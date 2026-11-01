"""Variance: cycle count analysis and root-cause detection in pandas.

Same rules as the browser tool (../engine.js), so a count analyzed here gives the
same accuracy, the same Pareto and the same likely cause for every line.

Usage:
    python variance_analyzer.py sample_count.csv --threshold 1000 --out report.md
"""
from __future__ import annotations

import argparse
import re
from dataclasses import dataclass, field

import pandas as pd

# ---------------------------------------------------------------- column mapping

FIELDS = {
    "sku": ["sku", "item", "item number", "item_no", "item #", "part", "part number", "part_no", "product", "product id", "material"],
    "location": ["location", "loc", "bin", "slot", "location id", "bin location", "storage bin"],
    "system": ["system qty", "system_qty", "system", "book qty", "expected", "expected qty", "on hand", "on_hand", "wms qty", "qty on hand", "book"],
    "counted": ["counted qty", "counted_qty", "counted", "count", "physical", "physical qty", "actual", "actual qty", "count qty"],
    "cost": ["unit cost", "unit_cost", "cost", "price", "unit price", "std cost", "standard cost", "avg cost"],
    "description": ["description", "desc", "item description", "name", "product name"],
    "counter": ["counter", "counted by", "counter id", "user", "associate", "employee"],
    "count_date": ["count date", "count_date", "date counted", "counted on", "date"],
    "last_move": ["last movement", "last_move", "last movement date", "last activity", "last receipt", "last transaction", "last txn"],
}
REQUIRED = ["sku", "location", "system", "counted", "cost"]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9#]+", " ", str(s).lower()).strip()


def load_count(path_or_buffer) -> pd.DataFrame:
    """Read a cycle count CSV and rename its columns to the standard names."""
    raw = pd.read_csv(path_or_buffer, dtype=str, keep_default_na=False)
    headers = {_norm(c): c for c in raw.columns}
    rename = {}
    for key, names in FIELDS.items():
        hit = next((headers[h] for h in headers if h in names), None)
        if hit is None:
            hit = next((headers[h] for h in headers if any(n in h for n in names)), None)
        if hit is not None and hit not in rename:
            rename[hit] = key
    df = raw.rename(columns=rename)
    missing = [k for k in REQUIRED if k not in df.columns]
    if missing:
        raise ValueError(f"missing required columns: {', '.join(missing)}")
    for k in ("system", "counted", "cost"):
        df[k] = pd.to_numeric(df[k].str.replace(r"[$,\s]", "", regex=True), errors="coerce")
    for k in ("count_date", "last_move"):
        df[k] = pd.to_datetime(df[k], errors="coerce") if k in df.columns else pd.NaT
    for k in ("description", "counter"):
        if k not in df.columns:
            df[k] = ""
    df = df.dropna(subset=["system", "counted", "cost"])
    df = df[(df["sku"].str.strip() != "") & (df["location"].str.strip() != "")]
    return df.reset_index(drop=True)


# ---------------------------------------------------------------- pattern catalog

