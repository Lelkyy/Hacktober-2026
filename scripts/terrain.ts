/**
 * Ground elevation from the open Terrain Tiles on AWS (Mapzen "terrarium" PNGs, mostly USGS 3DEP
 * around here; ~4 m per pixel at zoom 15), for timing walks up and down hills.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LngLat } from "@campus/core";
import { decodePng } from "./png.ts";

const TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
/** The most detailed level the tiles have. */
const ZOOM = 15;
const SIZE = 256;

const tileX = (lon: number) => ((lon + 180) / 360) * 2 ** ZOOM;
const tileY = (lat: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** ZOOM;
};

/** Download (once) every tile over the [south, west, north, east] box into `dir`. */
export async function fetchTerrain(bbox: readonly [number, number, number, number], dir: string, refresh = false): Promise<void> {
  const [s, w, n, e] = bbox;
  mkdirSync(dir, { recursive: true });
  for (let x = Math.floor(tileX(w)); x <= Math.floor(tileX(e)); x++) {
    for (let y = Math.floor(tileY(n)); y <= Math.floor(tileY(s)); y++) {
      const path = join(dir, `${x}_${y}.png`);
      if (!refresh && existsSync(path)) continue;
      const res = await fetch(`${TILES}/${ZOOM}/${x}/${y}.png`, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`Terrain tile ${ZOOM}/${x}/${y}: HTTP ${res.status}`);
      writeFileSync(path, new Uint8Array(await res.arrayBuffer()));
    }
  }
}

/** Elevation in meters anywhere in the downloaded tiles (bilinear between pixels). */
export class Terrain {
  private tiles = new Map<string, Float32Array>();
  constructor(private dir: string) {}

  at([lon, lat]: LngLat): number {
    // Pixel centres sit at half-pixel offsets.
    const px = tileX(lon) * SIZE - 0.5;
    const py = tileY(lat) * SIZE - 0.5;
    const [x0, y0] = [Math.floor(px), Math.floor(py)];
    const [fx, fy] = [px - x0, py - y0];
    const z = (x: number, y: number) => this.pixel(x, y);
    return (z(x0, y0) * (1 - fx) + z(x0 + 1, y0) * fx) * (1 - fy) + (z(x0, y0 + 1) * (1 - fx) + z(x0 + 1, y0 + 1) * fx) * fy;
  }

  private pixel(x: number, y: number): number {
    const [tx, ty] = [Math.floor(x / SIZE), Math.floor(y / SIZE)];
    const key = `${tx}_${ty}`;
    let tile = this.tiles.get(key);
    if (!tile) {
      const path = join(this.dir, `${key}.png`);
      if (!existsSync(path)) throw new Error(`No terrain tile ${key}; run with --refresh`);
      tile = decodeTerrarium(readFileSync(path));
      this.tiles.set(key, tile);
    }
    return tile[(y - ty * SIZE) * SIZE + (x - tx * SIZE)];
  }
}

/** A terrarium PNG to elevations: red * 256 + green + blue / 256 - 32768. */
function decodeTerrarium(png: Uint8Array): Float32Array {
  const { width, height, rgba } = decodePng(png);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
  return out;
}
