# Variance

**Find out why the count is off.** [Try it live](https://dualityframework-ux.github.io/duality-framework/variance/) · [Read the case study](https://dualityframework-ux.github.io/duality-framework/variance/case-study.html)

Variance takes a cycle count export and answers the three questions an inventory control team actually gets asked:

1. **How accurate are we?** Gross and net dollar accuracy against book value, plus location accuracy.
2. **Where are the dollars?** A Pareto view of the lines driving most of the gross variance.
3. **Why is each line off?** Every variance is matched to its most likely root cause, and lines over the write-up threshold get a drafted audit explanation in observation → mechanism → implication form.

Everything runs in the browser. The file is never uploaded.

## Root-cause checks

Each variance line is tested in this order and takes the first match:

| Cause | Signal it looks for | Typical fix |
| --- | --- | --- |
| Mislocated stock | Same SKU over in one location and short by about the same amount in another | One transfer back to the home slot |
| Unit of measure | System and counted quantities differ by an exact pack multiple (6, 10, 12, 24, 25, 50, 100…) | Recount in the stocking unit; check the item master |
| Transposed digits | Counted quantity uses the system quantity's digits in a different order (46 vs 64) | Recount; void the count if it matches |
| Look-alike swap | Two different SKUs in the same aisle, off by about the same quantity in opposite directions | Count and correct as a pair |
| Timing | Movement within N days before the count | Check open receipts, picks and transfers |
| Empty location | Counted zero with system stock | Search overflow and nearby slots |
| Found stock | Stock where the system shows none | Check unposted receipts and transfers |
| Counter accuracy | The counter's variance rate is well above the team's | Recount with a different counter |

## Input

A CSV with one row per counted location. Required: SKU, location, system quantity, counted quantity, unit cost. Optional but useful: description, counter, count date, last movement date. Common header names are matched automatically, and anything else can be matched by hand.

## Metrics

- **Gross accuracy** = 1 − Σ|variance $| ÷ book value
- **Net accuracy** = 1 − |Σ variance $| ÷ book value
- **Location accuracy** = locations with no variance ÷ locations counted

## Files

- `engine.js`: parsing, metrics and pattern detection as pure functions (browser and Node)
- `index.html`: the interface
- `test.js`: checks that every pattern planted in the synthetic sample is detected. Run with `node variance/test.js`.

The sample count is synthetic: 164 lines with mislocations, UOM errors, a transposition, a look-alike swap, timing issues, empty and found locations, and one counter with a high error rate planted in it.

Built by Ian Kachadorian from years of root-causing cycle count variances in distribution centers.
