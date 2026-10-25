/**
 * UC San Diego's illustrated campus map (the drawn one, by Concept3D): its walkways and roads,
 * read off the tiles, and how far the drawing is from the ground. It's drawn by hand, a few meters
 * off true positions in places (~4 m west-northwest over most of campus), so it's measured
 * against the surveyed ground plan and the offsets saved for the app to bend the drawing back.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { haversine, toDrawing, type DrawingWarp, type LngLat } from "@campus/core";
import { Cell, type GroundGrid } from "./ground.ts";
import { decodePng } from "./png.ts";

const TILES = "https://assets.concept3d.com/assets/1005/1005_Map_9";
/** Half a meter a pixel (the tiles are 512 px). */
const ZOOM = 17;
const SIZE = 512;
/** [west, south, east, north] the drawing covers. */
export const DRAWING_BOUNDS = [-117.26, 32.855, -117.2, 32.895] as const;

const tileX = (lon: number) => ((lon + 180) / 360) * 2 ** ZOOM;
const tileY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** ZOOM;
};

/** Download (once) every tile of the drawing into `dir`. */
export async function fetchIllustrated(dir: string, refresh = false): Promise<void> {
  const [w, s, e, n] = DRAWING_BOUNDS;
  mkdirSync(dir, { recursive: true });
  const jobs: [number, number][] = [];
  for (let x = Math.floor(tileX(w)); x <= Math.floor(tileX(e)); x++)
    for (let y = Math.floor(tileY(n)); y <= Math.floor(tileY(s)); y++)
      if (refresh || !existsSync(join(dir, `${x}_${y}`))) jobs.push([x, y]);
  if (jobs.length) console.log(`Fetching ${jobs.length} illustrated map tiles ...`);
  const next = async (): Promise<void> => {
    const job = jobs.pop();
    if (!job) return;
    const [x, y] = job;
    // The tiles count rows from the south (TMS).
    const res = await fetch(`${TILES}/${ZOOM}/${x}/${2 ** ZOOM - 1 - y}`, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok && res.status !== 404) throw new Error(`Illustrated map tile ${ZOOM}/${x}/${y}: HTTP ${res.status}`);
    writeFileSync(join(dir, `${x}_${y}`), res.ok ? new Uint8Array(await res.arrayBuffer()) : new Uint8Array(0));
    return next();
  };
  await Promise.all(Array.from({ length: 8 }, next));
}

/** What the drawing shows at a pixel. */
export const Ink = {
  /** Outside the drawing. */
  None: 0,
  /** Street or parking lot: dark grey. */
  Road: 1,
  /** Walkway or plaza: off-white. */
  Walk: 2,
  /** Roof: mid grey. */
  Roof: 3,
  /** Grass, trees, colored roofs and walls... */
  Other: 4,
} as const;

function ink(r: number, g: number, b: number, a: number): number {
  if (a < 128) return Ink.None;
  const max = Math.max(r, g, b);
  if (max < 8) return Ink.None;
  // Streets, walkways and roofs are all drawn in neutral greys, told apart by how light they are.
  if (max - Math.min(r, g, b) >= 14) return Ink.Other;
  const light = (r + g + b) / 3;
  return light >= 70 && light <= 112 ? Ink.Road : light >= 200 ? Ink.Walk : light > 125 && light < 185 ? Ink.Roof : Ink.Other;
}

/** The drawing, read tile by tile as it's asked about. */
export class Drawing {
  private tiles = new Map<string, Uint8Array | null>();
  constructor(private dir: string) {}

  /** What's drawn at a point (in the drawing's own placement: see `toDrawing`). */
  at([lon, lat]: LngLat): number {
    const [fx, fy] = [tileX(lon), tileY(lat)];
    const [tx, ty] = [Math.floor(fx), Math.floor(fy)];
    const tile = this.tile(tx, ty);
    if (!tile) return Ink.None;
    return tile[Math.min(SIZE - 1, Math.floor((fy - ty) * SIZE)) * SIZE + Math.min(SIZE - 1, Math.floor((fx - tx) * SIZE))];
  }

