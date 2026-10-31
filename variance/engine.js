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

  const aisleOf = loc => { const p = String(loc).split(/[-_.\s]/).filter(Boolean); return p.length > 1 ? p.slice(0, p.length > 2 ? 2 : 1).join("-") : p[0] || ""; };
  const close = (a, b, tol = 0.1) => Math.abs(Math.abs(a) - Math.abs(b)) <= tol * Math.max(Math.abs(a), Math.abs(b));

  // ---------- analysis ----------
  function analyze(records, opts = {}) {
    const threshold = opts.threshold ?? 1000, recentDays = opts.recentDays ?? 3;
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
        const n = p.qty >= 3 && neg.find(n => !n.pattern && n.location !== p.location && close(p.qty, n.qty, 0.15));
        if (n && !p.pattern) { p.pattern = n.pattern = "mislocated"; p.partner = n.location; n.partner = p.location; }
      }
    }
    // 2. UOM: exact pack multiple
    for (const v of vars) {
      if (v.pattern || v.system <= 0 || v.counted <= 0 || Math.abs(v.qty) < 5) continue;
      const hi = Math.max(v.system, v.counted), lo = Math.min(v.system, v.counted), r = hi / lo;
      const pack = PACKS.find(k => Math.abs(r - k) < 0.02 * k);
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
        if (aisleOf(a.location) !== aisleOf(b.location) || !close(a.qty, b.qty, 0.1) || Math.abs(a.qty) < 2) continue;
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
    const flaggedCounters = new Set(counterList.filter(c => c.lines >= 8 && c.rate >= Math.max(2 * teamRate, teamRate + 0.1)).map(c => c.counter));
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

    return { lines, variances: ranked, summary, byPattern, pareto, for80, counters: counterList.sort((a, b) => b.rate - a.rate), teamRate, flaggedCounters: [...flaggedCounters], threshold };
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
    return { observation, mechanism, implication: p.action, text: `Observation: ${observation}\nMechanism: ${mechanism}\nImplication: ${p.action}` };
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

  const api = { parseCSV, toCSV, FIELDS, guessMapping, buildRecords, analyze, explain, PATTERNS, sampleCSV, money };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.VarianceEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
