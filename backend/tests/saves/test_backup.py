"""SQLite 在线备份脚本的安全性与一致性。"""

import json
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "scripts" / "backup_db.py"


def test_online_backup_is_consistent_and_never_overwrites(tmp_path: Path) -> None:
    source = tmp_path / "source.db"
    output = tmp_path / "backup.db"
    with sqlite3.connect(source) as database:
        database.execute("PRAGMA journal_mode=WAL")
        for table in ("saves", "ops", "snapshots", "reports"):
            database.execute(f'CREATE TABLE "{table}" (id TEXT PRIMARY KEY)')
            database.execute(f'INSERT INTO "{table}" VALUES (?)', (f"{table}-1",))

    completed = subprocess.run(
        [sys.executable, str(SCRIPT), "--source", str(source), "--output", str(output)],
        check=True,
        capture_output=True,
        text=True,
    )
    result = json.loads(completed.stdout)
    assert result["integrity_check"] == "ok"
    assert result["rows"] == {"saves": 1, "ops": 1, "snapshots": 1, "reports": 1}
    with sqlite3.connect(output) as database:
        assert database.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert database.execute("SELECT id FROM saves").fetchone()[0] == "saves-1"

    repeated = subprocess.run(
        [sys.executable, str(SCRIPT), "--source", str(source), "--output", str(output)],
        check=False,
        capture_output=True,
        text=True,
    )
    assert repeated.returncode == 1
    assert "拒绝覆盖" in repeated.stderr