PATTERNS = {
    "mislocated": ("Mislocated stock",
                   "the same item is short in one location and over by about the same amount in another, which points to a put-away or replenishment move that went to the wrong slot",
                   "Move the stock back to its home location and correct both locations in one transfer, not two adjustments. Review the put-away that touched both slots."),
    "uom": ("Unit of measure",
            "the system and counted quantities differ by an exact pack multiple, which usually means cases were counted as eaches or eaches as cases",
            "Recount in the stocking unit and verify the item's UOM and case quantity in the item master before adjusting."),
    "transposed": ("Transposed digits",
                   "the counted quantity uses the same digits as the system quantity in a different order, which is the signature of a keying error",
                   "Recount before adjusting; if the recount matches the system, void the count. Check whether the original receipt was keyed correctly."),
    "swap": ("Look-alike swap",
             "two different items in the same aisle are off by about the same quantity in opposite directions, which suggests one was picked or put away as the other",
             "Count both items together and correct them as a pair. Consider separating the look-alike items or relabeling the slots."),
    "timing": ("Timing / unposted transaction",
               "the location had movement just before the count, so a receipt, pick or transfer may not have posted when the count was taken",
               "Check open receipts, picks and transfers for the item before adjusting. Recount after transactions post."),
    "empty": ("Empty location",
              "the location was counted at zero while the system shows stock, which points to an unrecorded move, a pick from the wrong slot or shrink",
              "Search overflow and nearby slots for the item first. If it is not found, adjust and log it for shrink review."),
    "found": ("Found stock",
              "stock was found where the system shows none, which usually means an unrecorded receipt or stock moved in without a transfer",
              "Check recent receipts and transfers for the item, then add the location and post the stock."),
    "counter": ("Counter accuracy",
                "this count came from a counter whose variance rate is well above the team's, so the count itself is the most likely error",
                "Have a different counter recount before adjusting, and review count procedure with the original counter."),
    "unexplained": ("Unexplained", "no common pattern matched, so the cause is not yet known",
                    "Recount, then review the item's transaction history since the last accurate count."),
}
ORDER = list(PATTERNS)
PACKS = [6, 8, 10, 12, 16, 20, 24, 25, 36, 48, 50, 100]
# Detection settings, matching DEFAULTS in ../engine.js.
DEFAULTS = {"pair_tolerance": 0.15, "swap_tolerance": 0.10, "min_pair_units": 3, "min_uom_units": 5, "packs": PACKS, "counter_min_lines": 8}


def aisle_of(loc: str) -> str:
    parts = [p for p in re.split(r"[-_.\s]", str(loc)) if p]
    if len(parts) > 1:
        return "-".join(parts[: 2 if len(parts) > 2 else 1])
    return parts[0] if parts else ""


def _close(a: float, b: float, tol: float) -> bool:
    return abs(abs(a) - abs(b)) <= tol * max(abs(a), abs(b))


# ---------------------------------------------------------------- analysis

@dataclass
class Result:
    lines: pd.DataFrame
    variances: pd.DataFrame          # variance lines, largest absolute dollars first
    summary: dict
    by_pattern: pd.DataFrame
    for80: int
    counters: pd.DataFrame
    flagged_counters: list = field(default_factory=list)
    threshold: float = 1000
    evidence: dict | None = None


