import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { PrinterConfig } from "../../../shared/types";
import { api, pref, setPref } from "../api";
import { CropView } from "../components/CropView";
import { Field, Icon, MonoCanvas, Num, Segmented, toast } from "../components/ui";
import { autoCrop, defaultLayout, overview, renderLabelGray, type Gray, type LayoutOptions, type Placement } from "../lib/layout";
import { ditherLum, type DitherOptions, type Mono } from "../lib/raster";
import { isZpl, loadSource, type Rect, type Source } from "../lib/sources";
import { buildJob } from "../lib/zpl";

const defaultDither: DitherOptions = { method: "threshold", threshold: 128, invert: false };

function Thumb(props: { source: Source; index: number; active: boolean; checked: boolean; onClick: () => void; onToggle: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    overview(props.source.pages[props.index], 140).then((c) => {
      if (!alive || !ref.current) return;
      ref.current.width = c.width;
      ref.current.height = c.height;
      ref.current.getContext("2d")!.drawImage(c, 0, 0);
    });
    return () => void (alive = false);
  }, [props.source, props.index]);
  return (
    <div class={`thumb${props.active ? " active" : ""}${props.checked ? "" : " excluded"}`} onClick={props.onClick}>
      <canvas ref={ref} />
      <label class="thumb-check" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={props.checked} onChange={props.onToggle} />
        <span>{props.index + 1}</span>
      </label>
    </div>
  );
}

