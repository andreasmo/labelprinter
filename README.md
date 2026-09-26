# zplPrinter

> Print PDFs, images and simple/serial labels on Zebra network printers (ZPL over TCP) – no drivers, no USB, runs fully local. UI is German.

Mit zplPrinter druckst du PDFs, Bilder und einfache Etiketten auf **Zebra-Netzwerkdrucker**. Die Aufträge gehen als ZPL per TCP an Port 6101 (Standard, alternativ 9100). Du brauchst weder USB noch Treiber oder Herstellersoftware. Das Tool funktioniert ähnlich wie der PDF-zu-ZPL-Konverter von Labelzoom, läuft aber komplett lokal.

```
Browser (die gesamte Logik in TypeScript)                  zplPrinter.exe / Docker (dünn)
┌────────────────────────────────────────────┐   HTTP    ┌──────────────────────────────┐   TCP 6101   ┌────────┐
│ PDF → pdf.js · Bild → Canvas · Designer     │ ───────► │ settings.json lesen/schreiben │ ──────────► │ Zebra  │
│ Zuschnitt, Skalierung, Drehung, Dithering   │  ZPL     │ ZPL an Drucker weiterreichen  │  ~HS / ~HI  │        │
│ ^GFA-Kodierung (ACS / Z64)                  │ ◄─────── │ Status / Erkennung            │ ◄────────── │        │
└────────────────────────────────────────────┘           └──────────────────────────────┘              └────────┘
```

Das Backend liefert nur die Weboberfläche aus, speichert die Einstellungen und reicht Bytes an den Drucker durch. Die gesamte Bildverarbeitung läuft im Browser. Deshalb funktioniert dieselbe Oberfläche lokal genauso wie gehostet.

## Schnellstart (Windows, lokal)

1. Doppelklick auf `zplPrinter.exe`. Du brauchst keine Installation und keine Admin-Rechte.
2. Der Browser öffnet `http://127.0.0.1:8910`. Das Konsolenfenster zeigt Adresse, Speicherort und Druckprotokoll.
3. Lege unter **Drucker** einen logischen Drucker an: IP-Adresse eintragen und **Erkennen** klicken. Damit werden Auflösung und Etikettengröße vom Drucker abgefragt. Danach **Speichern** und **Testetikett** drucken.
4. Schließt du das Konsolenfenster, beendet sich das Programm. Startest du es ein zweites Mal, öffnet sich nur der Browser.

Beim ersten Start einer unsignierten Exe zeigt Windows SmartScreen eventuell „Der Computer wurde durch Windows geschützt“. Klicke auf *Weitere Informationen* und dann auf *Trotzdem ausführen*.

### Wo liegen die Einstellungen?

Die Einstellungsdatei wird in dieser Reihenfolge gesucht:

| Reihenfolge | Ort |
|---|---|
| 1 | `--data-dir <Ordner>` oder Umgebungsvariable `ZPL_DATA_DIR` |
| 2 | **Portabel:** `settings.json` im selben Ordner wie die Exe, sofern sie existiert. Eine leere Datei mit `{}` genügt. |
| 3 | `%APPDATA%\zplPrinter\settings.json`, unter Linux `~/.config/zplprinter/settings.json` |

Die Datei ist lesbares JSON und enthält die logischen Drucker und Designer-Vorlagen. Beim ersten Speichern pro Start legt das Programm eine Sicherung `settings.json.bak` an.

### Kommandozeile

```
zplPrinter.exe [--port 8910] [--host 127.0.0.1] [--data-dir D:\etiketten] [--no-browser] [--server] [--readonly]
```

- `--server` bindet an `0.0.0.0`, damit andere Rechner im Netz zugreifen können, und öffnet keinen Browser. Windows fragt dann einmal nach einer Firewall-Freigabe.
- `--readonly` sperrt die Einstellungen. Die Druckerliste lässt sich dann nur noch über die `settings.json` pflegen.

## Gehostet (Docker)

```bash
docker compose up -d --build        # → http://server:8910
```

