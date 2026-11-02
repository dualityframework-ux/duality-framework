// Run with: node variance/test.js
const E = require("./engine.js");
const assert = require("assert");

const rows = E.parseCSV(E.sampleCSV("2026-10-31"));
const headers = rows.shift();
const map = E.guessMapping(headers);
for (const [k, f] of Object.entries(E.FIELDS)) assert.ok(map[k] != null, `mapped ${k}`);
const { records, skipped } = E.buildRecords(rows, map);
assert.strictEqual(skipped.length, 0);
const r = E.analyze(records, { threshold: 1000, recentDays: 3 });

const find = (sku, loc) => r.variances.find(v => v.sku === sku && v.location === loc);
const expect = [
  ["BAT-5100", "C-14-02", "mislocated"], ["BAT-5100", "C-15-04", "mislocated"],
  ["ALT-2400", "D-03-01", "mislocated"], ["ALT-2400", "D-21-03", "mislocated"],
  ["CLP-5005", "B-06-02", "uom"], ["SPK-7002", "A-09-04", "uom"],
  ["BRK-3301", "E-11-03", "transposed"],
  ["LMP-9005", "E-12-01", "swap"], ["LMP-9006", "E-12-02", "swap"],
  ["SEN-3200", "F-02-05", "timing"], ["STR-2500", "B-19-02", "timing"],
  ["PMP-4100", "A-22-01", "empty"], ["BRK-4410", "F-17-03", "empty"],
  ["SEN-3100", "D-08-04", "found"],
];
for (const [sku, loc, pat] of expect) {
  const v = find(sku, loc);
  assert.ok(v, `${sku} at ${loc} has a variance`);
  assert.strictEqual(v.pattern, pat, `${sku} at ${loc}: expected ${pat}, got ${v.pattern}`);
}
assert.ok(r.flaggedCounters.includes("C-07"), "C-07 flagged for counter accuracy");

// metric sanity
const s = r.summary;
assert.ok(s.gross >= Math.abs(s.net));
assert.ok(s.grossAccuracy <= s.netAccuracy);
assert.ok(r.for80 >= 1 && r.for80 <= r.variances.length);

// CSV round trip with quotes and commas
const tricky = E.parseCSV('a,b\n"x, y","he said ""hi"""\n');
assert.deepStrictEqual(tricky, [["a", "b"], ["x, y", 'he said "hi"']]);

// explanation shape
const ex = E.explain(find("BAT-5100", "C-14-02"));
assert.ok(ex.observation.includes("system 18") && ex.mechanism.includes("C-15-04"));

// walking order: aisles in order, bays alternate direction (serpentine)
assert.deepStrictEqual(
  E.walkingOrder(["B-02-01", "A-10-01", "A-02-03", "B-15-02", "A-02-01", "C-05-01", "C-01-01"]),
  ["A-02-01", "A-02-03", "A-10-01", "B-15-02", "B-02-01", "C-01-01", "C-05-01"]
);
// recount sheet: includes every planted line and keeps pairs, in walking order
const rc = E.recountList(r, { minDollars: 25 });
for (const [sku, loc] of expect) assert.ok(rc.rows.some(x => x.sku === sku && x.location === loc), `recount includes ${sku} at ${loc}`);
assert.ok(rc.rows.every(x => x.reason), "every recount row has a reason");
const locs = rc.rows.map(x => x.location);
assert.deepStrictEqual([...new Set(locs)], E.walkingOrder([...new Set(locs)]), "recount rows follow walking order");

// settings: defaults change nothing; tuning changes detection the expected way
const same = E.analyze(records, { threshold: 1000, recentDays: 3, ...E.DEFAULTS });
assert.deepStrictEqual(same.variances.map(v => v.pattern), r.variances.map(v => v.pattern), "explicit defaults match");
const no12 = E.analyze(records, { packs: [24] });
assert.notStrictEqual(no12.variances.find(v => v.sku === "CLP-5005" && v.location === "B-06-02").pattern, "uom", "pack 12 removed");
assert.strictEqual(no12.variances.find(v => v.sku === "SPK-7002").pattern, "uom", "pack 24 still found");
const strictPairs = E.analyze(records, { minPairUnits: 5 });
assert.notStrictEqual(strictPairs.variances.find(v => v.sku === "BLT-8120").pattern, "mislocated", "3-unit pair ignored at minimum 5");
assert.strictEqual(strictPairs.variances.find(v => v.sku === "BAT-5100" && v.location === "C-14-02").pattern, "mislocated", "12-unit pair still found");

