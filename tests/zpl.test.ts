import { expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { compressACS, crc16, decompressACS, encodeZ64, graphicField, packRows } from "../web/src/lib/zpl";
import { createMono, ditherLum } from "../web/src/lib/raster";

function randomMono(w: number, h: number, seed = 1) {
  const m = createMono(w, h);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let y = 0; y < h; y++) {
    const mode = y % 7;
    for (let x = 0; x < w; x++) {
      let v = 0;
      if (mode === 0) v = 0; // leere Zeile
      else if (mode === 1) v = 1; // volle Zeile
      else if (mode === 2) v = x < w / 3 ? 1 : 0; // Rest weiß
      else if (mode === 3) v = x > w / 2 ? 1 : 0; // Rest schwarz
      else v = rnd() < 0.3 ? 1 : 0;
      m.data[y * w + x] = v;
    }
    if (y % 11 === 5 && y > 0) m.data.copyWithin(y * w, (y - 1) * w, y * w); // Wiederholung
  }
  return m;
}

test("ACS round trip, verschiedene Breiten", () => {
  for (const w of [1, 7, 8, 9, 63, 64, 203, 812, 3300]) {
    const m = randomMono(w, 60, w);
    const { bytes, bytesPerRow } = packRows(m);
    const acs = compressACS(bytes, bytesPerRow);
    expect(acs).toMatch(/^[0-9A-FG-Yg-z,!:]*$/);
    expect(decompressACS(acs, bytesPerRow, bytes.length)).toEqual(bytes);
  }
});

test("ACS lange Läufe > 400", () => {
  const m = createMono(8 * 1000, 2);
  for (let x = 0; x < 8 * 900; x++) m.data[x] = 1; // 1800 F, dann 200 0
  for (let x = 16; x < 8000; x++) m.data[8000 + x] = x % 2; // "55…" Muster
  const { bytes, bytesPerRow } = packRows(m);
  const acs = compressACS(bytes, bytesPerRow);
  expect(decompressACS(acs, bytesPerRow, bytes.length)).toEqual(bytes);
  expect(acs.length).toBeLessThan(40);
});

test("Z64 ist zlib + Base64 + CRC", async () => {
  const m = randomMono(200, 50);
  const { bytes } = packRows(m);
  const z = await encodeZ64(bytes);
  const [, tag, b64, crc] = z.split(":");
  expect(tag).toBe("Z64");
  expect(new Uint8Array(inflateSync(Buffer.from(b64, "base64")))).toEqual(bytes);
  expect(crc).toBe(crc16(b64).toString(16).toUpperCase().padStart(4, "0"));
});

test("CRC-16/XMODEM Prüfwert", () => {
  expect(crc16("123456789")).toBe(0x31c3);
});

test("^GFA Kopf", async () => {
  const m = createMono(20, 3);
  m.data.fill(1);
  const gf = await graphicField(m, "acs");
  expect(gf.startsWith("^GFA,9,9,3,")).toBe(true);
});

test("Dithering liefert 50 % Schwarz bei Mittelgrau", () => {
  const w = 64, h = 64;
  const lum = new Float32Array(w * h).fill(127.5);
  for (const method of ["floyd", "atkinson", "bayer"] as const) {
    const m = ditherLum(lum, w, h, { method, threshold: 128 });
    const ratio = m.data.reduce((a, b) => a + b, 0) / (w * h);
    expect(Math.abs(ratio - 0.5)).toBeLessThan(0.08);
  }
});

test("Unabhängiger Encoder (zpl-image) wird von unserem ACS-Decoder identisch gelesen", async () => {
  // @ts-ignore – optionales Testpaket
  const zi = await import("zpl-image").catch(() => null);
  if (!zi) return;
  const w = 123, h = 40; // Läufe über Zeilengrenzen hinweg (zpl-image kodiert fortlaufend)
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = (i * 7919) % 13 < 5 || (i % w) > 100 || (i % w) < 20 ? 0 : 255;
    rgba.set([v, v, v, 255], i * 4);
  }
  const r = zi.rgbaToACS(rgba, w, { notrim: true });
  const m = createMono(w, h);
  for (let i = 0; i < w * h; i++) m.data[i] = rgba[i * 4] < 128 ? 1 : 0;
  const { bytes, bytesPerRow } = packRows(m);
  expect(r.rowlen).toBe(bytesPerRow);
  expect(decompressACS(r.acs, bytesPerRow, bytes.length)).toEqual(bytes);
  const z = zi.rgbaToZ64(rgba, w, { notrim: true }).z64 as string;
  const [, , b64, crc] = z.split(":");
  expect(crc).toBe(crc16(b64).toString(16).toUpperCase().padStart(4, "0"));
  expect(new Uint8Array(inflateSync(Buffer.from(b64, "base64")))).toEqual(bytes);
});
