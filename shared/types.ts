// Gemeinsame Typen für Frontend und Server.

/** Standard-Rohdruckport. Zebra lauscht auf 6101 und 9100; 6101 ist bei uns der Standard. */
export const DEFAULT_PORT = 6101;
/** Ports, die „Erkennen“ ausprobiert, wenn der eingetragene abgelehnt wird. */
export const RAW_PORTS = [6101, 9100];

/** Ein logischer Drucker = physischer Drucker (IP) + Etikettenformat + Justage. */
export interface PrinterConfig {
  id: string;
  name: string;
  host: string;
  port: number; // Raw/ZPL-Port, Standard 6101 (alternativ 9100)
  dpi: number; // 152 | 203 | 300 | 600
  widthMm: number;
  heightMm: number;
  /** ^LS – horizontale Verschiebung in Dots (positiv = nach links) */
  labelShift: number;
  /** ^LT – vertikale Verschiebung in Dots (-120..120) */
  labelTop: number;
  /** ~SD – Schwärzung 0..30, null = Druckereinstellung lassen */
  darkness: number | null;
  /** ^PR – Druckgeschwindigkeit in Zoll/s, null = lassen */
  speed: number | null;
  /** ^MT – T = Thermotransfer, D = Thermodirekt, null = lassen */
  mediaType: "T" | "D" | null;
  /** ^POI – Ausdruck um 180° drehen */
  rotate180: boolean;
  /** Grafikkompression im ^GFA-Befehl */
  encoding: "acs" | "z64";
  notes?: string;
}

export type DesignElementType = "text" | "barcode" | "box" | "image";

export interface DesignElementBase {
  id: string;
  type: DesignElementType;
  /** Position linke obere Ecke in mm */
  x: number;
  y: number;
  rotation: 0 | 90 | 180 | 270;
}

export interface TextElement extends DesignElementBase {
  type: "text";
  text: string;
  /** Schrifthöhe in mm (Versalhöhe ~ 0,7 davon) */
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
  /** 0 = keine Begrenzung, sonst Umbruchbreite in mm */
  maxWidth: number;
  align: "left" | "center" | "right";
  inverse: boolean;
}

export interface BarcodeElement extends DesignElementBase {
  type: "barcode";
  symbology: "code128" | "ean13" | "code39" | "qrcode" | "datamatrix" | "gs1-128" | "interleaved2of5";
  data: string;
  /** Modulbreite in Dots (ganzzahlig = scharf) */
  module: number;
  /** Balkenhöhe in mm (bei 2D ignoriert) */
  height: number;
  showText: boolean;
}

export interface BoxElement extends DesignElementBase {
  type: "box";
  width: number;
  height: number;
  /** Linienstärke in mm, 0 = gefüllt */
  thickness: number;
  radius: number;
}

export interface ImageElement extends DesignElementBase {
  type: "image";
  /** data:-URL */
  src: string;
  width: number;
  /** Höhe ergibt sich aus Seitenverhältnis wenn 0 */
  height: number;
  dither: DitherMethod;
  threshold: number;
}

export type DesignElement = TextElement | BarcodeElement | BoxElement | ImageElement;

/** Datentabelle für Serienetiketten: Spaltennamen sind die Variablen ({{Spalte}}). */
export interface DataTable {
  columns: string[];
  rows: string[][];
}

export interface Template {
  id: string;
  name: string;
  elements: DesignElement[];
  /** Optional: gespeicherte Seriendaten */
  data?: DataTable;
  /** Spalte, die die Anzahl Etiketten pro Zeile angibt */
  qtyColumn?: string | null;
  updatedAt?: string;
}

export interface Settings {
  version: 1;
  printers: PrinterConfig[];
  templates: Template[];
}

export type DitherMethod = "threshold" | "floyd" | "atkinson" | "bayer";

export interface ServerInfo {
  name: string;
  version: string;
  mode: "local" | "server";
  readonly: boolean;
  dataFile: string;
}

export interface PrinterStatus {
  ok: boolean;
  reachable: boolean;
  error?: string;
  paperOut?: boolean;
  paused?: boolean;
  headOpen?: boolean;
  ribbonOut?: boolean;
  thermalTransfer?: boolean;
  formatsInBuffer?: number;
  labelsRemaining?: number;
  raw?: string;
}

export interface ProbeResult {
  ok: boolean;
  error?: string;
  model?: string;
  firmware?: string;
  dpi?: number;
  printWidthDots?: number;
  labelLengthDots?: number;
  /** Port, auf dem der Drucker tatsächlich geantwortet hat (kann vom angefragten abweichen) */
  port?: number;
  raw?: string;
}

export function newPrinter(): PrinterConfig {
  return {
    id: crypto.randomUUID(),
    name: "Neuer Drucker",
    host: "",
    port: DEFAULT_PORT,
    dpi: 203,
    widthMm: 100,
    heightMm: 50,
    labelShift: 0,
    labelTop: 0,
    darkness: null,
    speed: null,
    mediaType: "T",
    rotate180: false,
    encoding: "acs",
  };
}

export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4);
}

export function labelDots(p: Pick<PrinterConfig, "widthMm" | "heightMm" | "dpi">) {
  return { w: mmToDots(p.widthMm, p.dpi), h: mmToDots(p.heightMm, p.dpi) };
}
