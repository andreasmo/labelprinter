import { chromium } from "playwright";
const URL = process.env.ZPL_URL || "http://127.0.0.1:8910/";
const CHROME = process.env.CHROME || undefined;
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") logs.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => logs.push("PAGEERROR: " + e.message));
const step = process.argv[2] || "all";
await page.goto(URL);
await page.waitForTimeout(800);
await page.screenshot({ path: "test-results/01-start.png" });

// Datei: A4-PDF mit Versandetikett
await page.selectOption(".printer-pick select", "versand");
await page.click("text=Datei drucken");
await page.setInputFiles(".file-tab input[type=file]", "tests/samples/versand-a4.pdf");
await page.waitForTimeout(2500);
await page.screenshot({ path: "test-results/02-pdf-full.png" });
await page.click("button:has-text('Automatisch')");
await page.waitForTimeout(2500);
await page.screenshot({ path: "test-results/03-pdf-auto.png" });
await page.click("button:has-text('2 Seiten drucken')");
await page.waitForTimeout(3000);
await page.screenshot({ path: "test-results/04-printed.png" });

// Rohstoff-Drucker + etikettengroßes PDF
await page.selectOption(".printer-pick select", "rohstoff");
await page.click("button:has-text('Andere Datei')");
await page.setInputFiles(".file-tab input[type=file]", "tests/samples/etikett-100x50.pdf");
await page.click("button:has-text('Ganze Seite')");
await page.waitForTimeout(2000);
await page.screenshot({ path: "test-results/05-label-pdf.png" });

// Foto mit Dithering + manueller Ausschnitt
await page.setInputFiles(".file-tab input[type=file]", "tests/samples/foto.png");
await page.click("button:has-text('Floyd-St.')");
await page.click("button:has-text('Manuell')");
const box = await page.locator(".crop-box").boundingBox();
await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.05);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.6, { steps: 5 });
await page.mouse.up();
await page.waitForTimeout(1500);
await page.screenshot({ path: "test-results/06-foto-crop.png" });
await page.click("button:has-text('Schwelle')");
await page.click("button:has-text('Ganze Seite')");

// Designer
await page.click("nav >> text=Designer");
await page.waitForTimeout(1500);
await page.screenshot({ path: "test-results/07-designer.png" });
await page.click("button:has-text('Barcode')");
await page.selectOption(".props select >> nth=1", "qrcode");
await page.waitForTimeout(800);
await page.screenshot({ path: "test-results/08-designer-qr.png" });
await page.click(".designer-tab button:has-text('Drucken')");
await page.waitForTimeout(1500);

// ZPL-Tab
await page.click("nav >> text=ZPL");
await page.click("button:has-text('Testetikett einfügen')");
await page.waitForTimeout(300);
await page.screenshot({ path: "test-results/09-zpl.png" });

// Drucker
await page.click("nav >> text=Drucker");
await page.waitForTimeout(500);
await page.click("button:has-text('Erkennen')");
await page.waitForTimeout(2000);
await page.screenshot({ path: "test-results/10-printers.png" });
await page.click("button:has-text('Status')");
await page.waitForTimeout(1500);
await page.screenshot({ path: "test-results/11-printers-status.png", fullPage: true });

// Dark mode + schmal
await page.emulateMedia({ colorScheme: "dark" });
await page.click("nav >> text=Datei drucken");
await page.waitForTimeout(800);
await page.screenshot({ path: "test-results/12-dark.png" });
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(500);
await page.screenshot({ path: "test-results/13-mobile.png", fullPage: true });
console.log(logs.join("\n") || "keine Konsolenfehler");
await browser.close();
