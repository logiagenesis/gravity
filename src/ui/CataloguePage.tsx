/**
 * Scenario catalogue: full-text search plus facet filters.
 *
 * The audited implementation offered NO search and paginated its catalogue
 * across 248 pages (artifacts/03-current-site-audit.md §6). Here the whole
 * index is in memory, so filtering is instantaneous and needs no network.
 */
import { useMemo, useState, useId } from "react";
import {
  catalog,
  categories,
  searchCatalog,
  filterCatalog,
  type CatalogEntry,
} from "../catalog";

const DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
const COSTS = ["light", "moderate", "heavy"] as const;

interface CataloguePageProps {
  onOpen: (id: string) => void;
}

export function CataloguePage({ onOpen }: CataloguePageProps) {
  const [query, setQuery] = useState("");
  const [selectedCategories, setCategories] = useState<string[]>([]);
  const [selectedDifficulties, setDifficulties] = useState<string[]>([]);
  const [selectedCosts, setCosts] = useState<string[]>([]);
  const searchId = useId();

  const results = useMemo<CatalogEntry[]>(() => {
    const matched = query.trim() === "" ? catalog : searchCatalog(query);
    return filterCatalog(matched, {
      categories: selectedCategories,
      difficulties: selectedDifficulties,
      costs: selectedCosts,
    });
  }, [query, selectedCategories, selectedDifficulties, selectedCosts]);

  const toggle = (
    value: string,
    list: string[],
    setList: (next: string[]) => void,
  ): void => {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const activeFilterCount =
    selectedCategories.length + selectedDifficulties.length + selectedCosts.length;

  return (
    <div>
      <h1>Scenarios</h1>
      <p className="source-note">
        Every scenario states where its numbers came from. Search by name, body, tag or
        category.
      </p>

      <div className="catalogue-layout">
        <form
          className="filters"
          onSubmit={(event) => event.preventDefault()}
          aria-label="Search and filter scenarios"
        >
          <div className="field">
            <label htmlFor={searchId}>Search</label>
            <input
              id={searchId}
              type="search"
              value={query}
              placeholder="jupiter, three-body, moon…"
              onChange={(event) => setQuery(event.target.value)}
              autoComplete="off"
            />
          </div>

          <fieldset>
            <legend>Category</legend>
            {categories.map((category) => (
              <div className="check" key={category}>
                <input
                  type="checkbox"
                  id={`cat-${category}`}
                  checked={selectedCategories.includes(category)}
                  onChange={() => toggle(category, selectedCategories, setCategories)}
                />
                <label htmlFor={`cat-${category}`}>{category.replace(/-/g, " ")}</label>
              </div>
            ))}
          </fieldset>

          <fieldset>
            <legend>Difficulty</legend>
            {DIFFICULTIES.map((difficulty) => (
              <div className="check" key={difficulty}>
                <input
                  type="checkbox"
                  id={`dif-${difficulty}`}
                  checked={selectedDifficulties.includes(difficulty)}
                  onChange={() =>
                    toggle(difficulty, selectedDifficulties, setDifficulties)
                  }
                />
                <label htmlFor={`dif-${difficulty}`}>{difficulty}</label>
              </div>
            ))}
          </fieldset>

          <fieldset>
            <legend>Computational cost</legend>
            {COSTS.map((cost) => (
              <div className="check" key={cost}>
                <input
                  type="checkbox"
                  id={`cost-${cost}`}
                  checked={selectedCosts.includes(cost)}
                  onChange={() => toggle(cost, selectedCosts, setCosts)}
                />
                <label htmlFor={`cost-${cost}`}>{cost}</label>
              </div>
            ))}
          </fieldset>

          {activeFilterCount > 0 && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setCategories([]);
                setDifficulties([]);
                setCosts([]);
              }}
            >
              Clear {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"}
            </button>
          )}
        </form>

        <div>
          {/* Announced to assistive technology as results change. */}
          <p role="status" aria-live="polite" data-testid="result-count">
            {results.length} scenario{results.length === 1 ? "" : "s"}
            {query.trim() !== "" ? ` matching “${query.trim()}”` : ""}
          </p>

          {results.length === 0 ? (
            <div className="notice">
              Nothing matched. Try a shorter search, or clear the filters.
            </div>
          ) : (
            <ul className="card-grid">
              {results.map((entry) => (
                <li key={entry.id}>
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
                    <p>{entry.summary}</p>
                    <div className="badges">
                      <span className="badge">{entry.category.replace(/-/g, " ")}</span>
                      <span className="badge">{entry.difficulty}</span>
                      <span className="badge">
                        {entry.bodyCount} bod{entry.bodyCount === 1 ? "y" : "ies"}
                      </span>
                      <span className="badge">{entry.cost}</span>
                    </div>
                    <p className="source-note" style={{ marginTop: "0.5rem" }}>
                      Source: {entry.sourceProvider}
                    </p>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
