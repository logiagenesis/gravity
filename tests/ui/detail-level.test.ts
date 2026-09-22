/**
 * The detail level.
 *
 * Two things are worth asserting: that the levels really are nested, so
 * raising one never takes something away, and that a browser which refuses
 * storage still gets a working setting.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  DEFAULT_DETAIL_LEVEL,
  DETAIL_LEVELS,
  DETAIL_LEVEL_INFO,
  readDetailLevel,
  shows,
  writeDetailLevel,
  type DetailFeature,
} from "../../src/ui/detail-level";

const FEATURES: DetailFeature[] = ["diagnostics", "method", "numerics"];

/** Replace localStorage for one test, restoring it afterwards. */
function withStorage(storage: unknown) {
  vi.stubGlobal("localStorage", storage);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the levels", () => {
  it("describes every one of them", () => {
    expect(DETAIL_LEVEL_INFO.map((info) => info.level)).toEqual([...DETAIL_LEVELS]);
    for (const info of DETAIL_LEVEL_INFO) {
      expect(info.label.length).toBeGreaterThan(2);
      expect(info.description.length).toBeGreaterThan(30);
    }
  });

  it("is nested: a higher level never shows less", () => {
    // Otherwise "more detail" would be a lie, and someone would move up a
    // level to find a control and lose a different one.
    for (const feature of FEATURES) {
      let seen = false;
      for (const level of DETAIL_LEVELS) {
        const visible = shows(level, feature);
        if (seen) expect(visible, `${feature} at ${level}`).toBe(true);
        seen ||= visible;
      }
      expect(seen, `${feature} is never shown at any level`).toBe(true);
    }
  });

  it("gives the beginner level no numerical settings at all", () => {
    for (const feature of FEATURES) {
      expect(shows("beginner", feature), feature).toBe(false);
    }
  });

  it("gives the advanced level everything", () => {
    for (const feature of FEATURES) {
      expect(shows("advanced", feature), feature).toBe(true);
    }
  });

  it("puts the conservation diagnostics one level above the bottom", () => {
    // The default has to include them: the drift readout is the project's
    // central claim about itself and hiding it by default would bury it.
    expect(shows(DEFAULT_DETAIL_LEVEL, "diagnostics")).toBe(true);
    expect(shows(DEFAULT_DETAIL_LEVEL, "numerics")).toBe(false);
  });
});

describe("persistence", () => {
  it("round-trips a level", () => {
    const store = new Map<string, string>();
    withStorage({
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    });
    writeDetailLevel("advanced");
    expect(readDetailLevel()).toBe("advanced");
  });

  it("falls back to the default when nothing is stored", () => {
    withStorage({ getItem: () => null, setItem: () => {} });
    expect(readDetailLevel()).toBe(DEFAULT_DETAIL_LEVEL);
  });

  it("ignores a stored value that is not a level", () => {
    // Someone else's key, an older build's value, or a hand-edited store.
    withStorage({ getItem: () => "expert", setItem: () => {} });
    expect(readDetailLevel()).toBe(DEFAULT_DETAIL_LEVEL);
  });

  it("survives storage that throws, which is what a private window does", () => {
    withStorage({
      getItem: () => {
        throw new Error("The operation is insecure.");
      },
      setItem: () => {
        throw new Error("The operation is insecure.");
      },
    });
    expect(readDetailLevel()).toBe(DEFAULT_DETAIL_LEVEL);
    expect(() => writeDetailLevel("beginner")).not.toThrow();
  });

  it("survives localStorage being absent entirely", () => {
    withStorage(undefined);
    expect(readDetailLevel()).toBe(DEFAULT_DETAIL_LEVEL);
    expect(() => writeDetailLevel("beginner")).not.toThrow();
  });
});