  private tile(x: number, y: number): Uint8Array | null {
    const key = `${x}_${y}`;
    let t = this.tiles.get(key);
    if (t !== undefined) return t;
    t = null;
    const path = join(this.dir, key);
    const bytes = existsSync(path) ? new Uint8Array(readFileSync(path)) : new Uint8Array(0);
    if (bytes.length > 8) {
      const isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
      const px = isPng ? decodePng(bytes) : (() => {
        const d = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true });
        return { width: d.width, height: d.height, rgba: d.data };
      })();
      t = new Uint8Array(SIZE * SIZE);
      // Some tiles are 256 px: scale up.
      const k = px.width / SIZE;
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          const i = (Math.floor(y * k) * px.width + Math.floor(x * k)) * 4;
          t[y * SIZE + x] = ink(px.rgba[i], px.rgba[i + 1], px.rgba[i + 2], px.rgba[i + 3]);
        }
      }
    }
    this.tiles.set(key, t);
    return t;
  }
}

/** Matching windows: 96 m across, every 48 m, searched up to 16 m each way. */
const WINDOW_M = 96;
const WINDOW_STEP_M = 48;
const SEARCH_M = 16;
/** How alike a window and the ground plan must look (correlation) for its offset to count. */
const MIN_MATCH = 0.45;
/** Offsets are given every 50 m: the median of the windows within 300 m of each. */
const GRID_M = 50;
const GRID_REACH_M = 300;

/**
 * How far the drawing is from the ground, measured against the surveyed ground plan: in windows
 * across campus, the shift that best lines its streets (dark) and walkways (light) up with the
 * plan's, then the median of those near each grid point.
 */
