# Next validation cycle

Use Variance and Runway as the lead case studies. Their domain problems align
with the portfolio's accounting and inventory experience. Keep synthetic fixture
results explicitly separate from observations made with people using the tools.

## Runway session

Use synthetic household data; no bank login or personal statement is necessary.
Ask the participant to add a card, schedule its minimum payment, link a payment
already entered as a bill, mark a payment paid, and explain the room-above-floor
estimate. Include an older backup without due dates and ask what remains to be set
up. Record completion, elapsed time, double-counting mistakes, confusing labels,
and whether the participant can distinguish hypothetical extra payments from
scheduled commitments. Do not present the forecast as a guarantee.

## Variance session

Give the participant a synthetic count and transaction history. Ask them to find
the largest variance, compare gross and net accuracy, inspect a matching transfer,
and explain why recent activity supports a timing hypothesis without proving it.
Include a transfer after the count and another with an unrelated quantity. Ask for
a recount sheet and an explanation of which entries still need investigation.
Record task completion, elapsed time, misread evidence labels, and the changes
made to the drafted explanation.

## Results template

For each session record: date, project revision, task, completion, elapsed time,
observed confusion, proposed change, and follow-up outcome. Publish anonymized
findings only with permission. Do not invent baseline time savings or accuracy
claims from synthetic data.

## Repository consolidation

The profile and portfolio already point to `frame2_mvp`; use that as the proposed
canonical sports repository. Before retiring `frame2-redsox-history`:

The local review batch now includes a baseline comparison record, the migrated
history guide in `frame2_mvp/docs/HISTORY_GUIDE.md`, and a legacy notice in the
secondary README. The repaired canonical sports suite and all four export formats
pass. Existing profile/portfolio links already point at the canonical repository.

Before publishing:

1. Recheck remote heads for changes since the recorded comparison.
2. Publish and verify the canonical fixes and guide before the secondary notice.
3. Verify a hosted deployment and inbound links.
4. Obtain approval before archiving the secondary repository; preserve its history.

Local March/April checkouts contain additional API/PWA work absent from the current
public sports repository. Review that work separately; a bulk push from those
checkouts could overwrite newer public changes.
