/**
 * Which colour a body is drawn in.
 *
 * The renderer used to hard-code 5,772 K for every star, so CM Dra — a pair
 * of measured 3,100 K M-dwarfs — rendered as two white suns. The scenario
 * knows each body's temperature and the renderer does not, so the scenario
 * wins; these tests pin that down.
 */
import { describe, it, expect } from "vitest";
import {
  bodyColour,
  starColour,
  UNSPECIFIED_BODY_COLOUR,
} from "../../src/render/materials";
import { SimState } from "../../src/sim/state";

const hex = (c: { getHexString: () => string }) => `#${c.getHexString()}`;

describe("bodyColour", () => {
  it("uses the scenario's colour for a star, not a Sun-like default", () => {
    // The colour an M-dwarf carries in the generated catalogue.
    expect(hex(bodyColour("#ff9060", "star"))).toBe("#ff9060");
  });

  it("uses the scenario's colour for a planet", () => {
    expect(hex(bodyColour("#6b93d6", "rocky"))).toBe("#6b93d6");
  });

  it("falls back to Sun-like only for a star with no colour at all", () => {
    expect(hex(bodyColour("", "star"))).toBe(hex(starColour(5772)));
  });

  it("falls back to a neutral grey for anything else with no colour", () => {
    expect(hex(bodyColour("", "rocky"))).toBe(UNSPECIFIED_BODY_COLOUR);
  });

  it("treats white as a choice, not as an absence", () => {
    // "#ffffff" used to be the default for an unspecified body, which made a
    // deliberately white star indistinguishable from one nobody had coloured.
    expect(hex(bodyColour("#ffffff", "star"))).toBe("#ffffff");
  });
});

describe("SimState colours", () => {
  const body = (colour?: string) => ({
    id: "a",
    name: "A",
    mass: 1,
    radius: 1,
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    ...(colour === undefined ? {} : { colour }),
  });

  it("keeps a scenario's colour", () => {
    const state = SimState.fromBodies([body("#ff9060"), body("#123456")]);
    expect(state.colours[0]).toBe("#ff9060");
  });

  it("records an absent colour as absent, rather than inventing white", () => {
    const state = SimState.fromBodies([body(), body("#123456")]);
    expect(state.colours[0]).toBe("");
  });
});
