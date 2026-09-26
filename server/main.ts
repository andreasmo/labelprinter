// zplPrinter – schlanker Server: Einstellungen speichern + ZPL per TCP an Drucker weiterreichen.
// Alle Bildverarbeitung passiert im Browser.
import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { parseArgs } from "node:util";
import pkg from "../package.json" with { type: "json" };
import { DEFAULT_PORT, type ServerInfo } from "../shared/types";
import { probe, sendRaw, status } from "./printer";
import { resolveDataFile, sanitizePrinter, sanitizeTemplate, SettingsStore } from "./settings";
import { serveStatic } from "./static";

const { values: args } = parseArgs({
  options: {
    port: { type: "string" },
    host: { type: "string" },
    "data-dir": { type: "string" },
    "no-browser": { type: "boolean" },
    server: { type: "boolean" },
    readonly: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
  strict: false,
});

if (args.help) {
  console.log(`zplPrinter ${pkg.version}

  --port <n>        Port (Standard 8910, env ZPL_PORT)
  --host <addr>     Bind-Adresse (Standard 127.0.0.1; --server ⇒ 0.0.0.0)
  --server          Server-Modus: im Netz erreichbar, kein Browserstart
  --data-dir <dir>  Ordner für settings.json (env ZPL_DATA_DIR)
  --readonly        Einstellungen nur lesen (env ZPL_READONLY=1)
  --no-browser      Browser nicht automatisch öffnen`);
  process.exit(0);
}

const serverMode = !!args.server || process.env.ZPL_MODE === "server";
const PORT = Number(args.port || process.env.ZPL_PORT || 8910);
const HOST = String(args.host || process.env.ZPL_HOST || (serverMode ? "0.0.0.0" : "127.0.0.1"));
const READONLY = !!args.readonly || process.env.ZPL_READONLY === "1";
const MAX_BODY = 64 * 1024 * 1024;

const store = new SettingsStore(resolveDataFile(args["data-dir"] as string | undefined));
await store.load();

const info: ServerInfo = { name: "zplPrinter", version: pkg.version, mode: serverMode ? "server" : "local", readonly: READONLY, dataFile: store.file };

function json(res: ServerResponse, code: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(data);
}

class HttpError extends Error {
  constructor(public code: number, msg: string) {
    super(msg);
  }
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, "Auftrag zu groß");
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<any> {
  try {
    return JSON.parse((await readBody(req)).toString("utf8"));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "Ungültiges JSON");
  }
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** Schutz gegen fremde Webseiten (CSRF / DNS-Rebinding), die den lokalen Dienst ansprechen. */
function guard(req: IncomingMessage, isApi: boolean) {
  const host = String(req.headers.host || "");
  if (!serverMode && !LOCAL_HOST.test(host)) throw new HttpError(403, "Zugriff nur über localhost erlaubt");
  if (isApi && req.method !== "GET") {
    if (req.headers["x-zpl-client"] !== "1") throw new HttpError(403, "Fehlender Client-Header");
    const origin = req.headers.origin;
    if (origin && origin !== `http://${host}` && origin !== `https://${host}`) throw new HttpError(403, "Fremder Ursprung");
  }
}

function writable() {
  if (READONLY) throw new HttpError(403, "Einstellungen sind schreibgeschützt (readonly)");
}

function printerOr404(id: string) {
  const p = store.printer(id);
  if (!p) throw new HttpError(404, "Drucker nicht gefunden");
  if (!p.host) throw new HttpError(400, "Für diesen Drucker ist keine IP-Adresse eingetragen");
  return p;
}

const ts = () => new Date().toLocaleTimeString("de-DE");

function validate<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e: any) {
    throw new HttpError(400, e.message);
  }
}

