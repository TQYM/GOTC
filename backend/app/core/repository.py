"""SQLite WAL 事件溯源仓储；所有写操作在单个事务中提交。"""

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import aiosqlite

SCHEMA = """
CREATE TABLE IF NOT EXISTS saves (
    save_id TEXT PRIMARY KEY,
    city_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    seed INTEGER NOT NULL,
    city_year INTEGER NOT NULL,
    phase TEXT NOT NULL,
    last_seq INTEGER NOT NULL DEFAULT 0,
    parcel_id TEXT NOT NULL,
    data_version TEXT NOT NULL,
    sim_config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ops (
    save_id TEXT NOT NULL REFERENCES saves(save_id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    op_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    client_op_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY(save_id, seq),
    UNIQUE(save_id, client_op_id)
);
CREATE TABLE IF NOT EXISTS snapshots (
    save_id TEXT NOT NULL REFERENCES saves(save_id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    state_json TEXT NOT NULL,
    PRIMARY KEY(save_id, seq)
);
CREATE TABLE IF NOT EXISTS reports (
    save_id TEXT NOT NULL REFERENCES saves(save_id) ON DELETE CASCADE,
    report_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY(save_id, report_id)
);
CREATE INDEX IF NOT EXISTS idx_reports_save_created ON reports(save_id, created_at DESC);
"""


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


