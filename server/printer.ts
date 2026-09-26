// Rohdruck über TCP (Port 6101/9100) und Statusabfragen.
import { Socket } from "node:net";
import { RAW_PORTS, type PrinterStatus, type ProbeResult } from "../shared/types";

const CONNECT_TIMEOUT = 5000;

/** Fehler mit Systemcode (ECONNREFUSED …), damit Aufrufer darauf reagieren können. */
export class PrinterError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

/** Übersetzt Socket-Fehlercodes in eine Meldung mit Ursache und Abhilfe. */
export function describeError(host: string, port: number, code: string | undefined, phase: "connect" | "send" = "connect"): string {
  const at = `${host}:${port}`;
  const other = RAW_PORTS.filter((p) => p !== port).join(" oder ");
  switch (code) {
    case "ECONNREFUSED":
      return `${at} lehnt die Verbindung ab (ECONNREFUSED). Das Gerät ist erreichbar, aber auf Port ${port} nimmt nichts Aufträge an. Prüfen: richtiger Port (${other ? `alternativ ${other}` : "Rohdruck-Port"})? Rohdruck/Raw-IP am Drucker aktiviert? Bei Nicht-Zebra-Druckern (z. B. cab): ZPL-Emulation eingeschaltet?`;
    case "ETIMEDOUT":
    case "TIMEOUT":
      return `Keine Antwort von ${at} innerhalb von ${CONNECT_TIMEOUT / 1000} s. Prüfen: Drucker eingeschaltet und im Netz? IP-Adresse richtig (z. B. per Konfigurationsausdruck)? Liegen Rechner und Drucker im selben Netz, oder blockiert eine Firewall?`;
    case "EHOSTUNREACH":
    case "EHOSTDOWN":
      return `${host} ist nicht erreichbar (${code}). Der Drucker ist aus, nicht im Netz oder die IP-Adresse stimmt nicht.`;
    case "ENETUNREACH":
      return `Das Netz von ${host} ist von diesem Rechner aus nicht erreichbar (ENETUNREACH). Netzwerkkabel/WLAN, VPN oder Routing prüfen.`;
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return `Hostname „${host}“ lässt sich nicht auflösen (${code}). IP-Adresse statt Namen eintragen oder DNS prüfen.`;
    case "EADDRNOTAVAIL":
    case "EINVAL":
      return `Ungültige Adresse ${at} (${code}).`;
    case "ECONNRESET":
    case "EPIPE":
      return phase === "send"
        ? `${at} hat die Verbindung während der Übertragung getrennt (${code}). Möglicherweise ist der Drucker mit einem anderen Auftrag belegt oder hat die Daten abgelehnt.`
        : `${at} hat die Verbindung sofort wieder getrennt (${code}). Möglicherweise ist der Drucker gerade durch eine andere Verbindung belegt.`;
    default:
      return `Keine Verbindung zu ${at} (${code || "unbekannter Fehler"}).`;
  }
}

function connect(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = new Socket();
    const t = setTimeout(() => {
      s.destroy();
      reject(new PrinterError(describeError(host, port, "TIMEOUT"), "TIMEOUT"));
    }, CONNECT_TIMEOUT);
    s.once("error", (e: any) => {
      clearTimeout(t);
      reject(new PrinterError(describeError(host, port, e.code) + (e.code ? "" : ` ${e.message}`), e.code));
    });
    s.connect(port, host, () => {
      clearTimeout(t);
      s.removeAllListeners("error");
      s.setNoDelay(true);
      resolve(s);
    });
  });
}

/** Sendet Rohdaten und schließt die Verbindung, sobald alles übertragen ist. */
export async function sendRaw(host: string, port: number, data: Buffer, timeoutMs = 60000): Promise<void> {
  const s = await connect(host, port);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      s.destroy();
      reject(new PrinterError(`Zeitüberschreitung beim Senden an ${host}:${port} nach ${timeoutMs / 1000} s. Der Drucker nimmt keine Daten an (belegt, pausiert oder Puffer voll?).`, "TIMEOUT"));
    }, timeoutMs);
    s.on("error", (e: any) => {
      clearTimeout(t);
      reject(new PrinterError(describeError(host, port, e.code, "send"), e.code));
    });
    s.on("data", () => {}); // Antworten ignorieren
    s.end(data, () => {
      clearTimeout(t);
      resolve();
      // Manche Drucker schließen nicht selbst
      setTimeout(() => s.destroy(), 2000).unref?.();
    });
  });
}

/** Sendet einen Befehl und sammelt die Antwort bis Ruhe herrscht. */
export async function query(host: string, port: number, cmd: string, idleMs = 600, totalMs = 5000): Promise<string> {
  const s = await connect(host, port);
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let idle: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(idle);
      clearTimeout(total);
      s.destroy();
      resolve(Buffer.concat(chunks).toString("latin1"));
    };
    const total = setTimeout(done, totalMs);
    s.on("data", (d: Buffer) => {
      chunks.push(d);
      clearTimeout(idle);
      idle = setTimeout(done, idleMs);
    });
    s.on("error", done);
    s.on("close", done);
    s.write(cmd);
  });
}

