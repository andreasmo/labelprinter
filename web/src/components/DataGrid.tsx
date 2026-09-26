import { useRef } from "preact/hooks";
import type { DataTable } from "../../../shared/types";
import { emptyTable, normalize, pasteBlock, tableFromText, toCsv } from "../lib/vars";
import { download, Icon, toast } from "./ui";

const MAX_VISIBLE = 500;

export function DataGrid(props: {
  table: DataTable;
  onChange: (t: DataTable) => void;
  selected: boolean[];
  onSelected: (s: boolean[]) => void;
  previewRow: number;
  onPreviewRow: (i: number) => void;
  qtyColumn: string | null;
  onQtyColumn: (c: string | null) => void;
}) {
  const t = props.table;
  const fileInput = useRef<HTMLInputElement>(null);
  const sel = t.rows.map((_, i) => props.selected[i] ?? true);
  const nSel = sel.filter(Boolean).length;

  const setCell = (r: number, c: number, v: string) => props.onChange({ ...t, rows: t.rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  const setCol = (c: number, v: string) => {
    const old = t.columns[c];
    props.onChange({ ...t, columns: t.columns.map((x, j) => (j === c ? v.replace(/[{}]/g, "") : x)) });
    if (props.qtyColumn === old) props.onQtyColumn(v);
  };
  const addRow = () => {
    props.onChange(normalize({ ...t, rows: [...t.rows, t.columns.map(() => "")] }));
    props.onSelected([...sel, true]);
  };
  const addCol = () => {
    let n = t.columns.length + 1;
    while (t.columns.includes(`Spalte${n}`)) n++;
    props.onChange(normalize({ columns: [...t.columns, `Spalte${n}`], rows: t.rows.length ? t.rows : [[]] }));
  };
  const delRow = (r: number) => {
    props.onChange({ ...t, rows: t.rows.filter((_, i) => i !== r) });
    props.onSelected(sel.filter((_, i) => i !== r));
    if (props.previewRow >= t.rows.length - 1) props.onPreviewRow(Math.max(0, t.rows.length - 2));
  };
  const delCol = (c: number) => {
    if (props.qtyColumn === t.columns[c]) props.onQtyColumn(null);
    props.onChange({ columns: t.columns.filter((_, j) => j !== c), rows: t.rows.map((r) => r.filter((_, j) => j !== c)) });
  };
  const replaceAll = (nt: DataTable) => {
    props.onChange(nt);
    props.onSelected(nt.rows.map(() => true));
    props.onPreviewRow(0);
    if (props.qtyColumn && !nt.columns.includes(props.qtyColumn)) props.onQtyColumn(null);
    const guess = nt.columns.find((c) => /^(anzahl|menge ?etiketten|stück|stk|qty|copies|kopien)$/i.test(c.trim()));
    if (guess && !props.qtyColumn) props.onQtyColumn(guess);
    toast(`${nt.rows.length} Zeilen, ${nt.columns.length} Spalten übernommen`, "ok");
  };

  const onPaste = (r: number, c: number) => (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!/[\t\n]/.test(text.replace(/\r?\n$/, ""))) return; // einzelner Wert → normales Einfügen
    e.preventDefault();
    if (r < 0 || t.columns.length === 0) {
      // In Kopfzeile oder leere Tabelle: erste Zeile = Spaltennamen
      replaceAll(tableFromText(text, true));
      return;
    }
    const nt = pasteBlock(t, text.replace(/\r?\n$/, ""), r, c);
    props.onChange(nt);
    props.onSelected(nt.rows.map((_, i) => sel[i] ?? true));
  };

  async function fromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return toast("Zwischenablage ist leer", "err");
      replaceAll(tableFromText(text, true));
    } catch {
      toast("Kein Zugriff auf die Zwischenablage – bitte mit Strg+V in die Kopfzeile einfügen", "err");
    }
  }

  const visible = t.rows.slice(0, MAX_VISIBLE);

  return (
    <div class="card data-card">
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".csv,.tsv,.txt"
        onChange={async (e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          (e.target as HTMLInputElement).value = "";
          if (!f) return;
          let text = await f.text();
          if (text.includes("�")) text = new TextDecoder("windows-1252").decode(await f.arrayBuffer()); // Excel-CSV (ANSI)
          replaceAll(tableFromText(text, true));
        }}
      />
      <div class="data-head">
        <h3>Seriendaten</h3>
        <span class="muted small">
          {t.columns.length ? `${t.columns.length} Spalten · ${t.rows.length} Zeilen · ${nSel} ausgewählt` : "Tabelle aus Excel einfügen oder Spalten anlegen"}
        </span>
        <span class="spacer" />
        <button class="btn ghost small" onClick={fromClipboard} title="Tabelle aus Excel/Calc kopieren (inkl. Kopfzeile) und hier einfügen">
          Aus Zwischenablage
        </button>
        <button class="btn ghost small" onClick={() => fileInput.current?.click()}>
          <Icon name="upload" size={14} /> CSV
        </button>
        <button class="btn ghost small" disabled={!t.columns.length} onClick={() => download("seriendaten.csv", "﻿" + toCsv(t))} title="Als CSV speichern">
          <Icon name="download" size={14} />
        </button>
        <button class="btn ghost small" onClick={addCol}>
          <Icon name="plus" size={14} /> Spalte
        </button>
        <button class="btn ghost small" disabled={!t.columns.length} onClick={addRow}>
          <Icon name="plus" size={14} /> Zeile
        </button>
        <button
          class="btn ghost small icon"
          disabled={!t.columns.length}
          title="Tabelle leeren"
          onClick={() => {
            props.onChange(emptyTable());
            props.onSelected([]);
            props.onQtyColumn(null);
          }}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>

      {t.columns.length === 0 ? (
        <div class="data-empty">
          <p>
            In Excel Bereich <strong>mit Kopfzeile</strong> kopieren und hier mit <kbd>Strg</kbd>+<kbd>V</kbd> einfügen – die Spaltennamen werden zu Variablen, z. B.{" "}
            <code>{"{{Charge}}"}</code>.
          </p>
          <textarea
            class="paste-target"
            rows={2}
            placeholder="Hier einfügen (Strg+V) …"
            onPaste={(e) => {
              e.preventDefault();
              const text = e.clipboardData?.getData("text/plain") ?? "";
              if (text.trim()) replaceAll(tableFromText(text, true));
            }}
          />
        </div>
      ) : (
        <>
          <div class="data-opts">
            <label class="check">
              <input
                type="checkbox"
                checked={nSel === t.rows.length && t.rows.length > 0}
                ref={(el) => {
                  if (el) el.indeterminate = nSel > 0 && nSel < t.rows.length;
                }}
                onChange={(e) => props.onSelected(t.rows.map(() => (e.target as HTMLInputElement).checked))}
              />
              Alle Zeilen drucken
            </label>
            <label class="inline-field">
              Anzahl pro Zeile aus Spalte
              <select value={props.qtyColumn ?? ""} onChange={(e) => props.onQtyColumn((e.target as HTMLSelectElement).value || null)}>
                <option value="">– (Kopien-Feld)</option>
                {t.columns.map((c) => (
                  <option value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <div class="grid-scroll">
            <table class="grid">
              <thead>
                <tr>
                  <th class="rh">#</th>
                  {t.columns.map((c, j) => (
                    <th>
                      <div class="col-head">
                        <input value={c} onInput={(e) => setCol(j, (e.target as HTMLInputElement).value)} onPaste={onPaste(-1, j)} title={`Variable: {{${c}}}`} />
                        <button class="btn ghost icon tiny" onClick={() => delCol(j)} title="Spalte löschen">
                          <Icon name="x" size={12} />
                        </button>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((row, i) => (
                  <tr class={`${i === props.previewRow ? "preview" : ""}${sel[i] ? "" : " off"}`}>
                    <td class="rh">
                      <div class="row-head">
                        <input type="checkbox" checked={sel[i]} onChange={() => props.onSelected(sel.map((v, k) => (k === i ? !v : v)))} title="Zeile drucken" />
                        <button class="row-nr" onClick={() => props.onPreviewRow(i)} title="In der Vorschau anzeigen">
                          {i + 1}
                        </button>
                        <button class="btn ghost icon tiny del" onClick={() => delRow(i)} title="Zeile löschen">
                          <Icon name="x" size={12} />
                        </button>
                      </div>
                    </td>
                    {row.map((v, j) => (
                      <td>
                        <input value={v} onFocus={() => props.onPreviewRow(i)} onInput={(e) => setCell(i, j, (e.target as HTMLInputElement).value)} onPaste={onPaste(i, j)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {t.rows.length > MAX_VISIBLE && <p class="muted small pad-s">… {t.rows.length - MAX_VISIBLE} weitere Zeilen (werden gedruckt, hier nicht angezeigt)</p>}
          </div>
        </>
      )}
    </div>
  );
}
