import type { LngLat } from "./types.ts";

/**
 * How far a drawn map (UCSD's illustrated campus map) is from the ground: a grid of offsets, each
 * the meters east and north a spot is drawn from where it really is. Between grid points the
 * offset is interpolated, so the drawing can be bent back onto true positions (or anything placed
 * on it moved to where the drawing shows it).
 */
export interface DrawingWarp {
  /** The grid's north-west corner. */
  west: number;
  north: number;
  /** Grid spacing, in degrees of longitude and latitude. */
  stepLon: number;
  stepLat: number;
  cols: number;
  rows: number;
  /** Offsets in meters, row by row from the north-west corner: east (dx) and north (dy). */
  dx: number[];
  dy: number[];
}

const M_PER_DEG_LAT = 111_132;

/** The drawing's offset at a true position, in meters east and north (held at the grid's edge beyond it). */
export function warpAt(warp: DrawingWarp, [lon, lat]: LngLat): [number, number] {
  const gx = Math.max(0, Math.min(warp.cols - 1, (lon - warp.west) / warp.stepLon));
  const gy = Math.max(0, Math.min(warp.rows - 1, (warp.north - lat) / warp.stepLat));
  const [x0, y0] = [Math.min(warp.cols - 2, Math.floor(gx)), Math.min(warp.rows - 2, Math.floor(gy))];
  const [fx, fy] = [gx - x0, gy - y0];
  const at = (v: number[], x: number, y: number) => v[y * warp.cols + x];
  const lerp = (v: number[]) =>
    (at(v, x0, y0) * (1 - fx) + at(v, x0 + 1, y0) * fx) * (1 - fy) + (at(v, x0, y0 + 1) * (1 - fx) + at(v, x0 + 1, y0 + 1) * fx) * fy;
  return [lerp(warp.dx), lerp(warp.dy)];
}

/** Where a true position is drawn. */
export function toDrawing(warp: DrawingWarp, p: LngLat): LngLat {
  const [dx, dy] = warpAt(warp, p);
  return [p[0] + dx / (M_PER_DEG_LAT * Math.cos((p[1] * Math.PI) / 180)), p[1] + dy / M_PER_DEG_LAT];
}
