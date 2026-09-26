// Liefert die Weboberfläche aus: eingebettet (Exe/Bundle) oder aus dist/web (Entwicklung).
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { assets } from "./assets.gen";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".bcmap": "application/octet-stream",
  ".pfb": "application/octet-stream",
  ".ttf": "font/ttf",
  ".icc": "application/vnd.iccprofile",
  ".woff2": "font/woff2",
};

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

const diskRoot = resolve(process.cwd(), "dist", "web");

export async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  let p = decodeURIComponent(pathname);
  if (p === "/" || !extname(p)) p = "/index.html";
  const type = MIME[extname(p).toLowerCase()] || "application/octet-stream";
  const cache = p === "/index.html" ? "no-cache" : p.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600";

  const embedded = assets[p];
  if (embedded) {
    const gz = Buffer.from(embedded, "base64");
    const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] || ""));
    const headers: Record<string, string> = { "Content-Type": type, "Cache-Control": cache, Vary: "Accept-Encoding", ...SECURITY_HEADERS };
    if (acceptsGzip) {
      res.writeHead(200, { ...headers, "Content-Encoding": "gzip", "Content-Length": String(gz.length) });
      res.end(gz);
    } else {
      const raw = gunzipSync(gz);
      res.writeHead(200, { ...headers, "Content-Length": String(raw.length) });
      res.end(raw);
    }
    return;
  }

  if (Object.keys(assets).length === 0 && existsSync(diskRoot)) {
    const file = normalize(join(diskRoot, p));
    if (file.startsWith(diskRoot) && existsSync(file)) {
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-cache", ...SECURITY_HEADERS });
      res.end(data);
      return;
    }
  }

  if (Object.keys(assets).length === 0 && !existsSync(diskRoot)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Weboberfläche nicht gebaut. Entwicklung: 'npm run dev:web' (Vite, Port 5173) oder 'npm run build'.");
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Nicht gefunden");
}
