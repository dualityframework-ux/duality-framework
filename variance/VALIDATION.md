# Challenge cases: when a plausible pattern is not the cause

Run `node variance/challenge-test.js` from the repository root.

These hand-authored synthetic cases are separate from the built-in demonstration
sample. They are targeted challenges, not a random or representative dataset,
external validation, or a held-out benchmark. No employer data is used.

## What the checks reveal

| Scenario and stipulated ground truth | Observed behavior | Investigation implication |
| --- | --- | --- |
| System and count agree | No variance diagnosis | Clean-count control passes. |
| Same item has opposite differences with substantially different quantities | No mislocation pairing | Opposite signs alone do not trigger a pair. |
| An unrelated loss and an unrecorded receipt happen to offset at different locations | Both lines are tagged mislocated | A causal false positive: matching quantities do not establish a transfer. |
| A genuine unrecorded receipt makes the count a pack multiple of system stock | Tagged unit of measure | Packaging and receiving records are needed to distinguish the causes. |
| Unrelated adjustments happen to produce quantities with the same digits | Tagged transposed | A recount or source document is needed to establish a keying error. |
| A transfer matches the item, locations, quantities and predates the count | Internal evidence status is confirmed | This means a matching record exists; it does not prove that transaction caused the discrepancy. |
| Transfer quantity differs from the offsetting quantities | Supported, not confirmed | Partial evidence should prompt review, not an automatic correction. |
| Transfer occurs after the count | No supporting evidence | Later events cannot explain an earlier observation. |
| Transfer belongs to another item | No supporting evidence | Evidence must match the item. |

The assertions deliberately preserve the observed false positives. If a rule
changes, review both its behavior and this report rather than changing an
expected label solely to make the test pass. Passing this suite means these
behaviors remain reproducible; it does not mean every suggested cause is right.

## What this changes about the recommendation

Use Variance to prioritize a recount and assemble evidence. Treat a cause label
as a hypothesis. Verify quantities, item setup and relevant movement records
before changing inventory balances or attributing an error to a counter.

This exercise does not estimate precision, recall, time saved or loss reduction.
A next evaluation would define a broader set of independently labeled scenarios
before inspecting predictions, including ambiguous cases with no unique cause,
and report missed causes and false positives separately. The JavaScript engine
is exercised here; these challenges do not independently validate the Python port.
