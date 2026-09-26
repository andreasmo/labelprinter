// ZPL-Erzeugung: ^GFA-Grafik (ACS- oder Z64-Kompression), Auftrags-Rahmen, Testetikett.
import type { PrinterConfig } from "../../../shared/types";
import { labelDots, mmToDots } from "../../../shared/types";
import type { Mono } from "./raster";

/** Packt 1-Byte-pro-Pixel in 1-Bit-Zeilen (MSB zuerst). */
export function packRows(m: Mono): { bytesPerRow: number; bytes: Uint8Array } {
  const bpr = Math.ceil(m.w / 8);
  const bytes = new Uint8Array(bpr * m.h);
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (m.data[y * m.w + x]) bytes[y * bpr + (x >> 3)] |= 0x80 >> (x & 7);
  return { bytesPerRow: bpr, bytes };
}

const HEX = "0123456789ABCDEF";

function repeatCode(n: number): string {
  // G..Y = 1..19, g..z = 20..400 (n ≤ 400, größere Läufe teilt rle() auf)
  let s = "";
  if (n >= 20) s += String.fromCharCode("g".charCodeAt(0) + Math.floor(n / 20) - 1);
  if (n % 20) s += String.fromCharCode("G".charCodeAt(0) + (n % 20) - 1);
  return s;
}

function rle(hex: string): string {
  let out = "";
  let i = 0;
  while (i < hex.length) {
    const c = hex[i];
    let j = i + 1;
    while (j < hex.length && hex[j] === c) j++;
    let n = j - i;
    while (n > 400) {
      out += "z" + c;
      n -= 400;
    }
    out += n === 1 ? c : repeatCode(n) + c;
    i = j;
  }
  return out;
}

/** Zebra "Alternative Compression Scheme" (ASCII-Hex mit Lauflängen). */
export function compressACS(bytes: Uint8Array, bytesPerRow: number): string {
  const rows = bytes.length / bytesPerRow;
  let out = "";
  let prev = "";
  for (let r = 0; r < rows; r++) {
    let hex = "";
    for (let i = r * bytesPerRow; i < (r + 1) * bytesPerRow; i++) hex += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
    if (r > 0 && hex === prev) {
      out += ":";
      continue;
    }
    prev = hex;
    let tail = "";
    const m0 = /0+$/.exec(hex);
    const mF = /F+$/.exec(hex);
    if (m0 && m0[0].length > 1) {
      hex = hex.slice(0, m0.index);
      tail = ",";
    } else if (mF && mF[0].length > 1) {
      hex = hex.slice(0, mF.index);
      tail = "!";
    }
    out += rle(hex) + tail;
  }
  return out;
}

