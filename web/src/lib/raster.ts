// 1-Bit-Rasterung: Graustufen + Dithering. DOM-frei, damit testbar.
import type { DitherMethod } from "../../../shared/types";

/** 1 Byte pro Pixel, 1 = schwarz (druckt), 0 = weiß */
export interface Mono {
  w: number;
  h: number;
  data: Uint8Array;
}

export function createMono(w: number, h: number): Mono {
  return { w, h, data: new Uint8Array(w * h) };
}

export interface DitherOptions {
  method: DitherMethod;
  /** 0..255 – höher = mehr schwarz */
  threshold: number;
  invert?: boolean;
}

/** RGBA → Luminanz (0 schwarz .. 255 weiß), Transparenz wird als Weiß behandelt. */
export function luminance(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const a = rgba[p + 3] / 255;
    const l = 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
    out[i] = l * a + 255 * (1 - a);
  }
  return out;
}

const BAYER8 = [
  0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
  3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21,
];

export function ditherLum(lum: Float32Array, w: number, h: number, opt: DitherOptions): Mono {
  const m = createMono(w, h);
  const t = opt.threshold;
  // Bei Fehlerdiffusion verschiebt der Schwellwert die Helligkeit.
  const bias = opt.method === "threshold" ? 0 : 128 - t;
  const g = opt.method === "threshold" ? lum : lum.map((v) => v + bias);
  const inv = !!opt.invert;
  const set = (i: number, black: boolean) => (m.data[i] = black !== inv ? 1 : 0);

  switch (opt.method) {
    case "threshold":
      for (let i = 0; i < g.length; i++) set(i, g[i] < t);
      break;
    case "bayer":
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const tt = ((BAYER8[(y & 7) * 8 + (x & 7)] + 0.5) / 64) * 255;
          set(i, g[i] < tt);
        }
      break;
    case "floyd":
    case "atkinson": {
      // Serpentinen-Abtastung (Zeilen abwechselnd links→rechts / rechts→links) vermeidet Streifenmuster
      const buf = Float32Array.from(g);
      const fs = opt.method === "floyd";
      const add = (x: number, y: number, v: number) => {
        if (x >= 0 && x < w && y < h) buf[y * w + x] += v;
      };
      for (let y = 0; y < h; y++) {
        const rev = (y & 1) === 1;
        const d = rev ? -1 : 1;
        for (let k = 0; k < w; k++) {
          const x = rev ? w - 1 - k : k;
          const i = y * w + x;
          const old = buf[i];
          const black = old < 128;
          set(i, black);
          const err = old - (black ? 0 : 255);
          if (fs) {
            add(x + d, y, (err * 7) / 16);
            add(x - d, y + 1, (err * 3) / 16);
            add(x, y + 1, (err * 5) / 16);
            add(x + d, y + 1, err / 16);
          } else {
            const e = err / 8;
            add(x + d, y, e);
            add(x + 2 * d, y, e);
            add(x - d, y + 1, e);
            add(x, y + 1, e);
            add(x + d, y + 1, e);
            add(x, y + 2, e);
          }
        }
      }
      break;
    }
  }
  return m;
}

export function rgbaToMono(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, opt: DitherOptions): Mono {
  return ditherLum(luminance(rgba, w, h), w, h, opt);
}

/** Verodert src in dst an Position (dx,dy). */
export function blitOr(dst: Mono, src: Mono, dx: number, dy: number) {
  for (let y = 0; y < src.h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= dst.w) continue;
      if (src.data[y * src.w + x]) dst.data[ty * dst.w + tx] = 1;
    }
  }
}

/** Bounding Box der "dunklen" Pixel, oder null wenn leer. */
export function contentBox(lum: Float32Array, w: number, h: number, limit = 235) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (lum[y * w + x] < limit) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function blackRatio(m: Mono) {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) n += m.data[i];
  return n / m.data.length;
}
