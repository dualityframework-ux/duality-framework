# Variance in Python and SQL

The same cycle count analysis as the [live Variance tool](https://dualityframework-ux.github.io/duality-framework/variance/), written two more ways:

- **`variance_analyzer.py`**: a pandas port of the full engine, with a command-line report.
- **`queries.sql`**: the core analyses as plain SQLite queries.

A parity test checks that the pandas version gives **the same likely cause for every variance line, the same paired slots and the same metrics** as the JavaScript engine behind the website, using its exported output as the fixture.

## Run it

```bash
pip install -r requirements.txt

# Markdown report: accuracy, causes, and a drafted write-up for every line over the threshold
python variance_analyzer.py sample_count.csv --threshold 1000 --out report.md

# Tune detection for your building
python variance_analyzer.py sample_count.csv --packs 6,12,24 --pair-tolerance 0.1 --min-pair-units 5

# SQL: load the CSV into SQLite and run every query, or one by name
python run_sql.py sample_count.csv
python run_sql.py sample_count.csv mislocated_pairs

# Tests (40), including parity with the JavaScript engine at default and tuned settings
pytest -q
```

See [`example_report.md`](example_report.md) for the output on the sample count.

## What's in the SQL

| Query | Technique |
| --- | --- |
| `line_variance` | View with variance units, dollars and book value per line |
| `accuracy` | Gross, net and location accuracy in one aggregate |
| `pareto` | Running share of gross variance with a window function (`SUM() OVER (ORDER BY …)`) |
| `mislocated_pairs` | Self-join on SKU: over in one slot, short by about the same amount in another |
| `uom_candidates` | Join against a pack-size table to find exact case/each multiples |
| `counter_rates` | Each counter's variance rate against the team rate, from a CTE |

## How the pandas version is organized

- `load_count` reads the CSV and matches common header names (`Bin`, `On Hand`, `Physical Qty`, `Std Cost`…) to standard columns.
- `analyze` runs the checks in the same order as the browser tool (mislocated, UOM, transposed, swap, timing, empty, found, counter) and returns metrics, the Pareto, causes and counter rates.
- `explain` drafts each write-up as observation → mechanism → implication; `report` assembles the markdown.

Transaction-history evidence is in the browser tool and `engine.js`; it has not been ported to Python yet.

The sample count is synthetic. No employer data was used.
