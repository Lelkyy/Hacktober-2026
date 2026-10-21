import { describe, expect, it } from "vitest";
import { lineShare, offsetLine, sameDirection, spreadOverlappingLines } from "./lineOffset.ts";
import type { LngLat } from "./types.ts";

/** A short northbound street near campus (~330 m). */
const north: LngLat[] = [
  [-117.235, 32.877],
  [-117.235, 32.88],
];
const northCopy: LngLat[] = [
  [-117.235, 32.877],
  [-117.235, 32.88],
];
const south: LngLat[] = [
  [-117.235, 32.88],
  [-117.235, 32.877],
];
/** A street a kilometre east — should not count as overlapping. */
const elsewhere: LngLat[] = [
  [-117.22, 32.877],
  [-117.22, 32.88],
];

describe("offsetLine", () => {
  it("moves a northbound line east for a positive offset", () => {
    const out = offsetLine(north, 10);
    expect(out[0][0]).toBeGreaterThan(north[0][0]);
    expect(out[1][0]).toBeGreaterThan(north[1][0]);
  });

  it("leaves a line alone when the offset is 0", () => {
    expect(offsetLine(north, 0)).toEqual(north);
  });
});

describe("lineShare", () => {
  it("is 1 for the same path", () => {
    expect(lineShare(north, northCopy)).toBeCloseTo(1, 1);
  });

  it("is 0 for distant paths", () => {
    expect(lineShare(north, elsewhere)).toBeLessThan(0.05);
  });
});

describe("sameDirection", () => {
  it("is true for copies, false for the reverse", () => {
    expect(sameDirection(north, northCopy)).toBe(true);
    expect(sameDirection(north, south)).toBe(false);
  });
});

describe("spreadOverlappingLines", () => {
  it("leaves a single line, or two far-apart lines, on their published shape", () => {
    expect(spreadOverlappingLines([north])).toEqual([north]);
    const [a, b] = spreadOverlappingLines([north, elsewhere]);
    expect(a).toEqual(north);
    expect(b).toEqual(elsewhere);
  });

  it("puts two copies of a street on opposite sides", () => {
    const [a, b] = spreadOverlappingLines([north, northCopy]);
    expect(a[0][0]).toBeLessThan(north[0][0]);
    expect(b[0][0]).toBeGreaterThan(north[0][0]);
    expect(Math.abs(b[0][0] - a[0][0])).toBeGreaterThan(Math.abs(a[0][0] - north[0][0]));
  });

  it("still separates a pair that run the street in opposite directions", () => {
    const [a, b] = spreadOverlappingLines([north, south]);
    expect(Math.abs(a[0][0] - b[0][0])).toBeGreaterThan(0.00005);
  });
});
