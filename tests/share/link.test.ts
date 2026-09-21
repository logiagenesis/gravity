/**
 * Share-link and import/export tests.
 *
 * A share link is UNTRUSTED input from a third party, so the critical property
 * is that decoding always runs full schema validation and never returns a
 * partially-read document.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  encodeScenario,
  decodeScenario,
  buildShareUrl,
  sharePayloadFromHash,
  ShareLinkError,
  MAX_SHARE_LENGTH,
} from "../../src/share/link";
import { migrateAndParse } from "../../src/schema/migrations";
import { ScenarioValidationError } from "../../src/schema/scenario";
import type { Scenario } from "../../src/schema/scenario";

const load = (id: string): Scenario =>
  migrateAndParse(
    JSON.parse(
      readFileSync(join(process.cwd(), "data", "scenarios", `${id}.json`), "utf8"),
    ),
  );

describe("share links", () => {
  it("round-trips a scenario exactly", async () => {
    const original = load("sun-and-earth");
    const decoded = await decodeScenario(await encodeScenario(original));
    expect(decoded).toEqual(original);
  });

  it("round-trips every shipped scenario", async () => {
    for (const id of [
      "inner-solar-system",
      "figure-eight-choreography",
      "jupiter-trojan-points",
      "three-body-chaos",
      "earth-and-moon",
    ]) {
      const original = load(id);
      expect(await decodeScenario(await encodeScenario(original))).toEqual(original);
    }
  });

  it("compresses to well under the length limit", async () => {
    const payload = await encodeScenario(load("inner-solar-system"));
    expect(payload.length).toBeLessThan(MAX_SHARE_LENGTH);
    // Compression must actually be doing something.
    expect(payload.startsWith("z:")).toBe(true);
    expect(payload.length).toBeLessThan(
      JSON.stringify(load("inner-solar-system")).length,
    );
  });

  it("puts the payload in the URL fragment, never the query string", async () => {
    const url = await buildShareUrl(load("sun-and-earth"), "https://example.test/app");
    const parsed = new URL(url);
    // Fragments are never transmitted to a server. This is the privacy property.
    expect(parsed.search).toBe("");
    expect(parsed.hash.startsWith("#/shared/")).toBe(true);
  });

  it("extracts a payload from a hash", () => {
    expect(sharePayloadFromHash("#/shared/z:abc")).toBe("z:abc");
    expect(sharePayloadFromHash("#/scenario/sun-and-earth")).toBeNull();
    expect(sharePayloadFromHash("")).toBeNull();
  });

  describe("rejects bad input with an explanation", () => {
    it("an unknown encoding prefix", async () => {
      await expect(decodeScenario("q:whatever")).rejects.toThrow(ShareLinkError);
    });

    it("a truncated payload", async () => {
      const payload = await encodeScenario(load("sun-and-earth"));
      await expect(
        decodeScenario(payload.slice(0, payload.length - 12)),
      ).rejects.toThrow(ShareLinkError);
    });

    it("valid JSON that is not a scenario", async () => {
      const bytes = new TextEncoder().encode(JSON.stringify({ hello: "world" }));
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const payload = `p:${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
      await expect(decodeScenario(payload)).rejects.toThrow();
    });

    it("a scenario missing its mandatory citation", async () => {
      const scenario = load("sun-and-earth") as unknown as Record<string, unknown>;
      delete scenario.source;
      const bytes = new TextEncoder().encode(JSON.stringify(scenario));
      let binary = "";
      for (const b of bytes) binary += String.fromCharCode(b);
      const payload = `p:${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
      // Decoding must validate; a share link is untrusted third-party input.
      await expect(decodeScenario(payload)).rejects.toThrow(ScenarioValidationError);
    });
  });
});
