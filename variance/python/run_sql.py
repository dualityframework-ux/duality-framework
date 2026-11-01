"""Load a cycle count CSV into SQLite and run the queries in queries.sql.

Usage:
    python run_sql.py sample_count.csv                     # run every count query
    python run_sql.py sample_count.csv accuracy            # run one by name
    python run_sql.py sample_count.csv --tx sample_transactions.csv confirmed_mislocations
    python run_sql.py sample_count.csv --prior sample_prior_count.csv repeat_variances
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


def connect(csv_path, transactions_path=None, prior_path=None) -> sqlite3.Connection:
    """In-memory database with the count as table `counts` (optionally `transactions` and `prior_counts`) plus the line_variance view."""
    df = pd.read_csv(csv_path)
    df["counter"] = df.get("counter", "").fillna("")
    con = sqlite3.connect(":memory:")
    df.to_sql("counts", con, index=False)
    if transactions_path is not None:
        tx = pd.read_csv(transactions_path, dtype=str, keep_default_na=False)
        tx["qty"] = pd.to_numeric(tx["qty"], errors="coerce")
        tx.to_sql("transactions", con, index=False)
    if prior_path is not None:
        prior = pd.read_csv(prior_path)
        prior["counter"] = prior.get("counter", "").fillna("")
        prior.to_sql("prior_counts", con, index=False)
    con.executescript(load_queries()["line_variance"])
    return con


def run(con: sqlite3.Connection, name: str) -> pd.DataFrame:
    return pd.read_sql_query(load_queries()[name], con)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    args = sys.argv[1:]
    tx = None
    if "--tx" in args:
        i = args.index("--tx"); tx = args[i + 1]; del args[i:i + 2]
    prior = None
    if "--prior" in args:
        i = args.index("--prior"); prior = args[i + 1]; del args[i:i + 2]
    con = connect(args[0], tx, prior)
    needs_tx = {"confirmed_mislocations", "activity_before_count"}
    needs_prior = {"repeat_variances"}
    names = args[1:] or [n for n in load_queries() if n != "line_variance" and (tx or n not in needs_tx) and (prior or n not in needs_prior)]
    with pd.option_context("display.width", 140, "display.max_columns", 20):
        for n in names:
            print(f"\n== {n} ==")
            print(run(con, n).to_string(index=False))
