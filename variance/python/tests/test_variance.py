"""Tests for the Python and SQL versions of Variance.

The parity test is the important one: the pandas port must give the same likely cause
for every variance line, and the same metrics, as the JavaScript engine behind the live tool.
"""
import json
import sys
from pathlib import Path

import pytest
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))

import run_sql  # noqa: E402
import variance_analyzer as va  # noqa: E402

SAMPLE = ROOT / "sample_count.csv"
EXPECTED = json.loads((HERE / "expected_from_js.json").read_text())

PLANTED = [
    ("BAT-5100", "C-14-02", "mislocated"), ("BAT-5100", "C-15-04", "mislocated"),
    ("ALT-2400", "D-03-01", "mislocated"), ("ALT-2400", "D-21-03", "mislocated"),
    ("CLP-5005", "B-06-02", "uom"), ("SPK-7002", "A-09-04", "uom"),
    ("BRK-3301", "E-11-03", "transposed"),
    ("LMP-9005", "E-12-01", "swap"), ("LMP-9006", "E-12-02", "swap"),
    ("SEN-3200", "F-02-05", "timing"), ("STR-2500", "B-19-02", "timing"),
    ("PMP-4100", "A-22-01", "empty"), ("BRK-4410", "F-17-03", "empty"),
    ("SEN-3100", "D-08-04", "found"),
]


@pytest.fixture(scope="module")
def result():
    return va.analyze(va.load_count(SAMPLE), threshold=1000, recent_days=3)


@pytest.fixture(scope="module")
def con():
    return run_sql.connect(SAMPLE)


# ---------------------------------------------------------------- pandas port

@pytest.mark.parametrize("sku,loc,pattern", PLANTED)
def test_planted_patterns_detected(result, sku, loc, pattern):
    row = result.variances[(result.variances["sku"] == sku) & (result.variances["location"] == loc)]
    assert len(row) == 1
    assert row.iloc[0]["pattern"] == pattern


def test_counter_flagged(result):
    assert result.flagged_counters == ["C-07"]


def test_every_line_matches_javascript(result):
    py = {(r.sku, r.location): r.pattern for r in result.variances.itertuples()}
    js = {(p["sku"], p["location"]): p["pattern"] for p in EXPECTED["patterns"]}
    assert py == js


def test_partners_match_javascript(result):
    py = {(r.sku, r.location): r.partner for r in result.variances.itertuples()}
    js = {(p["sku"], p["location"]): p["partner"] for p in EXPECTED["patterns"]}
    assert py == js


@pytest.mark.parametrize("key", ["lines", "varianceLines", "gross", "net", "grossAccuracy", "netAccuracy", "locationAccuracy", "overThreshold"])
def test_metrics_match_javascript(result, key):
    assert result.summary[key] == pytest.approx(EXPECTED["summary"][key], rel=1e-9)


def test_pareto_matches_javascript(result):
    assert result.for80 == EXPECTED["for80"]


def test_gross_never_below_net(result):
    s = result.summary
    assert s["gross"] >= abs(s["net"])
    assert s["grossAccuracy"] <= s["netAccuracy"]


def test_report_has_writeups(result):
    text = va.report(result)
    assert text.count("**Observation.**") == result.summary["overThreshold"]
    assert "C-07" in text


def test_explanation_names_the_offsetting_slot(result):
    v = result.variances[(result.variances["sku"] == "BAT-5100") & (result.variances["location"] == "C-14-02")].iloc[0]
    x = va.explain(v)
    assert "system 18, counted 6" in x["observation"]
    assert "C-15-04" in x["mechanism"]


def test_header_synonyms(tmp_path):
    f = tmp_path / "c.csv"
    f.write_text("Bin,Item Number,On Hand,Physical Qty,Std Cost\nA-01-01,X1,10,8,2.50\n")
    df = va.load_count(f)
    assert list(df[["location", "sku", "system", "counted", "cost"]].iloc[0]) == ["A-01-01", "X1", 10, 8, 2.5]


