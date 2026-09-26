import { useEffect, useRef, useState } from "preact/hooks";
import type { BarcodeElement, BoxElement, DataTable, DesignElement, ImageElement, PrinterConfig, Template, TextElement } from "../../../shared/types";
import { labelDots } from "../../../shared/types";
import { api, pref, setPref } from "../api";
import { DataGrid } from "../components/DataGrid";
import { Field, Icon, MonoCanvas, Num, Segmented, toast } from "../components/ui";
import { FONTS, newElement, renderDesign, SYMBOLOGIES, type DesignRender } from "../lib/designer";
import { BUILTINS, emptyTable, qtyOf, rowVars } from "../lib/vars";
import { buildJob } from "../lib/zpl";

/** Klickbare Variablen zum Einfügen in Text/Barcode */
function VarChips(props: { columns: string[]; onPick: (v: string) => void }) {
  const cols = props.columns.filter((c) => c.trim());
  return (
    <div class="var-chips">
      <span class="muted small">Variable einfügen:</span>
      {cols.map((c) => (
        <button class="chip var" onClick={() => props.onPick(`{{${c}}}`)} title={`{{${c}}}`}>
          {c}
        </button>
      ))}
      {BUILTINS.map((b) => (
        <button class="chip var builtin" onClick={() => props.onPick(`{{${b.name}}}`)} title={b.label}>
          {b.name}
        </button>
      ))}
    </div>
  );
}

const TYPE_LABEL: Record<DesignElement["type"], string> = { text: "Text", barcode: "Barcode", box: "Rahmen / Linie", image: "Bild" };

function describe(e: DesignElement) {
  switch (e.type) {
    case "text":
      return e.text.split("\n")[0] || "(leer)";
    case "barcode":
      return `${SYMBOLOGIES.find((s) => s.id === e.symbology)?.label}: ${e.data}`;
    case "box":
      return `${e.width} × ${e.height} mm`;
    case "image":
      return `${e.width} mm breit`;
  }
}

async function fileToDataUrl(f: File, maxPx = 1600): Promise<string> {
  const url = URL.createObjectURL(f);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, maxPx / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round((img.naturalWidth || 400) * k));
    c.height = Math.max(1, Math.round((img.naturalHeight || 400) * k));
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

const starter = (): DesignElement[] => [
  newElement("text", { x: 4, y: 4, text: "Material 4711", size: 6, bold: true } as Partial<TextElement>),
  newElement("text", { x: 4, y: 13, text: "Charge: 2026-09-23-01\nMenge: 25,0 kg", size: 3.5 } as Partial<TextElement>),
  newElement("barcode", { x: 4, y: 26, data: "4711-20260923-01", height: 12, module: 2 } as Partial<BarcodeElement>),
];