/** CRC-16/XMODEM (Polynom 0x1021, Start 0) über den Base64-Text. */
export function crc16(s: string): number {
  let crc = 0;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

async function zlibDeflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(u8: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function encodeZ64(bytes: Uint8Array): Promise<string> {
  const b64 = toBase64(await zlibDeflate(bytes));
  return `:Z64:${b64}:${crc16(b64).toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Erzeugt "^GFA,…" für ein Bitmap. */
export async function graphicField(m: Mono, encoding: "acs" | "z64"): Promise<string> {
  const { bytesPerRow, bytes } = packRows(m);
  const data = encoding === "z64" ? await encodeZ64(bytes) : compressACS(bytes, bytesPerRow);
  return `^GFA,${bytes.length},${bytes.length},${bytesPerRow},${data}`;
}

/** Druckerspezifischer Kopf eines Formats (^XA ist bereits enthalten). */
export function formatHeader(p: PrinterConfig): string {
  const { w, h } = labelDots(p);
  let s = "";
  if (p.darkness != null) s += `~SD${String(Math.max(0, Math.min(30, Math.round(p.darkness)))).padStart(2, "0")}\n`;
  s += "^XA\n^CI28\n";
  if (p.mediaType) s += `^MT${p.mediaType}\n`;
  if (p.speed != null) s += `^PR${Math.round(p.speed)}\n`;
  s += `^PW${w}\n^LL${h}\n^LH0,0\n`;
  s += `^LS${Math.round(p.labelShift || 0)}\n`;
  s += `^LT${Math.max(-120, Math.min(120, Math.round(p.labelTop || 0)))}\n`;
  s += p.rotate180 ? "^POI\n" : "^PON\n";
  return s;
}

export async function buildJob(p: PrinterConfig, pages: Mono[], copies: number): Promise<string> {
  let out = "";
  for (const m of pages) {
    out += formatHeader(p);
    out += "^FO0,0" + (await graphicField(m, p.encoding)) + "^FS\n";
    out += `^PQ${Math.max(1, Math.round(copies))}\n^XZ\n`;
  }
  return out;
}

/** Sonderzeichen ^ und ~ würden als ZPL-Befehl interpretiert. */
export function zplText(s: string): string {
  return s.replace(/[\^~]/g, " ");
}

/** Testetikett zum Einstellen von ^LS / ^LT: Rahmen, Fadenkreuz, mm-Skala. */
export function testLabel(p: PrinterConfig): string {
  const { w, h } = labelDots(p);
  const t = Math.max(2, Math.round(p.dpi / 100)); // Linienstärke
  const mm = (v: number) => mmToDots(v, p.dpi);
  let s = formatHeader(p);
  s += `^FO0,0^GB${w},${h},${t}^FS\n`;
  s += `^FO${Math.round(w / 2)},0^GB${t},${h},${t}^FS\n`;
  s += `^FO0,${Math.round(h / 2)}^GB${w},${t},${t}^FS\n`;
  for (let x = 5; x < p.widthMm; x += 5) s += `^FO${mm(x)},0^GB${t},${mm(x % 10 === 0 ? 4 : 2)},${t}^FS\n`;
  for (let y = 5; y < p.heightMm; y += 5) s += `^FO0,${mm(y)}^GB${mm(y % 10 === 0 ? 4 : 2)},${t},${t}^FS\n`;
  const fh = Math.max(16, Math.min(mm(4), Math.round(h / 8)));
  const lines = [zplText(p.name), `${p.widthMm} x ${p.heightMm} mm  ${p.dpi} dpi`, `LS ${p.labelShift}  LT ${p.labelTop}`];
  lines.forEach((l, i) => {
    s += `^FO${mm(6)},${mm(6) + i * Math.round(fh * 1.3)}^A0N,${fh},${fh}^FD${l}^FS\n`;
  });
  s += "^PQ1\n^XZ\n";
  return s;
}

/** Nur für Tests / Vorschau: ACS dekomprimieren. */
export function decompressACS(data: string, bytesPerRow: number, totalBytes: number): Uint8Array {
  const out = new Uint8Array(totalBytes);
  const rowHex = bytesPerRow * 2;
  let row = 0;
  let cur = "";
  let prev = "";
  let count = 0;
  const flush = (fill: string | null) => {
    if (fill) cur = cur.padEnd(rowHex, fill);
    for (let i = 0; i < bytesPerRow; i++) out[row * bytesPerRow + i] = parseInt(cur.substr(i * 2, 2), 16);
    prev = cur;
    cur = "";
    row++;
  };
  for (const c of data) {
    if (c >= "G" && c <= "Y") count += c.charCodeAt(0) - 70;
    else if (c >= "g" && c <= "z") count += (c.charCodeAt(0) - 102) * 20;
    else if (c === ",") flush("0");
    else if (c === "!") flush("F");
    else if (c === ":") {
      cur = prev;
      flush(null);
    } else {
      cur += c.repeat(count || 1);
      count = 0;
      while (cur.length >= rowHex && row < totalBytes / bytesPerRow) {
        const rest = cur.slice(rowHex);
        cur = cur.slice(0, rowHex);
        flush(null);
        cur = rest;
      }
    }
  }
  return out;
}