Die Einstellungen liegen im Volume `/data`. Mit `ZPL_READONLY=1` können Nutzer nur drucken und nichts konfigurieren. Der Server muss die Drucker auf ihrem Rohdruck-Port (Standard 6101, alternativ 9100) erreichen können.

## Funktionen

**Datei drucken**
- PDF mit mehreren Seiten (Auswahl per Miniaturansicht), PNG, JPG, GIF, BMP, WebP, SVG und Einfügen aus der Zwischenablage mit Strg+V. `.zpl`- und `.prn`-Dateien landen direkt im ZPL-Tab.
- Drei Ausschnitt-Modi:
  - **Ganze Seite**
  - **Automatisch**: Weißrand wird entfernt
  - **Manuell**: Du ziehst einen Bereich auf, z. B. bei A4-Seiten mit dem Etikett in einer Ecke. Der Bereich gilt für alle Seiten.
- Vier Skalierungen:
  - **Einpassen**
  - **Füllen**
  - **Strecken**
  - **1:1**: PDFs in Originalgröße, bei Bildern entspricht 1 Pixel einem Druckpunkt
- Drehung automatisch oder in 90°-Schritten, dazu Rand und Position.
- Schwarz-Weiß-Umsetzung: **Schwelle** (am schärfsten für Text und Barcodes), **Floyd-Steinberg**, **Atkinson** oder **Raster** (für Fotos). Außerdem Helligkeit und Invertieren.
- Pixelgenaue Vorschau in Druckerauflösung.

**Designer (bewusst einfach)**
- Text mit Windows-Schriften, Umbruch, fett, kursiv und weiß auf schwarz.
- Barcodes: Code 128, GS1-128, Code 39, EAN-13, 2/5 Interleaved, QR und DataMatrix. Die Modulbreite ist ganzzahlig in Druckpunkten, dadurch werden die Barcodes pixelgenau und bleiben scannbar.
- Rahmen und Linien, Bilder mit eigener Dithering-Einstellung.
- Elemente per Maus verschieben (Raster 0,5 mm, mit Alt 0,1 mm), mit Pfeiltasten bewegen und mit Entf löschen.
- Vorlagen werden in der `settings.json` gespeichert, auf Wunsch mit Seriendaten.
- Komplexe Layouts gestaltest du besser außerhalb und druckst sie als PDF oder PNG.

**Serienetiketten (Designer → „Serie“)**
- Tabelle aus Excel oder Calc **mit Kopfzeile** kopieren und mit Strg+V einfügen. Alternativ eine CSV laden (`;`, `,` oder Tab) oder die Tabelle direkt im Raster bearbeiten. Einfügen ab einer Zelle erweitert die Tabelle.
- Die Spaltennamen werden zu Variablen: `{{Charge}}` in Text oder Barcode-Inhalt, Groß- und Kleinschreibung egal. Per Klick lassen sich die Variablen einfügen.
- Eingebaute Variablen: `{{_nr}}` (laufende Nummer), `{{_datum}}`, `{{_zeit}}`.
- Zeilen per Häkchen auswählen. Die Vorschau blättert durch die Zeilen (Pfeile oder Klick auf eine Zeilennummer).
- **Anzahl pro Zeile** aus einer Spalte, zum Beispiel „Anzahl“, das wird automatisch erkannt. 0 überspringt die Zeile. Ohne Anzahl-Spalte gilt das Kopien-Feld je Zeile.
- Vor dem Senden wird jede Zeile geprüft. Bei einer unbekannten Variable oder einem ungültigen Barcode (z. B. Buchstaben im EAN-13) wird **nichts** gedruckt, und die betroffenen Zeilen werden angezeigt.
- Ist ein Wert leer, wird das Element auf diesem Etikett ausgelassen.

**ZPL**
- Roh-ZPL laden, bearbeiten, speichern und unverändert senden. Die Datei- und Designer-Tabs zeigen den erzeugten Code auf Wunsch hier an.