def test_missing_required_column(tmp_path):
    f = tmp_path / "c.csv"
    f.write_text("location,sku,system_qty\nA-01-01,X1,10\n")
    with pytest.raises(ValueError, match="counted"):
        va.load_count(f)


def test_aisle_of():
    assert va.aisle_of("E-12-01") == "E-12"
    assert va.aisle_of("E-12") == "E"
    assert va.aisle_of("BULK") == "BULK"


# ---------------------------------------------------------------- SQL version

def test_sql_accuracy_matches_python(con, result):
    row = run_sql.run(con, "accuracy").iloc[0]
    s = result.summary
    assert row["lines"] == s["lines"]
    assert row["variance_lines"] == s["varianceLines"]
    assert row["gross_variance"] == pytest.approx(s["gross"], abs=0.01)
    assert row["net_variance"] == pytest.approx(s["net"], abs=0.01)
    assert row["gross_accuracy"] == pytest.approx(round(s["grossAccuracy"], 4))
    assert row["net_accuracy"] == pytest.approx(round(s["netAccuracy"], 4))


def test_sql_pareto_reaches_80_percent_at_same_line(con, result):
    df = run_sql.run(con, "pareto")
    assert int((df["cumulative_share"] < 0.8).sum() + 1) == result.for80
    assert df["cumulative_share"].iloc[-1] == pytest.approx(1.0)


def test_sql_finds_planted_mislocations(con):
    pairs = set(map(tuple, run_sql.run(con, "mislocated_pairs")[["sku", "over_location", "short_location"]].values))
    assert ("BAT-5100", "C-15-04", "C-14-02") in pairs
    assert ("ALT-2400", "D-21-03", "D-03-01") in pairs


def test_sql_finds_uom_errors(con):
    df = run_sql.run(con, "uom_candidates")
    got = dict(zip(df["sku"], df["pack_size"]))
    assert got.get("CLP-5005") == 12 and got.get("SPK-7002") == 24


def test_sql_flags_same_counter(con, result):
    df = run_sql.run(con, "counter_rates")
    assert df[df["flagged"] == 1]["counter"].tolist() == result.flagged_counters


# ---------------------------------------------------------------- tunable settings

def test_explicit_defaults_change_nothing(result):
    again = va.analyze(va.load_count(SAMPLE), threshold=1000, recent_days=3, **va.DEFAULTS)
    assert list(again.variances["pattern"]) == list(result.variances["pattern"])


def test_tuned_settings_match_javascript():
    tuned = json.loads((HERE / "expected_tuned_from_js.json").read_text())
    r = va.analyze(va.load_count(SAMPLE), threshold=1000, recent_days=3, **tuned["settings"])
    py = {(x.sku, x.location): x.pattern for x in r.variances.itertuples()}
    js = {(p["sku"], p["location"]): p["pattern"] for p in tuned["patterns"]}
    assert py == js


def test_unknown_setting_rejected():
    with pytest.raises(TypeError, match="pair_tol"):
        va.analyze(va.load_count(SAMPLE), pair_tol=0.2)


# ---------------------------------------------------------------- transaction history evidence

TXNS = ROOT / "sample_transactions.csv"
EVIDENCE = json.loads((HERE / "expected_evidence_from_js.json").read_text())


@pytest.fixture(scope="module")
def with_evidence():
    r = va.analyze(va.load_count(SAMPLE), threshold=1000, recent_days=3)
    va.attach_evidence(r, va.load_transactions(TXNS), recent_days=3)
    return r


def test_evidence_tally_matches_javascript(with_evidence):
    assert with_evidence.evidence == EVIDENCE["tally"]


def test_evidence_matches_javascript_line_by_line(with_evidence):
    py = {(x.sku, x.location): (x.evidence_status, x.evidence) for x in with_evidence.variances.itertuples()}
    js = {(e["sku"], e["location"]): (e["status"], e["text"]) for e in EVIDENCE["lines"]}
    assert py == js


