# Worked audit example: one SKU, two locations

This is a **synthetic teaching example**, not an output captured from the live Variance engine. It demonstrates why gross and net accuracy should be read together and why a paired discrepancy needs transaction evidence before correction.

## Input

| SKU | Location | System units | Counted units | Unit cost |
| --- | --- | ---: | ---: | ---: |
| BAT-5100 | C-14-02 | 18 | 6 | $142 |
| BAT-5100 | C-15-04 | 4 | 16 | $142 |
| FIL-2200 | D-02-01 | 20 | 20 | $10 |

For each row, `unit variance = counted - system` and `dollar variance = unit variance × unit cost`.

## Calculated output

| Location | Unit variance | Dollar variance | Interpretation |
| --- | ---: | ---: | --- |
| C-14-02 | -12 | -$1,704 | Short |
| C-15-04 | +12 | +$1,704 | Over |
| D-02-01 | 0 | $0 | Match |

- Book value: `18×142 + 4×142 + 20×10 = $3,324`.
- Gross absolute variance: `1,704 + 1,704 = $3,408`.
- Net signed variance: `-1,704 + 1,704 = $0`.
- Gross accuracy under the documented formula: `1 - 3,408/3,324 = -2.53%`.
- Net accuracy: `1 - |0|/3,324 = 100%`.
- Location accuracy: `1/3 = 33.33%`.

**Important metric caveat:** The gross-accuracy formula can yield a negative value when absolute variance exceeds book value. Do not silently clamp or interpret this as a conventional percentage of correct inventory. This extreme, intentionally small example exposes the limitation. In operational reports, present the absolute gross variance alongside the percentage and clearly state the denominator.

## Observation → mechanism → implication

**Observation:** BAT-5100 is short 12 units at C-14-02 and over 12 at C-15-04, at an equal unit cost. The two dollar differences offset in net value but contribute $3,408 to gross variance.

**Possible mechanism:** The matching SKU and opposite quantities are consistent with a location or transfer error. The pattern alone **does not prove** that stock moved between these locations.

**Implication:** Verify physical counts, inspect movement and putaway records, then reconcile according to the site's inventory-control procedures. Do not post two independent adjustments or a transfer solely because the quantities match.

## Acceptance checks for an implementation

1. Uploading these three rows must preserve signed dollar variance and display both gross and net totals.
2. The matching BAT-5100 discrepancies should be considered together by the mislocation heuristic, subject to configured thresholds.
3. Without transaction evidence, label the cause as a hypothesis, not confirmed.
4. With verified transaction history, include the relevant evidence in the write-up.
5. A zero book-value dataset must not produce a misleading percentage or divide-by-zero error.

## Reproduce

Run `node variance/test.js` from the repository root for the existing engine regression suite. The example above is independently calculated and is **not** a claim that this exact three-row fixture has passed the test suite.

[Open Variance](https://dualityframework-ux.github.io/duality-framework/variance/) · [Read the full case study](case-study.html)
