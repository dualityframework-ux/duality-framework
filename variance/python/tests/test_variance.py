"""Tests for the Python and SQL versions of Variance.

The parity test is the important one: the pandas port must give the same likely cause
for every variance line, and the same metrics, as the JavaScript engine behind the live tool.
"""
import json
import sys
from pathlib import Path

import pytest

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
