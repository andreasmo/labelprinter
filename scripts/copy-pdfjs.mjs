// Kopiert pdf.js-Zusatzdaten (Schriften, CMaps, WASM-Decoder) in web/public/pdfjs, damit alles offline läuft.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
const src = "node_modules/pdfjs-dist";
const dst = "web/public/pdfjs";
mkdirSync(dst, { recursive: true });
for (const d of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  if (existsSync(join(src, d))) cpSync(join(src, d), join(dst, d), { recursive: true });
}
console.log("pdf.js-Daten kopiert →", dst);
