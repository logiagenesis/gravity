# Data snapshots

Committed copies of third-party data, with the exact query that produced each
one. They exist so the build is reproducible, auditable and offline-safe, and
because this environment's egress proxy and CI both block the source services.

Terms of use for every source here are recorded in
`artifacts/04-licensing-and-clean-room.md` §11, checked **before** the data was
committed.

---

## `nasa-exoplanet-archive-pscomppars.csv`

| Field       | Value                                                  |
| ----------- | ------------------------------------------------------ |
| Source      | NASA Exoplanet Archive TAP service, table `pscomppars` |
| Endpoint    | `https://exoplanetarchive.ipac.caltech.edu/TAP/sync`   |
| Retrieved   | 2026-09-21                                             |
| Rows        | 6,322 planets (header excluded)                        |
| Consumed by | `scripts/pipeline/build-exoplanets.ts`                 |

### Query

```sql
select pl_name, hostname, pl_orbsmax, pl_orbper, pl_orbeccen,
       pl_bmasse, pl_rade, st_mass, st_rad, st_teff
from pscomppars
where (pl_orbper is not null or pl_orbsmax is not null)
  and st_mass is not null
  and pl_bmasse is not null
```

Requested as `&format=csv`.

### Why it was fetched in three parts

The TAP service applies `TOP` **before** `ORDER BY`, so keyset pagination
returns an arbitrary subset rather than a stable window. The query was
therefore split into three disjoint, exhaustive partitions on `pl_bmasse`
(`< 6`, `>= 6 and < 300`, `>= 300`) and the results concatenated.

### Verification

The archive's own count query was run first and the merged file checked
against it:

```sql
select sum(case when (pl_orbper is not null or pl_orbsmax is not null)
                 and st_mass is not null and pl_bmasse is not null
            then 1 else 0 end) as either
from pscomppars
-- -> 6322
```

Merged file: **6,322 unique `pl_name` values, 0 duplicates — match.**

---

## `jpl-horizons-state-vectors.csv`

| Field       | Value                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source      | NASA JPL Horizons on-line ephemeris system (API version 1.2)                                                                                                                             |
| Endpoint    | `https://ssd.jpl.nasa.gov/api/horizons.api`                                                                                                                                              |
| Retrieved   | 2026-09-21                                                                                                                                                                               |
| Epoch       | **2026-01-01 00:00:00 TDB (JD 2461041.5)** — identical for every row                                                                                                                     |
| Rows        | 16 bodies                                                                                                                                                                                |
| Frame       | Solar System Barycentre (`500@0`), ecliptic of J2000.0                                                                                                                                   |
| Units       | AU and AU/day (`OUT_UNITS=AU-D`)                                                                                                                                                         |
| Ephemeris   | DE441, plus the per-body kernels Horizons names in each response (`mar099`, `jup365_merged`, `sat441l`, `ura184_merged`, `nep098_merged`, `plu060_merged`, and the spacecraft solutions) |
| Consumed by | `scripts/pipeline/build-horizons.ts`                                                                                                                                                     |

### Request

One request per body, differing only in `COMMAND`:

```
format=text  COMMAND='<id>'  OBJ_DATA=NO  MAKE_EPHEM=YES
EPHEM_TYPE=VECTORS  CENTER='500@0'  VEC_TABLE=2
OUT_UNITS=AU-D  REF_PLANE=ECLIPTIC  CSV_FORMAT=YES
START_TIME='2026-01-01'  STOP_TIME='2026-01-01 00:01'  STEP_SIZE='1'
```

Bodies: `10` Sun; `199` `299` `399` `499` `599` `699` `799` `899` `999` the
planets and Pluto; `301` Moon; `-31` Voyager 1; `-32` Voyager 2; `-98` New
Horizons; `-96` Parker Solar Probe; `-170` James Webb Space Telescope.

Only the first row of each response (the one at the epoch) is kept.

### Verification

The pipeline **refuses to build** if any row carries a JD other than
2461041.5, because a configuration assembled from mixed epochs is a Solar
System that never existed.

Independently, `tests/catalog/generated-scenarios.test.ts` checks these
vectors against orbital periods from a _different_ NASA source, the NSSDCA
Planetary Fact Sheet. Every planet agrees within 1.5% (worst: Uranus 1.11%,
which is the expected difference between an osculating and a mean period), the
Moon's orbit about the Earth comes out at 27.32 days against a published 27.3,
and all three interstellar spacecraft come out unbound, as they must.