// transaction history evidence
const tx = E.parseTransactions(E.sampleTransactionsCSV("2026-10-31"));
assert.ok(!tx.error && tx.txns.length >= 10, "sample transactions parse");
const ev = E.attachEvidence(E.analyze(records, { threshold: 1000, recentDays: 3 }), tx.txns, { recentDays: 3 });
const evOf = (sku, loc) => ev.variances.find(v => v.sku === sku && v.location === loc).evidence;
assert.strictEqual(evOf("BAT-5100", "C-15-04").status, "confirmed", "battery move confirmed (over slot)");
assert.strictEqual(evOf("BAT-5100", "C-14-02").status, "confirmed", "battery move confirmed (short slot)");
assert.strictEqual(evOf("ALT-2400", "D-21-03").status, "supported", "alternator only supported: came from the dock");
assert.strictEqual(evOf("SEN-3200", "F-02-05").status, "supported", "timing supported by receipt");
assert.strictEqual(evOf("STR-2500", "B-19-02").status, "supported", "timing supported by pick");
assert.strictEqual(evOf("SEN-3100", "D-08-04").status, "supported", "found stock supported");
assert.strictEqual(evOf("PMP-4100", "A-22-01").status, "supported", "empty location supported");
assert.ok(E.explain(ev.variances.find(v => v.sku === "BAT-5100" && v.location === "C-14-02")).text.includes("Evidence:"), "write-up cites evidence");
assert.ok(!E.explain(r.variances[0]).text.includes("Evidence:"), "no evidence line without history");
assert.ok(E.parseTransactions("a,b\n1,2\n").error, "bad transaction file is rejected");

// ---------- count over count ----------
const priorRows = E.parseCSV(E.samplePriorCSV("2026-10-31"));
const prior = E.analyze(E.buildRecords(priorRows.slice(1), E.guessMapping(priorRows[0])).records, { threshold: 1000, recentDays: 3 });
assert.strictEqual(prior.summary.lines, r.summary.lines, "prior sample covers the same locations");
const cmp = E.compareCounts(prior, r);
const rep = (sku, loc) => cmp.repeats.find(x => x.sku === sku && x.location === loc);
for (const [sku, loc] of [["BAT-5100", "C-14-02"], ["BAT-5100", "C-15-04"], ["LMP-9005", "E-12-01"], ["LMP-9006", "E-12-02"], ["PMP-4100", "A-22-01"]])
  assert.ok(rep(sku, loc), `${sku} at ${loc} repeats`);
assert.strictEqual(rep("BAT-5100", "C-14-02").prevPattern, "mislocated", "battery was mislocated last month too");
assert.ok(rep("BAT-5100", "C-14-02").sameDirection, "same direction both months");
assert.ok(!rep("ALT-2400", "D-03-01"), "new problems are not repeats");
assert.strictEqual(cmp.repeats.length + cmp.fresh, r.variances.length, "every current variance is a repeat or new");
assert.strictEqual(cmp.resolved + cmp.notRecounted + cmp.repeats.length, prior.variances.length, "every prior variance is resolved, repeated or not recounted");
assert.ok(Math.abs(cmp.delta.grossAccuracy - (r.summary.grossAccuracy - prior.summary.grossAccuracy)) < 1e-12, "accuracy delta");
assert.ok(Math.abs(cmp.repeatGross + cmp.freshGross - r.summary.gross) < 1e-6, "repeat + new dollars = gross");
const self = E.compareCounts(r, r);
assert.strictEqual(self.repeats.length, r.variances.length, "a count compared to itself: everything repeats");
assert.strictEqual(self.fresh, 0); assert.strictEqual(self.resolved, 0);
assert.strictEqual(E.samplePriorCSV("2026-10-31"), E.samplePriorCSV("2026-10-31"), "prior sample is deterministic");

// Evidence must not confirm a cause from an unrelated quantity or future transfer.
for (const altered of [
  tx.txns.map(t=>t.sku === "BAT-5100" ? {...t, qty:1} : t),
  tx.txns.map(t=>t.sku === "BAT-5100" ? {...t, date:new Date("2026-11-10T12:00:00")} : t),
]) {
  const checked = E.attachEvidence(E.analyze(records), altered);
  assert.ok(checked.variances.filter(v=>v.sku === "BAT-5100").every(v=>v.evidence.status !== "confirmed"));
}
// ABC value classes: worked by hand, then checked for consistency on the sample.
const line = (sku, value) => ({ sku, bookValue: value });
assert.deepStrictEqual(E.abcClasses([line("X", 85), line("Y", 10), line("Z", 5)]), { X: "A", Y: "B", Z: "C" }, "85/10/5 splits A/B/C");
assert.deepStrictEqual(E.abcClasses([line("X", 70), line("Y", 20), line("Z", 10)]), { X: "A", Y: "A", Z: "B" }, "the SKU that crosses 80% is still A");
assert.deepStrictEqual(E.abcClasses([line("X", 30), line("X", 50), line("Y", 20)]), { X: "A", Y: "B" }, "a SKU's locations are summed");
assert.deepStrictEqual(E.abcClasses([line("X", 90), line("B2", 5), line("A1", 5)]), { X: "A", A1: "B", B2: "C" }, "ties break by SKU");
assert.deepStrictEqual(E.abcClasses([line("X", 0)]), { X: "C" }, "no book value means C");
assert.strictEqual(r.abc.reduce((t, c) => t + c.lines, 0), s.lines, "every line has a class");
assert.strictEqual(r.abc.reduce((t, c) => t + c.varianceLines, 0), s.varianceLines);
assert.ok(Math.abs(r.abc.reduce((t, c) => t + c.gross, 0) - s.gross) < 1e-6, "class gross adds up");
assert.ok(Math.abs(r.abc.reduce((t, c) => t + c.bookShare, 0) - 1) < 1e-12, "book shares add to 100%");
const skuValue = {}; r.lines.forEach(l => { skuValue[l.sku] = (skuValue[l.sku] || 0) + l.bookValue; });
const lowest = k => Math.min(...r.lines.filter(l => l.abc === k).map(l => skuValue[l.sku]));
const highest = k => Math.max(...r.lines.filter(l => l.abc === k).map(l => skuValue[l.sku]));
assert.ok(lowest("A") >= highest("B") && lowest("B") >= highest("C"), "classes follow value");
assert.ok(r.abc[0].bookShare >= E.ABC_CUTS.A, "A covers at least 80% of value");
assert.ok(r.variances.every(v => "ABC".includes(v.abc)), "variance lines carry their class");

