import type { PrinterConfig, PrinterStatus, ProbeResult, ServerInfo, Settings, Template } from "../../shared/types";

async function call<T>(method: string, path: string, body?: unknown, raw = false): Promise<T> {
  const headers: Record<string, string> = { "X-ZPL-Client": "1" };
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (raw) {
      headers["Content-Type"] = "text/plain; charset=utf-8";
      payload = body as string;
    } else {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
  }
  let r: Response;
  try {
    r = await fetch("/api/" + path, { method, headers, body: payload });
  } catch {
    throw new Error("Server nicht erreichbar – läuft zplPrinter noch?");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j as T;
}

export const api = {
  info: () => call<ServerInfo>("GET", "info"),
  settings: () => call<Settings>("GET", "settings"),
  savePrinter: (p: PrinterConfig) => call<PrinterConfig>("PUT", `printers/${encodeURIComponent(p.id)}`, p),
  deletePrinter: (id: string) => call("DELETE", `printers/${encodeURIComponent(id)}`),
  saveTemplate: (t: Template) => call<Template>("PUT", `templates/${encodeURIComponent(t.id)}`, t),
  deleteTemplate: (id: string) => call("DELETE", `templates/${encodeURIComponent(id)}`),
  print: (id: string, zpl: string) => call<{ ok: boolean; bytes: number; ms: number }>("POST", `printers/${encodeURIComponent(id)}/print`, zpl, true),
  status: (id: string) => call<PrinterStatus>("GET", `printers/${encodeURIComponent(id)}/status`),
  command: (id: string, cmd: "calibrate" | "cancel" | "feed") => call("POST", `printers/${encodeURIComponent(id)}/command`, { cmd }),
  probe: (host: string, port: number) => call<ProbeResult>("POST", "probe", { host, port }),
};

/** Kleine Helfer für per-Browser-Vorlieben (letzter Drucker, Dithering …). */
export function pref<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem("zpl." + key);
    if (v == null) return def;
    const parsed = JSON.parse(v);
    // Objekte mit Standardwerten zusammenführen (neue Felder in späteren Versionen)
    if (def && typeof def === "object" && !Array.isArray(def)) return { ...def, ...parsed };
    return parsed;
  } catch {
    return def;
  }
}
export function setPref(key: string, v: unknown) {
  try {
    localStorage.setItem("zpl." + key, JSON.stringify(v));
  } catch {}
}
