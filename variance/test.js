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

console.log("all checks passed");
console.log(JSON.stringify({
  lines: s.lines, varianceLines: s.varianceLines, gross: s.gross.toFixed(2), net: s.net.toFixed(2),
  grossAcc: (s.grossAccuracy * 100).toFixed(2), netAcc: (s.netAccuracy * 100).toFixed(2), over: s.overThreshold, for80: r.for80,
  patterns: r.byPattern.map(p => `${p.key}:${p.count}`).join(" "), counters: r.flaggedCounters,
}, null, 1));
