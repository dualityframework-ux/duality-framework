# Variance

**Find out why the count is off.** [Try it live](https://dualityframework-ux.github.io/duality-framework/variance/) · [Read the case study](https://dualityframework-ux.github.io/duality-framework/variance/case-study.html)

Variance takes a cycle count export and answers the three questions an inventory control team actually gets asked:

1. **How accurate are we?** Gross and net dollar accuracy against book value, plus location accuracy.
2. **Where are the dollars?** A Pareto view of the lines driving most of the gross variance.
3. **Why is each line off?** Every variance is matched to its most likely root cause, and lines over the write-up threshold get a drafted audit explanation in observation → mechanism → implication form.

4. **What keeps coming back?** Load an earlier count of the same locations to see the change in accuracy, the change by cause, and every line that is off in both counts. A repeat points to a process problem, not a counting one.

5. **Is accuracy following the dollars?** SKUs are split into A, B and C classes by book value (A is the first 80% of value, B the next 15%, C the rest), with gross accuracy for each class. A full ABC study ranks by annual usage value; a count file doesn't include usage, so book value stands in.

It also builds a **recount sheet** in walking order (aisles in sequence, alternating direction, pairs kept together) with a blind-count option, ready to print or download.

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

## Transaction history (optional)

Add a second CSV of moves, receipts and picks (date, SKU, from location, to location, quantity, type) and Variance checks the history against each diagnosis:

- **Matching transfer:** the same SKU moved between the paired slots, with the variance quantity, on or before the count. This verifies a matching transaction, not the cause of the variance.
- **Supported:** history consistent with a cause but not proof, including recent activity for a timing hypothesis. Posting status still needs review.
- Write-ups gain an **Evidence** line citing the transaction.

The page has a sample history that goes with the sample count: it matches transfers for 2 lines and supports 6.

## Settings

The matching rules are tunable per building, in the page's **Detection settings** panel or as options to `analyze()` / flags on the Python CLI: mislocation and swap match tolerance, the smallest quantity that counts as a mislocation or a UOM error, the pack sizes checked for UOM errors, and how many lines a counter needs before their rate is judged.

## Input

A CSV with one row per counted location. Required: SKU, location, system quantity, counted quantity, unit cost. Optional but useful: description, counter, count date, last movement date. Common header names are matched automatically, and anything else can be matched by hand.

## Metrics

- **Gross accuracy** = 1 − Σ|variance $| ÷ book value
- **Net accuracy** = 1 − |Σ variance $| ÷ book value
- **Location accuracy** = locations with no variance ÷ locations counted
- **Accuracy by class** = the gross accuracy formula, using only that class's book value and variance

## Python and SQL

The same analysis, including transaction-history evidence, is also written in pandas and SQLite, with parity tests against this engine. See [`python/`](python/).

## Files

- `engine.js`: parsing, metrics and pattern detection as pure functions (browser and Node)
- `index.html`: the interface
- `test.js`: checks that every pattern planted in the synthetic sample is detected. Run with `node variance/test.js`.

The sample count is synthetic: 164 lines with mislocations, UOM errors, a transposition, a look-alike swap, timing issues, empty and found locations, and one counter with a high error rate planted in it.

Built by Ian Kachadorian from years of root-causing cycle count variances in distribution centers.

The internal `confirmed` status and SQL query name `confirmed_mislocations` are
retained for compatibility; both mean matching transfer evidence, not causal proof.