async function api(req: IncomingMessage, res: ServerResponse, path: string) {
  const m = req.method || "GET";
  let body: any;
  const seg = path.split("/").filter(Boolean).slice(1); // ohne "api"

  if (m === "GET" && seg[0] === "info") return json(res, 200, info);
  if (m === "GET" && seg[0] === "settings") return json(res, 200, store.get());

  if (seg[0] === "printers" && seg[1] && seg.length === 2) {
    if (m === "PUT") {
      writable();
      body = await readJson(req);
      const p = validate(() => sanitizePrinter(body, seg[1]));
      await store.update((s) => {
        const i = s.printers.findIndex((x) => x.id === p.id);
        if (i >= 0) s.printers[i] = p;
        else s.printers.push(p);
      });
      return json(res, 200, p);
    }
    if (m === "DELETE") {
      writable();
      await store.update((s) => void (s.printers = s.printers.filter((x) => x.id !== seg[1])));
      return json(res, 200, { ok: true });
    }
  }

  if (seg[0] === "printers" && seg[1] && seg[2] === "print" && m === "POST") {
    const p = printerOr404(seg[1]);
    const body = await readBody(req);
    if (!body.length) throw new HttpError(400, "Leerer Auftrag");
    const t0 = Date.now();
    try {
      await sendRaw(p.host, p.port, body);
    } catch (e: any) {
      console.log(`${ts()}  FEHLER  ${p.name} (${p.host}): ${e.message}`);
      throw new HttpError(502, e.message);
    }
    console.log(`${ts()}  Druck   ${p.name} (${p.host}) ${(body.length / 1024).toFixed(1)} kB`);
    return json(res, 200, { ok: true, bytes: body.length, ms: Date.now() - t0 });
  }

  if (seg[0] === "printers" && seg[1] && seg[2] === "status" && m === "GET") {
    const p = printerOr404(seg[1]);
    return json(res, 200, await status(p.host, p.port));
  }

  if (seg[0] === "printers" && seg[1] && seg[2] === "command" && m === "POST") {
    const p = printerOr404(seg[1]);
    const { cmd } = await readJson(req);
    const map: Record<string, string> = { calibrate: "~JC", cancel: "~JA", feed: "^XA^XZ" };
    if (!map[cmd]) throw new HttpError(400, "Unbekannter Befehl");
    await sendRaw(p.host, p.port, Buffer.from(map[cmd] + "\r\n")).catch((e) => {
      throw new HttpError(502, e.message);
    });
    return json(res, 200, { ok: true });
  }

  if (seg[0] === "probe" && m === "POST") {
    writable();
    body = await readJson(req);
    const host = String(body.host || "").trim();
    if (!/^[A-Za-z0-9.\-:\[\]_]+$/.test(host)) throw new HttpError(400, "Ungültige Adresse");
    return json(res, 200, await probe(host, Math.round(Number(body.port) || DEFAULT_PORT)));
  }

  if (seg[0] === "templates" && seg[1] && seg.length === 2) {
    if (m === "PUT") {
      writable();
      body = await readJson(req);
      const t = validate(() => sanitizeTemplate(body, seg[1]));
      await store.update((s) => {
        const i = s.templates.findIndex((x) => x.id === t.id);
        if (i >= 0) s.templates[i] = t;
        else s.templates.push(t);
      });
      return json(res, 200, t);
    }
    if (m === "DELETE") {
      writable();
      await store.update((s) => void (s.templates = s.templates.filter((x) => x.id !== seg[1])));
      return json(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, "Unbekannter API-Pfad");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", "http://x");
  const isApi = url.pathname.startsWith("/api/");
  try {
    guard(req, isApi);
    if (isApi) await api(req, res, url.pathname);
    else if (req.method === "GET" || req.method === "HEAD") await serveStatic(req, res, url.pathname);
    else throw new HttpError(405, "Methode nicht erlaubt");
  } catch (e: any) {
    const code = e instanceof HttpError ? e.code : 500;
    if (code === 500) console.error(e);
    if (!res.headersSent) json(res, code, { error: e.message || "Fehler" });
    else res.end();
  }
});

function openBrowser(url: string) {
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd[0] as string, cmd[1] as string[], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {}
}

const shownHost = HOST === "0.0.0.0" || HOST === "::" ? "localhost" : HOST;
const url = `http://${shownHost}:${PORT}/`;

server.on("error", async (e: any) => {
  if (e.code === "EADDRINUSE") {
    // Läuft schon? Dann einfach den Browser öffnen.
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/info`);
      const j = await r.json();
      if (j?.name === "zplPrinter") {
        console.log(`zplPrinter läuft bereits auf ${url}`);
        if (!args["no-browser"] && !serverMode) openBrowser(url);
        setTimeout(() => process.exit(0), 1500);
        return;
      }
    } catch {}
    console.error(`Port ${PORT} ist bereits belegt. Anderen Port wählen: zplPrinter.exe --port 8911`);
  } else console.error(e);
  setTimeout(() => process.exit(1), 10000);
});

server.listen(PORT, HOST, () => {
  console.log(`
  zplPrinter ${pkg.version}  (${serverMode ? "Server" : "lokal"}${READONLY ? ", schreibgeschützt" : ""})
  Oberfläche:     ${url}
  Einstellungen:  ${store.file}
  ${serverMode ? "" : "Fenster schließen = Programm beenden.\n"}`);
  if (!args["no-browser"] && !serverMode && process.env.ZPL_NO_BROWSER !== "1") openBrowser(url);
});

