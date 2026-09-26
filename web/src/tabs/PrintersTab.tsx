import { useEffect, useState } from "preact/hooks";
import type { PrinterConfig, ServerInfo } from "../../../shared/types";
import { DEFAULT_PORT, labelDots, newPrinter } from "../../../shared/types";
import { api } from "../api";
import { Field, Icon, Num, Segmented, toast } from "../components/ui";
import { testLabel } from "../lib/zpl";

const PRESETS: [number, number, string][] = [
  [100, 150, "Versand 4×6″"],
  [100, 50, ""],
  [100, 100, ""],
  [102, 76, "4×3″"],
  [76, 51, "3×2″"],
  [57, 32, ""],
  [50, 25, ""],
  [38, 25, ""],
];

export function PrintersTab(props: {
  printers: PrinterConfig[];
  info: ServerInfo | null;
  activeId: string | null;
  onChanged: (selectId?: string) => void;
  onSelect: (id: string) => void;
}) {
  const ro = !!props.info?.readonly;
  const [editId, setEditId] = useState<string | null>(props.activeId ?? props.printers[0]?.id ?? null);
  const stored = props.printers.find((p) => p.id === editId) ?? null;
  const [draft, setDraft] = useState<PrinterConfig | null>(stored);
  const [probing, setProbing] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);

  useEffect(() => {
    if (draft && draft.id === editId && !props.printers.some((p) => p.id === editId)) return; // neuer, ungespeicherter Drucker
    setDraft(stored ? { ...stored } : null);
    setStatusText(null);
  }, [editId, props.printers]);

  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(stored);

  // Aktiven Drucker (Kopfzeile) mitführen, solange nichts ungespeichert ist
  useEffect(() => {
    if (props.activeId && !dirty) setEditId(props.activeId);
  }, [props.activeId]);
  const set = (patch: Partial<PrinterConfig>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  async function save() {
    if (!draft) return;
    try {
      const saved = await api.savePrinter(draft);
      toast(`„${saved.name}“ gespeichert`, "ok");
      props.onChanged(saved.id);
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  async function remove() {
    if (!draft) return;
    if (!props.printers.some((p) => p.id === draft.id)) {
      setDraft(null);
      setEditId(props.printers[0]?.id ?? null);
      return;
    }
    try {
      await api.deletePrinter(draft.id);
      toast(`„${draft.name}“ gelöscht`, "ok");
      setEditId(props.printers.find((p) => p.id !== draft.id)?.id ?? null);
      props.onChanged();
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  function create(from?: PrinterConfig) {
    const p = from ? { ...from, id: crypto.randomUUID(), name: from.name + " (Kopie)" } : newPrinter();
    setEditId(p.id);
    setDraft(p);
  }

  async function probe() {
    if (!draft?.host) return toast("Bitte zuerst IP-Adresse eintragen", "err");
    setProbing(true);
    try {
      const r = await api.probe(draft.host, draft.port);
      if (!r.ok) throw new Error(r.error);
      const patch: Partial<PrinterConfig> = {};
      if (r.port && r.port !== draft.port) patch.port = r.port;
      if (r.dpi) patch.dpi = r.dpi;
      const dpi = r.dpi ?? draft.dpi;
      if (r.printWidthDots) patch.widthMm = Math.round((r.printWidthDots / dpi) * 25.4);
      if (r.labelLengthDots) patch.heightMm = Math.round((r.labelLengthDots / dpi) * 25.4);
      if (draft.name === "Neuer Drucker" && r.model) patch.name = r.model.replace(/-\d+dpi/i, "");
      set(patch);
      toast(`Gefunden: ${r.model ?? "Zebra"}${patch.port ? ` · Port ${patch.port}` : ""}${r.dpi ? ` · ${r.dpi} dpi` : ""}${patch.widthMm ? ` · Breite ${patch.widthMm} mm` : ""}${patch.heightMm ? ` · Länge ${patch.heightMm} mm` : ""} – bitte prüfen und speichern`, "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setProbing(false);
    }
  }

  async function needSaved(): Promise<PrinterConfig | null> {
    if (!draft) return null;
    if (dirty) {
      if (ro) {
        toast("Änderungen können nicht gespeichert werden (schreibgeschützt)", "err");
        return null;
      }
      await save();
    }
    return draft;
  }

  async function printTest() {
    const p = await needSaved();
    if (!p) return;
    try {
      await api.print(p.id, testLabel(p));
      toast("Testetikett gesendet", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  async function command(cmd: "calibrate" | "cancel") {
    const p = await needSaved();
    if (!p) return;
    try {
      await api.command(p.id, cmd);
      toast(cmd === "calibrate" ? "Kalibrierung gestartet (~JC)" : "Warteschlange gelöscht (~JA)", "ok");
    } catch (e: any) {
      toast(e.message, "err");
    }
  }

  async function checkStatus() {
    const p = await needSaved();
    if (!p) return;
    setStatusText("Frage Status ab …");
    try {
      const s = await api.status(p.id);
      if (!s.reachable) setStatusText("❌ " + s.error);
      else if (s.error) setStatusText("⚠️ " + s.error);
      else {
        const probs = [s.paperOut && "Papier leer", s.ribbonOut && "Farbband leer", s.headOpen && "Druckkopf offen", s.paused && "pausiert"].filter(Boolean);
        setStatusText(
          (probs.length ? "⚠️ " + probs.join(", ") : "✅ Bereit") +
            ` · Modus ${s.thermalTransfer ? "Thermotransfer" : "Thermodirekt"}` +
            (s.formatsInBuffer ? ` · ${s.formatsInBuffer} Aufträge im Puffer` : ""),
        );
      }
    } catch (e: any) {
      setStatusText("❌ " + e.message);
    }
  }

  const dots = draft ? labelDots(draft) : null;
  const isNew = !!draft && !props.printers.some((p) => p.id === draft.id);

  return (
    <div class="printers-tab">
      <aside class="pane printer-list">
        <div class="list-head">
          <h3>Logische Drucker</h3>
          <button class="btn ghost small" disabled={ro} onClick={() => create()}>
            <Icon name="plus" size={16} /> Neu
          </button>
        </div>
        {props.printers.length === 0 && !isNew && (
          <div class="empty">
            <p>Noch kein Drucker angelegt.</p>
            <button class="btn primary" disabled={ro} onClick={() => create()}>
              <Icon name="plus" /> Ersten Drucker anlegen
            </button>
          </div>
        )}
        <ul>
          {[...props.printers, ...(isNew ? [draft!] : [])].map((p) => (
            <li class={p.id === editId ? "sel" : ""} onClick={() => setEditId(p.id)}>
              <div class="pl-name">
                {p.name}
                {p.id === props.activeId && <span class="badge">aktiv</span>}
              </div>
              <div class="muted small">
                {p.host || "keine IP"} · {p.widthMm}×{p.heightMm} mm · {p.dpi} dpi
              </div>
            </li>
          ))}
        </ul>
        {props.info && (
          <p class="muted small data-file" title={props.info.dataFile}>
            Gespeichert in: {props.info.dataFile}
            {ro && <><br />Schreibgeschützt (readonly)</>}
          </p>
        )}
      </aside>

      <section class="pane printer-edit">
        {!draft ? (
          <p class="muted pad">Drucker links auswählen oder neu anlegen.</p>
        ) : (
          <>
            <div class="card">
              <h3>Verbindung</h3>
              <div class="row">
                <Field label="Name" wide>
                  <input value={draft.name} disabled={ro} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />
                </Field>
              </div>
              <div class="row">
                <Field label="IP-Adresse / Hostname" wide>
                  <input value={draft.host} disabled={ro} placeholder="z. B. 192.168.1.50" onInput={(e) => set({ host: (e.target as HTMLInputElement).value.trim() })} />
                </Field>
                <Field label="Port">
                  <Num value={draft.port} disabled={ro} onChange={(v) => set({ port: Math.round(v ?? DEFAULT_PORT) })} min={1} max={65535} />
                </Field>
                <div class="field align-end">
                  <button class="btn ghost" disabled={ro || probing || !draft.host} onClick={probe} title="Modell, Auflösung und Etikettengröße vom Drucker abfragen">
                    <Icon name="search" /> {probing ? "Frage ab …" : "Erkennen"}
                  </button>
                </div>
              </div>
            </div>

            <div class="card">
              <h3>Etikett</h3>
              <div class="row">
                <Field label="Breite">
                  <Num value={draft.widthMm} disabled={ro} onChange={(v) => set({ widthMm: v ?? 100 })} min={5} max={300} step={1} unit="mm" />
                </Field>
                <Field label="Höhe">
                  <Num value={draft.heightMm} disabled={ro} onChange={(v) => set({ heightMm: v ?? 50 })} min={5} max={2000} step={1} unit="mm" />
                </Field>
                <Field label="Auflösung">
                  <select value={draft.dpi} disabled={ro} onChange={(e) => set({ dpi: Number((e.target as HTMLSelectElement).value) })}>
                    <option value={152}>152 dpi (6 Punkte/mm)</option>
                    <option value={203}>203 dpi (8 Punkte/mm)</option>
                    <option value={300}>300 dpi (12 Punkte/mm)</option>
                    <option value={600}>600 dpi (24 Punkte/mm)</option>
                  </select>
                </Field>
              </div>
              <div class="presets">
                {PRESETS.map(([w, h, l]) => (
                  <button class={`chip${draft.widthMm === w && draft.heightMm === h ? " on" : ""}`} disabled={ro} onClick={() => set({ widthMm: w, heightMm: h })}>
                    {w}×{h}
                    {l && <span class="muted"> {l}</span>}
                  </button>
                ))}
              </div>
              {dots && (
                <p class="muted small">
                  = {dots.w} × {dots.h} Druckpunkte
                </p>
              )}
            </div>

            <div class="card">
              <h3>Justage &amp; Druck</h3>
              <div class="row">
                <Field label="Label Shift (^LS)" hint="Dots, positiv = nach links">
                  <Num value={draft.labelShift} disabled={ro} onChange={(v) => set({ labelShift: Math.round(v ?? 0) })} min={-9999} max={9999} unit="Dots" />
                </Field>
                <Field label="Label Top (^LT)" hint="Dots, positiv = nach unten (±120)">
                  <Num value={draft.labelTop} disabled={ro} onChange={(v) => set({ labelTop: Math.round(v ?? 0) })} min={-120} max={120} unit="Dots" />
                </Field>
              </div>
              <div class="row">
                <Field label="Schwärzung (~SD)" hint="0–30, leer = Druckereinstellung">
                  <Num value={draft.darkness} disabled={ro} allowEmpty placeholder="Drucker" onChange={(v) => set({ darkness: v == null ? null : Math.round(v) })} min={0} max={30} />
                </Field>
                <Field label="Geschwindigkeit (^PR)" hint="Zoll/s, leer = Drucker">
                  <Num value={draft.speed} disabled={ro} allowEmpty placeholder="Drucker" onChange={(v) => set({ speed: v == null ? null : Math.round(v) })} min={1} max={14} />
                </Field>
              </div>
              <div class="row">
                <Field label="Druckverfahren (^MT)">
                  <select
                    value={draft.mediaType ?? ""}
                    disabled={ro}
                    onChange={(e) => {
                      const v = (e.target as HTMLSelectElement).value;
                      set({ mediaType: v === "T" || v === "D" ? v : null });
                    }}
                  >
                    <option value="T">Thermotransfer (mit Farbband)</option>
                    <option value="D">Thermodirekt</option>
                    <option value="">Druckereinstellung lassen</option>
                  </select>
                </Field>
                <Field label="Grafik-Kompression" hint="ACS läuft auf allen ZPL-II-Druckern">
                  <Segmented
                    small
                    value={draft.encoding}
                    onChange={(v) => !ro && set({ encoding: v })}
                    options={[
                      { value: "acs", label: "ACS (Hex)" },
                      { value: "z64", label: "Z64 (kompakt)" },
                    ]}
                  />
                </Field>
              </div>
              <label class="check">
                <input type="checkbox" checked={draft.rotate180} disabled={ro} onChange={(e) => set({ rotate180: (e.target as HTMLInputElement).checked })} /> Ausdruck um 180° drehen (^POI)
              </label>
              <Field label="Notiz" wide>
                <input value={draft.notes ?? ""} disabled={ro} placeholder="z. B. Standort, Material, Farbband" onInput={(e) => set({ notes: (e.target as HTMLInputElement).value })} />
              </Field>
            </div>

            <div class="card actions-card">
              <div class="actions">
                <button class="btn primary" disabled={ro || !dirty} onClick={save}>
                  <Icon name="save" /> {isNew ? "Anlegen" : "Speichern"}
                </button>
                <button class="btn ghost" disabled={!draft.host} onClick={printTest} title="Rahmen, Fadenkreuz und mm-Skala zum Einstellen von LS/LT">
                  <Icon name="printer" /> Testetikett
                </button>
                <button class="btn ghost" disabled={!draft.host} onClick={checkStatus}>
                  <Icon name="refresh" /> Status
                </button>
                <button class="btn ghost" disabled={!draft.host} onClick={() => command("calibrate")} title="Etikettenlänge neu einmessen (~JC)">
                  Kalibrieren
                </button>
                {!isNew && draft.id !== props.activeId && (
                  <button class="btn ghost" onClick={() => props.onSelect(draft.id)}>
                    Als aktiv wählen
                  </button>
                )}
                <span class="spacer" />
                <button class="btn ghost" disabled={ro || isNew} onClick={() => create(draft)} title="Gleicher Drucker, anderes Etikettenformat">
                  <Icon name="copy" /> Duplizieren
                </button>
                <button class="btn ghost danger" disabled={ro} onClick={remove}>
                  <Icon name="trash" /> Löschen
                </button>
              </div>
              {statusText && <p class="status-line">{statusText}</p>}
              <p class="muted small">
                Tipp: Testetikett drucken, Versatz des Rahmens an der mm-Skala ablesen und mit Label Shift/Top ausgleichen (bei {draft.dpi} dpi ≈ {Math.round(draft.dpi / 25.4)} Dots pro mm). Für
                mehrere Etikettenformate am selben Drucker einfach duplizieren.
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