// The ABC note quotes these figures; recompute them so the note can't drift from the engine.
{
  const note = require("fs").readFileSync(require("path").join(__dirname, "../notes/abc-classes.html"), "utf8");
  const [A, B, C] = r.abc, money = n => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (n, d = 2) => (n * 100).toFixed(d) + "%";
  const cv = r.variances.filter(v => v.abc === "C"), gross = list => list.reduce((t, v) => t + Math.abs(v.dollars), 0);
  const starter = cv.find(v => v.sku === "STR-2500"), uom = cv.filter(v => v.pattern === "uom");
  const pairs = r.variances.filter(v => v.abc === "A" && v.pattern === "mislocated");
  const quoted = [money(s.bookValue), `Of the ${A.skus + B.skus + C.skus} SKUs, ${A.skus} hold ${pct(A.bookShare, 0)} of the value`,
    ...[A, B, C].flatMap(c => [pct(c.bookShare), money(c.gross), pct(c.grossAccuracy)]),
    pct(A.grossShare, 0) + " of the gross", "$" + gross(pairs).toLocaleString("en-US"), pct(gross(pairs) / A.gross, 0) + " of A",
    `${A.varianceLines} of ${A.lines}`, "−$" + Math.abs(starter.dollars), pct(Math.abs(starter.dollars) / C.gross, 0) + " of C",
    money(gross(uom)), pct(gross(uom) / C.gross, 0) + " of C", pct((Math.abs(starter.dollars) + gross(uom)) / C.gross, 0) + " of it"];
  for (const q of quoted) assert.ok(note.includes(q), `ABC note quotes ${q}`);
  assert.strictEqual(starter.pattern, "timing"); assert.strictEqual(uom.length, 2); assert.strictEqual(pairs.length, 4);
}

console.log("all checks passed");

// export formats: accounting "(4)" and SAP "6-" negatives, Excel date serials (shared fixture with the pandas port)
{
  const fx = E.parseCSV(require("fs").readFileSync(__dirname + "/python/tests/export_formats.csv", "utf8"));
  const fxMap = E.guessMapping(fx.shift());
  const { records: fr, skipped: fs } = E.buildRecords(fx, fxMap);
  assert.deepStrictEqual(fs, [5], "only the non-numeric line is skipped");
  assert.deepStrictEqual(fr.map(x => [x.sku, x.system, x.counted, x.cost]),
    [["OIL-1001", -4, 0, 12.5], ["FLT-2002", -6, 0, 1000], ["BRK-3003", 10, 8, 25]]);
  const ymd = d => d && `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  assert.deepStrictEqual(fr.map(x => [ymd(x.countDate), ymd(x.lastMove)]),
    [["2026-11-1", "2026-10-31"], ["2026-11-1", "2026-9-1"], ["2026-11-1", "2026-6-27"]]);
  const fa = E.analyze(fr, { threshold: 1000, recentDays: 3 });
  assert.strictEqual(fa.lines.find(x => x.sku === "OIL-1001").pattern, "timing", "serial dates feed the timing check");
}

console.log(JSON.stringify({
  lines: s.lines, varianceLines: s.varianceLines, gross: s.gross.toFixed(2), net: s.net.toFixed(2),
  grossAcc: (s.grossAccuracy * 100).toFixed(2), netAcc: (s.netAccuracy * 100).toFixed(2), over: s.overThreshold, for80: r.for80,
  patterns: r.byPattern.map(p => `${p.key}:${p.count}`).join(" "), counters: r.flaggedCounters,
}, null, 1));
