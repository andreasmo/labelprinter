import { useRef, useState } from "preact/hooks";
import type { PrinterConfig } from "../../../shared/types";
import { api } from "../api";
import { download, Icon, toast } from "../components/ui";
import { testLabel } from "../lib/zpl";

export function ZplTab(props: { printer: PrinterConfig | null; text: string; name: string; onChange: (t: string, name?: string) => void }) {
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const p = props.printer;
  const size = new Blob([props.text]).size;
  const labels = (props.text.match(/\^XZ/gi) || []).length;

  async function send() {
    if (!p) return;
    setBusy(true);
    try {
      const r = await api.print(p.id, props.text);
      toast(`An „${p.name}“ gesendet (${(r.bytes / 1024).toFixed(1)} kB)`, "ok");
    } catch (e: any) {
      toast(e.message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="zpl-tab pane">
      <input
        ref={fileInput}
        type="file"
        hidden
        accept=".zpl,.prn,.txt"
        onChange={async (e) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (f) props.onChange(await f.text(), f.name);
          (e.target as HTMLInputElement).value = "";
        }}
      />
      <div class="toolbar">
        <div class="tool-group">
          <button class="btn ghost" onClick={() => fileInput.current?.click()}>
            <Icon name="upload" /> Datei öffnen
          </button>
          <button class="btn ghost" disabled={!props.text} onClick={() => download(props.name || "etikett.zpl", props.text)}>
            <Icon name="download" /> Speichern
          </button>
          <button class="btn ghost" disabled={!p} onClick={() => p && props.onChange(testLabel(p), "testetikett.zpl")}>
            Testetikett einfügen
          </button>
          <button class="btn ghost" disabled={!props.text} onClick={() => props.onChange("", "")}>
            Leeren
          </button>
        </div>
        <span class="muted small">
          {props.name && <strong>{props.name} · </strong>}
          {(size / 1024).toFixed(1)} kB · {labels} Format{labels === 1 ? "" : "e"} (^XZ)
        </span>
      </div>
      <textarea
        class="zpl-editor"
        spellcheck={false}
        value={props.text}
        placeholder={"^XA\n^FO50,50^A0N,50,50^FDHallo Zebra^FS\n^XZ"}
        onInput={(e) => props.onChange((e.target as HTMLTextAreaElement).value)}
      />
      <div class="print-bar">
        <p class="hint">Der Code wird unverändert an den Drucker geschickt – Formatangaben des logischen Druckers (^PW, ^LS …) werden hier nicht ergänzt.</p>
        <button class="btn primary big" disabled={!p || !props.text.trim() || busy} onClick={send}>
          <Icon name="printer" /> {busy ? "Sende …" : "An Drucker senden"}
        </button>
      </div>
    </div>
  );
}
