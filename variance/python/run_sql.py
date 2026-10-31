"""Load a cycle count CSV into SQLite and run the queries in queries.sql.

Usage:
    python run_sql.py sample_count.csv            # run every query
    python run_sql.py sample_count.csv accuracy   # run one by name
"""
from __future__ import annotations

import re
import sqlite3
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).parent


def load_queries(path: Path = HERE / "queries.sql") -> dict[str, str]:
    """Split queries.sql on '-- name:' markers into {name: sql}."""
    text = path.read_text(encoding="utf-8")
    parts = re.split(r"^-- name:\s*(\w+)\s*$", text, flags=re.M)
    return {parts[i]: parts[i + 1].strip() for i in range(1, len(parts), 2)}


def connect(csv_path) -> sqlite3.Connection:
    """In-memory database with the count loaded as table `counts` and the line_variance view created."""
    df = pd.read_csv(csv_path)
    df["counter"] = df.get("counter", "").fillna("")
    con = sqlite3.connect(":memory:")
    df.to_sql("counts", con, index=False)
    con.executescript(load_queries()["line_variance"])
    return con


def run(con: sqlite3.Connection, name: str) -> pd.DataFrame:
    return pd.read_sql_query(load_queries()[name], con)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    con = connect(sys.argv[1])
    names = sys.argv[2:] or [n for n in load_queries() if n != "line_variance"]
    with pd.option_context("display.width", 140, "display.max_columns", 20):
        for n in names:
            print(f"\n== {n} ==")
            print(run(con, n).to_string(index=False))
