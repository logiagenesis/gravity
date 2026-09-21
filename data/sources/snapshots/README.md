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