def test_report_cites_evidence(with_evidence):
    text = va.report(with_evidence)
    assert "**Evidence.** History shows a replenishment of 12 from C-14-02 to C-15-04" in text
    assert "matches transfers for 2 and supports 6" in text


def test_bad_transaction_file(tmp_path):
    f = tmp_path / "t.csv"
    f.write_text("a,b\n1,2\n")
    with pytest.raises(ValueError, match="from/to"):
        va.load_transactions(f)


def test_sql_confirms_battery_mislocation_only():
    con = run_sql.connect(SAMPLE, TXNS)
    df = run_sql.run(con, "confirmed_mislocations")
    assert list(map(tuple, df[["sku", "short_location", "over_location"]].values)) == [("BAT-5100", "C-14-02", "C-15-04")]


def test_sql_activity_before_count_finds_timing_lines(with_evidence):
    con = run_sql.connect(SAMPLE, TXNS)
    found = set(run_sql.run(con, "activity_before_count")["sku"])
    confirmed_timing = set(with_evidence.variances.query("pattern == 'timing' and evidence_status == 'supported'")["sku"])
    assert confirmed_timing <= found


# ---------------------------------------------------------------- count over count

PRIOR = ROOT / "sample_prior_count.csv"
COMPARE = json.loads((HERE / "expected_compare_from_js.json").read_text())


@pytest.fixture(scope="module")
def comparison(result):
    return va.compare_counts(va.analyze(va.load_count(PRIOR), threshold=1000, recent_days=3), result)


def test_compare_repeats_match_javascript(comparison):
    py = comparison["repeats"].to_dict("records")
    js = COMPARE["repeats"]
    assert [(r["sku"], r["location"]) for r in py] == [(r["sku"], r["location"]) for r in js]
    for p, j in zip(py, js):
        assert (p["prev_qty"], p["qty"], p["prev_pattern"], p["pattern"], bool(p["same_direction"])) == \
               (j["prevQty"], j["qty"], j["prevPattern"], j["pattern"], j["sameDirection"])
        assert p["prev_dollars"] == pytest.approx(j["prevDollars"]) and p["dollars"] == pytest.approx(j["dollars"])


@pytest.mark.parametrize("key", ["fresh", "resolved", "notRecounted"])
def test_compare_counts_match_javascript(comparison, key):
    assert comparison[key] == COMPARE[key]


@pytest.mark.parametrize("key", ["repeatGross", "freshGross", "resolvedGross"])
def test_compare_dollars_match_javascript(comparison, key):
    assert comparison[key] == pytest.approx(COMPARE[key])


def test_compare_deltas_and_causes_match_javascript(comparison):
    for k, v in COMPARE["delta"].items():
        assert comparison["delta"][k] == pytest.approx(v, rel=1e-9, abs=1e-12)
    assert [(c["key"], c["prevCount"], c["count"]) for c in comparison["causes"]] == [(c["key"], c["prevCount"], c["count"]) for c in COMPARE["causes"]]
    for p, j in zip(comparison["causes"], COMPARE["causes"]):
        assert p["prevGross"] == pytest.approx(j["prevGross"]) and p["gross"] == pytest.approx(j["gross"])
    assert [s["sku"] for s in comparison["repeatSkus"]] == [s["sku"] for s in COMPARE["repeatSkus"]]


def test_compare_report_lists_repeats(comparison):
    text = va.compare_report(comparison)
    assert "| C-14-02 | BAT-5100 | -8 | -12 | Mislocated stock |" in text


def test_sql_repeat_variances_match_python(comparison):
    con = run_sql.connect(SAMPLE, prior_path=PRIOR)
    df = run_sql.run(con, "repeat_variances")
    assert set(zip(df["sku"], df["location"])) == set(zip(comparison["repeats"]["sku"], comparison["repeats"]["location"]))


