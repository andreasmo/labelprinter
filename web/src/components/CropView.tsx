import { useEffect, useRef, useState } from "preact/hooks";
import { overview } from "../lib/layout";
import type { Rect, SourcePage } from "../lib/sources";

type Drag = { kind: "new" | "move" | "nw" | "ne" | "sw" | "se"; x0: number; y0: number; start: Rect } | null;

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Seitenansicht mit Ausschnitt-Rahmen. rect ist normiert (0..1). */
export function CropView(props: { page: SourcePage; rect: Rect | null; editable: boolean; onChange: (r: Rect) => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    setReady(false);
    overview(props.page, 1400).then((c) => {
      if (!alive || !cv.current) return;
      cv.current.width = c.width;
      cv.current.height = c.height;
      cv.current.getContext("2d")!.drawImage(c, 0, 0);
      setReady(true);
    });
    return () => void (alive = false);
  }, [props.page]);

  const pos = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)] as const;
  };

  const down = (e: PointerEvent) => {
    if (!props.editable) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    const h = (e.target as HTMLElement).dataset.h as "nw" | "ne" | "sw" | "se" | undefined;
    const r = props.rect;
    if (h && r) setDrag({ kind: h, x0: x, y0: y, start: r });
    else if (r && x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h && !(r.w > 0.999 && r.h > 0.999)) setDrag({ kind: "move", x0: x, y0: y, start: r });
    else {
      const start = { x, y, w: 0, h: 0 };
      setDrag({ kind: "new", x0: x, y0: y, start });
      props.onChange({ x, y, w: 0.001, h: 0.001 });
    }
  };

  const move = (e: PointerEvent) => {
    if (!drag) return;
    const [x, y] = pos(e);
    const s = drag.start;
    let r: Rect;
    switch (drag.kind) {
      case "new":
        r = { x: Math.min(x, drag.x0), y: Math.min(y, drag.y0), w: Math.abs(x - drag.x0), h: Math.abs(y - drag.y0) };
        break;
      case "move": {
        const nx = clamp(s.x + x - drag.x0, 0, 1 - s.w);
        const ny = clamp(s.y + y - drag.y0, 0, 1 - s.h);
        r = { ...s, x: nx, y: ny };
        break;
      }
      default: {
        let x1 = s.x, y1 = s.y, x2 = s.x + s.w, y2 = s.y + s.h;
        if (drag.kind.includes("w")) x1 = x;
        if (drag.kind.includes("e")) x2 = x;
        if (drag.kind.includes("n")) y1 = y;
        if (drag.kind.includes("s")) y2 = y;
        r = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
      }
    }
    props.onChange(r);
  };

  const up = () => {
    if (drag && props.rect && (props.rect.w < 0.01 || props.rect.h < 0.01)) props.onChange({ x: 0, y: 0, w: 1, h: 1 });
    setDrag(null);
  };

  const r = props.rect;
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
  const aspect = props.page.width / props.page.height;
  return (
    <div class="crop-outer">
      <div
        class={`crop-box${props.editable ? " editable" : ""}`}
        ref={box}
        style={{ aspectRatio: String(aspect) }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
      >
        <canvas ref={cv} class="crop-canvas" style={{ opacity: ready ? 1 : 0.3 }} />
        {r && !(r.w > 0.999 && r.h > 0.999 && !props.editable) && (
          <>
            <div class="crop-shade" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${pct(r.x)} ${pct(r.y)},${pct(r.x)} ${pct(r.y + r.h)},${pct(r.x + r.w)} ${pct(r.y + r.h)},${pct(r.x + r.w)} ${pct(r.y)},${pct(r.x)} ${pct(r.y)})` }} />
            <div class={`crop-rect${props.editable ? "" : " fixed"}`} style={{ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) }}>
              {props.editable && ["nw", "ne", "sw", "se"].map((h) => <span class={`crop-h ${h}`} data-h={h} />)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
