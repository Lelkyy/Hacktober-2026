import { haversine } from "./geo.ts";
import { bearing } from "./instructions.ts";
import type { LngLat } from "./types.ts";

const M_PER_DEG_LAT = 110_540;
const OVERLAP_M = 16;
const SAMPLE_M = 28;
const MIN_SHARE = 0.2;
const MIN_OVERLAP_M = 100;
/** Centre-to-centre gap for lines that share a street. */
export const LINE_LANE_M = 10;

function mPerDegLng(lat: number): number {
  return 111_320 * Math.cos((lat * Math.PI) / 180);
}

function toEastNorth(a: LngLat, b: LngLat): [number, number] {
  const lat = (a[1] + b[1]) / 2;
  return [(b[0] - a[0]) * mPerDegLng(lat), (b[1] - a[1]) * M_PER_DEG_LAT];
}

function addMeters(p: LngLat, east: number, north: number): LngLat {
  return [p[0] + east / mPerDegLng(p[1]), p[1] + north / M_PER_DEG_LAT];
}

/** Unit perpendicular, to the right of A→B, in metres east/north. */
function unitPerp(a: LngLat, b: LngLat): [number, number] {
  const [e, n] = toEastNorth(a, b);
  const len = Math.hypot(e, n) || 1;
  return [n / len, -e / len];
}

/** Shift a polyline `meters` to the right of its travel direction. */
export function offsetLine(coords: LngLat[], meters: number): LngLat[] {
  if (Math.abs(meters) < 1e-6 || coords.length < 2) return coords;
  return coords.map((p, i) => {
    let pe: number;
    let pn: number;
    if (i === 0) [pe, pn] = unitPerp(coords[0], coords[1]);
    else if (i === coords.length - 1) [pe, pn] = unitPerp(coords[i - 1], coords[i]);
    else {
      const a = unitPerp(coords[i - 1], coords[i]);
      const b = unitPerp(coords[i], coords[i + 1]);
      let e = a[0] + b[0];
      let n = a[1] + b[1];
      const len = Math.hypot(e, n);
      if (len < 1e-6) {
        [pe, pn] = a;
      } else {
        e /= len;
        n /= len;
        const miter = 1 / Math.max(0.35, e * a[0] + n * a[1]);
        pe = e * miter;
        pn = n * miter;
      }
    }
    return addMeters(p, pe * meters, pn * meters);
  });
}

function distToSeg(p: LngLat, a: LngLat, b: LngLat): number {
  const [ex, ny] = toEastNorth(a, b);
  const [px, py] = toEastNorth(a, p);
  const len2 = ex * ex + ny * ny;
  const t = len2 < 1e-6 ? 0 : Math.max(0, Math.min(1, (px * ex + py * ny) / len2));
  return Math.hypot(px - ex * t, py - ny * t);
}

function distToLine(p: LngLat, line: LngLat[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, distToSeg(p, line[i - 1], line[i]));
  return best;
}

function nearestSeg(p: LngLat, line: LngLat[]): [LngLat, LngLat] | null {
  let best = Infinity;
  let seg: [LngLat, LngLat] | null = null;
  for (let i = 1; i < line.length; i++) {
    const d = distToSeg(p, line[i - 1], line[i]);
    if (d < best) {
      best = d;
      seg = [line[i - 1], line[i]];
    }
  }
  return seg;
}

function sample(coords: LngLat[], step = SAMPLE_M): LngLat[] {
  if (coords.length < 2) return coords.slice();
  const out: LngLat[] = [coords[0]];
  let carry = 0;
  for (let i = 1; i < coords.length; i++) {
    const span = haversine(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    if (span < 1e-6) continue;
    let d = step - carry;
    while (d <= span) {
      const t = d / span;
      out.push([coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t]);
      d += step;
    }
    carry = span - (d - step);
  }
  out.push(coords[coords.length - 1]);
  return out;
}

/** How much of `a` runs within `OVERLAP_M` of `b` (0–1). */
export function lineShare(a: LngLat[], b: LngLat[]): number {
  const pts = sample(a);
  if (pts.length < 2) return 0;
  let hit = 0;
  for (const p of pts) if (distToLine(p, b) <= OVERLAP_M) hit++;
  return hit / pts.length;
}

function overlap(a: LngLat[], b: LngLat[]): boolean {
  const share = Math.max(lineShare(a, b), lineShare(b, a));
  if (share >= MIN_SHARE) return true;
  const along = share * Math.max(sample(a).length, sample(b).length) * SAMPLE_M;
  return share >= 0.08 && along >= MIN_OVERLAP_M;
}

/** True when `b` mostly travels the same way as `a` along their shared stretch. */
export function sameDirection(a: LngLat[], b: LngLat[]): boolean {
  const mid = a[Math.floor(a.length / 2)] ?? a[0];
  const segA = nearestSeg(mid, a);
  const segB = nearestSeg(mid, b);
  if (!segA || !segB) return true;
  const da = Math.abs(((bearing(segA[0], segA[1]) - bearing(segB[0], segB[1]) + 540) % 360) - 180);
  return da <= 90;
}

/**
 * Nudge lines that share a street into parallel lanes so their colours sit
 * side by side. Lines that take different roads are left on their published shape.
 */
export function spreadOverlappingLines(lines: LngLat[][], spacing = LINE_LANE_M): LngLat[][] {
  const n = lines.length;
  if (n < 2) return lines;
  const parent = [...Array(n).keys()];
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (overlap(lines[i], lines[j])) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = groups.get(r) ?? [];
    g.push(i);
    groups.set(r, g);
  }
  const out = lines.slice();
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const ref = lines[members[0]];
    members.forEach((idx, lane) => {
      const raw = (lane - (members.length - 1) / 2) * spacing;
      const sign = sameDirection(ref, lines[idx]) ? 1 : -1;
      out[idx] = offsetLine(lines[idx], raw * sign);
    });
  }
  return out;
}