@pytest.mark.parametrize("change", ["quantity", "future"])
def test_unrelated_transfer_does_not_confirm_evidence(change):
    result = va.analyze(va.load_count(SAMPLE))
    tx = va.load_transactions(TXNS)
    if change == "quantity":
        tx.loc[tx.sku == "BAT-5100", "qty"] = 1
    else:
        tx.loc[tx.sku == "BAT-5100", "date"] = pd.Timestamp("2026-11-10")
    va.attach_evidence(result, tx)
    assert not (result.variances.loc[result.variances.sku == "BAT-5100", "evidence_status"] == "confirmed").any()


@pytest.mark.parametrize("change", ["quantity", "future"])
def test_sql_requires_matching_transfer_quantity_and_date(change):
    con = run_sql.connect(SAMPLE, TXNS)
    if change == "quantity":
        con.execute("UPDATE transactions SET qty=1 WHERE sku='BAT-5100'")
    else:
        con.execute("UPDATE transactions SET date='2026-11-10' WHERE sku='BAT-5100'")
    assert run_sql.run(con, "confirmed_mislocations").empty


# ---------------------------------------------------------------- ABC value classes

ABC_EXPECTED = json.loads((HERE / "expected_abc_from_js.json").read_text())


def _frame(pairs):
    return pd.DataFrame({"sku": [p[0] for p in pairs], "book_value": [p[1] for p in pairs]})


@pytest.mark.parametrize("pairs,expected", [
    ([("X", 85), ("Y", 10), ("Z", 5)], {"X": "A", "Y": "B", "Z": "C"}),
    ([("X", 70), ("Y", 20), ("Z", 10)], {"X": "A", "Y": "A", "Z": "B"}),
    ([("X", 30), ("X", 50), ("Y", 20)], {"X": "A", "Y": "B"}),
    ([("X", 90), ("B2", 5), ("A1", 5)], {"X": "A", "A1": "B", "B2": "C"}),
    ([("X", 0)], {"X": "C"}),
])
def test_abc_rule_matches_hand_examples(pairs, expected):
    assert va.abc_classes(_frame(pairs)) == expected


def test_abc_classes_match_javascript(result):
    assert dict(zip(result.lines["sku"], result.lines["abc"])) == ABC_EXPECTED["classes"]


@pytest.mark.parametrize("key", ["skus", "lines", "varianceLines", "bookValue", "bookShare", "gross", "grossShare", "grossAccuracy", "locationAccuracy"])
def test_abc_summary_matches_javascript(result, key):
    for py, js in zip(result.abc, ABC_EXPECTED["abc"]):
        assert py["cls"] == js["cls"]
        assert py[key] == pytest.approx(js[key], rel=1e-9)


def test_abc_in_report(result):
    assert "## Accuracy by value class" in va.report(result)


# ---------------------------------------------------------------- the SQL note

def test_sql_note_shows_the_real_queries_and_results():
    import html
    note = (ROOT.parent.parent / "notes/variance-sql.html").read_text()
    queries = run_sql.load_queries()
    for name in ["line_variance", "pareto", "mislocated_pairs", "repeat_variances"]:
        assert html.escape(queries[name]) in note, f"{name} in the note matches queries.sql"
    con = run_sql.connect(SAMPLE, prior_path=ROOT / "sample_prior_count.csv")
    pareto = run_sql.run(con, "pareto")
    cross = int((pareto["cumulative_share"] < 0.8).sum()) + 1
    rep = run_sql.run(con, "repeat_variances")
    same = int((rep["direction"] == "same direction").sum())
    for quoted in [f"so {cross} of {len(pareto)} lines", f"{pareto['cumulative_share'][1] * 100:.2f}%",
                   f"{pareto['cumulative_share'][cross - 1] * 100:.2f}%", f"{len(rep)} lines are off in both counts, and {same} of them",
                   *[f"${d:,.2f}" for d in run_sql.run(con, "mislocated_pairs")["dollars_moved"]]]:
        assert quoted in note, quoted
