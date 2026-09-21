# 04 — Licensing and Clean-Room Plan

**Status: decided. Clean-room implementation.**

I am an engineer, not a lawyer. This document records **verified facts**, the
**engineering decision** taken on them, and the points that need a lawyer if the
project ever wants to depend on them. Nothing here is legal advice.

---

## 1. Verified licence state of the upstream project

Repository: `TheHappyKoala/harmony-of-the-spheres` @
`ffbd3ebde342170515bb581b2637ffde87e7f1d0`, cloned and inspected 21/09/2026.

| Check                         | Command                                         | Result                                                      |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------------------------- |
| Licence file present?         | `find . -iname "LICENSE*" -o -iname "COPYING*"` | **none — empty output**                                     |
| Licence declared in metadata? | `grep -n license package.json`                  | `:11` → `"license": "GNU General Public License v3.0"`      |
| Valid SPDX identifier?        | compared against SPDX list                      | **No.** Valid forms are `GPL-3.0-only` / `GPL-3.0-or-later` |
| Copyright asserted anywhere?  | live v2 footer                                  | "Copyright © Darrell Arjuna Huffman 2024"                   |
| Per-file licence headers?     | inspected `src/physics/**`, `src/scene/**`      | none seen                                                   |

**So: the project claims GPLv3 in package metadata, carries no licence text,
uses a non-standard identifier, and asserts reserved copyright on the live
site.**

---

## 2. What that combination means in practice

Three points matter, and the third is the one people get wrong:

1. **The GPLv3 claim is a real signal of intent.** A maintainer writing "GNU
   General Public License v3.0" into `package.json` is signalling copyleft.
   Treating that as accidental would be wilful blindness.

2. **GPLv3 expects its own text to travel with the work.** The licence is
   granted _by_ its text; distributing under it without shipping it leaves the
   actual grant ill-defined.

3. **A missing licence file makes reuse _riskier_, not safer.** Under the Berne
   Convention, copyright subsists automatically on creation. No licence file
   means **no grant of permission** — the default is exclusive copyright, i.e.
   all rights reserved. "There's no LICENSE so it must be free" is exactly
   backwards.

**Net effect:** the upstream code sits in an ambiguous zone — probably intended
as GPLv3, arguably under-licensed, definitely not public domain. That ambiguity
is unresolvable by us and it is **not worth resolving**, because (§4) we do not
need a single line of it.

---

## 3. The copyleft risk if we were to reuse it

Recorded for completeness. If the rebuild copied upstream source and GPLv3
applies, GPLv3's terms would extend to the derived work: source disclosure for
the whole combined work on distribution, licensing the whole under GPLv3, and
— because this ships to browsers — the strong likelihood that shipping the app
counts as conveying. That forecloses a proprietary product and complicates any
commercial path.

**This risk is entirely avoidable, and the cost of avoiding it here is nearly
zero.**

---

## 4. The decisive fact

**`logiagenesis/gravity` was empty at session start** — `README.md`, 9 bytes,
single commit `85ecc61`. It is **not a fork**. There is no upstream history, no
copied file, no inherited dependency on that codebase.

Clean-room is therefore not a sacrifice made for legal safety. It is simply
**what building in an empty repository already is**. The only discipline
required is to keep it that way.

---

## 5. Decision

**Clean-room implementation. No upstream material of any kind.**

Per the brief: _"If licensing intent is not explicitly known, default to
clean-room."_ Intent is not explicitly known (blocking question **B1** in
`01-questions-and-answers.md` is unanswered). Clean-room is the default and it
is also the cheapest option. Decision taken; no further input needed to proceed.

### 5.1 Prohibited — not copied, adapted, translated or transliterated

- ❌ Source code, in any language, in whole or in part
- ❌ Class/module structure or file organisation copied from upstream
- ❌ Integrator coefficient tables lifted from upstream source
- ❌ Shaders and material code
- ❌ Scenario JSON files (all 4,435) and their schema shape
- ❌ Textures, images, icons, fonts, splash art
- ❌ Prose: descriptions, tooltips, about/changelog/credits text
- ❌ CSS/LESS
- ❌ Line-by-line "rewrite in a different style" of an upstream file

### 5.2 Permitted

- ✅ **Published scientific method.** Newton's law of gravitation; velocity
  Verlet; PEFRL; RK4; Plummer softening; the Barnes–Hut algorithm. These are
  physics and published algorithms — not anyone's copyrighted expression.
  Implemented from method, with the source cited in the code.
- ✅ **Facts.** Masses, radii, orbital elements, state vectors. Facts are not
  copyrightable (_Feist v. Rural_, US; similar principles elsewhere). Taken
  from primary sources, not from upstream's files.
- ✅ **Interoperability knowledge gained by auditing.** Knowing _that_ a
  refresh-rate-coupled timestep is wrong is knowledge, not expression.
- ✅ **Independently-licensed third-party libraries**, each recorded in §7.
- ✅ **Generic UX conventions** — a play button is a play button.

### 5.3 The line I am drawing on the audit

I read upstream source in detail to write `03-current-site-audit.md`. That
creates a real contamination risk, and I am naming it rather than pretending it
away.

**Mitigation, applied in practice:**

- The audit records **defects and their consequences**, never implementation
  recipes to copy.
