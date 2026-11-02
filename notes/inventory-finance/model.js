/* Synthetic teaching case. Monetary calculations use integer cents. */
(function (root) {
  'use strict';
  const base = Object.freeze({ sku: 'BAT-DEMO', bookUnits: 100, countedUnits: 92,
    unitCost: 7500, inventory: 2000000, revenue: 10000000, cogs: 6000000 });
  const cases = Object.freeze({
    pending: { label: 'Count only', found: 0, lost: 0, shipped: 0,
      evidence: 'The first count is short. No independent recount or movement review is complete.',
      action: 'Hold the proposed adjustment. Inventory control recounts the item and checks other locations; finance checks the posting cutoff. Escalate unresolved exposure to the close owner before sign-off.',
      entry: 'No entry proposed from the count alone. The unresolved difference still needs investigation.' },
    found: { label: 'All stock located', found: 8, lost: 0, shipped: 0,
      evidence: 'An independent recount locates the missing units in an unrecorded overflow bin. Item identity and ownership match; there is no shipment.',
      action: 'Inventory control corrects the bin records and confirms the location totals. Finance verifies that the total item balance already agrees; no expense is proposed.',
      entry: 'No general-ledger entry. Correct the location records without increasing total inventory.' },
    loss: { label: 'Partial recovery; loss confirmed', found: 3, lost: 5, shipped: 0,
      evidence: 'The recount finds some units in overflow. A signed investigation confirms the remaining units are lost in the current period; receipt and shipment records are complete.',
      action: 'Inventory control documents the recount and loss. The controller reviews the evidence and approves the inventory reduction and expense classification before posting.',
      entry: 'Proposed entry: debit COGS — inventory loss; credit Inventory. This case includes confirmed loss in COGS.' },
    shipment: { label: 'Shipment cost not posted', found: 0, lost: 0, shipped: 8,
      evidence: 'Dispatch records confirm a current-period sale before the count. The related revenue is already recorded, but the inventory relief and cost entry are missing.',
      action: 'Finance matches the dispatch, invoice and cost record, then posts the missing cost once. Operations verifies the stock movement. Do not also book a shrinkage adjustment.',
      entry: 'Proposed entry: debit COGS — goods sold; credit Inventory. Revenue is already recorded in this scenario.' }
  });
  function calculate(key) {
    if (!Object.hasOwn(cases, key)) throw new Error('Unknown evidence scenario');
    const scenario = cases[key];
    const shortage = base.bookUnits - base.countedUnits;
    const unresolved = shortage - scenario.found - scenario.lost - scenario.shipped;
    const reduction = (scenario.lost + scenario.shipped) * base.unitCost;
    const profitBefore = base.revenue - base.cogs;
    return { ...scenario, shortage, unresolved, exposure: unresolved * base.unitCost,
      initialExposure: shortage * base.unitCost, recovered: scenario.found * base.unitCost,
      lossCost: scenario.lost * base.unitCost, shipmentCost: scenario.shipped * base.unitCost,
      reduction, inventoryAfter: base.inventory - reduction, cogsAfter: base.cogs + reduction,
      profitBefore, profitAfter: profitBefore - reduction,
      marginBefore: profitBefore / base.revenue * 100,
      marginAfter: (profitBefore - reduction) / base.revenue * 100,
      marginDrop: reduction / base.revenue * 100, debit: reduction, credit: reduction };
  }
  const money = cents => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function values(key) {
    const c = calculate(key);
    return { sku: base.sku, book: base.bookUnits, count: base.countedUnits, cost: money(base.unitCost),
      shortage: c.shortage, initial: money(c.initialExposure), label: c.label, evidence: c.evidence,
      action: c.action, entry: c.entry, found: c.found, lost: c.lost, shipped: c.shipped,
      unresolved: c.unresolved, exposure: money(c.exposure), recovered: money(c.recovered),
      lossCost: money(c.lossCost), shipmentCost: money(c.shipmentCost),
      reduction: money(c.reduction), inventoryBefore: money(base.inventory), inventoryAfter: money(c.inventoryAfter),
      revenue: money(base.revenue), cogsBefore: money(base.cogs), cogsAfter: money(c.cogsAfter),
      profitBefore: money(c.profitBefore), profitAfter: money(c.profitAfter),
      marginBefore: c.marginBefore.toFixed(2) + '%', marginAfter: c.marginAfter.toFixed(2) + '%',
      marginDrop: c.marginDrop.toFixed(3) + ' percentage points', debit: money(c.debit), credit: money(c.credit) };
  }
  const api = { base, cases, calculate, values };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InventoryFinance = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
