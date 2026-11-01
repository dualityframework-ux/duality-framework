/*
 * Variance engine: cycle-count analysis and root-cause pattern detection.
 * Pure functions, no DOM. Works in the browser (window.VarianceEngine) and in Node (module.exports).
 */
(function (root) {
  "use strict";

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = []; let row = [], field = "", q = false;
    text = String(text).replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some(v => v.trim() !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(v => v.trim() !== "")) rows.push(row);
    return rows;
  }

  function toCSV(rows) {
    const esc = v => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return rows.map(r => r.map(esc).join(",")).join("\n");
  }

  // ---------- column mapping ----------
  const FIELDS = {
    sku:        { label: "SKU / item", required: true,  names: ["sku", "item", "item number", "item_no", "item #", "part", "part number", "part_no", "product", "product id", "material"] },
    location:   { label: "Location",   required: true,  names: ["location", "loc", "bin", "slot", "location id", "bin location", "storage bin"] },
    system_qty: { label: "System qty", required: true,  names: ["system qty", "system_qty", "system", "book qty", "expected", "expected qty", "on hand", "on_hand", "wms qty", "qty on hand", "book"] },
    counted_qty:{ label: "Counted qty",required: true,  names: ["counted qty", "counted_qty", "counted", "count", "physical", "physical qty", "actual", "actual qty", "count qty"] },
    unit_cost:  { label: "Unit cost",  required: true,  names: ["unit cost", "unit_cost", "cost", "price", "unit price", "std cost", "standard cost", "avg cost"] },
    description:{ label: "Description",required: false, names: ["description", "desc", "item description", "name", "product name"] },
    counter:    { label: "Counter",    required: false, names: ["counter", "counted by", "counter id", "user", "associate", "employee"] },
    count_date: { label: "Count date", required: false, names: ["count date", "count_date", "date counted", "counted on", "date"] },
    last_move:  { label: "Last movement date", required: false, names: ["last movement", "last_move", "last movement date", "last activity", "last receipt", "last transaction", "last txn"] },
  };

  const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim();

  function guessMapping(headers) {
    const h = headers.map(norm), map = {};
    for (const [key, def] of Object.entries(FIELDS)) {
      let idx = h.findIndex(x => def.names.includes(x));
      if (idx < 0) idx = h.findIndex(x => def.names.some(n => x.includes(n)));
      if (idx >= 0 && !Object.values(map).includes(idx)) map[key] = idx;
    }
    return map;
  }

  const num = v => { const n = parseFloat(String(v ?? "").replace(/[$,\s]/g, "")); return isFinite(n) ? n : NaN; };
  function parseDate(v) {
    const s = String(v || "").trim(); if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return new Date(+m[1], +m[2] - 1, +m[3], 12);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[1] - 1, +m[2], 12); }
    const d = new Date(s); return isNaN(d) ? null : d;
  }

  function buildRecords(rows, map) {
    const out = [], skipped = [];
    rows.forEach((r, i) => {
      const g = k => map[k] == null ? "" : (r[map[k]] ?? "").trim();
      const rec = {
        line: i + 2, sku: g("sku"), location: g("location"), description: g("description"),
        system: num(g("system_qty")), counted: num(g("counted_qty")), cost: num(g("unit_cost")),
        counter: g("counter"), countDate: parseDate(g("count_date")), lastMove: parseDate(g("last_move")),
      };
      if (!rec.sku || !rec.location || !isFinite(rec.system) || !isFinite(rec.counted) || !isFinite(rec.cost)) { skipped.push(i + 2); return; }
      out.push(rec);
    });
    return { records: out, skipped };
  }

  // ---------- pattern catalog ----------
  const PATTERNS = {
    mislocated: {
      name: "Mislocated stock", short: "Mislocated",
      mechanism: "the same item is short in one location and over by about the same amount in another, which points to a put-away or replenishment move that went to the wrong slot",
      action: "Move the stock back to its home location and correct both locations in one transfer, not two adjustments. Review the put-away that touched both slots.",
    },
    uom: {
      name: "Unit of measure", short: "UOM",
      mechanism: "the system and counted quantities differ by an exact pack multiple, which usually means cases were counted as eaches or eaches as cases",
      action: "Recount in the stocking unit and verify the item's UOM and case quantity in the item master before adjusting.",
    },
    transposed: {
      name: "Transposed digits", short: "Transposed",
      mechanism: "the counted quantity uses the same digits as the system quantity in a different order, which is the signature of a keying error",
      action: "Recount before adjusting; if the recount matches the system, void the count. Check whether the original receipt was keyed correctly.",
    },
    swap: {
      name: "Look-alike swap", short: "Swap",
      mechanism: "two different items in the same aisle are off by about the same quantity in opposite directions, which suggests one was picked or put away as the other",
      action: "Count both items together and correct them as a pair. Consider separating the look-alike items or relabeling the slots.",
    },
    timing: {
      name: "Timing / unposted transaction", short: "Timing",
      mechanism: "the location had movement just before the count, so a receipt, pick or transfer may not have posted when the count was taken",
      action: "Check open receipts, picks and transfers for the item before adjusting. Recount after transactions post.",
    },
    empty: {
      name: "Empty location", short: "Empty",
      mechanism: "the location was counted at zero while the system shows stock, which points to an unrecorded move, a pick from the wrong slot or shrink",
      action: "Search overflow and nearby slots for the item first. If it is not found, adjust and log it for shrink review.",
    },
    found: {
      name: "Found stock", short: "Found",
      mechanism: "stock was found where the system shows none, which usually means an unrecorded receipt or stock moved in without a transfer",
      action: "Check recent receipts and transfers for the item, then add the location and post the stock.",
    },
    counter: {
      name: "Counter accuracy", short: "Counter",
      mechanism: "this count came from a counter whose variance rate is well above the team's, so the count itself is the most likely error",
      action: "Have a different counter recount before adjusting, and review count procedure with the original counter.",
    },
    unexplained: {
      name: "Unexplained", short: "Unexplained",
      mechanism: "no common pattern matched, so the cause is not yet known",
      action: "Recount, then review the item's transaction history since the last accurate count.",
    },
  };
  const ORDER = ["mislocated", "uom", "transposed", "swap", "timing", "empty", "found", "counter", "unexplained"];
  const PACKS = [6, 8, 10, 12, 16, 20, 24, 25, 36, 48, 50, 100];
  // Detection settings. Defaults reflect one distribution center's experience; every building can tune them.
  const DEFAULTS = { pairTolerance: 0.15, swapTolerance: 0.10, minPairUnits: 3, minUomUnits: 5, packs: PACKS, counterMinLines: 8 };

  const aisleOf = loc => { const p = String(loc).split(/[-_.\s]/).filter(Boolean); return p.length > 1 ? p.slice(0, p.length > 2 ? 2 : 1).join("-") : p[0] || ""; };
  const close = (a, b, tol = 0.1) => Math.abs(Math.abs(a) - Math.abs(b)) <= tol * Math.max(Math.abs(a), Math.abs(b));

  // ---------- analysis ----------
  function analyze(records, opts = {}) {
    const threshold = opts.threshold ?? 1000, recentDays = opts.recentDays ?? 3;
    const cfg = { ...DEFAULTS, ...Object.fromEntries(Object.entries(opts).filter(([k, v]) => k in DEFAULTS && v != null)) };
    const packs = [...new Set((cfg.packs || []).map(Number).filter(n => n > 1))].sort((a, b) => a - b);
    const lines = records.map(r => {
      const qty = r.counted - r.system;
      return { ...r, qty, dollars: qty * r.cost, bookValue: Math.max(r.system, 0) * r.cost, pattern: null, partner: null, note: "" };
    });
    const vars = lines.filter(l => l.qty !== 0);

    // 1. Mislocated: same SKU, opposite signs, similar size, different locations
    const bySku = {};
    vars.forEach(v => (bySku[v.sku] ||= []).push(v));
    for (const list of Object.values(bySku)) {
      const pos = list.filter(v => v.qty > 0).sort((a, b) => b.qty - a.qty);
      const neg = list.filter(v => v.qty < 0).sort((a, b) => a.qty - b.qty);
      for (const p of pos) {
        const n = p.qty >= cfg.minPairUnits && neg.find(n => !n.pattern && n.location !== p.location && close(p.qty, n.qty, cfg.pairTolerance));
        if (n && !p.pattern) { p.pattern = n.pattern = "mislocated"; p.partner = n.location; n.partner = p.location; }
      }
    }
    // 2. UOM: exact pack multiple
    for (const v of vars) {
      if (v.pattern || v.system <= 0 || v.counted <= 0 || Math.abs(v.qty) < cfg.minUomUnits) continue;
      const hi = Math.max(v.system, v.counted), lo = Math.min(v.system, v.counted), r = hi / lo;
      const pack = packs.find(k => Math.abs(r - k) < 0.02 * k);
      if (pack) { v.pattern = "uom"; v.note = `${v.counted > v.system ? "counted" : "system"} is ${pack}× the other`; }
    }
    // 3. Transposed digits
    for (const v of vars) {
      if (v.pattern) continue;
      const a = String(Math.round(Math.abs(v.system))), b = String(Math.round(Math.abs(v.counted)));
      if (a.length >= 2 && a.length === b.length && a !== b && [...a].sort().join() === [...b].sort().join()) v.pattern = "transposed";
    }
    // 4. Look-alike swap: different SKUs, same aisle, opposite signs, similar quantity
    const open = vars.filter(v => !v.pattern);
    for (let i = 0; i < open.length && i < 4000; i++) {
      const a = open[i]; if (a.pattern) continue;
      for (let j = i + 1; j < open.length && j < 4000; j++) {
        const b = open[j];
        if (b.pattern || a.sku === b.sku || Math.sign(a.qty) === Math.sign(b.qty)) continue;
        if (aisleOf(a.location) !== aisleOf(b.location) || !close(a.qty, b.qty, cfg.swapTolerance) || Math.abs(a.qty) < 2) continue;
        a.pattern = b.pattern = "swap"; a.partner = `${b.sku} at ${b.location}`; b.partner = `${a.sku} at ${a.location}`; break;
      }
    }
    // 5. Timing: movement within N days before the count
    const fallbackCountDate = lines.reduce((m, l) => (l.countDate && (!m || l.countDate > m) ? l.countDate : m), null);
    for (const v of vars) {
      if (v.pattern || !v.lastMove) continue;
      const cd = v.countDate || fallbackCountDate; if (!cd) continue;
      const days = (cd - v.lastMove) / 864e5;
      if (days >= 0 && days <= recentDays) { v.pattern = "timing"; v.note = `moved ${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"} before the count`; }
    }
    // 6/7. Empty and found
    for (const v of vars) {
      if (v.pattern) continue;
      if (v.counted === 0 && v.system > 0) v.pattern = "empty";
      else if (v.system <= 0 && v.counted > 0) v.pattern = "found";
    }
    // 8. Counter accuracy: counters with a variance rate well above the team's
    const counters = {};
    lines.forEach(l => { if (!l.counter) return; const c = counters[l.counter] ||= { counter: l.counter, lines: 0, variances: 0, gross: 0 }; c.lines++; if (l.qty) { c.variances++; c.gross += Math.abs(l.dollars); } });
    const counterList = Object.values(counters).map(c => ({ ...c, rate: c.variances / c.lines }));
    const withCounter = lines.filter(l => l.counter);
    const teamRate = withCounter.length ? withCounter.filter(l => l.qty).length / withCounter.length : 0;
    const flaggedCounters = new Set(counterList.filter(c => c.lines >= cfg.counterMinLines && c.rate >= Math.max(2 * teamRate, teamRate + 0.1)).map(c => c.counter));
    for (const v of vars) if (!v.pattern && flaggedCounters.has(v.counter)) v.pattern = "counter";
    for (const v of vars) if (!v.pattern) v.pattern = "unexplained";

    // ---------- metrics ----------
    const book = lines.reduce((t, l) => t + l.bookValue, 0);
    const gross = vars.reduce((t, v) => t + Math.abs(v.dollars), 0);
    const net = vars.reduce((t, v) => t + v.dollars, 0);
    const summary = {
      lines: lines.length, varianceLines: vars.length,
      locationAccuracy: lines.length ? 1 - vars.length / lines.length : 1,
      bookValue: book, gross, net,
      grossAccuracy: book ? 1 - gross / book : null,
      netAccuracy: book ? 1 - Math.abs(net) / book : null,
      overThreshold: vars.filter(v => Math.abs(v.dollars) >= threshold).length,
    };
    const byPattern = ORDER.map(k => {
      const items = vars.filter(v => v.pattern === k);
      return { key: k, ...PATTERNS[k], count: items.length, gross: items.reduce((t, v) => t + Math.abs(v.dollars), 0), net: items.reduce((t, v) => t + v.dollars, 0) };
    }).filter(p => p.count);
    const ranked = [...vars].sort((a, b) => Math.abs(b.dollars) - Math.abs(a.dollars));
    let run = 0; const pareto = ranked.map(v => { run += Math.abs(v.dollars); return { ...v, cumShare: gross ? run / gross : 0 }; });
    const for80 = pareto.findIndex(p => p.cumShare >= 0.8) + 1;

    return { lines, variances: ranked, summary, byPattern, pareto, for80, counters: counterList.sort((a, b) => b.rate - a.rate), teamRate, flaggedCounters: [...flaggedCounters], threshold, settings: { ...cfg, packs } };
  }

  // ---------- drafted audit explanation (observation → mechanism → implication) ----------
  const money = n => (n < 0 ? "−$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const qtyS = n => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toLocaleString("en-US");

  function explain(v) {
    const p = PATTERNS[v.pattern];
    const item = v.description ? `${v.sku} (${v.description})` : v.sku;
    const observation = `${item} at ${v.location}: system ${v.system.toLocaleString("en-US")}, counted ${v.counted.toLocaleString("en-US")}, a variance of ${qtyS(v.qty)} units (${money(v.dollars)}).`;
    let mechanism = p.mechanism.charAt(0).toUpperCase() + p.mechanism.slice(1);
    if (v.partner) mechanism += v.pattern === "mislocated" ? `. The offsetting variance is at ${v.partner}` : `. The paired variance is ${v.partner}`;
    if (v.note) mechanism += ` (${v.note})`;
    mechanism += ".";
    const evidence = v.evidence && v.evidence.status !== "none" ? v.evidence.text : "";
    return { observation, mechanism, implication: p.action, evidence,
      text: `Observation: ${observation}\nMechanism: ${mechanism}${evidence ? `\nEvidence: ${evidence}` : ""}\nImplication: ${p.action}` };
  }

  // ---------- transaction history: evidence for each likely cause ----------
  const TXN_FIELDS = {
    date: ["date", "transaction date", "txn date", "created", "timestamp"],
    sku:  ["sku", "item", "item number", "part", "part number", "product", "material"],
    from: ["from", "from location", "from loc", "source", "source location", "from bin"],
    to:   ["to", "to location", "to loc", "destination", "dest", "destination location", "to bin"],
    qty:  ["qty", "quantity", "units", "qty moved"],
    type: ["type", "transaction type", "txn type", "activity", "reason"],
  };

  function parseTransactions(text) {
    const rows = parseCSV(text); if (rows.length < 2) return { error: "The transaction file has no data rows." };
    const h = rows[0].map(norm), map = {};
    for (const [k, names] of Object.entries(TXN_FIELDS)) {
      let i = h.findIndex(x => names.includes(x)); if (i < 0) i = h.findIndex(x => names.some(n => x.includes(n)));
      if (i >= 0 && !Object.values(map).includes(i)) map[k] = i;
    }
    if (map.date == null || map.sku == null || (map.from == null && map.to == null)) return { error: "Couldn't find date, SKU and from/to location columns in the transaction file." };
    const txns = rows.slice(1).map(r => ({
      date: parseDate(r[map.date]), sku: (r[map.sku] || "").trim(),
      from: map.from == null ? "" : (r[map.from] || "").trim(), to: map.to == null ? "" : (r[map.to] || "").trim(),
      qty: map.qty == null ? NaN : num(r[map.qty]), type: map.type == null ? "" : (r[map.type] || "").trim().toLowerCase(),
    })).filter(t => t.date && t.sku);
    return { txns };
  }

  const fmtDate = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const describe = t => { const what = t.type ? `${/^[aeiou]/.test(t.type) ? "an" : "a"} ${t.type}${isFinite(t.qty) ? ` of ${t.qty}` : ""}` : `${isFinite(t.qty) ? t.qty + " units" : "stock"} moved`;
    return `${what} ${t.from && t.to ? `from ${t.from} to ${t.to}` : t.to ? `into ${t.to}` : `out of ${t.from}`} on ${fmtDate(t.date)}`; };

  // Adds v.evidence = { status: "confirmed" | "supported" | "none", text } to each variance line.
  function attachEvidence(result, txns, opts = {}) {
    const recentDays = opts.recentDays ?? 3;
    const bySku = {}; txns.forEach(t => (bySku[t.sku] ||= []).push(t));
    Object.values(bySku).forEach(list => list.sort((a, b) => b.date - a.date));
    const countDate = result.lines.reduce((m, l) => (l.countDate && (!m || l.countDate > m) ? l.countDate : m), null);
    const tally = { confirmed: 0, supported: 0, none: 0 };
    for (const v of result.variances) {
      const list = bySku[v.sku] || [], cd = v.countDate || countDate;
      const into = list.filter(t => t.to === v.location), outOf = list.filter(t => t.from === v.location);
      let ev = { status: "none", text: "No transactions for this item and location in the history." };
      if (v.pattern === "mislocated" && v.partner) {
        const exact = v.qty > 0 ? into.find(t => t.from === v.partner) : outOf.find(t => t.to === v.partner);
        const loose = v.qty > 0 ? into[0] : list.find(t => t.to === v.partner);
        if (exact) ev = { status: "confirmed", text: `History shows ${describe(exact)}, which matches the offsetting pair.` };
        else if (loose) ev = { status: "supported", text: `History shows ${describe(loose)}, not a move from the paired slot. Check where the stock came from.` };
      } else if (v.pattern === "timing") {
        const recent = list.filter(t => (t.to === v.location || t.from === v.location) && cd && (cd - t.date) / 864e5 >= 0 && (cd - t.date) / 864e5 <= recentDays);
        if (recent.length) ev = { status: "confirmed", text: `Activity just before the count: ${recent.map(describe).join("; ")}.` };
      } else if (v.pattern === "found") {
        if (into.length) ev = { status: "supported", text: `History shows ${describe(into[0])}. The system doesn't show the stock, so the move may not have posted to this location.` };
      } else if (v.pattern === "empty") {
        if (outOf.length) ev = { status: "supported", text: `Last activity was ${describe(outOf[0])}. Nothing has been put back since.` };
        else if (into.length) ev = { status: "supported", text: `History shows ${describe(into[0])} and no picks since, which points to an unrecorded move or shrink.` };
      } else if (into.length || outOf.length) {
        const last = [...into, ...outOf].sort((a, b) => b.date - a.date)[0];
        ev = { status: "none", text: `Most recent activity: ${describe(last)}. It doesn't confirm or rule out this cause.` };
      }
      v.evidence = ev; tally[ev.status]++;
    }
    result.evidence = { ...tally, transactions: txns.length };
    return result;
  }

  // ---------- recount sheet in walking order ----------
  // Why each cause gets recounted, in the counter's words.
  const RECOUNT_REASON = {
    mislocated: "Verify both slots before the transfer",
    uom: "Recount in the stocking unit",
    transposed: "Recount; void if it matches system",
    swap: "Count both look-alike items together",
    timing: "Recount after open transactions post",
    empty: "Check overflow and nearby slots",
    found: "Confirm item and quantity",
    counter: "Second counter recount",
    unexplained: "Recount",
  };

  // "A-12-03" -> aisle "A", bay 12, level 3. Falls back to plain text sorting.
  function parseLocation(loc) {
    const parts = String(loc).split(/[-_.\s]/).filter(Boolean);
    const n = s => { const v = parseInt(s, 10); return isNaN(v) ? null : v; };
    return { aisle: (parts[0] || "").toUpperCase(), bay: n(parts[1]), level: n(parts[2]), raw: String(loc) };
  }

  // Serpentine path: walk aisles in order, alternating bay direction so the counter never backtracks.
  function walkingOrder(locs) {
    const aisles = [...new Set(locs.map(l => parseLocation(l).aisle))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const dir = Object.fromEntries(aisles.map((a, i) => [a, i % 2 === 0 ? 1 : -1]));
    return [...locs].sort((x, y) => {
      const a = parseLocation(x), b = parseLocation(y);
      if (a.aisle !== b.aisle) return aisles.indexOf(a.aisle) - aisles.indexOf(b.aisle);
      if (a.bay !== b.bay) return ((a.bay ?? 0) - (b.bay ?? 0)) * dir[a.aisle];
      if (a.level !== b.level) return (a.level ?? 0) - (b.level ?? 0);
      return a.raw.localeCompare(b.raw);
    });
  }

  function recountList(result, opts = {}) {
    const min = opts.minDollars ?? 25;
    const picked = result.variances.filter(v => Math.abs(v.dollars) >= min || v.pattern === "counter" || v.pattern === "mislocated" || v.pattern === "swap");
    const order = walkingOrder([...new Set(picked.map(v => v.location))]);
    const rows = [];
    order.forEach(loc => picked.filter(v => v.location === loc).forEach(v => rows.push({ ...v, reason: RECOUNT_REASON[v.pattern] })));
    return { rows, aisles: new Set(rows.map(r => parseLocation(r.location).aisle)).size, minDollars: min };
  }

  // ---------- sample data (synthetic; planted patterns for the demo) ----------
  function sampleCSV(seedDate) {
    let s = 20261031; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const pick = a => a[Math.floor(rnd() * a.length)];
    const base = seedDate ? new Date(seedDate) : new Date(); base.setHours(12, 0, 0, 0);
    const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    const daysAgo = n => { const d = new Date(base); d.setDate(d.getDate() - n); return iso(d); };
    const items = [
      ["FLT-1042", "Oil filter, spin-on", 6.85], ["FLT-1043", "Oil filter, spin-on, long", 7.10], ["FLT-2210", "Cabin air filter", 11.40],
      ["BRK-3301", "Brake pad set, front", 38.90], ["BRK-3302", "Brake pad set, rear", 34.50], ["BRK-4410", "Brake rotor, vented", 61.25],
      ["BAT-5100", "Battery, group 24F", 142.00], ["BAT-5101", "Battery, group 35", 138.00], ["WIP-6020", "Wiper blade, 20 in", 9.75],
      ["WIP-6022", "Wiper blade, 22 in", 9.95], ["SPK-7001", "Spark plug, iridium", 8.40], ["SPK-7002", "Spark plug, copper", 2.95],
      ["BLT-8120", "Serpentine belt, 6-rib", 27.60], ["HOS-8500", "Radiator hose, upper", 19.80], ["LMP-9005", "Headlight bulb 9005", 12.30],
      ["LMP-9006", "Headlight bulb 9006", 12.30], ["FLD-1100", "Brake fluid, 32 oz", 7.45], ["FLD-1200", "Coolant, 1 gal", 16.90],
      ["ALT-2400", "Alternator, reman", 189.00], ["STR-2500", "Starter, reman", 164.00], ["SEN-3100", "O2 sensor", 54.20],
      ["SEN-3200", "MAF sensor", 98.60], ["PMP-4100", "Water pump", 72.40], ["CLP-5005", "Hose clamp, 5/8 in", 0.85],
      ["FUS-6010", "Fuse assortment", 6.20], ["TPE-7100", "Electrical tape", 2.40], ["WSH-8800", "Washer fluid, 1 gal", 3.10],
    ];
    const counters = ["C-02", "C-04", "C-07", "C-11", "C-15"];
    const rows = [["location", "sku", "description", "system_qty", "counted_qty", "unit_cost", "counter", "count_date", "last_movement"]];
    const aisles = ["A", "B", "C", "D", "E", "F"];
    const used = new Set(); let n = 0;
    const loc = () => { let l; do { l = `${pick(aisles)}-${String(1 + Math.floor(rnd() * 24)).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 5)).padStart(2, "0")}`; } while (used.has(l)); used.add(l); return l; };
    const add = (l, it, sys, cnt, ctr, lastMoveDaysAgo) => rows.push([l, it[0], it[1], sys, cnt, it[2].toFixed(2), ctr || pick(counters), daysAgo(0), daysAgo(lastMoveDaysAgo ?? 8 + Math.floor(rnd() * 40))]);
    // clean counts, with a light background error rate
    for (let i = 0; i < 150; i++) {
      const it = pick(items), sys = 4 + Math.floor(rnd() * 60), ctr = pick(counters);
      let cnt = sys;
      if (ctr === "C-07" ? rnd() < 0.3 : rnd() < 0.04) cnt = Math.max(0, sys + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 3)));
      add(loc(), it, sys, cnt, ctr);
    }
    // planted patterns
    const it = sku => items.find(x => x[0] === sku);
    add("C-14-02", it("BAT-5100"), 18, 6, "C-04");  add("C-15-04", it("BAT-5100"), 0, 12, "C-04");      // mislocated (12 batteries)
    add("D-03-01", it("ALT-2400"), 9, 2, "C-02");   add("D-21-03", it("ALT-2400"), 3, 10, "C-11");     // mislocated (7 alternators)
    add("B-06-02", it("CLP-5005"), 300, 25, "C-15");                                                    // UOM: 12 counted as boxes
    add("A-09-04", it("SPK-7002"), 4, 96, "C-02");                                                      // UOM: cases of 24 counted as eaches
    add("E-11-03", it("BRK-3301"), 46, 64, "C-11");                                                     // transposed
    add("E-12-01", it("LMP-9005"), 30, 18, "C-15"); add("E-12-02", it("LMP-9006"), 22, 34, "C-15");    // look-alike swap (12 bulbs)
    add("F-02-05", it("SEN-3200"), 14, 8, "C-04", 1);                                                    // timing
    add("B-19-02", it("STR-2500"), 7, 3, "C-02", 2);                                                     // timing
    add("A-22-01", it("PMP-4100"), 11, 0, "C-11");  add("F-17-03", it("BRK-4410"), 16, 0, "C-15");     // empty
    add("D-08-04", it("SEN-3100"), 0, 9, "C-04");                                                        // found
    for (let i = rows.length - 1; i > 1; i--) { const j = 1 + Math.floor(rnd() * i); [rows[i], rows[j]] = [rows[j], rows[i]]; }
    return toCSV(rows);
  }

  // Synthetic transaction history that goes with sampleCSV: some of it confirms the planted causes, some only supports them.
  function sampleTransactionsCSV(seedDate) {
    const base = seedDate ? new Date(seedDate) : new Date(); base.setHours(12, 0, 0, 0);
    const day = n => { const d = new Date(base); d.setDate(d.getDate() - n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
    const rows = [["date", "sku", "type", "from_location", "to_location", "qty"],
      [day(12), "BAT-5100", "replenishment", "C-14-02", "C-15-04", 12],   // confirms the battery mislocation
      [day(9),  "ALT-2400", "putaway", "DOCK-03", "D-21-03", 7],          // supports the alternator pair, wrong source
      [day(1),  "SEN-3200", "receipt", "DOCK-01", "F-02-05", 6],          // confirms timing
      [day(2),  "STR-2500", "pick", "B-19-02", "", 4],                    // confirms timing
      [day(20), "PMP-4100", "pick", "A-22-01", "", 3],                    // supports empty location
      [day(5),  "SEN-3100", "putaway", "DOCK-02", "D-08-04", 9],          // supports found stock
      [day(15), "LMP-9005", "putaway", "DOCK-01", "E-12-01", 30],
      [day(15), "LMP-9006", "putaway", "DOCK-01", "E-12-02", 22],
      [day(30), "CLP-5005", "receipt", "DOCK-02", "B-06-02", 300],
      [day(6),  "FLT-1042", "pick", "C-23-02", "", 2],
      [day(11), "WIP-6020", "pick", "B-24-01", "", 1],
    ];
    return toCSV(rows);
  }

  // ---------- count over count ----------
  // Compare two analyzed counts of the same area: what improved, what keeps coming back.
  function compareCounts(prev, curr) {
    const key = v => v.sku + "\u0000" + v.location;
    const prevLines = new Map(prev.lines.map(l => [key(l), l]));
    const currLines = new Map(curr.lines.map(l => [key(l), l]));
    const repeats = [], fresh = [], resolved = [], notRecounted = [];
    for (const v of curr.variances) {
      const p = prevLines.get(key(v));
      if (p && p.qty !== 0) repeats.push({ sku: v.sku, location: v.location, description: v.description || "",
        prevQty: p.qty, prevDollars: p.dollars, prevPattern: p.pattern, qty: v.qty, dollars: v.dollars, pattern: v.pattern,
        sameDirection: Math.sign(p.qty) === Math.sign(v.qty) });
      else fresh.push(v);
    }
    for (const p of prev.variances) {
      const c = currLines.get(key(p));
      if (!c) notRecounted.push(p); else if (c.qty === 0) resolved.push(p);
    }
    repeats.sort((a, b) => (Math.abs(b.prevDollars) + Math.abs(b.dollars)) - (Math.abs(a.prevDollars) + Math.abs(a.dollars)) || (a.location < b.location ? -1 : 1));
    const gross = list => list.reduce((t, v) => t + Math.abs(v.dollars), 0);
    const skuGross = list => list.reduce((m, v) => (m[v.sku] = (m[v.sku] || 0) + Math.abs(v.dollars), m), {});
    const ps = skuGross(prev.variances), cs = skuGross(curr.variances);
    const repeatSkus = Object.keys(cs).filter(k => k in ps).map(sku => ({ sku, prevGross: ps[sku], gross: cs[sku] }))
      .sort((a, b) => (b.prevGross + b.gross) - (a.prevGross + a.gross) || (a.sku < b.sku ? -1 : 1));
    const pb = Object.fromEntries(prev.byPattern.map(p => [p.key, p])), cb = Object.fromEntries(curr.byPattern.map(p => [p.key, p]));
    const causes = ORDER.filter(k => pb[k] || cb[k]).map(k => ({ key: k, name: PATTERNS[k].name, short: PATTERNS[k].short,
      prevCount: pb[k] ? pb[k].count : 0, count: cb[k] ? cb[k].count : 0, prevGross: pb[k] ? pb[k].gross : 0, gross: cb[k] ? cb[k].gross : 0 }));
    const delta = {};
    ["grossAccuracy", "netAccuracy", "locationAccuracy", "gross", "net", "varianceLines"].forEach(k => {
      delta[k] = prev.summary[k] == null || curr.summary[k] == null ? null : curr.summary[k] - prev.summary[k]; });
    return { prev: prev.summary, curr: curr.summary, delta, causes, repeats, repeatGross: gross(repeats),
      fresh: fresh.length, freshGross: gross(fresh), resolved: resolved.length, resolvedGross: gross(resolved),
      notRecounted: notRecounted.length, repeatSkus };
  }

  // Synthetic prior count of the same locations a month earlier. Some problems were fixed since,
  // some are new, and three keep coming back (the battery pair, the look-alike bulbs, the water pump slot).
  function samplePriorCSV(seedDate) {
    const rows = parseCSV(sampleCSV(seedDate));
    let s = 20260930; const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const shift = (d, n) => { const t = new Date(d + "T12:00:00"); t.setDate(t.getDate() - n); return t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); };
    const H = rows[0], I = Object.fromEntries(H.map((h, i) => [h, i]));
    const body = rows.slice(1).filter(r => r.length === H.length);
    for (const r of body) {
      const sys = +r[I.system_qty], ctr = r[I.counter];
      const was = sys === 0 ? 0 : Math.max(1, sys + Math.round(rnd() * 12 - 6));
      let cnt = was;
      if (was > 0 && (ctr === "C-07" ? rnd() < 0.3 : rnd() < 0.04)) cnt = Math.max(0, was + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 3)));
      r[I.system_qty] = was; r[I.counted_qty] = cnt;
      r[I.count_date] = shift(r[I.count_date], 30); r[I.last_movement] = shift(r[I.count_date], 8 + Math.floor(rnd() * 40));
    }
    const at = (loc, sku) => body.find(r => r[I.location] === loc && r[I.sku] === sku);
    const set = (loc, sku, sys, cnt) => { const r = at(loc, sku); if (r) { r[I.system_qty] = sys; r[I.counted_qty] = cnt; } };
    // lines that are problems this month were clean last month
    [["D-03-01", "ALT-2400"], ["D-21-03", "ALT-2400"], ["B-06-02", "CLP-5005"], ["A-09-04", "SPK-7002"], ["E-11-03", "BRK-3301"],
     ["F-02-05", "SEN-3200"], ["B-19-02", "STR-2500"], ["F-17-03", "BRK-4410"], ["D-08-04", "SEN-3100"]].forEach(([l, k]) => { const r = at(l, k); if (r) r[I.counted_qty] = r[I.system_qty]; });
    // repeat offenders
    set("C-14-02", "BAT-5100", 18, 10); set("C-15-04", "BAT-5100", 0, 8);   // the same battery mislocation, 8 units
    set("E-12-01", "LMP-9005", 26, 16); set("E-12-02", "LMP-9006", 20, 30); // the same look-alike bulbs, 10 units
    set("A-22-01", "PMP-4100", 11, 7);                                      // the water pump slot was short then too
    // problems last month that this month's count shows fixed: the three largest clean lines by book value
    const current = new Map(parseCSV(sampleCSV(seedDate)).slice(1).map(x => [x[I.location] + "|" + x[I.sku], x]));
    const clean = body.filter(r => { const c = current.get(r[I.location] + "|" + r[I.sku]); return r[I.counter] !== "C-07" && +r[I.system_qty] > 0 && c && +c[I.counted_qty] === +c[I.system_qty]; })
      .sort((a, b) => b[I.system_qty] * b[I.unit_cost] - a[I.system_qty] * a[I.unit_cost]);
    const fixes = [sys => Math.max(0, sys - 6), sys => Math.max(0, sys - 4), sys => sys + 5];
    let k = 0;
    for (const r of clean) {
      if (k >= fixes.length) break;
      if (["C-14-02", "C-15-04", "E-12-01", "E-12-02", "A-22-01"].includes(r[I.location]) || +r[I.counted_qty] !== +r[I.system_qty]) continue;
      r[I.counted_qty] = fixes[k++](+r[I.system_qty]);
    }
    return toCSV([H, ...body]);
  }

  const api = { DEFAULTS, parseTransactions, attachEvidence, sampleTransactionsCSV, compareCounts, samplePriorCSV, parseCSV, toCSV, FIELDS, guessMapping, buildRecords, analyze, explain, PATTERNS, sampleCSV, money, parseLocation, walkingOrder, recountList, RECOUNT_REASON };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.VarianceEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
