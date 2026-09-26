// Einfacher Etiketten-Designer: rendert Elemente pixelgenau in Druckerauflösung (1 Bit).
import bwipjs from "bwip-js/browser";
import type { BarcodeElement, BoxElement, DesignElement, ImageElement, PrinterConfig, TextElement } from "../../../shared/types";
import { labelDots, mmToDots } from "../../../shared/types";
import { blitOr, createMono, ditherLum, luminance, type Mono } from "./raster";
import { applyVars, type Vars } from "./vars";

export interface ElementBox {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DesignRender {
  mono: Mono;
  boxes: ElementBox[];
  errors: Record<string, string>;
}

export const FONTS = ["Arial", "Arial Narrow", "Segoe UI", "Calibri", "Bahnschrift", "Verdana", "Tahoma", "Consolas", "Courier New", "Times New Roman"];

export const SYMBOLOGIES: { id: BarcodeElement["symbology"]; label: string; twoD: boolean }[] = [
  { id: "code128", label: "Code 128", twoD: false },
  { id: "gs1-128", label: "GS1-128", twoD: false },
  { id: "code39", label: "Code 39", twoD: false },
  { id: "ean13", label: "EAN-13", twoD: false },
  { id: "interleaved2of5", label: "2/5 Interleaved", twoD: false },
  { id: "qrcode", label: "QR-Code", twoD: true },
  { id: "datamatrix", label: "DataMatrix", twoD: true },
];

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function rotateCanvas(src: HTMLCanvasElement, rot: number): HTMLCanvasElement {
  if (!rot) return src;
  const swap = rot % 180 !== 0;
  const c = canvas(swap ? src.height : src.width, swap ? src.width : src.height);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingEnabled = false;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

function canvasToMono(c: HTMLCanvasElement, method: ImageElement["dither"] = "threshold", threshold = 128): Mono {
  const d = c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height);
  return ditherLum(luminance(d.data, c.width, c.height), c.width, c.height, { method, threshold });
}

function fontSpec(e: TextElement, px: number) {
  return `${e.italic ? "italic " : ""}${e.bold ? "bold " : ""}${px}px "${e.font}", Arial, sans-serif`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    if (!maxW) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const test = line + word;
      if (line && ctx.measureText(test).width > maxW) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

function renderText(e: TextElement, dpi: number): HTMLCanvasElement {
  const px = Math.max(4, mmToDots(e.size, dpi));
  const maxW = e.maxWidth > 0 ? mmToDots(e.maxWidth, dpi) : 0;
  const m = canvas(10, 10).getContext("2d")!;
  m.font = fontSpec(e, px);
  const lines = wrap(m, e.text || " ", maxW);
  const lh = Math.round(px * 1.15);
  const widths = lines.map((l) => m.measureText(l).width);
  const pad = e.inverse ? Math.round(px * 0.15) : 0;
  const boxW = Math.ceil((maxW || Math.max(1, ...widths)) + 2 * pad);
  const boxH = Math.ceil(lines.length * lh + 2 * pad);
  const c = canvas(boxW, boxH);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = e.inverse ? "#000" : "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = e.inverse ? "#fff" : "#000";
  ctx.font = fontSpec(e, px);
  ctx.textBaseline = "top";
  lines.forEach((l, i) => {
    const inner = boxW - 2 * pad;
    const x = e.align === "center" ? (inner - widths[i]) / 2 : e.align === "right" ? inner - widths[i] : 0;
    ctx.fillText(l, pad + x, pad + i * lh + (lh - px) / 2);
  });
  return c;
}

function renderBarcode(e: BarcodeElement, dpi: number): HTMLCanvasElement {
  const module = Math.max(1, Math.round(e.module));
  const twoD = SYMBOLOGIES.find((s) => s.id === e.symbology)?.twoD;
  const c = document.createElement("canvas");
  const opts: Record<string, unknown> = {
    bcid: e.symbology,
    text: e.data,
    scale: module,
    includetext: !twoD && e.showText,
    textxalign: "center",
    backgroundcolor: "FFFFFF",
    parsefnc: e.symbology === "gs1-128",
  };
  if (!twoD) {
    // bwip-js rechnet die Höhe in mm bei 72 dpi × scale
    opts.height = (mmToDots(e.height, dpi) / module) * (25.4 / 72);
    opts.textsize = Math.min(24, Math.max(6, Math.round(mmToDots(2.2, dpi) / module))); // bwip-js: 1..24
  }
  if (e.symbology === "qrcode") opts.eclevel = "M";
  bwipjs.toCanvas(c, opts as any);
  return c;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImg(src: string) {
  let p = imageCache.get(src);
  if (!p) {
    const img = new Image();
    img.src = src;
    p = img.decode().then(() => img);
    imageCache.set(src, p);
  }
  return p;
}

async function renderImage(e: ImageElement, dpi: number): Promise<HTMLCanvasElement> {
  const img = await loadImg(e.src);
  const w = Math.max(1, mmToDots(e.width, dpi));
  const h = e.height > 0 ? mmToDots(e.height, dpi) : Math.round((w * img.naturalHeight) / Math.max(1, img.naturalWidth));
  const c = canvas(w, h);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

function boxMono(e: BoxElement, dpi: number): Mono {
  const swap = e.rotation % 180 !== 0;
  const w = Math.max(1, mmToDots(swap ? e.height : e.width, dpi));
  const h = Math.max(1, mmToDots(swap ? e.width : e.height, dpi));
  const t = e.thickness > 0 ? Math.max(1, mmToDots(e.thickness, dpi)) : 0;
  const r = Math.min(mmToDots(e.radius || 0, dpi), Math.floor(Math.min(w, h) / 2));
  const m = createMono(w, h);
  const inside = (x: number, y: number, rr: number, W: number, H: number, ox: number, oy: number) => {
    // Punkt im (abgerundeten) Rechteck?
    const lx = x - ox, ly = y - oy;
    if (lx < 0 || ly < 0 || lx >= W || ly >= H) return false;
    if (rr <= 0) return true;
    const cx = lx < rr ? rr : lx >= W - rr ? W - rr - 1 : lx;
    const cy = ly < rr ? rr : ly >= H - rr ? H - rr - 1 : ly;
    return (lx - cx) ** 2 + (ly - cy) ** 2 <= rr * rr;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const outer = inside(x, y, r, w, h, 0, 0);
      const inner = t > 0 && inside(x, y, Math.max(0, r - t), w - 2 * t, h - 2 * t, t, t);
      if (outer && !inner) m.data[y * w + x] = 1;
    }
  return m;
}

export async function elementMono(e: DesignElement, dpi: number): Promise<Mono> {
  switch (e.type) {
    case "box":
      return boxMono(e, dpi);
    case "text":
      return canvasToMono(rotateCanvas(renderText(e, dpi), e.rotation));
    case "barcode":
      return canvasToMono(rotateCanvas(renderBarcode(e, dpi), e.rotation));
    case "image":
      return canvasToMono(rotateCanvas(await renderImage(e, dpi), e.rotation), e.dither, e.threshold);
  }
}

/** Setzt Variablen in Text- und Barcode-Inhalte ein. Ohne vars bleiben die Platzhalter sichtbar. */
export function resolveElement(e: DesignElement, vars?: Vars): { el: DesignElement; missing: string[] } {
  if (!vars) return { el: e, missing: [] };
  if (e.type === "text") {
    const r = applyVars(e.text, vars);
    return { el: { ...e, text: r.text }, missing: r.missing };
  }
  if (e.type === "barcode") {
    const r = applyVars(e.data, vars);
    return { el: { ...e, data: r.text }, missing: r.missing };
  }
  return { el: e, missing: [] };
}

export async function renderDesign(elements: DesignElement[], p: PrinterConfig, vars?: Vars): Promise<DesignRender> {
  const L = labelDots(p);
  const mono = createMono(L.w, L.h);
  const boxes: ElementBox[] = [];
  const errors: Record<string, string> = {};
  for (const orig of elements) {
    const { el: e, missing } = resolveElement(orig, vars);
    const x = mmToDots(e.x, p.dpi);
    const y = mmToDots(e.y, p.dpi);
    if (missing.length) errors[e.id] = `Unbekannte Variable: ${missing.map((m) => `{{${m}}}`).join(", ")}`;
    if ((e.type === "text" && !e.text.trim()) || (e.type === "barcode" && !e.data.trim())) {
      // leerer Wert in dieser Zeile → Element auslassen
      boxes.push({ id: e.id, x, y, w: mmToDots(3, p.dpi), h: mmToDots(3, p.dpi) });
      continue;
    }
    try {
      const m = await elementMono(e, p.dpi);
      blitOr(mono, m, x, y);
      boxes.push({ id: e.id, x, y, w: m.w, h: m.h });
    } catch (err) {
      errors[e.id] = String((err as Error)?.message ?? err).replace(/^bwipp\.\w+#?\d*:\s*/, "");
      boxes.push({ id: e.id, x, y, w: mmToDots(10, p.dpi), h: mmToDots(10, p.dpi) });
    }
  }
  return { mono, boxes, errors };
}

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export function newElement(type: DesignElement["type"], extra: Partial<DesignElement> = {}): DesignElement {
  const base = { id: uid(), x: 3, y: 3, rotation: 0 as const };
  switch (type) {
    case "text":
      return { ...base, type, text: "Text", size: 5, font: "Arial", bold: false, italic: false, maxWidth: 0, align: "left", inverse: false, ...(extra as object) };
    case "barcode":
      return { ...base, type, symbology: "code128", data: "12345678", module: 2, height: 10, showText: true, ...(extra as object) };
    case "box":
      return { ...base, type, width: 20, height: 10, thickness: 0.5, radius: 0, ...(extra as object) };
    case "image":
      return { ...base, type, src: "", width: 20, height: 0, dither: "floyd", threshold: 128, ...(extra as object) } as ImageElement;
  }
}
