import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DEFAULT_PORT, type PrinterConfig, type Settings, type Template } from "../shared/types";

export function isCompiledExe(): boolean {
  const exe = basename(process.execPath).toLowerCase();
  return !/^(node|bun|nodejs)(\.exe)?$/.test(exe);
}

/** Reihenfolge: --data-dir / ZPL_DATA_DIR → portable (settings.json neben der Exe) → %APPDATA% bzw. ~/.config */
export function resolveDataFile(dataDir?: string): string {
  const dir = dataDir || process.env.ZPL_DATA_DIR;
  if (dir) return join(dir, "settings.json");
  if (isCompiledExe()) {
    const portable = join(dirname(process.execPath), "settings.json");
    if (existsSync(portable)) return portable;
  }
  if (process.platform === "win32") return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "zplPrinter", "settings.json");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "zplprinter", "settings.json");
}

const num = (v: unknown, def: number, min = -Infinity, max = Infinity) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const numOrNull = (v: unknown, min: number, max: number) => (v === null || v === undefined || v === "" ? null : num(v, 0, min, max));
const str = (v: unknown, def = "", max = 500) => (typeof v === "string" ? v.slice(0, max) : def);

export function sanitizePrinter(raw: any, id?: string): PrinterConfig {
  const host = str(raw?.host).trim();
  if (host && !/^[A-Za-z0-9.\-:\[\]_]+$/.test(host)) throw new Error("Ungültiger Hostname / IP-Adresse");
  return {
    id: id || str(raw?.id) || crypto.randomUUID(),
    name: str(raw?.name, "Drucker", 100).trim() || "Drucker",
    host,
    port: Math.round(num(raw?.port, DEFAULT_PORT, 1, 65535)),
    dpi: Math.round(num(raw?.dpi, 203, 100, 600)),
    widthMm: num(raw?.widthMm, 100, 5, 300),
    heightMm: num(raw?.heightMm, 50, 5, 2000),
    labelShift: Math.round(num(raw?.labelShift, 0, -9999, 9999)),
    labelTop: Math.round(num(raw?.labelTop, 0, -120, 120)),
    darkness: numOrNull(raw?.darkness, 0, 30),
    speed: numOrNull(raw?.speed, 1, 14),
    mediaType: raw?.mediaType === "T" || raw?.mediaType === "D" ? raw.mediaType : null,
    rotate180: !!raw?.rotate180,
    encoding: raw?.encoding === "z64" ? "z64" : "acs",
    notes: str(raw?.notes, "", 2000),
  };
}

export function sanitizeTemplate(raw: any, id?: string): Template {
  if (!Array.isArray(raw?.elements)) throw new Error("Vorlage ohne Elemente");
  const json = JSON.stringify(raw.elements);
  if (json.length > 20_000_000) throw new Error("Vorlage zu groß");
  const t: Template = {
    id: id || str(raw?.id) || crypto.randomUUID(),
    name: str(raw?.name, "Vorlage", 100).trim() || "Vorlage",
    elements: JSON.parse(json),
    updatedAt: new Date().toISOString(),
  };
  if (raw?.data && Array.isArray(raw.data.columns) && Array.isArray(raw.data.rows)) {
    const cols = raw.data.columns.slice(0, 200).map((c: unknown) => str(c, "", 200));
    const rows = raw.data.rows.slice(0, 20000).map((r: unknown) => (Array.isArray(r) ? r.slice(0, 200).map((c) => str(c, "", 5000)) : []));
    if (JSON.stringify(rows).length > 20_000_000) throw new Error("Datentabelle zu groß");
    t.data = { columns: cols, rows };
    t.qtyColumn = raw.qtyColumn ? str(raw.qtyColumn, "", 200) : null;
  }
  return t;
}

export class SettingsStore {
  private data: Settings = { version: 1, printers: [], templates: [] };
  private queue: Promise<unknown> = Promise.resolve();
  private backedUp = false;

  constructor(readonly file: string) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.file, "utf8"));
      this.data = {
        version: 1,
        printers: (raw.printers || []).map((p: any) => sanitizePrinter(p)),
        templates: (raw.templates || []).flatMap((t: any) => {
          try {
            return [sanitizeTemplate(t, t.id)];
          } catch {
            return [];
          }
        }),
      };
    } catch (e: any) {
      if (e?.code !== "ENOENT") console.error(`Einstellungen konnten nicht gelesen werden (${this.file}):`, e.message);
    }
  }

  get(): Settings {
    return this.data;
  }

  printer(id: string) {
    return this.data.printers.find((p) => p.id === id);
  }

  /** Serialisierte Änderung + atomares Speichern. */
  update(fn: (s: Settings) => void): Promise<Settings> {
    const run = async () => {
      const next: Settings = structuredClone(this.data);
      fn(next);
      await mkdir(dirname(this.file), { recursive: true });
      if (!this.backedUp && existsSync(this.file)) {
        await copyFile(this.file, this.file + ".bak").catch(() => {});
        this.backedUp = true;
      }
      const tmp = this.file + ".tmp";
      await writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
      await rename(tmp, this.file);
      this.data = next;
      return next;
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}
