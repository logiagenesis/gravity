# 13 — Deployment verification (GitHub Pages)

Why the site 404'd, what fixed it, and what is now proven about the live
deployment — separating what was observed on the live URL from what was
observed on a byte-identical local copy of it.

## The 404, and its cause

`https://logiagenesis.github.io/gravity/` returned 404. The cause was not a
Pages setting and not a build failure: **`pages.yml` had never run at all.**

GitHub registers a workflow only when the file is present on the repository's
default branch. `pages.yml` existed solely on `claude/amazing-wright-3iwr5k`
and triggers on `push` to `main`, so GitHub had never seen it. Listing the
repository's workflows returned only `ci.yml` — the deploy workflow was not in
the list, which is the observable signature of this state rather than a
disabled or failing one.

The fix was therefore to land the work on `main`, not to change any
configuration. `actions/configure-pages@v6` enables Pages itself on first run,
so no manual repository setting was required.

## What was done

| Step                             | Result                                      |
| -------------------------------- | ------------------------------------------- |
| Waited for CI green on `4ea429d` | 254 unit tests, 50 e2e, all green           |
| Merged PR #2 into `main`         | merge commit `6097a918`                     |
| `pages.yml` registered           | workflow id `363670232`                     |
| Run #1                           | conclusion `success`, 19:41:42–19:44:46 UTC |

Run: https://github.com/logiagenesis/gravity/actions/runs/35646423453

The `build` job runs `npm run build`, which includes `npm run data:build`. The
pipelines read only committed snapshots under `data/sources/snapshots/`, so the
deploy does not depend on reaching NASA, JPL or DEBCat at deploy time and the
published catalogue is reproducible from the repository alone.

## Verified ON the live URL

Observed through the Firecrawl and Cloudflare browser-rendering tools, which
are the only permitted route to that host from this environment.

| Check                                     | Result                                                   |
| ----------------------------------------- | -------------------------------------------------------- |
| `GET /gravity/`                           | HTTP 200                                                 |
| Canonical and `og:url`                    | `https://logiagenesis.github.io/gravity/` — correct      |
| `gravitysimulator.org` anywhere in output | absent (CI asserts this too)                             |
| Catalogue renders                         | 5,142 scenarios, all six categories, search and filters  |
| `#/scenario/exo-trappist-1` renders       | 8 bodies with labels, real positions, red M-dwarf colour |

Screenshots: `pages-catalogue-1440x900.png`, `pages-trappist-1440x900.png`.

The populated body table is itself evidence that the whole chain works on the
live host: the scenario JSON was fetched from the `/gravity/` sub-path, passed
Zod validation, was loaded by the worker, and the worker posted a snapshot back
that the renderer drew.

## Verified on a byte-identical copy, NOT on the live URL

**What could not be done, and why.** Proving the clock _advances_ needs a
click, and this container's egress proxy refuses `CONNECT` to
`logiagenesis.github.io` (403). The browser tools available here can load and
screenshot a page but expose no click action, and `firecrawl_interact` — which
can — is capped at 60 s by the MCP client, below the time the interaction
needs. So the live page could not be driven.

What was driven instead is the same bundle. Building `4ea429d` locally with the
workflow's own `SITE_URL` and `BASE_PATH` reproduced the exact content-hashed
filenames the deployed `index.html` references:

| Asset        | Deployed page references             | Local rebuild produced |
| ------------ | ------------------------------------ | ---------------------- |
| entry script | `/gravity/assets/index-rhStGFHW.js`  | `index-rhStGFHW.js`    |
| stylesheet   | `/gravity/assets/index-Bf2w3tH7.css` | `index-Bf2w3tH7.css`   |

`git diff --stat 4ea429d origin/main` is empty, so the merge commit's tree is
the branch head's tree, and Vite's hashes are content hashes: identical names
mean identical bytes.

That `dist/` was then served by `vite preview` under the same `/gravity/` base
and driven with Playwright:

| Sample              | Clock  |
| ------------------- | ------ |
| paused, on load     | 0.00 h |
| paused, +2 s        | 0.00 h |
| playing, +3 s       | 2.9 d  |
| playing, +6 s       | 5.9 d  |
| after Pause, +1.5 s | 6.6 d  |
| after Pause, +3.5 s | 6.6 d  |

Zero page errors and zero failed requests. The clock holds while paused,
advances 3.0 simulated days over 3 wall-clock seconds at the default 1× speed,
and holds again after Pause. Screenshot:
`pages-build-stepping-1440x900.png`.

**State this honestly:** stepping is proven for the deployed _bytes_ under the
deployed _base path_, not for the deployed _host_. The difference that remains
untested is the host itself — GitHub Pages' MIME types and headers for the
worker and JSON. The live screenshots above rule out the most likely failure
there, since the worker demonstrably ran on the live host to produce the body
table.

## Found while looking

The `z` column of the body table is clipped at the panel's right edge at
1440×900. Not a regression from the earlier fix (names wrap, 4 significant
figures, tabular numerals) — the column simply still does not fit. Logged for
M5.
