/**
 * Scenario catalogue: search, facet filters, sorting and paging over 4,439
 * scenarios.
 *
 * The audited implementation offered NO search and paginated its catalogue
 * across 248 pages, so finding a named system meant clicking through them
 * (artifacts/03-current-site-audit.md section 6). Here the whole facet set is
 * in memory after one request, so every keystroke re-ranks the catalogue with
 * no network at all; only the summaries of the cards actually on screen are
 * fetched.
 */
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  loadCatalogue,
  type CatalogEntry,
  type Catalogue,
  type SortKey,
  type SortDirection,
} from "../catalog";
import {
  BODY_BANDS,
  PERIOD_BANDS,
  CATEGORY_COPY,
  categoryTitle,
  formatPeriod,
} from "./catalogue-facets";

/**
 * Width at or above which the filter panel is a permanent sidebar rather than
 * a disclosure. Must match the .catalogue-layout breakpoint in styles.css.
 */
const SIDEBAR_QUERY = "(min-width: 821px)";

/**
 * Track a media query.
 *
 * The filter panel holds nine facet groups. As a permanent column on a phone
 * that is three screens of checkboxes before the first result, which is what
 * the M4 mobile screenshot showed, so on a phone it collapses to one button.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => globalThis.matchMedia?.(query).matches ?? true,
  );
  useEffect(() => {
    const list = globalThis.matchMedia?.(query);
    if (!list) return;
    const onChange = () => setMatches(list.matches);
    onChange();
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Cards per page. Small enough to render instantly, large enough to scan. */
const PAGE_SIZE = 24;
/** Tags shown before the "show all" disclosure. */
const TAGS_SHOWN = 10;

const SORTS: { id: string; label: string; key: SortKey; direction: SortDirection }[] = [
  { id: "relevance", label: "Best match", key: "name", direction: "asc" },
  { id: "featured", label: "Hand-built first", key: "featured", direction: "desc" },
  { id: "name-asc", label: "Name (A–Z)", key: "name", direction: "asc" },
  { id: "name-desc", label: "Name (Z–A)", key: "name", direction: "desc" },
  { id: "bodies-desc", label: "Most bodies", key: "bodies", direction: "desc" },
  { id: "bodies-asc", label: "Fewest bodies", key: "bodies", direction: "asc" },
  { id: "period-asc", label: "Shortest orbit", key: "period", direction: "asc" },
  { id: "period-desc", label: "Longest orbit", key: "period", direction: "desc" },
];

interface CataloguePageProps {
  onOpen: (id: string) => void;
  /** When set, the page is a category landing view rather than the full index. */
  category?: string;
}

export function CataloguePage({ onOpen, category }: CataloguePageProps) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCatalogue()
      .then((c) => {
        if (!cancelled) setCatalogue(c);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "The scenario catalogue could not be loaded.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loadError !== null) {
    return (
      <div>
        <h1>Scenarios</h1>
        <div className="notice notice--error" role="alert">
          <p>{loadError}</p>
          <p>
            The catalogue is a static file; this usually means the page was served
            without it. Reloading may help.
          </p>
        </div>
      </div>
    );
  }

  if (catalogue === null) {
    return (
      <div>
        <h1>{category ? categoryTitle(category) : "Scenarios"}</h1>
        <p role="status" aria-live="polite">
          Loading the scenario catalogue…
        </p>
      </div>
    );
  }

  return (
    <CatalogueBrowser
      key={category ?? "all"}
      catalogue={catalogue}
      onOpen={onOpen}
      category={category}
    />
  );
}

interface BrowserProps {
  catalogue: Catalogue;
  onOpen: (id: string) => void;
  category?: string;
}