def analyze(df: pd.DataFrame, threshold: float = 1000, recent_days: int = 3, **settings) -> Result:
    unknown = set(settings) - set(DEFAULTS)
    if unknown:
        raise TypeError(f"unknown settings: {', '.join(sorted(unknown))}")
    cfg = {**DEFAULTS, **{k: v for k, v in settings.items() if v is not None}}
    packs = sorted({int(k) for k in cfg["packs"] if int(k) > 1})
    lines = df.copy()
    lines["qty"] = lines["counted"] - lines["system"]
    lines["dollars"] = lines["qty"] * lines["cost"]
    lines["book_value"] = lines["system"].clip(lower=0) * lines["cost"]
    lines["pattern"] = None
    lines["partner"] = None
    lines["note"] = ""

    var = lines[lines["qty"] != 0]
    open_ = lambda idx: lines.loc[idx, "pattern"] is None  # noqa: E731

    # 1. Mislocated: same SKU, opposite signs, similar size, different locations.
    for _, grp in var.groupby("sku", sort=False):
        pos = grp[grp["qty"] > 0].sort_values("qty", ascending=False, kind="stable")
        neg = grp[grp["qty"] < 0].sort_values("qty", ascending=True, kind="stable")
        for pi, p in pos.iterrows():
            if p["qty"] < cfg["min_pair_units"]:
                continue
            for ni, n in neg.iterrows():
                if open_(ni) and n["location"] != p["location"] and _close(p["qty"], n["qty"], cfg["pair_tolerance"]):
                    if open_(pi):
                        lines.loc[[pi, ni], "pattern"] = "mislocated"
                        lines.at[pi, "partner"], lines.at[ni, "partner"] = n["location"], p["location"]
                    break

    # 2. Unit of measure: an exact pack multiple, with at least a 5-unit difference.
    for i, v in var.iterrows():
        if not open_(i) or v["system"] <= 0 or v["counted"] <= 0 or abs(v["qty"]) < cfg["min_uom_units"]:
            continue
        hi, lo = max(v["system"], v["counted"]), min(v["system"], v["counted"])
        pack = next((k for k in packs if abs(hi / lo - k) < 0.02 * k), None)
        if pack:
            lines.at[i, "pattern"] = "uom"
            lines.at[i, "note"] = f"{'counted' if v['counted'] > v['system'] else 'system'} is {pack}× the other"

    # 3. Transposed digits.
    for i, v in var.iterrows():
        if not open_(i):
            continue
        a, b = str(int(round(abs(v["system"])))), str(int(round(abs(v["counted"]))))
        if len(a) >= 2 and len(a) == len(b) and a != b and sorted(a) == sorted(b):
            lines.at[i, "pattern"] = "transposed"

    # 4. Look-alike swap: different SKUs in the same aisle, opposite signs, similar quantity.
    cand = [i for i in var.index if open_(i)][:4000]
    for x, i in enumerate(cand):
        if not open_(i):
            continue
        a = lines.loc[i]
        for j in cand[x + 1:]:
            b = lines.loc[j]
            if not open_(j) or a["sku"] == b["sku"] or (a["qty"] > 0) == (b["qty"] > 0):
                continue
            if aisle_of(a["location"]) != aisle_of(b["location"]) or not _close(a["qty"], b["qty"], cfg["swap_tolerance"]) or abs(a["qty"]) < 2:
                continue
            lines.loc[[i, j], "pattern"] = "swap"
            lines.at[i, "partner"] = f"{b['sku']} at {b['location']}"
            lines.at[j, "partner"] = f"{a['sku']} at {a['location']}"
            break

    # 5. Timing: movement within N days before the count.
    fallback = lines["count_date"].max()
    for i, v in var.iterrows():
        if not open_(i) or pd.isna(v["last_move"]):
            continue
        cd = v["count_date"] if not pd.isna(v["count_date"]) else fallback
        if pd.isna(cd):
            continue
        days = (cd - v["last_move"]).total_seconds() / 86400
        if 0 <= days <= recent_days:
            lines.at[i, "pattern"] = "timing"
            d = round(days)
            lines.at[i, "note"] = f"moved {d} day{'' if d == 1 else 's'} before the count"

    # 6-7. Empty and found.
    for i, v in var.iterrows():
        if not open_(i):
            continue
        if v["counted"] == 0 and v["system"] > 0:
            lines.at[i, "pattern"] = "empty"
        elif v["system"] <= 0 and v["counted"] > 0:
            lines.at[i, "pattern"] = "found"

    # 8. Counter accuracy: variance rate well above the team's.
    has_counter = lines[lines["counter"].astype(str).str.strip() != ""]
    counters = (has_counter.assign(is_var=has_counter["qty"] != 0, abs_dollars=has_counter["dollars"].abs().where(has_counter["qty"] != 0, 0))
                .groupby("counter", sort=False).agg(lines=("qty", "size"), variances=("is_var", "sum"), gross=("abs_dollars", "sum")).reset_index())
    counters["rate"] = counters["variances"] / counters["lines"]
    team_rate = (has_counter["qty"] != 0).mean() if len(has_counter) else 0.0
    flagged = counters[(counters["lines"] >= cfg["counter_min_lines"]) & (counters["rate"] >= max(2 * team_rate, team_rate + 0.1))]["counter"].tolist()
    for i in var.index:
        if open_(i) and lines.at[i, "counter"] in flagged:
            lines.at[i, "pattern"] = "counter"
    for i in var.index:
        if open_(i):
            lines.at[i, "pattern"] = "unexplained"

    # ------------------------------------------------------------ metrics
    var = lines[lines["qty"] != 0].copy()
    book, gross, net = lines["book_value"].sum(), var["dollars"].abs().sum(), var["dollars"].sum()
    summary = {
        "lines": len(lines), "varianceLines": len(var),
        "locationAccuracy": 1 - len(var) / len(lines) if len(lines) else 1.0,
        "bookValue": book, "gross": gross, "net": net,
        "grossAccuracy": 1 - gross / book if book else None,
        "netAccuracy": 1 - abs(net) / book if book else None,
        "overThreshold": int((var["dollars"].abs() >= threshold).sum()),
    }
    var["abs_dollars"] = var["dollars"].abs()
    var = var.sort_values("abs_dollars", ascending=False, kind="stable")
    var["cum_share"] = var["abs_dollars"].cumsum() / gross if gross else 0.0
    for80 = int((var["cum_share"] < 0.8 - 1e-12).sum() + 1) if len(var) else 0

    by_pattern = (var.groupby("pattern").agg(count=("qty", "size"), gross=("abs_dollars", "sum"), net=("dollars", "sum"))
                  .reindex([p for p in ORDER if p in set(var["pattern"])]).reset_index())
    by_pattern["name"] = by_pattern["pattern"].map(lambda k: PATTERNS[k][0])
    return Result(lines, var, summary, by_pattern, for80, counters.sort_values("rate", ascending=False), flagged, threshold)


