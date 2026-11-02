'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { base, cases, calculate, values } = require('./model.js');
// Independently worked expectations, in cents: 5 units * $75 = $375.
const loss = calculate('loss');
assert.equal(loss.shortage, 8);
assert.equal(loss.initialExposure, 60000);
assert.equal(loss.recovered, 22500);
assert.equal(loss.reduction, 37500);
assert.equal(loss.inventoryAfter, 1962500);
assert.equal(loss.cogsAfter, 6037500);
assert.equal(loss.profitAfter, 3962500);
assert.equal(loss.marginAfter, 39.625);
assert.equal(loss.marginDrop, 0.375);
assert.equal(values('loss').marginAfter, '39.63%');
assert.equal(values('loss').marginDrop, '0.375 percentage points');
const shipment = calculate('shipment');
assert.equal(shipment.reduction, 60000);
assert.equal(shipment.lossCost, 0, 'A shipment is not also a loss');
assert.equal(shipment.inventoryAfter, 1940000);
assert.equal(shipment.cogsAfter, 6060000);
assert.equal(shipment.profitAfter, 3940000);
assert.equal(shipment.marginAfter, 39.4);
for (const key of ['pending', 'found']) {
  const c = calculate(key);
  assert.equal(c.reduction, 0);
  assert.equal(c.inventoryAfter, 2000000);
  assert.equal(c.profitAfter, 4000000);
  assert.equal(c.marginAfter, 40);
}
assert.equal(calculate('pending').exposure, 60000);
assert.equal(calculate('found').exposure, 0);
assert.equal(calculate('found').recovered, 60000);
for (const key of Object.keys(cases)) {
  const c = calculate(key);
  assert.equal(c.found + c.lost + c.shipped + c.unresolved, c.shortage);
  assert.equal(c.recovered + c.lossCost + c.shipmentCost + c.exposure, c.initialExposure);
  assert.equal(c.debit, c.credit);
  assert.equal(base.inventory - c.inventoryAfter, c.cogsAfter - base.cogs);
  assert.equal(c.profitAfter, base.revenue - c.cogsAfter);
  assert.equal(c.profitBefore - c.profitAfter, c.reduction);
  assert.ok(c.unresolved >= 0);
}
assert.throws(() => calculate('unknown'), /Unknown/);
assert.throws(() => calculate('toString'), /Unknown/);
// Every data-value in the published fallback must match a fresh calculation.
execFileSync(process.execPath, [require.resolve('./build.js'), '--check']);
console.log('Inventory-to-finance: hand-worked outcomes, reconciliation, entries and published figures passed.');