export function measureWarp(drawing: Drawing, ground: GroundGrid): { warp: DrawingWarp; windows: number; medianMeters: number } {
  const [west, south, east, north] = DRAWING_BOUNDS;
  const my = haversine(west, south, west, north) / (north - south);
  const mx = haversine(west, (south + north) / 2, east, (south + north) / 2) / (east - west);
  const W = Math.ceil((east - west) * mx);
  const H = Math.ceil((north - south) * my);
  const lngLat = (x: number, y: number): LngLat => [west + (x + 0.5) / mx, north - (y + 0.5) / my];
  // A meter grid of each: +1 street or parking, -1 walkway, 0 anything else (and drawn or not).
  const planCells = new Int8Array(W * H);
  const drawnCells = new Int8Array(W * H);
  const inDrawing = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = lngLat(x, y);
      const [gx, gy] = ground.toCell(p);
      const bits = ground.at(gx, gy);
      planCells[y * W + x] = bits & (Cell.Street | Cell.Parking) ? 1 : bits & (Cell.Walk | Cell.Sidewalk) ? -1 : 0;
      const k = drawing.at(p);
      drawnCells[y * W + x] = k === Ink.Road ? 1 : k === Ink.Walk ? -1 : 0;
      inDrawing[y * W + x] = k === Ink.None ? 0 : 1;
    }
  }
  // Softened a little (3 m box), so a line a meter out still half-matches.
  const plan = soften(planCells, W, H);
  const drawn = soften(drawnCells, W, H);
  // Correlation of the plan's window at (x0, y0) with the drawing's shifted (sx, sy), every `step` cells.
  const score = (x0: number, y0: number, sx: number, sy: number, step: number) => {
    let [n, st, ss, stt, sss, sts] = [0, 0, 0, 0, 0, 0];
    for (let y = y0; y < y0 + WINDOW_M; y += step) {
      for (let x = x0; x < x0 + WINDOW_M; x += step) {
        const t = plan[y * W + x];
        const s = drawn[(y + sy) * W + x + sx];
        n++;
        st += t;
        ss += s;
        stt += t * t;
        sss += s * s;
        sts += t * s;
      }
    }
    const vt = stt - (st * st) / n;
    const vs = sss - (ss * ss) / n;
    return vt > 0 && vs > 0 ? (sts - (st * ss) / n) / Math.sqrt(vt * vs) : -1;
  };
  const found: { x: number; y: number; dx: number; dy: number }[] = [];
  for (let y0 = SEARCH_M; y0 + WINDOW_M + SEARCH_M < H; y0 += WINDOW_STEP_M) {
    for (let x0 = SEARCH_M; x0 + WINDOW_M + SEARCH_M < W; x0 += WINDOW_STEP_M) {
      let [inside, marked] = [0, 0];
      for (let y = y0; y < y0 + WINDOW_M; y += 4) {
        for (let x = x0; x < x0 + WINDOW_M; x += 4) {
          inside += inDrawing[y * W + x];
          if (plan[y * W + x]) marked++;
        }
      }
      const cells = (WINDOW_M / 4) ** 2;
      if (inside < 0.9 * cells || marked < 0.15 * cells) continue;
      // Coarse search every 2 m on every other cell, then the meters around the best.
      let best = { sx: 0, sy: 0, r: -Infinity };
      for (let sy = -SEARCH_M; sy <= SEARCH_M; sy += 2)
        for (let sx = -SEARCH_M; sx <= SEARCH_M; sx += 2) {
          const r = score(x0, y0, sx, sy, 2);
          if (r > best.r) best = { sx, sy, r };
        }
      const coarse = best;
      best = { sx: 0, sy: 0, r: -Infinity };
      for (let sy = coarse.sy - 2; sy <= coarse.sy + 2; sy++)
        for (let sx = coarse.sx - 2; sx <= coarse.sx + 2; sx++) {
          if (Math.abs(sx) > SEARCH_M || Math.abs(sy) > SEARCH_M) continue;
          const r = score(x0, y0, sx, sy, 1);
          if (r > best.r) best = { sx, sy, r };
        }
      // Drawn east = +x; drawn north = -y.
      if (best.r >= MIN_MATCH) found.push({ x: x0 + WINDOW_M / 2, y: y0 + WINDOW_M / 2, dx: best.sx, dy: -best.sy });
    }
  }
  const median = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  const all = { dx: median(found.map((f) => f.dx)), dy: median(found.map((f) => f.dy)) };
  const cols = Math.ceil(W / GRID_M) + 1;
  const rows = Math.ceil(H / GRID_M) + 1;
  const dx: number[] = [];
  const dy: number[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [x, y] = [c * GRID_M, r * GRID_M];
      const byDistance = found.map((f) => ({ f, d: Math.hypot(f.x - x, f.y - y) })).sort((a, b) => a.d - b.d);
      let near = byDistance.filter((n) => n.d <= GRID_REACH_M);
      // Thinly matched ground: the nearest few, if close enough; else campus as a whole.
      if (near.length < 5) near = byDistance.slice(0, 8).filter((n) => n.d <= 3 * GRID_REACH_M);
      dx.push(near.length >= 5 ? median(near.map((n) => n.f.dx)) : all.dx);
      dy.push(near.length >= 5 ? median(near.map((n) => n.f.dy)) : all.dy);
    }
  }
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    warp: { west, north, stepLon: GRID_M / mx, stepLat: GRID_M / my, cols, rows, dx: dx.map(round), dy: dy.map(round) },
    windows: found.length,
    medianMeters: median(found.map((f) => Math.hypot(f.dx, f.dy))),
  };
}

/** A 3 × 3 box average. */
function soften(cells: Int8Array, w: number, h: number): Float32Array {
  const rows = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 1; x < w - 1; x++) rows[y * w + x] = cells[y * w + x - 1] + cells[y * w + x] + cells[y * w + x + 1];
  const out = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 0; x < w; x++) out[y * w + x] = (rows[(y - 1) * w + x] + rows[y * w + x] + rows[(y + 1) * w + x]) / 9;
  return out;
}

/** Whether the drawing shows a walkway (or plaza) at a true position. */
export function drawnWalk(drawing: Drawing, warp: DrawingWarp, p: LngLat): boolean {
  return drawing.at(toDrawing(warp, p)) === Ink.Walk;
}