class SaveRepository:
    def __init__(self, path: str | Path, *, snapshot_interval: int = 50) -> None:
        self.path = Path(path)
        self.snapshot_interval = snapshot_interval
        self._db: aiosqlite.Connection | None = None
        self._write_lock = asyncio.Lock()

    @property
    def db(self) -> aiosqlite.Connection:
        if self._db is None:
            raise RuntimeError("SaveRepository 尚未 initialize")
        return self._db

    async def initialize(self) -> None:
        if self._db is not None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._db = await aiosqlite.connect(self.path)
        self._db.row_factory = aiosqlite.Row
        await self._db.execute("PRAGMA foreign_keys=ON")
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute("PRAGMA synchronous=NORMAL")
        await self._db.executescript(SCHEMA)
        await self._db.commit()

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    async def health(self) -> dict[str, Any]:
        row = await self.db.execute_fetchall("SELECT COUNT(*) AS count FROM saves")
        return {"status": "ok", "saves": row[0]["count"], "path": str(self.path)}

    async def get_record(self, city_code: str) -> dict[str, Any] | None:
        rows = await self.db.execute_fetchall(
            "SELECT * FROM saves WHERE city_code=?", (city_code.upper(),)
        )
        return dict(rows[0]) if rows else None

    async def create_save(
        self, *, record: dict[str, Any], snapshot: dict[str, Any], created_at: str
    ) -> None:
        await self.db.execute(
            """INSERT INTO saves(
                save_id,city_code,name,seed,city_year,phase,last_seq,parcel_id,
                data_version,sim_config_json,created_at,updated_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                record["save_id"], record["city_code"], record["name"], record["seed"],
                1, "briefing", 0, record["parcel_id"], record["data_version"],
                _json(snapshot["sim_config"]), created_at, created_at,
            ),
        )
        await self.db.execute(
            "INSERT INTO snapshots(save_id,seq,state_json) VALUES(?,?,?)",
            (record["save_id"], 0, _json(snapshot)),
        )
        await self.db.commit()

    async def get_operation(self, save_id: str, client_op_id: str) -> dict[str, Any] | None:
        rows = await self.db.execute_fetchall(
            "SELECT * FROM ops WHERE save_id=? AND client_op_id=?", (save_id, client_op_id)
        )
        return dict(rows[0]) if rows else None

    async def append_operation(
        self,
        *,
        save_id: str,
        expected_seq: int,
        op_type: str,
        payload: dict[str, Any],
        result: dict[str, Any],
        client_op_id: str,
        snapshot: dict[str, Any],
    ) -> tuple[bool, dict[str, Any]]:
        """返回 (是否新提交, 首次/本次结果)；唯一约束兜底重复请求。"""
        await self._write_lock.acquire()
        await self.db.execute("BEGIN IMMEDIATE")
        try:
            existing = await self.db.execute_fetchall(
                "SELECT result_json FROM ops WHERE save_id=? AND client_op_id=?",
                (save_id, client_op_id),
            )
            if existing:
                await self.db.commit()
                return False, json.loads(existing[0]["result_json"])
            rows = await self.db.execute_fetchall(
                "SELECT last_seq FROM saves WHERE save_id=?", (save_id,)
            )
            if not rows or rows[0]["last_seq"] != expected_seq - 1:
                raise RuntimeError(
                    f"op seq 冲突: save={save_id} expected={expected_seq} "
                    f"actual={rows[0]['last_seq'] if rows else 'missing'}"
                )
            created_at = utc_now()
            await self.db.execute(
                """INSERT INTO ops(
                    save_id,seq,op_type,payload_json,result_json,client_op_id,created_at
                ) VALUES(?,?,?,?,?,?,?)""",
                (
                    save_id, expected_seq, op_type, _json(payload), _json(result),
                    client_op_id, created_at,
                ),
            )
            await self.db.execute(
                """UPDATE saves SET city_year=?,phase=?,last_seq=?,updated_at=?
                   WHERE save_id=?""",
                (
                    snapshot["at_year"], snapshot["phase"], expected_seq, created_at, save_id,
                ),
            )
            if expected_seq % self.snapshot_interval == 0:
                await self.db.execute(
                    "INSERT INTO snapshots(save_id,seq,state_json) VALUES(?,?,?)",
                    (save_id, expected_seq, _json(snapshot)),
                )
            await self.db.commit()
            return True, result
        except Exception:
            await self.db.rollback()
            raise
        finally:
            self._write_lock.release()

    async def update_phase(self, save_id: str, phase: str, city_year: int) -> None:
        async with self._write_lock:
            await self.db.execute(
                "UPDATE saves SET phase=?,city_year=?,updated_at=? WHERE save_id=?",
                (phase, city_year, utc_now(), save_id),
            )
            await self.db.commit()

    async def load_state(
        self, city_code: str
    ) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]] | None:
        record = await self.get_record(city_code)
        if record is None:
            return None
        snapshots = await self.db.execute_fetchall(
            "SELECT seq,state_json FROM snapshots WHERE save_id=? ORDER BY seq DESC LIMIT 1",
            (record["save_id"],),
        )
        if not snapshots:
            raise RuntimeError(f"存档 {record['save_id']} 缺少初始快照")
        snapshot = json.loads(snapshots[0]["state_json"])
        rows = await self.db.execute_fetchall(
            "SELECT * FROM ops WHERE save_id=? AND seq>? ORDER BY seq",
            (record["save_id"], snapshots[0]["seq"]),
        )
        return record, snapshot, [dict(row) for row in rows]

    async def add_report(self, save_id: str, report: dict[str, Any]) -> None:
        await self._write_lock.acquire()
        await self.db.execute("BEGIN IMMEDIATE")
        try:
            await self.db.execute(
                "INSERT INTO reports(save_id,report_id,created_at,payload_json) VALUES(?,?,?,?)",
                (save_id, report["report_id"], report["created_at"], _json(report)),
            )
            await self.db.execute(
                """DELETE FROM reports WHERE save_id=? AND report_id NOT IN (
                    SELECT report_id FROM reports WHERE save_id=?
                    ORDER BY created_at DESC,rowid DESC LIMIT 20
                )""",
                (save_id, save_id),
            )
            await self.db.commit()
        except Exception:
            await self.db.rollback()
            raise
        finally:
            self._write_lock.release()

    async def update_report(self, save_id: str, report: dict[str, Any]) -> None:
        async with self._write_lock:
            await self.db.execute(
                "UPDATE reports SET payload_json=? WHERE save_id=? AND report_id=?",
                (_json(report), save_id, report["report_id"]),
            )
            await self.db.commit()

    async def list_reports(self, save_id: str) -> list[dict[str, Any]]:
        rows = await self.db.execute_fetchall(
            """SELECT payload_json FROM reports WHERE save_id=?
               ORDER BY created_at DESC,rowid DESC LIMIT 20""",
            (save_id,),
        )
        return [json.loads(row["payload_json"]) for row in rows]