# ---------------------------------------------------------------- transaction history evidence

TXN_FIELDS = {
    "date": ["date", "transaction date", "txn date", "created", "timestamp"],
    "sku": ["sku", "item", "item number", "part", "part number", "product", "material"],
    "from": ["from", "from location", "from loc", "source", "source location", "from bin"],
    "to": ["to", "to location", "to loc", "destination", "dest", "destination location", "to bin"],
    "qty": ["qty", "quantity", "units", "qty moved"],
    "type": ["type", "transaction type", "txn type", "activity", "reason"],
}


def load_transactions(path_or_buffer) -> pd.DataFrame:
    """Read a moves/receipts/picks CSV into columns date, sku, from, to, qty, type."""
    raw = pd.read_csv(path_or_buffer, dtype=str, keep_default_na=False)
    headers = [_norm(c) for c in raw.columns]
    rename, used = {}, set()
    for key, names in TXN_FIELDS.items():
        idx = next((i for i, h in enumerate(headers) if h in names), None)
        if idx is None:
            idx = next((i for i, h in enumerate(headers) if any(n in h for n in names)), None)
        if idx is not None and idx not in used:
            used.add(idx)
            rename[raw.columns[idx]] = key
    df = raw.rename(columns=rename)
    if "date" not in df or "sku" not in df or ("from" not in df and "to" not in df):
        raise ValueError("couldn't find date, SKU and from/to location columns in the transaction file")
    for k in ("from", "to", "type"):
        df[k] = df[k].str.strip() if k in df else ""
    df["type"] = df["type"].str.lower()
    df["qty"] = pd.to_numeric(df["qty"], errors="coerce") if "qty" in df else float("nan")
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["sku"] = df["sku"].str.strip()
    return df.dropna(subset=["date"])[df["sku"] != ""].reset_index(drop=True)


def _describe(t) -> str:
    q = t["qty"]
    qs = (str(int(q)) if float(q).is_integer() else str(q)) if pd.notna(q) else None
    if t["type"]:
        article = "an" if t["type"][0] in "aeiou" else "a"
        what = f"{article} {t['type']}" + (f" of {qs}" if qs else "")
    else:
        what = f"{qs} units moved" if qs else "stock moved"
    if t["from"] and t["to"]:
        where = f"from {t['from']} to {t['to']}"
    elif t["to"]:
        where = f"into {t['to']}"
    else:
        where = f"out of {t['from']}"
    return f"{what} {where} on {t['date'].strftime('%b')} {t['date'].day}"


def _newest_first(rows: list) -> list:
    return sorted(rows, key=lambda t: -t["date"].value)  # sorted() is stable, like the JS engine


