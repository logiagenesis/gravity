# Exoplanet pipeline report

Generated: 2026-09-21
Snapshot: data/sources/snapshots/nasa-exoplanet-archive-pscomppars.csv

| Metric                                          | Value    |
| ----------------------------------------------- | -------- |
| Planet rows in snapshot                         | 6322     |
| Distinct host systems                           | 4740     |
| **Systems written**                             | **4740** |
| Planets included                                | 6322     |
| Systems excluded                                | 0        |
| Orbits sized from the published PERIOD          | 5987     |
| Orbits sized from the published semi-major AXIS | 335      |

## Why orbits are sized from the period

`pscomppars` is a COMPOSITE table: each parameter is taken from whichever
reference the archive judges best, so `pl_orbsmax` and `pl_orbper` may come
from different papers, or from the same paper and still disagree. For a
transiting or radial-velocity detection the period is the measured quantity
and the axis is inferred from it, so this pipeline derives the axis back
from the period and the stellar mass it actually integrates with. Each
scenario therefore reproduces the period the archive publishes, which
`tests/catalog/generated-scenarios.test.ts` checks on every CI run.

How far the published axis would have disagreed, over the
5570 planets that have both:

| Disagreement in semi-major axis | Planets |
| ------------------------------- | ------- |
| over 1%                         | 2286    |
| over 5%                         | 594     |
| over 10%                        | 210     |
| over 25%                        | 43      |

## Systems by planet count

| Planets | Systems |
| ------- | ------- |
| 1       | 3688    |
| 2       | 708     |
| 3       | 218     |
| 4       | 83      |
| 5       | 29      |
| 6       | 12      |
| 7       | 1       |
| 8       | 1       |

## Exclusions by reason

None — every system in the snapshot produced a valid scenario.

Excluded systems are omitted entirely rather than emitted with placeholder
numbers. Every included system records its assumptions in its own citation
block, so no approximation is presented as a measurement.
