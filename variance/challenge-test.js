// Hand-authored scenarios separate from sampleCSV. These characterize limitations;
// passing means the documented behavior is reproduced, not that causes are proven.
const assert = require('assert');
const E = require('./engine.js');
const row = (location, system, counted, extra = {}) => ({
  sku: 'TEST-PART', description: 'Synthetic test part', location, system, counted,
  cost: 10, counter: '', countDate: new Date('2026-10-20T00:00:00Z'),
  lastMove: null, ...extra,
});
const patterns = records => E.analyze(records).variances.map(v => v.pattern);
const pair = () => [row('A-01-01', 20, 13), row('B-02-01', 20, 27)];

assert.deepStrictEqual(patterns([row('A-01-01', 20, 20)]), [], 'clean count has no diagnosis');
assert.ok(patterns([row('A-01-01', 20, 13), row('B-02-01', 20, 23)])
  .every(p => p !== 'mislocated'), 'unequal changes must not form a mislocation pair');

// Ground truth deliberately differs from the inferred cause: an unrelated loss
// and an unrelated unrecorded receipt happen to offset. Counts cannot tell them apart.
assert.deepStrictEqual(patterns(pair()), ['mislocated', 'mislocated'],
  'coincidental offsets are a known causal false positive');
// Ground truth: a genuine unrecorded receipt, not a pack-counting mistake.
assert.deepStrictEqual(patterns([row('A-01-01', 10, 120)]), ['uom'],
  'a genuine receipt can imitate a pack multiple');
// Ground truth: unrelated adjustments happen to permute the quantity digits.
assert.deepStrictEqual(patterns([row('A-01-01', 46, 64)]), ['transposed'],
  'digit similarity alone cannot establish a keying mistake');

const evidence = (changes = {}) => {
  const txn = { sku: 'TEST-PART', type: 'transfer', from: 'A-01-01',
    to: 'B-02-01', qty: 7, date: new Date('2026-10-19T00:00:00Z'), ...changes };
  return E.attachEvidence(E.analyze(pair()), [txn]).variances.map(v => v.evidence.status);
};
assert.deepStrictEqual(evidence(), ['confirmed', 'confirmed'],
  'confirmed is the internal status for a matching record, not causal proof');
assert.deepStrictEqual(evidence({ qty: 6 }), ['supported', 'supported'],
  'wrong quantity must not count as an exact match');
assert.deepStrictEqual(evidence({ date: new Date('2026-10-21T00:00:00Z') }), ['none', 'none'],
  'a later transfer cannot explain the earlier count');
assert.deepStrictEqual(evidence({ sku: 'OTHER-PART' }), ['none', 'none'],
  'another item cannot supply evidence for this pair');
console.log('Challenge checks passed: clean/unequal controls, causal false positives, and transaction evidence boundaries.');
