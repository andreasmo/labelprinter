// Bettet dist/web gzip-komprimiert in server/assets.gen.ts ein (für Single-Exe und Node-Bundle).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { gzipSync } from "node:zlib";

const root = "dist/web";
const out = "server/assets.gen.ts";
const stub = process.argv.includes("--stub");
const entries = {};
let raw = 0, packed = 0;
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else {
      if (/LICENSE|\.map$|quickjs|nowasm_fallback/.test(f)) continue;
      const data = readFileSync(p);
      const gz = gzipSync(data, { level: 9 });
      raw += data.length;
      packed += gz.length;
      entries["/" + relative(root, p).split(sep).join("/")] = gz.toString("base64");
    }
  }
}
if (!stub && existsSync(root)) walk(root);
if (stub && existsSync(out)) process.exit(0);
writeFileSync(out, `// Automatisch erzeugt von scripts/embed-assets.mjs – nicht bearbeiten.\nexport const assets: Record<string, string> = ${JSON.stringify(entries)};\n`);
console.log(`${Object.keys(entries).length} Dateien eingebettet: ${(raw / 1e6).toFixed(1)} MB → ${(packed / 1e6).toFixed(1)} MB (gzip)`);
