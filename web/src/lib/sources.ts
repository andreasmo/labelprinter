// Eingabequellen: PDF (pdf.js) und Bilder. Jede Seite kann einen Ausschnitt in beliebiger Pixelgröße rendern.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SourcePage {
  index: number;
  /** Seitengröße in Quelleinheiten (PDF: pt, Bild: px) */
  width: number;
  height: number;
  /** Einheiten pro Zoll, wenn physisch bekannt (PDF: 72) */
  unitsPerInch: number | null;
  /** Rendert region (Quelleinheiten) auf eine Leinwand mit genau outW×outH Pixeln, weißer Hintergrund. */
  render(region: Rect, outW: number, outH: number): Promise<HTMLCanvasElement>;
}

export interface Source {
  name: string;
  kind: "pdf" | "image";
  pages: SourcePage[];
  destroy(): void;
}

const base = import.meta.env.BASE_URL + "pdfjs/";

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

async function loadPdf(file: File): Promise<Source> {
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    cMapUrl: base + "cmaps/",
    cMapPacked: true,
    standardFontDataUrl: base + "standard_fonts/",
    wasmUrl: base + "wasm/",
    iccUrl: base + "iccs/",
  });
  const doc = await task.promise;
  const pages: SourcePage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    pages.push({
      index: i - 1,
      width: vp.width,
      height: vp.height,
      unitsPerInch: 72,
      async render(r, outW, outH) {
        const c = canvas(outW, outH);
        const sx = c.width / r.w;
        const sy = c.height / r.h;
        await page.render({
          canvas: c,
          viewport: vp,
          intent: "print",
          transform: [sx, 0, 0, sy, -r.x * sx, -r.y * sy],
          background: "#ffffff",
        }).promise;
        return c;
      },
    });
  }
  return { name: file.name, kind: "pdf", pages, destroy: () => void task.destroy() };
}

async function loadImage(file: File): Promise<Source> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (!w || !h) {
    // SVG ohne feste Größe
    w = 1000;
    h = 1000;
  }
  const page: SourcePage = {
    index: 0,
    width: w,
    height: h,
    unitsPerInch: null,
    async render(r, outW, outH) {
      const c = canvas(outW, outH);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // Pixelgenau bei 1:1, sonst hochwertige Skalierung (bei starker Verkleinerung stufenweise)
      let src: CanvasImageSource = img;
      let sr = { ...r };
      let cw = r.w;
      let ch = r.h;
      while (cw / 2 > c.width && ch / 2 > c.height) {
        const step = canvas(cw / 2, ch / 2);
        const sctx = step.getContext("2d")!;
        sctx.imageSmoothingQuality = "high";
        sctx.fillStyle = "#fff";
        sctx.fillRect(0, 0, step.width, step.height);
        sctx.drawImage(src, sr.x, sr.y, sr.w, sr.h, 0, 0, step.width, step.height);
        src = step;
        sr = { x: 0, y: 0, w: step.width, h: step.height };
        cw = step.width;
        ch = step.height;
      }
      if (Math.abs(sr.w - c.width) < 0.01 && Math.abs(sr.h - c.height) < 0.01) ctx.imageSmoothingEnabled = false;
      ctx.drawImage(src, sr.x, sr.y, sr.w, sr.h, 0, 0, c.width, c.height);
      return c;
    },
  };
  return { name: file.name, kind: "image", pages: [page], destroy: () => URL.revokeObjectURL(url) };
}

export function isPdf(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

export function isZpl(file: File) {
  return /\.(zpl|prn|txt)$/i.test(file.name);
}

export async function loadSource(file: File): Promise<Source> {
  if (isPdf(file)) return loadPdf(file);
  if (file.type.startsWith("image/") || /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(file.name)) return loadImage(file);
  throw new Error(`Dateityp nicht unterstützt: ${file.name}`);
}
