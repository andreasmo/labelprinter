import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Mono } from "../lib/raster";

// ---------- Toasts ----------
type ToastKind = "ok" | "err" | "info";
interface ToastMsg {
  id: number;
  text: string;
  kind: ToastKind;
}
let listeners: ((t: ToastMsg[]) => void)[] = [];
let toasts: ToastMsg[] = [];
let tid = 0;
export function toast(text: string, kind: ToastKind = "info") {
  const t = { id: ++tid, text, kind };
  toasts = [...toasts, t];
  listeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    listeners.forEach((l) => l(toasts));
  }, kind === "err" ? 7000 : 3500);
}
export function Toaster() {
  const [list, setList] = useState<ToastMsg[]>([]);
  useEffect(() => {
    listeners.push(setList);
    return () => void (listeners = listeners.filter((l) => l !== setList));
  }, []);
  return (
    <div class="toaster" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} class={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------- Formularbausteine ----------
export function Field(props: { label: string; hint?: ComponentChildren; children: ComponentChildren; wide?: boolean }) {
  return (
    <label class={`field${props.wide ? " wide" : ""}`}>
      <span class="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span class="field-hint">{props.hint}</span>}
    </label>
  );
}

export function Segmented<T extends string | number>(props: { value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div class={`segmented${props.small ? " small" : ""}`} role="radiogroup">
      {props.options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          class={o.value === props.value ? "on" : ""}
          title={o.title}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Num(props: {
  value: number | null;
  onChange: (v: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
  placeholder?: string;
  unit?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(props.value == null ? "" : String(props.value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(props.value == null ? "" : String(props.value));
  }, [props.value]);
  const commit = (t: string) => {
    const s = t.replace(",", ".").trim();
    if (s === "" && props.allowEmpty) return props.onChange(null);
    const n = Number(s);
    if (!Number.isFinite(n)) return;
    let v = n;
    if (props.min != null) v = Math.max(props.min, v);
    if (props.max != null) v = Math.min(props.max, v);
    props.onChange(v);
  };
  return (
    <div class="num">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={props.placeholder}
        disabled={props.disabled}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(props.value == null ? "" : String(props.value));
        }}
        onInput={(e) => {
          const t = (e.target as HTMLInputElement).value;
          setText(t);
          commit(t);
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const step = (props.step ?? 1) * (e.shiftKey ? 10 : 1);
          const cur = props.value ?? 0;
          const next = Math.round((cur + (e.key === "ArrowUp" ? step : -step)) * 1000) / 1000;
          setText(String(next));
          commit(String(next));
        }}
      />
      {props.unit && <span class="unit">{props.unit}</span>}
    </div>
  );
}

export function Icon(props: { name: keyof typeof ICONS; size?: number }) {
  const s = props.size ?? 18;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      {ICONS[props.name]}
    </svg>
  );
}

const ICONS = {
  printer: (
    <>
      <path d="M6 9V3h12v6" />
      <rect x="3" y="9" width="18" height="8" rx="2" />
      <path d="M6 14h12v7H6z" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </>
  ),
  pen: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </>
  ),
  code: (
    <>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </>
  ),
  cog: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m17 8-5-5-5 5" />
      <path d="M12 3v12" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  text: (
    <>
      <path d="M4 7V4h16v3" />
      <path d="M9 20h6" />
      <path d="M12 4v16" />
    </>
  ),
  barcode: (
    <>
      <path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14" />
    </>
  ),
  square: <rect x="4" y="4" width="16" height="16" rx="1" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  up: <path d="m18 15-6-6-6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M3 15h18M9 4v16" />
    </>
  ),
  save: (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </>
  ),
};

// ---------- 1-Bit-Vorschau ----------
export function MonoCanvas(props: { mono: Mono | null; class?: string; maxScale?: number; onPointer?: (e: PointerEvent, x: number, y: number, kind: "down" | "move" | "up") => void; overlay?: ComponentChildren }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const m = props.mono;

  useEffect(() => {
    const c = ref.current;
    if (!c || !m) return;
    c.width = m.w;
    c.height = m.h;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(m.w, m.h);
    const d = img.data;
    for (let i = 0, p = 0; i < m.data.length; i++, p += 4) {
      const v = m.data[i] ? 20 : 255;
      d[p] = d[p + 1] = d[p + 2] = v;
      d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [m]);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !m) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const s = Math.min((r.width - 2) / m.w, (Math.max(160, r.height) - 2) / m.h, props.maxScale ?? 6);
      setScale(Math.max(0.05, s));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [m?.w, m?.h]);

  const toDots = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * (m?.w ?? 1), ((e.clientY - r.top) / r.height) * (m?.h ?? 1)] as const;
  };
  const handler = (kind: "down" | "move" | "up") => (e: PointerEvent) => {
    if (!props.onPointer) return;
    if (kind === "down") (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const [x, y] = toDots(e);
    props.onPointer(e, x, y, kind);
  };

  return (
    <div class={`mono-wrap ${props.class ?? ""}`} ref={wrap}>
      {m ? (
        <div
          class="label-paper"
          style={{ width: m.w * scale + "px", height: m.h * scale + "px", cursor: props.onPointer ? "default" : undefined }}
          onPointerDown={handler("down")}
          onPointerMove={handler("move")}
          onPointerUp={handler("up")}
        >
          <canvas ref={ref} style={{ width: "100%", height: "100%", imageRendering: scale >= 1 ? "pixelated" : "auto" }} />
          {props.overlay && <div class="label-overlay">{props.overlay}</div>}
        </div>
      ) : (
        <div class="mono-empty">Keine Vorschau</div>
      )}
    </div>
  );
}

export function download(name: string, text: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
