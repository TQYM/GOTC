#!/usr/bin/env python3
"""使用 SQLite 在线 backup API 创建一致性存档备份，不复制 WAL 文件。"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path

TABLES = ("saves", "ops", "snapshots", "reports")


def counts(database: sqlite3.Connection) -> dict[str, int]:
    existing = {
        row[0]
        for row in database.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    return {
        table: database.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
        for table in TABLES
        if table in existing
    }


def backup(source_path: Path, output_path: Path) -> dict[str, object]:
    source_path = source_path.expanduser().resolve()
    output_path = output_path.expanduser().resolve()
    if not source_path.is_file():
        raise ValueError(f"源数据库不存在：{source_path}")
    if source_path == output_path:
        raise ValueError("备份目标不能覆盖正在运行的数据库")
    if output_path.exists():
        raise ValueError(f"备份目标已存在，拒绝覆盖：{output_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # mode=ro 防止路径写错时创建空库；backup() 在源库在线、WAL 模式下也保持一致。
    with closing(sqlite3.connect(f"{source_path.as_uri()}?mode=ro", uri=True)) as source:
        source.execute("PRAGMA query_only = ON")
        with closing(sqlite3.connect(output_path)) as target:
            source.backup(target)
            integrity = target.execute("PRAGMA integrity_check").fetchone()[0]
            if integrity != "ok":
                output_path.unlink(missing_ok=True)
                raise ValueError(f"备份完整性检查失败：{integrity}")
            target_counts = counts(target)
        source_counts = counts(source)
    if source_counts != target_counts:
        output_path.unlink(missing_ok=True)
        raise ValueError(f"备份行数校验失败：source={source_counts}, backup={target_counts}")
    return {
        "source": str(source_path),
        "output": str(output_path),
        "integrity_check": "ok",
        "rows": target_counts,
        "bytes": output_path.stat().st_size,
    }


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path(os.environ.get("CITY20_DATABASE_PATH", root / "data" / "city20.db")),
    )
    parser.add_argument("--output", type=Path, default=root / "backups" / f"city20-{stamp}.db")
    args = parser.parse_args()
    try:
        result = backup(args.source, args.output)
    except (OSError, sqlite3.Error, ValueError) as exc:
        print(f"备份失败：{exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