def attach_evidence(r: Result, txns: pd.DataFrame, recent_days: int = 3) -> dict:
    """Mark each variance confirmed, supported or none, with a plain explanation. Same rules as engine.js."""
    by_sku: dict = {}
    for t in txns.to_dict("records"):
        by_sku.setdefault(t["sku"], []).append(t)
    by_sku = {k: _newest_first(v) for k, v in by_sku.items()}
    count_date = r.lines["count_date"].max()
    tally = {"confirmed": 0, "supported": 0, "none": 0}
    statuses, texts = [], []
    for _, v in r.variances.iterrows():
        rows = by_sku.get(v["sku"], [])
        cd = v["count_date"] if pd.notna(v["count_date"]) else count_date
        into = [t for t in rows if t["to"] == v["location"]]
        out_of = [t for t in rows if t["from"] == v["location"]]
        status, text = "none", "No transactions for this item and location in the history."
        if v["pattern"] == "mislocated" and v["partner"]:
            if v["qty"] > 0:
                exact = next((t for t in into if t["from"] == v["partner"]), None)
                loose = into[0] if into else None
            else:
                exact = next((t for t in out_of if t["to"] == v["partner"]), None)
                loose = next((t for t in rows if t["to"] == v["partner"]), None)
            if exact:
                status, text = "confirmed", f"History shows {_describe(exact)}, which matches the offsetting pair."
            elif loose:
                status, text = "supported", f"History shows {_describe(loose)}, not a move from the paired slot. Check where the stock came from."
        elif v["pattern"] == "timing":
            recent = [t for t in rows if (t["to"] == v["location"] or t["from"] == v["location"]) and pd.notna(cd)
                      and 0 <= (cd - t["date"]).total_seconds() / 86400 <= recent_days]
            if recent:
                status, text = "confirmed", "Activity just before the count: " + "; ".join(_describe(t) for t in recent) + "."
        elif v["pattern"] == "found":
            if into:
                status, text = "supported", f"History shows {_describe(into[0])}. The system doesn't show the stock, so the move may not have posted to this location."
        elif v["pattern"] == "empty":
            if out_of:
                status, text = "supported", f"Last activity was {_describe(out_of[0])}. Nothing has been put back since."
            elif into:
                status, text = "supported", f"History shows {_describe(into[0])} and no picks since, which points to an unrecorded move or shrink."
        elif into or out_of:
            last = _newest_first(into + out_of)[0]
            text = f"Most recent activity: {_describe(last)}. It doesn't confirm or rule out this cause."
        statuses.append(status)
        texts.append(text)
        tally[status] += 1
    r.variances["evidence_status"] = statuses
    r.variances["evidence"] = texts
    r.evidence = {**tally, "transactions": len(txns)}
    return r.evidence


# ---------------------------------------------------------------- explanations and report

def _money(n: float) -> str:
    return ("−$" if n < 0 else "$") + f"{abs(n):,.2f}"


def explain(v: pd.Series) -> dict:
    name, mechanism, action = PATTERNS[v["pattern"]]
    item = f"{v['sku']} ({v['description']})" if v.get("description") else v["sku"]
    q = int(v["qty"]) if float(v["qty"]).is_integer() else v["qty"]
    sign = "+" if q > 0 else "−"
    observation = (f"{item} at {v['location']}: system {v['system']:,.0f}, counted {v['counted']:,.0f}, "
                   f"a variance of {sign}{abs(q):,} units ({_money(v['dollars'])}).")
    mech = mechanism[0].upper() + mechanism[1:]
    if v.get("partner"):
        mech += (f". The offsetting variance is at {v['partner']}" if v["pattern"] == "mislocated"
                 else f". The paired variance is {v['partner']}")
    if v.get("note"):
        mech += f" ({v['note']})"
    ev = v.get("evidence") if v.get("evidence_status") in ("confirmed", "supported") else ""
    return {"observation": observation, "mechanism": mech + ".", "implication": action, "evidence": ev or ""}


# ---------------------------------------------------------------- count over count

