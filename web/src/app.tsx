import { useEffect, useState } from "preact/hooks";
import type { ServerInfo, Settings } from "../../shared/types";
import { api, pref, setPref } from "./api";
import { Icon, Toaster, toast } from "./components/ui";
import { DesignerTab } from "./tabs/DesignerTab";
import { FileTab } from "./tabs/FileTab";
import { PrintersTab } from "./tabs/PrintersTab";
import { ZplTab } from "./tabs/ZplTab";

type Tab = "file" | "designer" | "zpl" | "printers";

const TABS: { id: Tab; label: string; icon: "file" | "pen" | "code" | "cog" }[] = [
  { id: "file", label: "Datei drucken", icon: "file" },
  { id: "designer", label: "Designer", icon: "pen" },
  { id: "zpl", label: "ZPL", icon: "code" },
  { id: "printers", label: "Drucker", icon: "cog" },
];

export function App() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [offline, setOffline] = useState(false);
  const [tab, setTabRaw] = useState<Tab>(() => pref("tab", "file"));
  const [activeId, setActiveIdRaw] = useState<string | null>(() => pref("printer", null));
  const [zpl, setZpl] = useState({ text: "", name: "" });
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const setTab = (t: Tab) => {
    setTabRaw(t);
    setPref("tab", t);
  };
  const setActiveId = (id: string | null) => {
    setActiveIdRaw(id);
    setPref("printer", id);
  };

  async function reload(selectId?: string) {
    try {
      const [i, s] = await Promise.all([api.info(), api.settings()]);
      setInfo(i);
      setSettings(s);
      setOffline(false);
      if (selectId && !activeId) setActiveId(selectId);
      if (!s.printers.length) setTab("printers");
    } catch (e: any) {
      setOffline(true);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  const printers = settings?.printers ?? [];
  const printer = printers.find((p) => p.id === activeId) ?? printers[0] ?? null;

  // Status des aktiven Druckers (leise im Hintergrund)
  useEffect(() => {
    setStatus(null);
    if (!printer?.host) return;
    let alive = true;
    const check = () =>
      api
        .status(printer.id)
        .then((s) => {
          if (!alive) return;
          if (!s.reachable) setStatus({ ok: false, text: "nicht erreichbar" });
          else if (s.error) setStatus({ ok: true, text: "erreichbar" });
          else {
            const probs = [s.paperOut && "Papier leer", s.ribbonOut && "Farbband leer", s.headOpen && "Kopf offen", s.paused && "pausiert"].filter(Boolean);
            setStatus({ ok: !probs.length, text: probs.length ? probs.join(", ") : "bereit" });
          }
        })
        .catch(() => alive && setStatus({ ok: false, text: "unbekannt" }));
    check();
    const t = setInterval(check, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [printer?.id, printer?.host, printer?.port]);

  const openZpl = (text: string, name: string) => {
    setZpl({ text, name });
    setTab("zpl");
    toast(`${name || "ZPL"} geladen`, "info");
  };

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <span class="logo" aria-hidden="true">
            <Icon name="barcode" size={20} />
          </span>
          <span>zplPrinter</span>
        </div>
        <nav class="tabs" role="tablist">
          {TABS.map((t) => (
            <button role="tab" aria-selected={tab === t.id} class={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={16} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div class="printer-pick">
          {printers.length > 0 ? (
            <>
              <span class={`dot ${status ? (status.ok ? "ok" : "bad") : ""}`} title={status?.text ?? "Status wird abgefragt"} />
              <select value={printer?.id} onChange={(e) => setActiveId((e.target as HTMLSelectElement).value)} aria-label="Aktiver Drucker">
                {printers.map((p) => (
                  <option value={p.id}>
                    {p.name} — {p.widthMm}×{p.heightMm} mm
                  </option>
                ))}
              </select>
              {status && <span class="muted small status-text">{status.text}</span>}
            </>
          ) : (
            <span class="muted small">kein Drucker</span>
          )}
        </div>
      </header>

      {offline && (
        <div class="banner">
          Keine Verbindung zum zplPrinter-Dienst. Läuft das Programm noch?{" "}
          <button class="btn ghost small" onClick={() => reload()}>
            Erneut versuchen
          </button>
        </div>
      )}

      <main class="main">
        <div hidden={tab !== "file"} class="tab-page">
          <FileTab printer={printer} onZpl={openZpl} active={tab === "file"} />
        </div>
        <div hidden={tab !== "designer"} class="tab-page">
          {tab === "designer" && (
            <DesignerTab printer={printer} templates={settings?.templates ?? []} readonly={!!info?.readonly} onTemplatesChanged={() => reload()} />
          )}
        </div>
        <div hidden={tab !== "zpl"} class="tab-page">
          <ZplTab printer={printer} text={zpl.text} name={zpl.name} onChange={(text, name) => setZpl((z) => ({ text, name: name ?? z.name }))} />
        </div>
        <div hidden={tab !== "printers"} class="tab-page">
          {settings && (
            <PrintersTab
              printers={printers}
              info={info}
              activeId={printer?.id ?? null}
              onChanged={(id) => reload(id)}
              onSelect={(id) => {
                setActiveId(id);
                toast("Aktiver Drucker gewechselt", "ok");
              }}
            />
          )}
        </div>
      </main>
      <Toaster />
    </div>
  );
}