function CatalogueBrowser({ catalogue, onOpen, category }: BrowserProps) {
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [difficulties, setDifficulties] = useState<string[]>([]);
  const [costs, setCosts] = useState<string[]>([]);
  const [providers, setProviders] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [bodyBands, setBodyBands] = useState<string[]>([]);
  const [periodBands, setPeriodBands] = useState<string[]>([]);
  const [starCounts, setStarCounts] = useState<number[]>([]);
  const [sortId, setSortId] = useState("relevance");
  const [page, setPage] = useState(0);
  const [showAllTags, setShowAllTags] = useState(false);
  const [summaries, setSummaries] = useState<Map<number, string>>(new Map());

  const searchId = useId();
  const sortFieldId = useId();
  const hasSidebar = useMediaQuery(SIDEBAR_QUERY);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const trimmedQuery = query.trim();

  // A category landing view is the full catalogue with one filter pinned, so
  // everything below works the same way on both.
  const pinnedCategories = useMemo(
    () => (category ? [category] : categories),
    [category, categories],
  );

  const matched = useMemo(
    () => (trimmedQuery === "" ? catalogue.all() : catalogue.search(trimmedQuery)),
    [catalogue, trimmedQuery],
  );

  /**
   * Apply the filters, optionally leaving one facet out.
   *
   * The star and tag option lists are built from the CURRENT results, because
   * only the data can say which values exist. Building them from the fully
   * filtered set would mean that ticking "1 star" removed "No star" from the
   * list, stranding the reader on a choice they could not undo except by
   * clearing everything. Each of those two facets is therefore offered on the
   * results as they would be WITHOUT that facet applied.
   */
  const applyFilters = useCallback(
    (from: Int32Array, exclude?: "stars" | "tags"): Int32Array => {
      const bands = BODY_BANDS.filter((b) => bodyBands.includes(b.id));
      const periods = PERIOD_BANDS.filter((b) => periodBands.includes(b.id));

      // Body and period bands are unions within their own facet, so several
      // filter passes are combined rather than intersected.
      const unionOf = (
        input: Int32Array,
        ranges: { min: number | null; max: number | null }[],
        apply: (
          input: Int32Array,
          range: { min: number | null; max: number | null },
        ) => Int32Array,
      ): Int32Array => {
        if (ranges.length === 0) return input;
        const keep = new Set<number>();
        for (const range of ranges) for (const i of apply(input, range)) keep.add(i);
        return input.filter((i) => keep.has(i));
      };

      let out = catalogue.filter(from, {
        categories: pinnedCategories,
        difficulties,
        costs,
        providers,
        tags: exclude === "tags" ? [] : tags,
        starCounts: exclude === "stars" ? [] : starCounts,
      });

      out = unionOf(out, bands, (input, range) =>
        catalogue.filter(input, {
          minBodies: range.min ?? undefined,
          maxBodies: range.max ?? undefined,
        }),
      );
      out = unionOf(out, periods, (input, range) =>
        catalogue.filter(input, {
          minPeriodDays: range.min ?? undefined,
          maxPeriodDays: range.max ?? undefined,
        }),
      );
      return out;
    },
    [
      catalogue,
      pinnedCategories,
      difficulties,
      costs,
      providers,
      tags,
      bodyBands,
      periodBands,
      starCounts,
    ],
  );

  const results = useMemo(() => {
    let out = applyFilters(matched);
    const sort = SORTS.find((s) => s.id === sortId);
    // "Best match" means the order search returned; sorting would destroy it.
    if (sort && sortId !== "relevance") {
      out = catalogue.sort(out, sort.key, sort.direction);
    } else if (sortId === "relevance" && trimmedQuery === "") {
      // With no query there is no relevance to preserve, so lead with the
      // hand-built scenarios. Otherwise the first page of the catalogue is
      // 24 arbitrary exoplanet host names and everything written to teach
      // something is 185 pages away.
      out = catalogue.sort(out, "featured", "desc");
    }
    return out;
  }, [applyFilters, catalogue, matched, sortId, trimmedQuery]);

  const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = useMemo(() => {
    const from = currentPage * PAGE_SIZE;
    return Array.from(results.slice(from, from + PAGE_SIZE));
  }, [results, currentPage]);

  // Any change to the query or the filters puts the reader back on page one;
  // silently leaving them on page 12 of 3 results is disorienting.
  useEffect(() => {
    setPage(0);
  }, [
    trimmedQuery,
    categories,
    difficulties,
    costs,
    providers,
    tags,
    bodyBands,
    periodBands,
    starCounts,
    sortId,
  ]);

  // Fetch only the summaries this page needs.
  useEffect(() => {
    let cancelled = false;
    if (visible.length === 0) return;
    catalogue
      .summaries(visible)
      .then((loaded) => {
        if (!cancelled) setSummaries((previous) => new Map([...previous, ...loaded]));
      })
      .catch(() => {
        // A missing summary is a degraded card, not a broken page: every fact
        // on the card other than the sentence comes from the manifest.
      });
    return () => {
      cancelled = true;
    };
  }, [catalogue, visible]);

  const entries = useMemo(
    () => visible.map((i) => catalogue.entry(i)),
    [catalogue, visible],
  );

  const tagRows = useMemo(
    () => catalogue.tagCounts(applyFilters(matched, "tags")),
    [catalogue, applyFilters, matched],
  );
  const starRows = useMemo(
    () => catalogue.starCountBuckets(applyFilters(matched, "stars")),
    [catalogue, applyFilters, matched],
  );

  const toggle = useCallback(
    <T,>(value: T, list: T[], setList: (next: T[]) => void) => {
      setList(
        list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
      );
    },
    [],
  );

  const activeFilterCount =
    categories.length +
    difficulties.length +
    costs.length +
    providers.length +
    tags.length +
    bodyBands.length +
    periodBands.length +
    starCounts.length;

  const clearAll = () => {
    setCategories([]);
    setDifficulties([]);
    setCosts([]);
    setProviders([]);
    setTags([]);
    setBodyBands([]);
    setPeriodBands([]);
    setStarCounts([]);
  };

  const copy = category ? CATEGORY_COPY[category] : undefined;
  const shownTags = showAllTags ? tagRows : tagRows.slice(0, TAGS_SHOWN);

  return (
    <div>
      <h1>{category ? categoryTitle(category) : "Scenarios"}</h1>
      {copy ? (
        <p className="lede">{copy.blurb}</p>
      ) : (
        <p className="lede">
          {catalogue.count.toLocaleString("en-GB")} scenarios, every one stating where
          its numbers came from. Search by name, body, tag or category.
        </p>
      )}

      {!category && (
        <nav className="category-strip" aria-label="Browse by category">
          {catalogue.categories.map((id) => {
            const count = catalogue.filter(catalogue.all(), {
              categories: [id],
            }).length;
            return (
              <a className="category-strip__item" key={id} href={`#/category/${id}`}>
                <span className="category-strip__title">{categoryTitle(id)}</span>
                <span className="category-strip__count">
                  {count.toLocaleString("en-GB")}
                </span>
              </a>
            );
          })}
        </nav>
      )}

      <div className="catalogue-layout">
        <form
          className="filters"
          onSubmit={(event) => event.preventDefault()}
          aria-label="Search and filter scenarios"
        >
          {/* Search sits OUTSIDE the disclosure: it is the primary action and
              must never be a click away. */}
          <div className="field">
            <label htmlFor={searchId}>Search</label>
            <input
              id={searchId}
              type="search"
              value={query}
              placeholder="jupiter, trappist, three-body…"
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
          </div>

          <details
            className="filters__disclosure"
            open={hasSidebar || filtersOpen}
            onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
          >
            <summary className="filters__summary">
              Filters
              {activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
            </summary>

            {!category && (
              <CheckGroup
                legend="Category"
                options={catalogue.categories.map((c) => ({
                  value: c,
                  label: categoryTitle(c),
                }))}
                selected={categories}
                onToggle={(v) => toggle(v, categories, setCategories)}
              />
            )}

            <CheckGroup
              legend="Difficulty"
              options={catalogue.difficulties.map((d) => ({ value: d, label: d }))}
              selected={difficulties}
              onToggle={(v) => toggle(v, difficulties, setDifficulties)}
            />

            <CheckGroup
              legend="Bodies"
              options={BODY_BANDS.map((b) => ({ value: b.id, label: b.label }))}
              selected={bodyBands}
              onToggle={(v) => toggle(v, bodyBands, setBodyBands)}
            />

            <CheckGroup
              legend="Stars"
              hint="Counted at the hydrogen-burning limit, so a brown-dwarf host counts as none."
              options={[...starRows.keys()]
                .sort((a, b) => a - b)
                .map((n) => ({
                  value: String(n),
                  label:
                    n === 0
                      ? "No star (substellar host)"
                      : n === 1
                        ? "1 star"
                        : `${n} stars`,
                }))}
              selected={starCounts.map(String)}
              onToggle={(v) => toggle(Number(v), starCounts, setStarCounts)}
            />

            <CheckGroup
              legend="Orbital period"
              hint="A system matches if any of its orbits falls in the band."
              options={PERIOD_BANDS.map((b) => ({ value: b.id, label: b.label }))}
              selected={periodBands}
              onToggle={(v) => toggle(v, periodBands, setPeriodBands)}
            />

            <CheckGroup
              legend="Computational cost"
              options={catalogue.costs.map((c) => ({ value: c, label: c }))}
              selected={costs}
              onToggle={(v) => toggle(v, costs, setCosts)}
            />

            <CheckGroup
              legend="Data source"
              options={catalogue.providers.map((p) => ({ value: p, label: p }))}
              selected={providers}
              onToggle={(v) => toggle(v, providers, setProviders)}
            />

            <fieldset>
              <legend>Tags</legend>
              {shownTags.map(({ tag, count }) => (
                <div className="check" key={tag}>
                  <input
                    type="checkbox"
                    id={`tag-${tag}`}
                    checked={tags.includes(tag)}
                    onChange={() => toggle(tag, tags, setTags)}
                  />
                  <label htmlFor={`tag-${tag}`}>
                    {tag.replace(/-/g, " ")}{" "}
                    <span className="check__count">
                      {count.toLocaleString("en-GB")}
                    </span>
                  </label>
                </div>
              ))}
              {tagRows.length > TAGS_SHOWN && (
                <button
                  type="button"
                  className="btn btn--ghost btn--small"
                  aria-expanded={showAllTags}
                  onClick={() => setShowAllTags(!showAllTags)}
                >
                  {showAllTags ? "Show fewer tags" : `Show all ${tagRows.length} tags`}
                </button>
              )}
              {tagRows.length === 0 && (
                <p className="field-hint">No tags in this result.</p>
              )}
            </fieldset>

            {activeFilterCount > 0 && (
              <button type="button" className="btn btn--ghost" onClick={clearAll}>
                Clear {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}
              </button>
            )}
          </details>
        </form>

        <div>
          <div className="results-bar">
            {/* Announced to assistive technology as results change. */}
            <p role="status" aria-live="polite" data-testid="result-count">
              {results.length.toLocaleString("en-GB")} scenario
              {results.length === 1 ? "" : "s"}
              {trimmedQuery !== "" ? ` matching “${trimmedQuery}”` : ""}
              {pageCount > 1
                ? ` — page ${currentPage + 1} of ${pageCount.toLocaleString("en-GB")}`
                : ""}
            </p>
            <div className="field field--inline select">
              <label htmlFor={sortFieldId}>Sort</label>
              <select
                id={sortFieldId}
                value={
                  sortId === "relevance" && trimmedQuery === "" ? "featured" : sortId
                }
                onChange={(event) => setSortId(event.target.value)}
              >
                {SORTS.filter(
                  (s) =>
                    // "Best match" only means something once there is a query;
                    // without one the default is "hand-built first", which is
                    // already in the list.
                    (s.id !== "relevance" || trimmedQuery !== "") &&
                    (s.id !== "featured" || trimmedQuery === ""),
                ).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {results.length === 0 ? (
            <div className="notice">
              Nothing matched. Try a shorter search, or clear the filters.
            </div>
          ) : (
            <>
              <ul className="card-grid">
                {entries.map((entry) => (
                  <ScenarioCard
                    key={entry.id}
                    entry={entry}
                    summary={summaries.get(entry.index)}
                    onOpen={onOpen}
                  />
                ))}
              </ul>
              {pageCount > 1 && (
                <Pager
                  page={currentPage}
                  pageCount={pageCount}
                  onGo={(p) => {
                    setPage(p);
                    globalThis.scrollTo({ top: 0, behavior: "auto" });
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

interface CheckGroupProps {
  legend: string;
  hint?: string;
  options: { value: string; label: string }[];
  selected: string[];
  onToggle: (value: string) => void;
}

function CheckGroup({ legend, hint, options, selected, onToggle }: CheckGroupProps) {
  const prefix = useId();
  if (options.length === 0) return null;
  return (
    <fieldset>
      <legend>{legend}</legend>
      {hint && <p className="field-hint">{hint}</p>}
      {options.map((option) => (
        <div className="check" key={option.value}>
          <input
            type="checkbox"
            id={`${prefix}-${option.value}`}
            checked={selected.includes(option.value)}
            onChange={() => onToggle(option.value)}
          />
          <label htmlFor={`${prefix}-${option.value}`}>{option.label}</label>
        </div>
      ))}
    </fieldset>
  );
}

function ScenarioCard({
  entry,
  summary,
  onOpen,
}: {
  entry: CatalogEntry;
  summary: string | undefined;
  onOpen: (id: string) => void;
}) {
  return (
    <li>
      <article className="card">
        <h3>
          <a
            href={`#/scenario/${entry.id}`}
            onClick={(event) => {
              // Let modified clicks open a new tab as usual.
              if (event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              onOpen(entry.id);
            }}
          >
            {entry.name}
          </a>
        </h3>
        {/* The sentence arrives with its shard; the facts below never wait. */}
        <p>{summary ?? " "}</p>
        <div className="badges">
          {entry.featured && <span className="badge badge--featured">Hand-built</span>}
          <span className="badge">{categoryTitle(entry.category)}</span>
          <span className="badge">{entry.difficulty}</span>
          <span className="badge">
            {entry.bodyCount} bod{entry.bodyCount === 1 ? "y" : "ies"}
          </span>
          {entry.minPeriodDays !== null && (
            <span className="badge">{formatPeriod(entry.minPeriodDays)}</span>
          )}
        </div>
        <p className="source-note" style={{ marginTop: "0.5rem" }}>
          Source: {entry.provider}
        </p>
      </article>
    </li>
  );
}

/**
 * Numbered paging.
 *
 * Pages are real, reachable targets rather than an infinite scroll, so a
 * keyboard user can get to the end of 4,439 results and a reader can come
 * back to where they were.
 */
function Pager({
  page,
  pageCount,
  onGo,
}: {
  page: number;
  pageCount: number;
  onGo: (page: number) => void;
}) {
  // A short window around the current page, always including the first and
  // last, so the control stays the same size at page 2 and page 185.
  const window = new Set<number>([0, pageCount - 1]);
  for (let p = page - 2; p <= page + 2; p++) if (p >= 0 && p < pageCount) window.add(p);
  const pages = [...window].sort((a, b) => a - b);

  return (
    <nav className="pager" aria-label="Result pages">
      <button
        type="button"
        className="btn btn--ghost"
        disabled={page === 0}
        onClick={() => onGo(page - 1)}
      >
        Previous
      </button>
      <ul>
        {pages.map((p, at) => (
          <li key={p}>
            {at > 0 && pages[at - 1] !== p - 1 && (
              <span className="pager__gap" aria-hidden="true">
                …
              </span>
            )}
            <button
              type="button"
              className="pager__page"
              aria-current={p === page ? "page" : undefined}
              aria-label={`Page ${p + 1} of ${pageCount}`}
              onClick={() => onGo(p)}
            >
              {p + 1}
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="btn btn--ghost"
        disabled={page === pageCount - 1}
        onClick={() => onGo(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
