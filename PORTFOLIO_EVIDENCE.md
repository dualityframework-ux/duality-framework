# Portfolio evidence checklist

This document tracks evidence needed before making public claims about each project.

| Project | Demonstration | Verification | Next improvement |
| --- | --- | --- | --- |
| Variance | [Live tool](https://dualityframework-ux.github.io/duality-framework/variance/) | Check calculation examples and edge cases | Add a worked inventory variance example with input, output and explanation |
| Runway | [Live app](https://dualityframework-ux.github.io/Runway/) | Run `node tests/runway.test.js` and record result | Show an example forecast with clearly fictional data |
| frame² | [Timeline](https://dualityframework-ux.github.io/duality-framework/frame2/) | Run `PYTHONPATH=. pytest -q` and record collected test count | Explain data provenance and distinguish historical dashboard from planned live features |
| frame²mental | [Repository](https://github.com/dualityframework-ux/frame2mental) | Verify local setup and privacy claims | Add a sample walkthrough using synthetic entries |

## Publication standard

For each featured project, provide:
1. A specific problem and intended user.
2. A screenshot or live demonstration.
3. An explanation of the algorithm, data, and major design tradeoffs.
4. Reproducible test instructions and an observed result, not an unverified test count.
5. Explicit limitations and next steps.

## Immediate consistency issue

The main portfolio README currently states **215 tests** for frame², while the frame² README states **214 tests**. Run the suite and reconcile both references with the actual collected count.

## Editorial direction

Keep the unifying method **observation → mechanism → implication**. Avoid claiming production readiness without deployment, reliability, security and user-validation evidence.
