# 14 — M5 side-by-side against the original

Required by rule 5 of the remediation brief: _"For each of M3, M4 and M5
capture the equivalent view on the original … and put both images in the
milestone's log entry. We must win the comparison, not merely exist."_

M5 is about changing a simulation while it runs: editing bodies, guided
experiments, levels of detail, building from a template, and embedding. The
equivalent view on the original is its simulator's side panel, which offers
**Physics · Graphics · Masses · Add**.

**Captured 21–22/09/2026.** Ours at 1440×900 and 393×852 from the production
build (`npm run build` + `npm run preview`), driven by
`scripts/capture-screenshots.ts`.

## Ours — committed images

| View                              | Image                                          |
| --------------------------------- | ---------------------------------------------- |
| Guided experiments                | `screenshots/m5-desktop-experiments.png`       |
| An experiment's answer, opened    | `screenshots/m5-desktop-experiment-answer.png` |
| Body editor                       | `screenshots/m5-desktop-editor.png`            |
| Adding a body on a circular orbit | `screenshots/m5-desktop-editor-add.png`        |
| A rejected edit, with its reason  | `screenshots/m5-desktop-editor-rejected.png`   |
| Detail level: Explore             | `screenshots/m5-desktop-level-explore.png`     |
| Detail level: Full control        | `screenshots/m5-desktop-level-full.png`        |
| Build your own                    | `screenshots/m5-desktop-build.png`             |
| Embedded view (`?embed=1`)        | `screenshots/m5-desktop-embed.png`             |
| Experiments on a phone            | `screenshots/m5-mobile-experiments.png`        |
| Editor on a phone                 | `screenshots/m5-mobile-editor.png`             |
| Build on a phone                  | `screenshots/m5-mobile-build.png`              |
| Embedded on a phone               | `screenshots/m5-mobile-embed.png`              |

## Theirs — what could and could not be captured

**This half of the gate is incomplete, and here is exactly why.**

The rule names Firecrawl "or another permitted route". Both were tried.

| Route                            | Their simulator pages                                                                             | Can it write a file?                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `firecrawl_scrape` (screenshot)  | **Times out.** 60 s MCP cap exceeded on five attempts across three URLs                           | Yes — returns a storage URL that `curl` can fetch        |
| Cloudflare browser rendering     | **Succeeds.** Rendered and returned an image                                                      | **No** — returns the image into the session, not to disk |
| `firecrawl_interact` + local CDP | Session opens; `wss://browser.firecrawl.dev` is **not in the egress allowlist** (`403 Forbidden`) | Would have, if the host were reachable                   |
| `curl` direct                    | `CONNECT tunnel failed, response 403` — the domain is blocked from here                           | —                                                        |

So the one route that renders their simulator cannot save a file, and the one
route that can save a file cannot render their simulator. **Their image is
therefore described below rather than committed.** Recording that plainly is
better than substituting a different view of their site and calling it
equivalent.

The timeout is itself reproducible and worth stating precisely: Firecrawl's
renderer did not reach its completion criteria within 60 s on
`/solar-system/the-solar-system`, `/misc/the-figure-eight-n-body-choreography`
(twice), or with `proxy: basic` and `waitFor: 0`. It is consistent with a page
that never fires `load` — a continuous animation loop or a pending request —
but it is a statement about Firecrawl's criteria, **not** about what a visitor
experiences. Their listing pages scrape in seconds.

### What the Cloudflare capture showed

Two URLs, `/solar-system/the-solar-system` and
`/misc/the-figure-eight-n-body-choreography`, both at 1440×900, both identical
in structure:

- A right-hand panel, about 280px wide, with four top-level tabs: **Physics**,
  **Graphics**, **Masses**, **Add**. Graphics was selected, itself holding
  three sub-tabs — Camera, Labels, Objects — and three controls: Rotating
  Reference Frame, Camera Position, Camera Focus, each with a `[?]` help
  affordance.
- A bottom bar: menu, play, reset, save, and an elapsed-time readout.
- The canvas was black and the three dropdowns were empty. The clock read
  **"NaN years, NaN months, NaN days"**.

**That last observation must not be read as a defect in their product.** The
same Cloudflare renderer, pointed at our own deployed site, captured it
mid-load showing "Loading…" — it screenshots before either application has
finished initialising. Their page had at least drawn its full control panel by
that moment; ours had not. Taken together the capture says nothing reliable
about either one's rendered output, and it is not offered as a win.

## What the comparison does support

Only the structural claims below, each resting on the panel their own page
renders and on their site's own description of itself — _"Add, delete and
modify planets, and change the laws of physics"_ (meta description,
`gravitysimulator.org`, fetched 21/09/2026).

|                                 | Theirs                               | Ours                                                                                |
| ------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------- |
| Add / modify / delete bodies    | **Yes** — Masses and Add tabs        | Yes — `BodyEditor`                                                                  |
| Change the physics constants    | **Yes** — Physics tab                | Yes — integrator, timestep, softening, force method, contact mode                   |
| Undo an edit                    | Not present in the panel as captured | Yes — exact inverses, `src/ui/edit-history.ts`, tested to restore state bit for bit |
| Guided experiments              | Not present                          | Six, each with the question before the button and the physics behind a disclosure   |
| Levels of detail                | Not present                          | Three, persisted; warnings and citations shown at every level                       |
| Build from a template           | Not observed                         | Three templates, each validated and physics-asserted in tests                       |
| Chrome-less embedding           | Not observed                         | `?embed=1`, with attribution and citation retained                                  |
| A rejected edit explains itself | Not observed                         | Validated before any write; the reason appears next to the control that caused it   |

"Not present" and "not observed" are different words on purpose. **Not
present** means the captured panel shows the tab set and it is not among them.
**Not observed** means it may exist behind a tab this capture could not open —
neither available route can click.

## Where they are ahead, still

- **Fourteen integrators to our three.** Recorded in `artifacts/08`; not parity
  for its own sake, and M5 added the one that mattered — a measured adaptive
  scheme — rather than a longer list.
- **Per-scenario preview images.** Their first fifteen cards have hand-made
  thumbnails. Ours has none; it is the largest piece of visual work
  outstanding and is scheduled for M7.
- **A habitable-zone overlay**, which directly serves an exoplanet catalogue.
  Also M7.

## What this gate still owes

An image of their editing panel, committed next to ours. It needs one of:

- the egress allowlist to include `browser.firecrawl.dev`, which would let the
  existing `firecrawl_interact` session be driven from here and the screenshot
  written straight to disk; **or**
- a screenshot route that both renders a continuously-animating page and
  returns a file.

Until then this row is **unmet**, and is listed as such rather than quietly
marked done.
