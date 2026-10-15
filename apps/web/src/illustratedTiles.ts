import { addProtocol } from "maplibre-gl";
import { warpAt, type DrawingWarp, type LngLat } from "@campus/core";

/**
 * UC San Diego's illustrated campus map, bent back onto the ground. The drawing is a few meters
 * off true positions (~4 m west-northwest over most of campus; measured against the surveyed
 * ground plan when the graph is built, data/illustrated-warp.json), so routes, doors and your
 * location would sit beside its walkways. Each tile is redrawn from the drawing's tiles with the
 * offset taken out: exactly at the tile's corners, linearly between (two triangles), so
 * neighbouring tiles meet without a seam.
 */

/** UC San Diego's illustrated campus map (by Concept3D, the old maps.ucsd.edu): 512 px, rows counted from the south. */
const SOURCE = "https://assets.concept3d.com/assets/1005/1005_Map_9";
/** The tile URL for the map style. */
export const ILLUSTRATED_TILES = "illustrated://{z}/{x}/{y}";
const SIZE = 512;
/** Drawing tiles kept decoded, for the neighbouring tiles that need them too. */
const KEEP_TILES = 48;

let warp: Promise<DrawingWarp | null> | null = null;
const loadWarp = () =>
  (warp ??= fetch("/data/illustrated-warp.json")
    .then((r) => (r.ok ? (r.json() as Promise<DrawingWarp>) : null))
    .catch(() => null));

const tiles = new Map<string, Promise<ImageBitmap | null>>();
function drawingTile(z: number, x: number, y: number): Promise<ImageBitmap | null> {
  const key = `${z}/${x}/${y}`;
  let tile = tiles.get(key);
  if (tile) {
    // Most recently used last.
    tiles.delete(key);
    tiles.set(key, tile);
    return tile;
  }
  tile = fetch(`${SOURCE}/${z}/${x}/${2 ** z - 1 - y}`)
    .then((r) => (r.ok ? r.blob() : null))
    .then((b) => (b ? createImageBitmap(b) : null))
    .catch(() => null);
  tiles.set(key, tile);
  for (const [old, t] of tiles) {
    if (tiles.size <= KEEP_TILES) break;
    tiles.delete(old);
    void t.then((bitmap) => bitmap?.close());
  }
  return tile;
}

const tileLngLat = (x: number, y: number, z: number): LngLat => {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return [(x / 2 ** z) * 360 - 180, (Math.atan(Math.sinh(n)) * 180) / Math.PI];
};

/** The affine map (canvas setTransform order) taking points `from` to `to`, three of each. */
function affine(from: [number, number][], to: [number, number][]): [number, number, number, number, number, number] {
  const [[x0, y0], [x1, y1], [x2, y2]] = from;
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  // Solve for each output coordinate: out = p * x + q * y + r.
  const solve = (u0: number, u1: number, u2: number) => {
    const p = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
    const q = ((x1 - x0) * (u2 - u0) - (x2 - x0) * (u1 - u0)) / det;
    return [p, q, u0 - p * x0 - q * y0];
  };
  const [a, c, e] = solve(to[0][0], to[1][0], to[2][0]);
  const [b, d, f] = solve(to[0][1], to[1][1], to[2][1]);
  return [a, b, c, d, e, f];
}

async function warpedTile(z: number, x: number, y: number): Promise<ImageBitmap> {
  const w = await loadWarp();
  // Where each corner of the tile is drawn, in drawing pixels at this zoom: its true spot, moved.
  const corners = ([[0, 0], [1, 0], [0, 1], [1, 1]] as const).map(([u, v]): [number, number] => {
    const at = tileLngLat(x + u, y + v, z);
    const [dx, dy] = w ? warpAt(w, at) : [0, 0];
    const metersPerPixel = (40_075_016.7 * Math.cos((at[1] * Math.PI) / 180)) / 2 ** z / SIZE;
    return [(x + u) * SIZE + dx / metersPerPixel, (y + v) * SIZE - dy / metersPerPixel];
  });
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const [tx0, tx1] = [Math.floor(Math.min(...xs) / SIZE), Math.floor((Math.max(...xs) - 1) / SIZE)];
  const [ty0, ty1] = [Math.floor(Math.min(...ys) / SIZE), Math.floor((Math.max(...ys) - 1) / SIZE)];
  const parts: { bitmap: ImageBitmap; tx: number; ty: number }[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const bitmap = await drawingTile(z, tx, ty);
      if (bitmap) parts.push({ bitmap, tx, ty });
    }
  }
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  const dest: [number, number][] = [
    [0, 0],
    [SIZE, 0],
    [0, SIZE],
    [SIZE, SIZE],
  ];
  // The first triangle's mapping over the whole tile, then the second's over its own half: the
  // two agree along the diagonal, so it doesn't show.
  for (const [i, j, k] of [
    [0, 1, 2],
    [1, 3, 2],
  ]) {
    ctx.save();
    if (i === 1) {
      ctx.beginPath();
      ctx.moveTo(SIZE + 1, -1);
      ctx.lineTo(SIZE + 1, SIZE + 1);
      ctx.lineTo(-1, SIZE + 1);
      ctx.closePath();
      ctx.clip();
    }
    ctx.setTransform(...affine([corners[i], corners[j], corners[k]], [dest[i], dest[j], dest[k]]));
    for (const { bitmap, tx, ty } of parts) ctx.drawImage(bitmap, tx * SIZE, ty * SIZE, SIZE, SIZE);
    ctx.restore();
  }
  return canvas.transferToImageBitmap();
}

let registered = false;
/** Serve `illustrated://{z}/{x}/{y}` tiles: the drawing, moved onto true positions. */
export function registerIllustratedTiles() {
  if (registered) return;
  registered = true;
  addProtocol("illustrated", async (params) => {
    const [z, x, y] = params.url.replace("illustrated://", "").split("/").map(Number);
    return { data: await warpedTile(z, x, y) };
  });
}
