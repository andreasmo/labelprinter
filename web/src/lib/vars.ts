// Serienetiketten: Datentabelle, Variablen {{Spalte}} und Tabellen-Import (Excel-Kopie / CSV). DOM-frei.
import type { DataTable } from "../../../shared/types";

export const BUILTINS: { name: string; label: string }[] = [
  { name: "_nr", label: "laufende Nummer" },
  { name: "_datum", label: "heutiges Datum" },
  { name: "_zeit", label: "Uhrzeit" },
];

const VAR_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;

export function hasVars(s: string) {
  VAR_RE.lastIndex = 0;
  return VAR_RE.test(s);
}

export function usedVars(s: string): string[] {
  return [...s.matchAll(VAR_RE)].map((m) => m[1]);
}

export type Vars = Record<string, string>;

/** Ersetzt {{name}}; Groß-/Kleinschreibung egal. Unbekannte Variablen werden leer und gemeldet. */
export function applyVars(s: string, vars: Vars): { text: string; missing: string[] } {
  const lower: Record<string, string> = {};
  for (const k in vars) lower[k.toLowerCase()] = vars[k];
  const missing: string[] = [];
  const text = s.replace(VAR_RE, (_, name: string) => {
    if (name in vars) return vars[name];
    const v = lower[name.toLowerCase()];
    if (v !== undefined) return v;
    missing.push(name);
    return "";
  });
  return { text, missing };
}

export function builtinVars(index: number, now = new Date()): Vars {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    _nr: String(index + 1),
    _datum: `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`,
    _zeit: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

export function rowVars(t: DataTable, index: number, now = new Date()): Vars {
  const v = builtinVars(index, now);
  const row = t.rows[index] ?? [];
  t.columns.forEach((c, i) => {
    if (c.trim()) v[c.trim()] = row[i] ?? "";
  });
  return v;
}

/** Trennzeichen erraten: Tab (Excel), sonst ; oder , – je nachdem was in der ersten Zeile häufiger ist. */
export function detectDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  if (first.includes("\t")) return "\t";
  const semi = (first.match(/;/g) || []).length;
  const comma = (first.match(/,/g) || []).length;
  if (semi === 0 && comma === 0) return "\t";
  return semi >= comma ? ";" : ",";
}

/** CSV/TSV mit Anführungszeichen (auch Zeilenumbrüche in Zellen, wie Excel sie kopiert). */
export function parseDelimited(text: string, delim = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Leere Schlusszeilen entfernen
  while (rows.length && rows[rows.length - 1].every((x) => x === "")) rows.pop();
  return rows;
}

export function emptyTable(): DataTable {
  return { columns: [], rows: [] };
}

export function normalize(t: DataTable): DataTable {
  const n = Math.max(t.columns.length, ...t.rows.map((r) => r.length), 0);
  const columns = Array.from({ length: n }, (_, i) => t.columns[i] ?? `Spalte${i + 1}`);
  return { columns, rows: t.rows.map((r) => Array.from({ length: n }, (_, i) => r[i] ?? "")) };
}

/** Importiert Text als neue Tabelle (erste Zeile = Spaltennamen). */
export function tableFromText(text: string, header = true): DataTable {
  const rows = parseDelimited(text);
  if (!rows.length) return emptyTable();
  if (!header) return normalize({ columns: [], rows });
  const used = new Set<string>();
  const columns = rows[0].map((c, i) => {
    let name = c.trim().replace(/[{}]/g, "") || `Spalte${i + 1}`;
    let k = 2;
    while (used.has(name.toLowerCase())) name = `${c.trim() || "Spalte"}_${k++}`;
    used.add(name.toLowerCase());
    return name;
  });
  return normalize({ columns, rows: rows.slice(1) });
}

/** Fügt eingefügten Block ab Zelle (row, col) ein und vergrößert die Tabelle bei Bedarf. */
export function pasteBlock(t: DataTable, text: string, row: number, col: number): DataTable {
  const block = parseDelimited(text, text.includes("\t") ? "\t" : detectDelimiter(text));
  const rows = t.rows.map((r) => [...r]);
  const columns = [...t.columns];
  block.forEach((br, i) => {
    const ri = row + i;
    while (rows.length <= ri) rows.push([]);
    br.forEach((v, j) => {
      const ci = col + j;
      while (columns.length <= ci) columns.push(`Spalte${columns.length + 1}`);
      rows[ri][ci] = v;
    });
  });
  return normalize({ columns, rows });
}

export function toCsv(t: DataTable): string {
  const esc = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [t.columns, ...t.rows].map((r) => r.map(esc).join(";")).join("\r\n");
}

/** Anzahl Etiketten pro Zeile aus einer Spalte (leer/ungültig → 1, 0 → überspringen). */
export function qtyOf(t: DataTable, index: number, qtyColumn: string | null | undefined, fallback: number): number {
  if (!qtyColumn) return fallback;
  const ci = t.columns.indexOf(qtyColumn);
  if (ci < 0) return fallback;
  const raw = (t.rows[index]?.[ci] ?? "").trim().replace(",", ".");
  if (raw === "") return 1;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 9999) : 1;
}
