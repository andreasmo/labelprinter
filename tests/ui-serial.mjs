// Playwright-Durchlauf Serienetiketten: Tabelle einfügen, Variablen, Anzahl-Spalte, Zeile abwählen, drucken.
import { chromium } from "playwright";
const URL = process.env.ZPL_URL || "http://127.0.0.1:8910/";
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const logs = [];
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));
page.on("console", (m) => m.type() === "error" && logs.push(m.text()));
await page.goto(URL);
await page.click("nav >> text=Designer");
await page.click("button:has-text('Serie')");
const tsv = "Material\tCharge\tMenge\tAnzahl\nEPDM 70 Shore A\t2026-0924-01\t25,0 kg\t2\nNBR 80\t2026-0924-02\t12,5 kg\t1\nFKM 75\t2026-0924-03\t5,0 kg\t3\n";
await page.locator(".paste-target").evaluate((el, text) => {
  const dt = new DataTransfer();
  dt.setData("text/plain", text);
  el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, tsv);
await page.waitForTimeout(500);
// Elemente auf Variablen umstellen (Starter-Etikett: Text, Text, Barcode)
await page.click(".layers li >> nth=0");
await page.fill(".props textarea", "{{Material}}");
await page.click(".layers li >> nth=1");
await page.fill(".props textarea", "Charge: {{Charge}}\nMenge: {{Menge}} · {{_datum}}");
await page.click(".layers li >> nth=2");
await page.fill(".props label.field:has-text('Inhalt') input", "");
await page.click(".var-chips button:has-text('Charge')");
await page.waitForTimeout(800);
await page.screenshot({ path: "test-results/20-serie.png" });
// Zeile 2 abwählen, nächste Zeile in Vorschau
await page.locator(".grid tbody tr >> nth=1").locator("input[type=checkbox]").uncheck();
await page.click(".serial-nav button >> nth=1");
await page.click(".serial-nav button >> nth=1");
await page.waitForTimeout(600);
await page.screenshot({ path: "test-results/21-serie-zeile3.png" });
const label = await page.locator(".designer-tab .print-bar .btn.primary").innerText();
console.log("Button:", label);
await page.click(".designer-tab .print-bar .btn.primary");
await page.waitForTimeout(2500);
// Fehlerfall: ungültiger EAN-13 in Zeile → darf nicht gedruckt werden
await page.selectOption(".props label.field:has-text('Typ') select", "ean13");
await page.waitForTimeout(600);
await page.click(".designer-tab .print-bar .btn.primary");
await page.waitForTimeout(1200);
console.log("Toast:", await page.locator(".toast-err").last().innerText().catch(() => "-"));
await page.selectOption(".props label.field:has-text('Typ') select", "code128");
// Vorlage mit Daten speichern und neu laden
await page.fill(".tpl-name", "Rohstoff-Serie");
await page.click("button:has-text('Speichern')");
await page.waitForTimeout(800);
console.log(logs.join("\n") || "keine Konsolenfehler");
await browser.close();
