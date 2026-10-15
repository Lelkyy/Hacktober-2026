import { describe, expect, it } from "vitest";
import { toDrawing, warpAt, type DrawingWarp } from "./warp.ts";

const warp: DrawingWarp = { west: 0, north: 1, stepLon: 0.5, stepLat: 0.5, cols: 3, rows: 3, dx: [0, 2, 4, 0, 2, 4, 0, 2, 4], dy: [-1, -1, -1, -1, -1, -1, -1, -1, -1] };

describe("drawing warp", () => {
  it("interpolates between grid points and holds at the edges", () => {
    expect(warpAt(warp, [0.25, 0.9])).toEqual([1, -1]);
    expect(warpAt(warp, [1, 0])).toEqual([4, -1]);
    expect(warpAt(warp, [5, -5])).toEqual([4, -1]);
  });
  it("moves a point by the offset in meters", () => {
    const [lon, lat] = toDrawing(warp, [0.5, 0.5]);
    expect((lon - 0.5) * 111_132 * Math.cos((0.5 * Math.PI) / 180)).toBeCloseTo(2, 6);
    expect((lat - 0.5) * 111_132).toBeCloseTo(-1, 6);
  });
});