export function FileTab(props: { printer: PrinterConfig | null; onZpl: (text: string, name: string) => void; active: boolean }) {
  const p = props.printer;
  const [source, setSource] = useState<Source | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<boolean[]>([]);
  const [current, setCurrent] = useState(0);
  const [layout, setLayoutRaw] = useState<LayoutOptions>(() => pref("layout", defaultLayout));
  const [dither, setDitherRaw] = useState<DitherOptions>(() => pref("dither", defaultDither));
  const [copies, setCopies] = useState(1);
  const [gray, setGray] = useState<{ gray: Gray; placement: Placement } | null>(null);
  const [autoRect, setAutoRect] = useState<Rect | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const setLayout = (patch: Partial<LayoutOptions>) =>
    setLayoutRaw((l) => {
      const n = { ...l, ...patch };
      setPref("layout", n);
      return n;
    });
  const setDither = (patch: Partial<DitherOptions>) =>
    setDitherRaw((d) => {
      const n = { ...d, ...patch };
      setPref("dither", n);
      return n;
    });

  async function openFile(file: File) {
    if (isZpl(file)) {
      props.onZpl(await file.text(), file.name);
      return;
    }
    setLoading(true);
    try {
      const s = await loadSource(file);
      source?.destroy();
      setSource(s);
      setSelected(s.pages.map(() => true));
      setCurrent(0);
      setGray(null);
    } catch (e: any) {
      toast(e.message || String(e), "err");
    } finally {
      setLoading(false);
    }
  }

  // Einfügen aus der Zwischenablage (Strg+V)
  useEffect(() => {
    if (!props.active) return;
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])][0];
      if (f) {
        e.preventDefault();
        openFile(f);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [props.active, source]);

  const page = source?.pages[current] ?? null;
  const fmtKey = p ? `${p.widthMm}x${p.heightMm}@${p.dpi}` : "";

  // Seite in Etikettengröße rendern (entprellt)
  useEffect(() => {
    if (!page || !p) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const g = await renderLabelGray(page, p, layout);
        if (alive) setGray(g);
      } catch (e: any) {
        if (alive) toast("Rendern fehlgeschlagen: " + e.message, "err");
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [page, fmtKey, JSON.stringify(layout)]);

  useEffect(() => {
    if (!page || layout.crop !== "auto") return setAutoRect(null);
    autoCrop(page).then((r) => setAutoRect({ x: r.x / page.width, y: r.y / page.height, w: r.w / page.width, h: r.h / page.height }));
  }, [page, layout.crop]);

  const mono: Mono | null = useMemo(() => (gray ? ditherLum(gray.gray.lum, gray.gray.w, gray.gray.h, dither) : null), [gray, dither]);

  const pages = source ? source.pages.map((_, i) => i).filter((i) => selected[i]) : [];

  async function makeZpl(): Promise<string> {
    if (!p || !source) throw new Error("Kein Drucker oder keine Datei");
    const monos: Mono[] = [];
    for (let k = 0; k < pages.length; k++) {
      setBusy(`Rastere Seite ${k + 1} / ${pages.length} …`);
      const g = await renderLabelGray(source.pages[pages[k]], p, layout);
      monos.push(ditherLum(g.gray.lum, g.gray.w, g.gray.h, dither));
    }
    setBusy("Erzeuge ZPL …");
    return buildJob(p, monos, copies);
  }

  async function print() {
    if (!p) return;
    try {
      const zpl = await makeZpl();
      setBusy("Sende an Drucker …");
      const r = await api.print(p.id, zpl);
      toast(`${pages.length * copies} Etikett${pages.length * copies === 1 ? "" : "en"} an „${p.name}“ gesendet (${(r.bytes / 1024).toFixed(0)} kB)`, "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  }

  async function showZpl() {
    try {
      props.onZpl(await makeZpl(), (source?.name ?? "etikett").replace(/\.\w+$/, "") + ".zpl");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(null);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) openFile(f);
  };

  const pl = gray?.placement;
  const cropRect: Rect | null = layout.crop === "manual" ? layout.manualCrop : layout.crop === "auto" ? autoRect : null;

  return (
    <div
      class={`file-tab${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".pdf,image/*,.zpl,.prn,.txt"
        onChange={(e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) openFile(f);
          (e.target as HTMLInputElement).value = "";
        }}
      />

      <section class="pane source-pane">
        {!source ? (
          <button class="dropzone" onClick={() => fileInput.current?.click()} disabled={loading}>
            <Icon name="upload" size={40} />
            <strong>{loading ? "Lade …" : "PDF, Bild oder ZPL-Datei hierher ziehen"}</strong>
            <span>oder klicken zum Auswählen · Bilder auch mit Strg+V einfügen</span>
            <span class="muted small">PDF · PNG · JPG · GIF · BMP · WebP · SVG · .zpl</span>
          </button>
        ) : (
          <>
            <div class="pane-head">
              <div class="file-name" title={source.name}>
                <Icon name="file" /> {source.name}
                <span class="muted">
                  {source.kind === "pdf" ? `${source.pages.length} Seite${source.pages.length > 1 ? "n" : ""}` : `${Math.round(page!.width)} × ${Math.round(page!.height)} px`}
                </span>
              </div>
              <button class="btn ghost" onClick={() => fileInput.current?.click()}>
                Andere Datei …
              </button>
              <button
                class="btn ghost icon"
                title="Schließen"
                onClick={() => {
                  source.destroy();
                  setSource(null);
                  setGray(null);
                }}
              >
                <Icon name="x" />
              </button>
            </div>
            {source.pages.length > 1 && (
              <div class="thumbs-bar">
                <div class="thumbs">
                  {source.pages.map((_, i) => (
                    <Thumb
                      key={i}
                      source={source}
                      index={i}
                      active={i === current}
                      checked={!!selected[i]}
                      onClick={() => setCurrent(i)}
                      onToggle={() => setSelected((s) => s.map((v, j) => (j === i ? !v : v)))}
                    />
                  ))}
                </div>
                <div class="thumbs-actions">
                  <button class="btn ghost small" onClick={() => setSelected(source.pages.map(() => true))}>
                    Alle
                  </button>
                  <button class="btn ghost small" onClick={() => setSelected(source.pages.map((_, i) => i === current))}>
                    Nur diese
                  </button>
                </div>
              </div>
            )}
            {page && (
              <CropView
                page={page}
                rect={cropRect}
                editable={layout.crop === "manual"}
                onChange={(r) => setLayout({ manualCrop: r })}
              />
            )}
            {layout.crop === "manual" && <p class="hint">Bereich mit der Maus aufziehen, verschieben oder an den Ecken anpassen. Gilt für alle Seiten.</p>}
          </>
        )}
      </section>

      <aside class="pane side-pane">
        <div class="card">
          <h3>Ausschnitt &amp; Größe</h3>
          <Field label="Ausschnitt">
            <Segmented
              value={layout.crop}
              onChange={(v) => setLayout({ crop: v })}
              options={[
                { value: "none", label: "Ganze Seite" },
                { value: "auto", label: "Automatisch", title: "Weißen Rand entfernen" },
                { value: "manual", label: "Manuell", title: "Bereich in der Seite aufziehen" },
              ]}
            />
          </Field>
          <Field label="Skalierung">
            <Segmented
              value={layout.fit}
              onChange={(v) => setLayout({ fit: v })}
              options={[
                { value: "contain", label: "Einpassen" },
                { value: "cover", label: "Füllen", title: "Etikett füllen, Überstand abschneiden" },
                { value: "stretch", label: "Strecken", title: "Seitenverhältnis ignorieren" },
                { value: "actual", label: "1:1", title: "PDF: Originalgröße · Bild: 1 Pixel = 1 Druckpunkt" },
              ]}
            />
          </Field>
          <div class="row">
            <Field label="Drehung">
              <select value={String(layout.rotate)} onChange={(e) => setLayout({ rotate: ((v) => (v === "auto" ? "auto" : (Number(v) as 0)))((e.target as HTMLSelectElement).value) })}>
                <option value="auto">Auto</option>
                <option value="0">0°</option>
                <option value="90">90° ↻</option>
                <option value="180">180°</option>
                <option value="270">270° ↺</option>
              </select>
            </Field>
            <Field label="Position">
              <select value={layout.align} onChange={(e) => setLayout({ align: (e.target as HTMLSelectElement).value as "center" })}>
                <option value="center">Zentriert</option>
                <option value="topleft">Oben links</option>
              </select>
            </Field>
            <Field label="Rand">
              <Num value={layout.marginMm} onChange={(v) => setLayout({ marginMm: v ?? 0 })} min={0} max={50} step={0.5} unit="mm" />
            </Field>
          </div>
        </div>

        <div class="card">
          <h3>Schwarz-Weiß-Umsetzung</h3>
          <Field label="Verfahren">
            <Segmented
              small
              value={dither.method}
              onChange={(v) => setDither({ method: v })}
              options={[
                { value: "threshold", label: "Schwelle", title: "Für Text, Barcodes, Grafiken – am schärfsten" },
                { value: "floyd", label: "Floyd-St.", title: "Fehlerdiffusion – für Fotos" },
                { value: "atkinson", label: "Atkinson", title: "Fehlerdiffusion, kontrastreicher" },
                { value: "bayer", label: "Raster", title: "Geordnetes Raster" },
              ]}
            />
          </Field>
          <Field label={dither.method === "threshold" ? `Schwellwert ${dither.threshold}` : `Helligkeit ${128 - dither.threshold > 0 ? "+" : ""}${128 - dither.threshold}`}>
            <input type="range" min={1} max={254} value={dither.threshold} onInput={(e) => setDither({ threshold: Number((e.target as HTMLInputElement).value) })} />
          </Field>
          <label class="check">
            <input type="checkbox" checked={!!dither.invert} onChange={(e) => setDither({ invert: (e.target as HTMLInputElement).checked })} /> Invertieren
          </label>
        </div>

        <div class="card preview-card">
          <div class="preview-head">
            <h3>Vorschau</h3>
            {p && (
              <span class="muted small">
                {pl ? `${gray!.gray.w} × ${gray!.gray.h} Dots` : ""}
                {source && source.pages.length > 1 ? ` · Seite ${current + 1}` : ""}
              </span>
            )}
          </div>
          {!p ? (
            <p class="muted">Bitte zuerst oben einen Drucker wählen oder unter „Drucker“ anlegen.</p>
          ) : (
            <MonoCanvas mono={source ? mono : null} class="preview" />
          )}
          {pl?.clipped && layout.fit !== "cover" && <p class="warn">Motiv ist größer als das Etikett und wird abgeschnitten.</p>}
        </div>

        <div class="print-bar">
          <Field label="Kopien">
            <Num value={copies} onChange={(v) => setCopies(Math.max(1, Math.round(v ?? 1)))} min={1} max={9999} />
          </Field>
          <button class="btn primary big" disabled={!p || !source || !pages.length || !!busy} onClick={print}>
            <Icon name="printer" />
            {busy ?? (pages.length > 1 ? `${pages.length} Seiten drucken` : "Drucken")}
          </button>
          <button class="btn ghost icon" disabled={!p || !source || !pages.length || !!busy} onClick={showZpl} title="Erzeugten ZPL-Code ansehen / speichern">
            <Icon name="code" />
          </button>
        </div>
      </aside>
    </div>
  );
}
