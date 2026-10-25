/** A small PNG reader for map tiles: 8-bit truecolor, truecolor with alpha or palette; not interlaced. */
import { unzlibSync } from "fflate";

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row by row. */
  rgba: Uint8Array;
}

export function decodePng(png: Uint8Array): Pixels {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0;
  let height = 0;
  let colorType = 2;
  let palette: Uint8Array = new Uint8Array(0);
  let alpha: Uint8Array = new Uint8Array(0);
  const idat: Uint8Array[] = [];
  for (let at = 8; at < png.length; ) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0 || ![2, 3, 6].includes(colorType)) throw new Error("Unsupported PNG (not 8-bit truecolor or palette, or interlaced)");
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") alpha = data;
    else if (type === "IDAT") idat.push(data);
    at += 12 + len;
  }
  const joined = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  idat.reduce((off, d) => (joined.set(d, off), off + d.length), 0);
  const raw = unzlibSync(joined);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  // Undo the per-row filters.
  const stride = width * channels;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const up = y ? px.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = up[i];
      const c = i >= channels ? up[i - channels] : 0;
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    if (colorType === 3) {
      const k = px[i];
      rgba.set(palette.subarray(k * 3, k * 3 + 3), i * 4);
      rgba[i * 4 + 3] = k < alpha.length ? alpha[k] : 255;
    } else {
      rgba.set(px.subarray(i * channels, i * channels + 3), i * 4);
      rgba[i * 4 + 3] = channels === 4 ? px[i * channels + 3] : 255;
    }
  }
  return { width, height, rgba };
}