- Our physics is written from **standard published formulations** — the papers
  and textbook forms cited inline in the source — not from recollection of
  upstream's code.
- Our architecture is **deliberately different in kind**: structure-of-arrays
  over `Float64Array` in a Web Worker with a fixed-timestep accumulator, versus
  upstream's array-of-objects on the main thread stepping once per frame. These
  are not variants of one design; they are opposite choices.
- Our scenario schema is designed from **our** requirements (versioning,
  mandatory citation, Zod validation, migrations) — none of which upstream has.
- Integrator coefficients come from their **published sources**, cited in
  comments at the point of use.

**Residual risk: low, and stated honestly rather than claimed to be zero.** The
overlap that remains is the overlap any two correct implementations of Newtonian
gravity share — which is not protectable expression.

---

## 6. Data licensing

Facts are not copyrightable, but **compilations** can attract database rights
(notably in the EU/UK), and providers attach their own terms. So:

| Source                                    | Role                            | Terms position                                                                                                                                                  |
| ----------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **JPL Horizons** (NASA/Caltech)           | State vectors, ephemerides      | US-government-funded public data; NASA generally permits reuse of unrestricted material with attribution. **Confidence: Medium** — verify per dataset at ingest |
| **NASA Exoplanet Archive** (IPAC/Caltech) | Exoplanet parameters            | Publicly accessible; requests specific acknowledgement. **Confidence: Medium** — verify at ingest                                                               |
| **NASA planetary fact sheets**            | Masses, radii, rotation         | Public NASA factual data. **Confidence: Medium**                                                                                                                |
| **Published papers**                      | Choreography initial conditions | Numerical values are facts; **the paper's text is not**. Cite the DOI, never quote the prose                                                                    |

**Standing rules for the data pipeline:**

1. Every scenario carries a **mandatory, machine-readable `source`** — provider,
   identifier, retrieval date, URL.
2. **Only numerical values and object designations** are ingested. Never
   prose, never images.
3. All descriptive text in our catalogue is **written by us**.
4. Terms are **re-checked at ingest time**, and the check is recorded — not
   assumed from this document.
5. No bulk mirroring of any provider's database. Initial conditions only.

**Open point for legal review:** whether our curated catalogue could itself
attract a database right, and what licence we want to offer it under. Not
blocking; flagged.

---

## 7. Third-party dependency licensing

Every runtime dependency must be permissive (MIT / BSD / Apache-2.0 / ISC).
**No GPL or AGPL dependency may enter the runtime**, since that would reimpose
by the back door the exact constraint this document avoids.

Verified at time of selection:

| Dependency       | Licence     | Role                                                                                                                                      |
| ---------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| React, React-DOM | MIT         | UI chrome                                                                                                                                 |
| TypeScript       | Apache-2.0  | Build                                                                                                                                     |
| Vite             | MIT         | Build/dev                                                                                                                                 |
| Three.js         | MIT         | Rendering                                                                                                                                 |
| Zod              | MIT         | Runtime schema validation                                                                                                                 |
| Vitest           | MIT         | Unit/physics tests                                                                                                                        |
| Playwright       | Apache-2.0  | E2E + accessibility                                                                                                                       |
| axe-core         | **MPL-2.0** | Accessibility testing — **dev-only, not bundled.** MPL is file-level copyleft; keeping it out of the runtime avoids the question entirely |

Enforcement: `npm run verify` includes a licence check that **fails the build**
on any GPL/AGPL/SSPL/CC-BY-SA in the production dependency tree.

---

## 8. Our own licensing posture

Blocking question **B1** (proprietary vs open) is unanswered. Therefore:

- **No `LICENSE` file is added yet.** Adding one guesses at the owner's
  commercial intent; omitting one preserves every option, since the default is
  reserved copyright.
- **Crucially, this is not the upstream mistake.** Upstream declares a licence
  it does not ship. We declare **nothing**, which is unambiguous: all rights
  reserved until the owner decides.
- `package.json` is set `"license": "UNLICENSED"` and `"private": true` — the
  correct npm expression of "not yet licensed for redistribution", and it
  prevents accidental publication.
- When B1 is answered: Apache-2.0 if open (patent grant, and it is what NASA
  chose for GMAT — see `02-top-20-benchmark.md` §5); a proprietary licence if
  closed. Either is a one-file change, because the clean-room discipline has
  kept both doors open.

---

## 9. Attribution we _do_ owe

Clean-room does not mean pretending the prior art did not exist. The rebuild's
credits will acknowledge Harmony of the Spheres by Darrell Huffman and
contributors as prior art in this space, without implying derivation — because
there is none.

---

## 10. Ongoing verification

| Control                             | Mechanism                                                                                           | When         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------- | ------------ |
| No upstream code enters the repo    | Upstream clone lives at `/home/user/thehappykoala/…`, **outside** the project tree; never copied in | Continuous   |
| Dependency licences stay permissive | `npm run verify` licence gate; build fails on copyleft                                              | Every CI run |
| No secrets committed                | Secret scan in CI                                                                                   | Every CI run |
| Data terms re-checked               | Recorded per scenario at ingest                                                                     | Every ingest |

**Verified now:** the upstream clone is at
`/home/user/thehappykoala/harmony-of-the-spheres`, entirely outside
`/home/user/gravity`. No file has been copied between them.