def compare_counts(prev: Result, curr: Result) -> dict:
    """Compare two analyzed counts of the same area: accuracy change, causes, and lines that keep coming back."""
    key = ["sku", "location"]
    pv, cv = prev.variances, curr.variances
    prev_lines = prev.lines[key + ["qty"]].rename(columns={"qty": "prev_line_qty"})
    curr_lines = curr.lines[key + ["qty"]].rename(columns={"qty": "curr_line_qty"})
    m = cv.merge(prev_lines, on=key, how="left")
    is_repeat = m["prev_line_qty"].fillna(0) != 0
    rep = m[is_repeat].merge(pv[key + ["dollars", "pattern"]].rename(columns={"dollars": "prev_dollars", "pattern": "prev_pattern"}), on=key, how="left")
    repeats = pd.DataFrame({
        "sku": rep["sku"], "location": rep["location"], "description": rep["description"],
        "prev_qty": rep["prev_line_qty"], "prev_dollars": rep["prev_dollars"], "prev_pattern": rep["prev_pattern"],
        "qty": rep["qty"], "dollars": rep["dollars"], "pattern": rep["pattern"],
        "same_direction": (rep["prev_line_qty"] > 0) == (rep["qty"] > 0),
    })
    repeats["_size"] = repeats["prev_dollars"].abs() + repeats["dollars"].abs()
    repeats = repeats.sort_values(["_size", "location"], ascending=[False, True], kind="stable").drop(columns="_size").reset_index(drop=True)
    fresh = m[~is_repeat]
    back = pv.merge(curr_lines, on=key, how="left")
    resolved = back[back["curr_line_qty"] == 0]
    not_recounted = back[back["curr_line_qty"].isna()]

    ps, cs = pv.groupby("sku")["abs_dollars"].sum(), cv.groupby("sku")["abs_dollars"].sum()
    both = sorted(set(ps.index) & set(cs.index), key=lambda k: (-(ps[k] + cs[k]), k))
    repeat_skus = [{"sku": k, "prevGross": float(ps[k]), "gross": float(cs[k])} for k in both]

    pb, cb = prev.by_pattern.set_index("pattern"), curr.by_pattern.set_index("pattern")
    causes = [{"key": k, "name": PATTERNS[k][0],
               "prevCount": int(pb.at[k, "count"]) if k in pb.index else 0, "count": int(cb.at[k, "count"]) if k in cb.index else 0,
               "prevGross": float(pb.at[k, "gross"]) if k in pb.index else 0.0, "gross": float(cb.at[k, "gross"]) if k in cb.index else 0.0}
              for k in ORDER if k in pb.index or k in cb.index]
    delta = {k: (None if prev.summary[k] is None or curr.summary[k] is None else curr.summary[k] - prev.summary[k])
             for k in ("grossAccuracy", "netAccuracy", "locationAccuracy", "gross", "net", "varianceLines")}
    return {"prev": prev.summary, "curr": curr.summary, "delta": delta, "causes": causes, "repeats": repeats,
            "repeatGross": float(repeats["dollars"].abs().sum()), "fresh": int(len(fresh)), "freshGross": float(fresh["dollars"].abs().sum()),
            "resolved": int(len(resolved)), "resolvedGross": float(resolved["dollars"].abs().sum()),
            "notRecounted": int(len(not_recounted)), "repeatSkus": repeat_skus}


def compare_report(c: dict) -> str:
    p, s, d = c["prev"], c["curr"], c["delta"]
    pts = lambda x: f"{x * 100:+.2f} pts"
    out = ["## Compared with the previous count", "",
           f"- Gross accuracy: {p['grossAccuracy']:.2%} → {s['grossAccuracy']:.2%} ({pts(d['grossAccuracy'])})",
           f"- Net accuracy: {p['netAccuracy']:.2%} → {s['netAccuracy']:.2%} ({pts(d['netAccuracy'])})",
           f"- Gross variance: {_money(p['gross'])} → {_money(s['gross'])}",
           f"- {len(c['repeats'])} lines are off again ({_money(c['repeatGross'])} this count), {c['fresh']} are new, {c['resolved']} from last time now count clean",
           "", "| Location | SKU | Last count | This count | Cause now |", "| --- | --- | ---: | ---: | --- |"]
    for _, v in c["repeats"].iterrows():
        out.append(f"| {v['location']} | {v['sku']} | {int(v['prev_qty']):+d} | {int(v['qty']):+d} | {PATTERNS[v['pattern']][0]} |")
    return "\n".join(out)


