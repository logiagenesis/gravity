# 10 — M4 side-by-side against the original

Required by rule 5 of the remediation brief: _"For each of M3, M4 and M5
capture the equivalent view on the original … and put both images in the
milestone's log entry. We must win the comparison, not merely exist."_

**Captured 21/09/2026.** Ours from the production build (`npm run build` +
`npm run preview`) at 1440×900. Theirs fetched live through the Firecrawl MCP
tool at the same viewport, because the egress proxy blocks the domain
directly (`curl` returns `CONNECT tunnel failed, response 403`).

| Side   | View                              | Image                                                                |
| ------ | --------------------------------- | -------------------------------------------------------------------- |
| Theirs | `gravitysimulator.org/exoplanets` | `screenshots/prior-art/gravitysimulator-org-exoplanets-1440x900.png` |
| Ours   | Catalogue index                   | `screenshots/m4-desktop-catalogue.png`                               |
| Ours   | Exoplanets, filtered              | `screenshots/m4-desktop-category-filtered.png`                       |
| Ours   | Search                            | `screenshots/m4-desktop-search.png`                                  |
| Ours   | Catalogue on a phone              | `screenshots/m4-mobile-catalogue.png`                                |

The prior-art screenshot is third-party content held for comparison only. It
is recorded in `04-licensing-and-clean-room.md` §11 and is not used in, or
served by, the product.

---

## What the comparison actually shows

### Finding a named system

|            | Theirs                                                                                                      | Ours                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Search     | **None.** No search field anywhere on the listing                                                           | Full-text, every keystroke, no network                                                                         |
| Pagination | `First Page · 1 · 2 · 3 · Last Page` over **106 pages** — pages 4 to 105 are reachable only by typing a URL | Numbered pages with a sliding window; first and last are always one click away                                 |
| Filters    | None                                                                                                        | 8 groups: category, difficulty, bodies, stars, orbital period, cost, data source, tags — each with live counts |
| Sort       | None                                                                                                        | 7 orders                                                                                                       |

Verified on the fetched page: the pager markup is literally
`First Page`, `1`, `2`, `3`, `Last Page` linking to `/exoplanets/106`.
To reach "K2-137" a visitor must already know which of the 106 pages it is on.

### Honesty about the data

|                    | Theirs     | Ours                                                                      |
| ------------------ | ---------- | ------------------------------------------------------------------------- |
| Source on the card | Not shown  | `Source: NASA Exoplanet Archive` on every card                            |
| Assumptions        | Not stated | Each scenario's citation block lists exactly what was assumed, per system |
| Orbit sizing       | Unknown    | From the published **period**, with the 335 fallbacks named               |

### Curated versus bulk

Both catalogues are mostly bulk import, and **both show it**. On their page the
first fifteen cards have hand-made thumbnails and editorial titles; further in,
every entry shares one generic `exoplanet.png` and the template title
"_X_ - System With _N_ Exoplanets". Ours leads with the 15 hand-built scenarios
and marks them **Hand-built**, so the distinction is stated rather than left
for the visitor to infer from a repeated stock image.

---

## Where they are still better

Stated plainly, because a comparison that only finds wins is not a comparison.

1. **Preview imagery.** Their curated cards carry a rendered picture of the
   system; ours carry text. Theirs is more inviting to browse, and no amount
   of facet count makes up for that at a glance.
   _Remedy:_ render each scenario headlessly at build time to a small WebP and
   ship it beside the scenario JSON. The renderer already runs in Playwright,
   so the machinery exists. Cost is build time and roughly 4,755 images; it
   needs a byte budget of its own. **Not done — scheduled for M7.**

2. **Editorial titles.** "Kepler-70 b and c — Worlds, Around a Dying Star,
   that Almost Touch" tells a story. Ours says "Kepler-70". Theirs is better
   writing on the ~38 systems where a human wrote it.
   _Remedy:_ hand-write titles and summaries for a "Hall of Fame" subset,
   sourced and cited like everything else. **Not done — candidate for M5.**

3. **Sub-navigation by detection method.** They split exoplanets into Transit,
   Radial Velocity and Imaging. That is a genuinely useful axis we do not
   carry, because `pl_discmethod` is not in our snapshot.
   _Remedy:_ add the column at the next snapshot refresh and make it a facet.
   **Not done — small, and worth doing.**

---

## Verdict

**We win on finding things and on honesty; they win on first impression.**

The functional gap is the one that matters for a catalogue of 4,755 scenarios
— a catalogue nobody can search is a catalogue nobody uses, which is the
finding that opened `03-current-site-audit.md` §6. But "it looks like a
prototype, it is not done" cuts both ways, and a text-only grid against their
image grid is the weakest part of this milestone. Item 1 above is the single
highest-value visual improvement left in the project.
