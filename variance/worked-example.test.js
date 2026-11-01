// Synthetic regression fixture for the documented worked audit example.
// Run from repository root: node variance/worked-example.test.js
const assert = require('node:assert/strict');
const E = require('./engine.js');

const csv = [
  'sku,location,system_qty,counted_qty,unit_cost',
  'BAT-5100,C-14-02,18,6,142',
  'BAT-5100,C-15-04,4,16,142',
  'FIL-2200,D-02-01,20,20,10'
].join('\n');
const [headers, ...rows] = E.parseCSV(csv);
const mapping = E.guessMapping(headers);
const { records, skipped } = E.buildRecords(rows, mapping);
assert.deepEqual(skipped, []);
assert.equal(records.length, 3);
const result = E.analyze(records);
const s = result.summary;
assert.equal(s.bookValue, 3324);
assert.equal(s.gross, 3408);
assert.equal(s.net, 0);
assert.equal(s.lines, 3);
assert.equal(s.varianceLines, 2);
assert.ok(Math.abs(s.locationAccuracy - 1/3) < 1e-12);
assert.ok(Math.abs(s.grossAccuracy - (1-3408/3324)) < 1e-12);
assert.equal(s.netAccuracy, 1);
const battery = result.variances.filter(v => v.sku === 'BAT-5100');
assert.equal(battery.length, 2);
assert.deepEqual(battery.map(v => v.dollars).sort((a,b)=>a-b), [-1704,1704]);
assert.ok(battery.every(v => v.pattern === 'mislocated'));
assert.ok(battery.every(v => battery.some(other => other.location === v.partner)));
assert.equal(E.analyze([{sku:'X',location:'A',system:0,counted:0,cost:1}]).summary.grossAccuracy,null);
console.log('Worked example: all assertions passed');