def report(r: Result) -> str:
    s = r.summary
    out = ["# Variance report", "",
           f"- Lines counted: {s['lines']:,} ({s['varianceLines']} with a variance)",
           f"- Gross accuracy: {s['grossAccuracy']:.2%} · Net accuracy: {s['netAccuracy']:.2%}",
           f"- Gross variance: {_money(s['gross'])} · Net variance: {_money(s['net'])}",
           f"- {r.for80} lines drive 80% of gross variance",
           *([f"- Transaction history confirms {r.evidence['confirmed']} and supports {r.evidence['supported']} of {s['varianceLines']} lines"] if r.evidence else []), "",
           "## Likely causes", "", "| Cause | Lines | Gross $ | Share |", "| --- | ---: | ---: | ---: |"]
    for _, p in r.by_pattern.iterrows():
        out.append(f"| {p['name']} | {p['count']} | {_money(p['gross'])} | {p['gross'] / s['gross']:.0%} |")
    flagged = r.variances[r.variances["abs_dollars"] >= r.threshold]
    out += ["", f"## Needs a written root cause (≥ {_money(r.threshold)})", ""]
    if flagged.empty:
        out.append("No line reaches the threshold.")
    for _, v in flagged.iterrows():
        x = explain(v)
        out += [f"### {v['location']} · {v['sku']} · {_money(v['dollars'])}", "",
                f"**Observation.** {x['observation']}  ", f"**Mechanism.** {x['mechanism']}  ",
                *([f"**Evidence.** {x['evidence']}  "] if x["evidence"] else []),
                f"**Implication.** {x['implication']}", ""]
    if r.flagged_counters:
        out += ["## Counters", "", f"Flagged for a variance rate well above the team's: {', '.join(r.flagged_counters)}", ""]
    return "\n".join(out)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Analyze a cycle count CSV and draft root causes.")
    ap.add_argument("csv")
    ap.add_argument("--threshold", type=float, default=1000, help="dollar threshold for a written root cause")
    ap.add_argument("--recent-days", type=int, default=3, help="movement this close to the count counts as timing")
    ap.add_argument("--out", help="write the markdown report here instead of printing it")
    ap.add_argument("--transactions", help="optional CSV of moves, receipts and picks to confirm causes")
    ap.add_argument("--prior", help="optional earlier count of the same locations, to see what keeps coming back")
    ap.add_argument("--packs", help="comma-separated pack sizes for unit-of-measure checks, e.g. 6,12,24")
    ap.add_argument("--pair-tolerance", type=float, help="how close offsetting quantities must be, e.g. 0.15 for 15%%")
    ap.add_argument("--swap-tolerance", type=float, help="same, for look-alike swaps")
    ap.add_argument("--min-pair-units", type=float, help="smallest overage that counts as half of a mislocation")
    a = ap.parse_args(argv)
    settings = {"packs": [int(x) for x in a.packs.split(",")] if a.packs else None,
                "pair_tolerance": a.pair_tolerance, "swap_tolerance": a.swap_tolerance, "min_pair_units": a.min_pair_units}
    result = analyze(load_count(a.csv), a.threshold, a.recent_days, **settings)
    if a.transactions:
        attach_evidence(result, load_transactions(a.transactions), a.recent_days)
    text = report(result)
    if a.prior:
        text += "\n" + compare_report(compare_counts(analyze(load_count(a.prior), a.threshold, a.recent_days, **settings), result)) + "\n"
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(text + "\n")
        print(f"Report written to {a.out}")
    else:
        print(text)


if __name__ == "__main__":
    main()
