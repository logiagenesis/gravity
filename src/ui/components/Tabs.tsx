/**
 * An accessible tab set.
 *
 * Implements the WAI-ARIA tabs pattern properly: role="tablist"/"tab"/
 * "tabpanel", aria-selected, aria-controls, roving tabindex, and arrow-key
 * navigation with Home/End. The audited implementation used
 * <ul class="nav"><li class="nav-item"> with no roles at all, so the tabs were
 * invisible to assistive technology and unreachable by keyboard
 * (artifacts/03-current-site-audit.md §10.2).
 */
import { useId, useRef, type ReactNode } from "react";

export interface TabDefinition {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  tabs: TabDefinition[];
  activeId: string;
  onChange: (id: string) => void;
  /** Accessible name for the tab list. */
  label: string;
}

export function Tabs({ tabs, activeId, onChange, label }: TabsProps) {
  const baseId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const focusTab = (index: number) => {
    const clamped = (index + tabs.length) % tabs.length;
    onChange(tabs[clamped].id);
    const buttons =
      listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[clamped]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    switch (event.key) {
      case "ArrowRight":
        event.preventDefault();
        focusTab(index + 1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        focusTab(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusTab(0);
        break;
      case "End":
        event.preventDefault();
        focusTab(tabs.length - 1);
        break;
    }
  };

  return (
    <>
      <div className="tabs" role="tablist" aria-label={label} ref={listRef}>
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              className="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              /* Roving tabindex: only the active tab is in the tab order. */
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${baseId}-panel-${tab.id}`}
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          hidden={tab.id !== activeId}
          tabIndex={0}
        >
          {tab.id === activeId ? tab.content : null}
        </div>
      ))}
    </>
  );
}