export function DesignerTab(props: { printer: PrinterConfig | null; templates: Template[]; readonly: boolean; onTemplatesChanged: () => void }) {
  const p = props.printer;
  const [elements, setElementsRaw] = useState<DesignElement[]>(() => pref("design", starter()));
  const [selId, setSelId] = useState<string | null>(null);
  const [tplId, setTplId] = useState<string | null>(() => pref("designTpl", null));
  const [tplName, setTplName] = useState<string>(() => pref("designTplName", ""));
  const [copies, setCopies] = useState(1);
  const [result, setResult] = useState<DesignRender | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [table, setTableRaw] = useState<DataTable>(() => pref("designData", emptyTable()));
  const [selRows, setSelRows] = useState<boolean[]>([]);
  const [previewRow, setPreviewRow] = useState(0);
  const [qtyColumn, setQtyColumnRaw] = useState<string | null>(() => pref("designQty", null));
  const [showData, setShowDataRaw] = useState<boolean>(() => pref("designShowData", false));
  const setTable = (t: DataTable) => {
    setTableRaw(t);
    setPref("designData", t);
  };
  const setQtyColumn = (c: string | null) => {
    setQtyColumnRaw(c);
    setPref("designQty", c);
  };
  const setShowData = (v: boolean) => {
    setShowDataRaw(v);
    setPref("designShowData", v);
  };
  const serial = table.columns.length > 0 && table.rows.length > 0;
  const rowSelected = (i: number) => selRows[i] ?? true;
  const serialRows = serial ? table.rows.map((_, i) => i).filter(rowSelected) : [];
  const serialCount = serialRows.reduce((n, i) => n + qtyOf(table, i, qtyColumn, copies), 0);
  const previewVars = serial ? rowVars(table, Math.min(previewRow, table.rows.length - 1)) : undefined;
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const replaceImage = useRef(false);

  const setElements = (fn: (els: DesignElement[]) => DesignElement[]) =>
    setElementsRaw((els) => {
      const n = fn(els);
      setPref("design", n);
      return n;
    });
  const update = (id: string, patch: Partial<DesignElement>) => setElements((els) => els.map((e) => (e.id === id ? ({ ...e, ...patch } as DesignElement) : e)));
  const sel = elements.find((e) => e.id === selId) ?? null;

  useEffect(() => {
    setPref("designTpl", tplId);
    setPref("designTplName", tplName);
  }, [tplId, tplName]);

  const fmtKey = p ? `${p.widthMm}x${p.heightMm}@${p.dpi}` : "";
  useEffect(() => {
    if (!p) return;
    let alive = true;
    const t = setTimeout(() => {
      renderDesign(elements, p, previewVars).then((r) => alive && setResult(r));
    }, 40);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [elements, fmtKey, table, previewRow]);

  // Tastatur: Entf löscht, Pfeile verschieben
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel) return;
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      const step = e.shiftKey ? 5 : 0.5;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) {
        e.preventDefault();
        update(sel.id, { x: +(sel.x + moves[e.key][0]).toFixed(2), y: +(sel.y + moves[e.key][1]).toFixed(2) });
      } else if (e.key === "Delete") {
        setElements((els) => els.filter((x) => x.id !== sel.id));
        setSelId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel]);

  const onPointer = (e: PointerEvent, x: number, y: number, kind: "down" | "move" | "up") => {
    if (!p || !result) return;
    const k = 25.4 / p.dpi;
    if (kind === "down") {
      const hit = [...result.boxes].reverse().find((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
      setSelId(hit?.id ?? null);
      if (hit) drag.current = { id: hit.id, dx: x - hit.x, dy: y - hit.y, moved: false };
    } else if (kind === "move" && drag.current) {
      const snap = e.altKey ? 0.1 : 0.5;
      const nx = Math.round(((x - drag.current.dx) * k) / snap) * snap;
      const ny = Math.round(((y - drag.current.dy) * k) / snap) * snap;
      const el = elements.find((q) => q.id === drag.current!.id);
      if (el && (el.x !== nx || el.y !== ny)) {
        drag.current.moved = true;
        update(el.id, { x: +nx.toFixed(2), y: +ny.toFixed(2) });
      }
    } else if (kind === "up") drag.current = null;
  };

  function add(type: DesignElement["type"]) {
    if (type === "image") {
      replaceImage.current = false;
      return imgInput.current?.click();
    }
    const off = 3 + (elements.length % 6) * 4;
    const e = newElement(type, { x: off, y: off } as Partial<DesignElement>);
    if (e.type === "barcode" && p) e.module = Math.max(1, Math.round(p.dpi / 100)); // ~0,25–0,33 mm
    setElements((els) => [...els, e]);
    setSelId(e.id);
  }

  async function onImage(f: File) {
    try {
      const src = await fileToDataUrl(f);
      if (sel?.type === "image" && replaceImage.current) {
        update(sel.id, { src });
        return;
      }
      const w = p ? Math.min(30, p.widthMm - 6) : 30;
      const e = newElement("image", { src, width: w } as Partial<ImageElement>);
      setElements((els) => [...els, e]);
      setSelId(e.id);
    } catch {
      toast("Bild konnte nicht geladen werden", "err");
    }
  }

  function moveLayer(id: string, dir: -1 | 1) {
    setElements((els) => {
      const i = els.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= els.length) return els;
      const n = [...els];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  }

  function duplicate(id: string) {
    const e = elements.find((x) => x.id === id);
    if (!e) return;
    const c = { ...structuredClone(e), id: newElement(e.type).id, x: e.x + 2, y: e.y + 2 } as DesignElement;
    setElements((els) => [...els, c]);
    setSelId(c.id);
  }

  async function print() {
    if (!p || !result) return;
    try {
      // Erst alles rendern und prüfen, dann senden – fehlerhafte Etiketten (z. B. ungültiger Barcode) werden nicht gedruckt.
      const jobs: { zpl: string; qty: number }[] = [];
      const problems: string[] = [];
      if (!serial) {
        setBusy("Rastere …");
        const r = await renderDesign(elements, p);
        Object.values(r.errors).forEach((e) => problems.push(e));
        jobs.push({ zpl: await buildJob(p, [r.mono], copies), qty: copies });
      } else {
        const now = new Date();
        for (let k = 0; k < serialRows.length; k++) {
          const i = serialRows[k];
          const qty = qtyOf(table, i, qtyColumn, copies);
          if (qty <= 0) continue;
          setBusy(`Rastere Zeile ${k + 1} / ${serialRows.length} …`);
          const r = await renderDesign(elements, p, rowVars(table, i, now));
          Object.values(r.errors).forEach((e) => problems.push(`Zeile ${i + 1}: ${e}`));
          jobs.push({ zpl: await buildJob(p, [r.mono], qty), qty });
        }
      }
      if (problems.length) {
        toast(`Nicht gedruckt – bitte korrigieren: ${problems.slice(0, 3).join(" · ")}${problems.length > 3 ? ` (+${problems.length - 3})` : ""}`, "err");
        return;
      }
      // In Paketen von max. ~4 MB senden
      let sent = 0;
      for (let k = 0; k < jobs.length; ) {
        let chunk = "";
        let n = 0;
        while (k < jobs.length && (chunk === "" || chunk.length + jobs[k].zpl.length < 4_000_000)) {
          chunk += jobs[k].zpl;
          n += jobs[k].qty;
          k++;
        }
        setBusy(`Sende … ${sent + n} Etiketten`);
        await api.print(p.id, chunk);
        sent += n;
      }
      toast(`${sent} ${serial ? "Serienetikett" : "Etikett"}${sent === 1 ? "" : "en"} an „${p.name}“ gesendet`, "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  }

  async function saveTemplate(asNew: boolean) {
    const name = tplName.trim() || "Vorlage";
    const id = !asNew && tplId ? tplId : crypto.randomUUID();
    try {
      await api.saveTemplate({ id, name, elements, ...(table.columns.length ? { data: table, qtyColumn } : {}) });
      setTplId(id);
      setTplName(name);
      props.onTemplatesChanged();
      toast(`Vorlage „${name}“ gespeichert`, "ok");
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  function loadTemplate(id: string) {
    if (id === "") {
      setTplId(null);
      setTplName("");
      return;
    }
    const t = props.templates.find((x) => x.id === id);
    if (!t) return;
    setElements(() => structuredClone(t.elements));
    setTable(t.data ? structuredClone(t.data) : emptyTable());
    setQtyColumn(t.qtyColumn ?? null);
    setSelRows([]);
    setPreviewRow(0);
    if (t.data?.columns.length) setShowData(true);
    setTplId(t.id);
    setTplName(t.name);
    setSelId(null);
  }

  async function deleteTemplate() {
    if (!tplId) return;
    try {
      await api.deleteTemplate(tplId);
      setTplId(null);
      props.onTemplatesChanged();
      toast("Vorlage gelöscht", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  const L = p ? labelDots(p) : { w: 1, h: 1 };
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div class="designer-tab">
      <input
        ref={imgInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) onImage(f);
          (e.target as HTMLInputElement).value = "";
        }}
      />
      <section class="pane design-pane">
        <div class="toolbar">
          <div class="tool-group">
            <button class="btn ghost" onClick={() => add("text")}>
              <Icon name="text" /> Text
            </button>
            <button class="btn ghost" onClick={() => add("barcode")}>
              <Icon name="barcode" /> Barcode
            </button>
            <button class="btn ghost" onClick={() => add("box")}>
              <Icon name="square" /> Rahmen
            </button>
            <button class="btn ghost" onClick={() => add("image")}>
              <Icon name="image" /> Bild
            </button>
          </div>
          <div class="tool-group tpl">
            <select value={tplId ?? ""} onChange={(e) => loadTemplate((e.target as HTMLSelectElement).value)} title="Gespeicherte Vorlage laden">
              <option value="">– Vorlage laden –</option>
              {props.templates.map((t) => (
                <option value={t.id}>{t.name}</option>
              ))}
            </select>
            <input class="tpl-name" placeholder="Vorlagenname" value={tplName} onInput={(e) => setTplName((e.target as HTMLInputElement).value)} />
            <button class="btn ghost" disabled={props.readonly} onClick={() => saveTemplate(false)} title={tplId ? "Vorlage überschreiben" : "Als neue Vorlage speichern"}>
              <Icon name="save" /> Speichern
            </button>
            {tplId && (
              <>
                <button class="btn ghost" disabled={props.readonly} onClick={() => saveTemplate(true)} title="Als neue Vorlage speichern">
                  Kopie
                </button>
                <button class="btn ghost icon" disabled={props.readonly} onClick={deleteTemplate} title="Vorlage löschen">
                  <Icon name="trash" />
                </button>
              </>
            )}
            <button
              class="btn ghost"
              onClick={() => {
                setElements(() => []);
                setTplId(null);
                setTplName("");
                setSelId(null);
              }}
              title="Leeres Etikett"
            >
              Leeren
            </button>
            <button class={`btn ${showData ? "primary" : "ghost"}`} onClick={() => setShowData(!showData)} title="Tabelle für Serienetiketten ein-/ausblenden">
              <Icon name="table" /> Serie{serial ? ` (${table.rows.length})` : ""}
            </button>
          </div>
        </div>
        {!p ? (
          <p class="muted pad">Bitte zuerst einen Drucker wählen – das Etikettenformat kommt vom Drucker.</p>
        ) : (
          <MonoCanvas
            mono={result?.mono ?? null}
            class="design-canvas"
            maxScale={8}
            onPointer={onPointer}
            overlay={result?.boxes.map((b) => (
              <div
                class={`el-box${b.id === selId ? " sel" : ""}${result.errors[b.id] ? " err" : ""}`}
                style={{ left: pct(b.x, L.w), top: pct(b.y, L.h), width: pct(b.w, L.w), height: pct(b.h, L.h) }}
              />
            ))}
          />
        )}
        {serial && p && (
          <div class="serial-nav">
            <button class="btn ghost small icon" disabled={previewRow <= 0} onClick={() => setPreviewRow(previewRow - 1)} title="Vorherige Zeile">
              <Icon name="up" size={14} />
            </button>
            <span>
              Vorschau Zeile <strong>{Math.min(previewRow, table.rows.length - 1) + 1}</strong> / {table.rows.length}
              {!rowSelected(previewRow) && <span class="muted"> (wird nicht gedruckt)</span>}
            </span>
            <button class="btn ghost small icon" disabled={previewRow >= table.rows.length - 1} onClick={() => setPreviewRow(previewRow + 1)} title="Nächste Zeile">
              <Icon name="down" size={14} />
            </button>
          </div>
        )}
        {showData && (
          <DataGrid
            table={table}
            onChange={setTable}
            selected={selRows}
            onSelected={setSelRows}
            previewRow={previewRow}
            onPreviewRow={setPreviewRow}
            qtyColumn={qtyColumn}
            onQtyColumn={setQtyColumn}
          />
        )}
        <p class="hint">
          Elemente anklicken und ziehen (Raster 0,5 mm, mit Alt 0,1 mm) · Pfeiltasten verschieben · Entf löscht. Barcodes werden mit ganzzahliger Modulbreite pixelgenau
          gerastert. Serienetiketten: Spaltennamen als <code>{"{{Spalte}}"}</code> in Text oder Barcode verwenden.
        </p>
      </section>

      <aside class="pane side-pane">
        <div class="card layers">
          <h3>Elemente</h3>
          {elements.length === 0 && <p class="muted small">Noch leer – oben Text, Barcode, Rahmen oder Bild hinzufügen.</p>}
          <ul>
            {elements.map((e, i) => (
              <li class={e.id === selId ? "sel" : ""} onClick={() => setSelId(e.id)}>
                <span class="layer-type">{TYPE_LABEL[e.type]}</span>
                <span class="layer-desc">{describe(e)}</span>
                {result?.errors[e.id] && <span class="badge err">!</span>}
                <span class="layer-actions" onClick={(ev) => ev.stopPropagation()}>
                  <button class="btn ghost icon tiny" disabled={i === 0} onClick={() => moveLayer(e.id, -1)} title="Nach hinten">
                    <Icon name="up" size={14} />
                  </button>
                  <button class="btn ghost icon tiny" disabled={i === elements.length - 1} onClick={() => moveLayer(e.id, 1)} title="Nach vorne">
                    <Icon name="down" size={14} />
                  </button>
                  <button class="btn ghost icon tiny" onClick={() => duplicate(e.id)} title="Duplizieren">
                    <Icon name="copy" size={14} />
                  </button>
                  <button
                    class="btn ghost icon tiny"
                    onClick={() => {
                      setElements((els) => els.filter((x) => x.id !== e.id));
                      if (selId === e.id) setSelId(null);
                    }}
                    title="Löschen"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {sel && (
          <div class="card props">
            <h3>{TYPE_LABEL[sel.type]}</h3>
            {result?.errors[sel.id] && <p class="warn">{result.errors[sel.id]}</p>}
            <div class="row">
              <Field label="X">
                <Num value={sel.x} onChange={(v) => update(sel.id, { x: v ?? 0 })} step={0.5} unit="mm" />
              </Field>
              <Field label="Y">
                <Num value={sel.y} onChange={(v) => update(sel.id, { y: v ?? 0 })} step={0.5} unit="mm" />
              </Field>
              <Field label="Drehung">
                <select value={sel.rotation} onChange={(e) => update(sel.id, { rotation: Number((e.target as HTMLSelectElement).value) as 0 })}>
                  <option value="0">0°</option>
                  <option value="90">90°</option>
                  <option value="180">180°</option>
                  <option value="270">270°</option>
                </select>
              </Field>
            </div>
            {sel.type === "text" && <TextProps e={sel} set={(patch) => update(sel.id, patch)} />}
            {sel.type === "barcode" && <BarcodeProps e={sel} dpi={p?.dpi ?? 203} set={(patch) => update(sel.id, patch)} />}
            {sel.type === "text" && <VarChips columns={table.columns} onPick={(v) => update(sel.id, { text: sel.text + v })} />}
            {sel.type === "barcode" && <VarChips columns={table.columns} onPick={(v) => update(sel.id, { data: sel.data + v })} />}
            {sel.type === "box" && <BoxProps e={sel} set={(patch) => update(sel.id, patch)} />}
            {sel.type === "image" && <ImageProps e={sel} set={(patch) => update(sel.id, patch)} onPick={() => {
                  replaceImage.current = true;
                  imgInput.current?.click();
                }} />}
          </div>
        )}

        {serial && (
          <p class="muted small serial-sum">
            Serie: {serialRows.length} von {table.rows.length} Zeilen{qtyColumn ? `, Anzahl aus „${qtyColumn}“` : copies > 1 ? `, je ${copies}×` : ""}
          </p>
        )}
        <div class="print-bar">
          <Field label={serial && qtyColumn ? "Kopien" : serial ? "je Zeile" : "Kopien"}>
            <Num value={copies} disabled={serial && !!qtyColumn} onChange={(v) => setCopies(Math.max(1, Math.round(v ?? 1)))} min={1} max={9999} />
          </Field>
          <button class="btn primary big" disabled={!p || !!busy || !elements.length || (serial && serialCount === 0)} onClick={print}>
            <Icon name="printer" />
            {busy ?? (serial ? `${serialCount} Etikett${serialCount === 1 ? "" : "en"} drucken` : "Drucken")}
          </button>
        </div>
      </aside>
    </div>
  );
}

function TextProps(props: { e: TextElement; set: (p: Partial<TextElement>) => void }) {
  const { e, set } = props;
  return (
    <>
      <Field label="Text">
        <textarea rows={3} value={e.text} onInput={(ev) => set({ text: (ev.target as HTMLTextAreaElement).value })} />
      </Field>
      <div class="row">
        <Field label="Schriftgröße">
          <Num value={e.size} onChange={(v) => set({ size: v ?? 3 })} min={0.5} max={200} step={0.5} unit="mm" />
        </Field>
        <Field label="Schrift">
          <select value={e.font} onChange={(ev) => set({ font: (ev.target as HTMLSelectElement).value })}>
            {FONTS.map((f) => (
              <option value={f}>{f}</option>
            ))}
          </select>
        </Field>
      </div>
      <div class="row">
        <Field label="Umbruchbreite" hint="0 = kein Umbruch">
          <Num value={e.maxWidth} onChange={(v) => set({ maxWidth: v ?? 0 })} min={0} step={1} unit="mm" />
        </Field>
        <Field label="Ausrichtung">
          <Segmented
            small
            value={e.align}
            onChange={(v) => set({ align: v })}
            options={[
              { value: "left", label: "Links" },
              { value: "center", label: "Mitte" },
              { value: "right", label: "Rechts" },
            ]}
          />
        </Field>
      </div>
      <div class="checks">
        <label class="check">
          <input type="checkbox" checked={e.bold} onChange={(ev) => set({ bold: (ev.target as HTMLInputElement).checked })} /> Fett
        </label>
        <label class="check">
          <input type="checkbox" checked={e.italic} onChange={(ev) => set({ italic: (ev.target as HTMLInputElement).checked })} /> Kursiv
        </label>
        <label class="check">
          <input type="checkbox" checked={e.inverse} onChange={(ev) => set({ inverse: (ev.target as HTMLInputElement).checked })} /> Weiß auf Schwarz
        </label>
      </div>
    </>
  );
}

function BarcodeProps(props: { e: BarcodeElement; dpi: number; set: (p: Partial<BarcodeElement>) => void }) {
  const { e, set } = props;
  const twoD = SYMBOLOGIES.find((s) => s.id === e.symbology)?.twoD;
  return (
    <>
      <Field label="Typ">
        <select
          value={e.symbology}
          onChange={(ev) => {
            const symbology = (ev.target as HTMLSelectElement).value as BarcodeElement["symbology"];
            const to2D = SYMBOLOGIES.find((s) => s.id === symbology)?.twoD;
            // Sinnvolle Modulgröße vorschlagen: 1D ≈ 0,25–0,33 mm, 2D ≈ 0,5 mm
            const module = Math.max(1, Math.round(props.dpi / (to2D ? 50 : 100)));
            set({ symbology, ...(to2D !== twoD ? { module } : {}) });
          }}
        >
          {SYMBOLOGIES.map((s) => (
            <option value={s.id}>{s.label}</option>
          ))}
        </select>
      </Field>
      <Field label="Inhalt" hint={e.symbology === "gs1-128" ? "Format: (01)04012345678901(10)CHARGE" : undefined}>
        <input value={e.data} onInput={(ev) => set({ data: (ev.target as HTMLInputElement).value })} />
      </Field>
      <div class="row">
        <Field label="Modulbreite" hint="Druckpunkte pro Modul">
          <Num value={e.module} onChange={(v) => set({ module: Math.max(1, Math.round(v ?? 2)) })} min={1} max={20} unit="Dots" />
        </Field>
        {!twoD && (
          <Field label="Höhe">
            <Num value={e.height} onChange={(v) => set({ height: v ?? 10 })} min={1} max={300} step={1} unit="mm" />
          </Field>
        )}
      </div>
      {!twoD && (
        <label class="check">
          <input type="checkbox" checked={e.showText} onChange={(ev) => set({ showText: (ev.target as HTMLInputElement).checked })} /> Klartext darunter
        </label>
      )}
    </>
  );
}

function BoxProps(props: { e: BoxElement; set: (p: Partial<BoxElement>) => void }) {
  const { e, set } = props;
  return (
    <>
      <div class="row">
        <Field label="Breite">
          <Num value={e.width} onChange={(v) => set({ width: v ?? 1 })} min={0.1} step={1} unit="mm" />
        </Field>
        <Field label="Höhe">
          <Num value={e.height} onChange={(v) => set({ height: v ?? 1 })} min={0.1} step={1} unit="mm" />
        </Field>
      </div>
      <div class="row">
        <Field label="Linienstärke" hint="0 = gefüllt">
          <Num value={e.thickness} onChange={(v) => set({ thickness: v ?? 0 })} min={0} step={0.1} unit="mm" />
        </Field>
        <Field label="Eckenradius">
          <Num value={e.radius} onChange={(v) => set({ radius: v ?? 0 })} min={0} step={0.5} unit="mm" />
        </Field>
      </div>
      <p class="muted small">Für eine Linie Höhe (oder Breite) auf die Linienstärke setzen und „gefüllt“ (0) wählen.</p>
    </>
  );
}

function ImageProps(props: { e: ImageElement; set: (p: Partial<ImageElement>) => void; onPick: () => void }) {
  const { e, set } = props;
  return (
    <>
      <div class="row">
        <Field label="Breite">
          <Num value={e.width} onChange={(v) => set({ width: v ?? 10 })} min={1} step={1} unit="mm" />
        </Field>
        <Field label="Höhe" hint="0 = proportional">
          <Num value={e.height} onChange={(v) => set({ height: v ?? 0 })} min={0} step={1} unit="mm" />
        </Field>
      </div>
      <Field label="Umsetzung">
        <Segmented
          small
          value={e.dither}
          onChange={(v) => set({ dither: v })}
          options={[
            { value: "threshold", label: "Schwelle" },
            { value: "floyd", label: "Floyd-St." },
            { value: "atkinson", label: "Atkinson" },
            { value: "bayer", label: "Raster" },
          ]}
        />
      </Field>
      <Field label={`Schwelle / Helligkeit ${e.threshold}`}>
        <input type="range" min={1} max={254} value={e.threshold} onInput={(ev) => set({ threshold: Number((ev.target as HTMLInputElement).value) })} />
      </Field>
      <button class="btn ghost" onClick={props.onPick}>
        <Icon name="image" /> Anderes Bild …
      </button>
    </>
  );
}