function stxGroups(raw: string): string[][] {
  const out: string[][] = [];
  const re = /\x02([^\x03]*)\x03/g;
  let m;
  while ((m = re.exec(raw))) out.push(m[1].split(","));
  return out;
}

export function parseHostStatus(raw: string): PrinterStatus {
  const g = stxGroups(raw);
  if (g.length < 2) return { ok: false, reachable: true, error: "Keine gültige ~HS-Antwort", raw };
  const [a, b] = g;
  const flag = (v?: string) => v?.trim() === "1";
  const paperOut = flag(a[1]);
  const paused = flag(a[2]);
  const headOpen = flag(b[2]);
  const ribbonOut = flag(b[3]);
  return {
    ok: !paperOut && !paused && !headOpen && !ribbonOut,
    reachable: true,
    paperOut,
    paused,
    headOpen,
    ribbonOut,
    thermalTransfer: flag(b[4]),
    formatsInBuffer: Number(a[4]) || 0,
    labelsRemaining: Number(b[8]) || 0,
    raw,
  };
}

export async function status(host: string, port: number): Promise<PrinterStatus> {
  try {
    const raw = await query(host, port, "~HS\r\n", 400, 3000);
    if (!raw) return { ok: false, reachable: true, error: "Drucker antwortet nicht auf ~HS" };
    return parseHostStatus(raw);
  } catch (e: any) {
    return { ok: false, reachable: false, error: e.message };
  }
}

export function parseProbe(hi: string, hh: string): ProbeResult {
  const r: ProbeResult = { ok: true, raw: (hi + "\n" + hh).replace(/[\x02\x03]/g, "").trim() };
  const g = stxGroups(hi)[0];
  if (g) {
    r.model = g[0]?.trim();
    r.firmware = g[1]?.trim();
    const dpi = /(\d{3})\s*dpi/i.exec(g[0] || "");
    if (dpi) r.dpi = Number(dpi[1]);
  }
  const pw = /(\d+)\s+(?:PRINT WIDTH|DRUCKBREITE)/i.exec(hh);
  if (pw) r.printWidthDots = Number(pw[1]);
  const ll = /(\d+)\s+(?:LABEL LENGTH|ETIKETTENL[ÄA]NGE)/i.exec(hh);
  if (ll) r.labelLengthDots = Number(ll[1]);
  if (!r.dpi) {
    const res = /(\d{3})\s*(?:DPI|dots\/in)/i.exec(hh);
    if (res) r.dpi = Number(res[1]);
    else {
      const dpmm = /(\d+)\s*(?:DOTS\/MM|dpmm)/i.exec(hh);
      if (dpmm) r.dpi = { 6: 152, 8: 203, 12: 300, 24: 600 }[Number(dpmm[1])] ?? undefined;
    }
  }
  return r;
}

async function probeOnce(host: string, port: number): Promise<ProbeResult> {
  const hi = await query(host, port, "~HI\r\n", 400, 3000);
  let hh = "";
  try {
    hh = await query(host, port, "^XA^HH^XZ\r\n", 800, 6000);
  } catch {}
  if (!hi && !hh)
    return {
      ok: false,
      port,
      error: `Verbunden mit ${host}:${port}, aber keine Antwort auf ~HI/^HH. Vermutlich kein Zebra-Drucker oder ZPL-Emulation ohne Statusabfrage. Drucken kann trotzdem funktionieren – Testetikett versuchen.`,
    };
  return { ...parseProbe(hi, hh), port };
}

/** Fragt den Drucker ab. Lehnt der eingetragene Port ab, werden die übrigen Standardports probiert. */
export async function probe(host: string, port: number): Promise<ProbeResult> {
  try {
    return await probeOnce(host, port);
  } catch (e: any) {
    if (e?.code !== "ECONNREFUSED") return { ok: false, error: e.message };
    const tried = [port];
    for (const alt of RAW_PORTS.filter((p) => p !== port)) {
      tried.push(alt);
      try {
        return await probeOnce(host, alt);
      } catch (e2: any) {
        if (e2?.code !== "ECONNREFUSED") return { ok: false, error: e2.message };
      }
    }
    return {
      ok: false,
      error: `${host} ist erreichbar, lehnt aber alle Rohdruck-Ports ab (${tried.join(", ")}). Am Drucker Rohdruck/Raw-IP aktivieren bzw. den konfigurierten Port nachsehen (Weboberfläche http://${host} oder Konfigurationsausdruck). Bei Nicht-Zebra-Druckern (z. B. cab): ZPL-Emulation einschalten.`,
    };
  }
}