**Drucker (logische Drucker)**
- Ein logischer Drucker besteht aus IP und Port, Etikettenformat, Auflösung, Label Shift (`^LS`), Label Top (`^LT`), Schwärzung (`~SD`), Geschwindigkeit (`^PR`), Druckverfahren (`^MT`), 180°-Drehung (`^POI`) und Grafik-Kompression.
- Für mehrere Etikettenformate am selben Drucker duplizierst du den Eintrag einfach.
- Weitere Funktionen: Erkennen (`~HI`, `^HH`), Status (`~HS`), Testetikett mit mm-Skala zum Justieren und Kalibrieren (`~JC`).

### Justage in 1 Minute

1. Drucke das **Testetikett**. Es enthält einen Rahmen am Etikettenrand, ein Fadenkreuz und alle 5 mm Striche.
2. Lies ab, um wie viele Millimeter der Rahmen verschoben ist. Rechne mit Druckpunkten pro mm: 8 bei 203 dpi, 12 bei 300 dpi.
3. Stelle den Wert unter **Label Shift** (horizontal, positiv = nach links) bzw. **Label Top** (vertikal, positiv = nach unten) ein und drucke erneut.

## Entwicklung

Voraussetzung ist Node 22 oder neuer. Bun wird als npm-Abhängigkeit mitinstalliert.

```bash
npm ci
npm run dev:server     # API auf :8910 (bun --watch)
npm run dev:web        # Vite auf :5173, leitet /api weiter
npm test               # Encoder-/Dithering-Tests (bun test)
npm run typecheck
```

### Bauen

```bash
npm run build          # dist/web + dist/server.js (Node-Bundle mit eingebetteter Oberfläche)
npm run build:exe      # dist/zplPrinter.exe (Windows x64, Single-File, ~90 MB)
npm run build:exe-linux
```

Die Exe entsteht per Cross-Compile mit `bun build --compile` und lässt sich auf Linux, Mac und Windows bauen. Die Weboberfläche mit pdf.js, Schriften und WASM-Decodern wird gzip-komprimiert in die Exe eingebettet, dadurch funktioniert alles offline.

### Testen ohne Drucker

```bash
bun tests/fake-printer.ts 9191 /tmp/mitschnitt.zpl   # Fake-Zebra: nimmt Aufträge an, antwortet auf ~HS/~HI/^HH
# Drucker mit IP 127.0.0.1, Port 9191 anlegen und drucken …
python3 tests/verify_zpl.py /tmp/mitschnitt.zpl       # ^GFA unabhängig dekodieren → test-results/*.png
npm run test:ui                                       # Playwright-Durchlauf mit Screenshots (npm i -D playwright)
```

## Sicherheit

- Im lokalen Modus bindet der Server nur an `127.0.0.1` und akzeptiert ausschließlich den `Host` localhost. Das schützt vor DNS-Rebinding.
- Schreibende API-Aufrufe brauchen den Header `X-ZPL-Client: 1` und einen passenden `Origin`. Fremde Webseiten können deshalb keine Druckaufträge an den lokalen Dienst schicken.
- Gedruckt wird nur über gespeicherte Drucker-IDs. Die API ist also kein offenes TCP-Relay. Einzige Ausnahme ist „Erkennen“, das im Readonly-Modus gesperrt ist.
- Im Server-Modus gibt es noch **keine Anmeldung**. Betreibe ihn nur im internen Netz, notfalls hinter einem Reverse Proxy mit Anmeldung.

## Grenzen und Ideen für später

- Z64 ist kompakter, setzt aber neuere Firmware voraus. ACS läuft überall und ist voreingestellt.
- „Automatisch“ schneidet auf den gesamten Inhalt zu. Steht auf der Seite noch Hinweistext, nimm „Manuell“.
- Mögliche Erweiterungen:
  - Vorschau für Roh-ZPL
  - Anmeldung und Druckprotokoll im Server-Modus
  - Tray-Icon statt Konsolenfenster

## Lizenz

[MIT](LICENSE). Verwendete Bibliotheken: [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0), [bwip-js](https://github.com/metafloor/bwip-js) (MIT), [Preact](https://github.com/preactjs/preact) (MIT).

Zebra und ZPL sind Marken der Zebra Technologies Corp. Dieses Projekt steht in keiner Verbindung zu Zebra.
