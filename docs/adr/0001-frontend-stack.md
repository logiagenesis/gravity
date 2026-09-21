# ADR-0001 — Frontend stack: React + TypeScript + Vite

**Status:** Accepted · **Date:** 2026-09-21

## Context

We are rebuilding a browser n-body gravity simulator. The audit
(`artifacts/03-current-site-audit.md`) established that the existing product's
architectural failures — not its physics knowledge — are what hold it back:

- physics on the main thread (F5),
- the whole Redux state deep-cloned _and_ all body state dispatched back every
  frame (F4),
- 4,435 scenarios compiled into 4,435 built pages (§6),
- a build that rewrites its own `node_modules` to work around its framework (F7).

## Decision

**React 19 + TypeScript + Vite**, producing a static bundle plus a Web Worker.

## Alternatives considered

**Gatsby** — the incumbent. Rejected. Its GraphQL data layer is precisely what
turns a catalogue into thousands of built pages, and the upstream project felt
compelled to patch Gatsby's own loader source to make builds work (F7). We want
a manifest and a client-side search index, which is a plain build script.

**Next.js** — rejected. It brings a server runtime we have no use for: the
product is static assets plus a worker. Added operational surface for no gain.

**Astro** — genuinely strong for content-heavy sites, and the closest call.
Rejected because this product is one large, stateful, interactive island;
islands architecture optimises for the case we do not have.

**Vite** — chosen. Fast dev server, first-class ES-module worker support via
`new Worker(new URL("./x.ts", import.meta.url), { type: "module" })`, and a
plain static build deployable to any CDN.

## Consequences

- No server is required; hosting is a static bucket behind a CDN.
- Worker support is a first-class build feature, not a plugin workaround.
- We own routing and the search index — a deliberate trade of convenience for
  control over exactly the thing that failed upstream.
- React is confined to UI chrome. Per-frame body state lives in the worker and
  reaches the renderer as transferable buffers, never through React state.
- WebAssembly remains an open upgrade path: the simulation core is
  dependency-free and could be reimplemented behind the same worker protocol.
