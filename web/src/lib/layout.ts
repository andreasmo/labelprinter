// Platziert eine Quellseite (Ausschnitt, Drehung, Skalierung) auf dem Etikett und liefert Graustufen in Druckerauflösung.
import type { PrinterConfig } from "../../../shared/types";
import { labelDots, mmToDots } from "../../../shared/types";
import { contentBox, luminance } from "./raster";
import type { Rect, SourcePage } from "./sources";

export type FitMode = "contain" | "cover" | "stretch" | "actual";
export type RotateMode = "auto" | 0 | 90 | 180 | 270;
export type CropMode = "none" | "auto" | "manual";

export interface LayoutOptions {
  crop: CropMode;
  /** normiert 0..1 bezogen auf die Seite */
  manualCrop: Rect;
  fit: FitMode;
  rotate: RotateMode;
  align: "center" | "topleft";
  marginMm: number;
}

export const defaultLayout: LayoutOptions = {
  crop: "none",
  manualCrop: { x: 0, y: 0, w: 1, h: 1 },
  fit: "contain",
  rotate: "auto",
  align: "center",
  marginMm: 0,
};

export interface Gray {
  w: number;
  h: number;
  lum: Float32Array;
}

const autoCropCache = new WeakMap<SourcePage, Rect>();

export async function overview(page: SourcePage, maxPx: number): Promise<HTMLCanvasElement> {
  const s = Math.min(maxPx / page.width, maxPx / page.height);
  return page.render({ x: 0, y: 0, w: page.width, h: page.height }, page.width * s, page.height * s);
}

export async function autoCrop(page: SourcePage): Promise<Rect> {
  const cached = autoCropCache.get(page);
  if (cached) return cached;
  const c = await overview(page, 1600);
  const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height);
  const box = contentBox(luminance(d.data, c.width, c.height), c.width, c.height);
  const full = { x: 0, y: 0, w: page.width, h: page.height };
  let r = full;
  if (box) {
    const k = page.width / c.width;
    const pad = 2; // Pixel Sicherheitsrand in der Übersicht
    const x = Math.max(0, (box.x - pad) * k);
    const y = Math.max(0, (box.y - pad) * k);
    r = {
      x,
      y,
      w: Math.min(page.width - x, (box.w + 2 * pad) * k),
      h: Math.min(page.height - y, (box.h + 2 * pad) * k),
    };
  }
  autoCropCache.set(page, r);
  return r;
}

export async function cropRegion(page: SourcePage, o: LayoutOptions): Promise<Rect> {
  if (o.crop === "auto") return autoCrop(page);
  if (o.crop === "manual") {
    const m = o.manualCrop;
    return { x: m.x * page.width, y: m.y * page.height, w: Math.max(1, m.w * page.width), h: Math.max(1, m.h * page.height) };
  }
  return { x: 0, y: 0, w: page.width, h: page.height };
}

export function resolveRotation(region: Rect, lw: number, lh: number, r: RotateMode): 0 | 90 | 180 | 270 {
  if (r !== "auto") return r;
  const srcLandscape = region.w > region.h * 1.02;
  const srcPortrait = region.h > region.w * 1.02;
  const lblLandscape = lw > lh;
  if ((srcLandscape && !lblLandscape) || (srcPortrait && lblLandscape)) return 90;
  return 0;
}

export interface Placement {
  rotation: 0 | 90 | 180 | 270;
  x: number;
  y: number;
  w: number;
  h: number;
  region: Rect;
  /** Wird etwas abgeschnitten? */
  clipped: boolean;
  /** Effektive Auflösung der Quelle (nur PDF/Originalgröße relevant) */
  scale: number;
}

export function computePlacement(page: SourcePage, region: Rect, p: PrinterConfig, o: LayoutOptions): Placement {
  const L = labelDots(p);
  const margin = mmToDots(o.marginMm || 0, p.dpi);
  const aw = Math.max(1, L.w - 2 * margin);
  const ah = Math.max(1, L.h - 2 * margin);
  const rot = resolveRotation(region, aw, ah, o.rotate);
  const swap = rot % 180 !== 0;
  const rw = swap ? region.h : region.w;
  const rh = swap ? region.w : region.h;
  let sx: number, sy: number;
  switch (o.fit) {
    case "cover":
      sx = sy = Math.max(aw / rw, ah / rh);
      break;
    case "stretch":
      sx = aw / rw;
      sy = ah / rh;
      break;
    case "actual":
      sx = sy = page.unitsPerInch ? p.dpi / page.unitsPerInch : 1;
      break;
    default:
      sx = sy = Math.min(aw / rw, ah / rh);
  }
  const w = Math.max(1, Math.round(rw * sx));
  const h = Math.max(1, Math.round(rh * sy));
  const x = o.align === "center" ? Math.round((L.w - w) / 2) : margin;
  const y = o.align === "center" ? Math.round((L.h - h) / 2) : margin;
  const clipped = x < 0 || y < 0 || x + w > L.w || y + h > L.h;
  return { rotation: rot, x, y, w, h, region, clipped, scale: sx };
}

const MAX_PIXELS = 40_000_000;

/** Rendert die Seite fertig platziert als Graustufenbild in Etikettengröße. */
export async function renderLabelGray(page: SourcePage, p: PrinterConfig, o: LayoutOptions): Promise<{ gray: Gray; placement: Placement }> {
  const region = await cropRegion(page, o);
  const pl = computePlacement(page, region, p, o);
  const L = labelDots(p);
  const swap = pl.rotation % 180 !== 0;
  let uw = swap ? pl.h : pl.w;
  let uh = swap ? pl.w : pl.h;
  // Bei "Füllen" nur so groß wie nötig rendern
  if (uw * uh > MAX_PIXELS) {
    const k = Math.sqrt(MAX_PIXELS / (uw * uh));
    uw = Math.floor(uw * k);
    uh = Math.floor(uh * k);
  }
  const src = await page.render(region, uw, uh);

  const c = document.createElement("canvas");
  c.width = L.w;
  c.height = L.h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, L.w, L.h);
  ctx.imageSmoothingEnabled = uw !== (swap ? pl.h : pl.w);
  ctx.translate(pl.x + pl.w / 2, pl.y + pl.h / 2);
  ctx.rotate((pl.rotation * Math.PI) / 180);
  const dw = swap ? pl.h : pl.w;
  const dh = swap ? pl.w : pl.h;
  ctx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
  const img = ctx.getImageData(0, 0, L.w, L.h);
  return { gray: { w: L.w, h: L.h, lum: luminance(img.data, L.w, L.h) }, placement: pl };
}
