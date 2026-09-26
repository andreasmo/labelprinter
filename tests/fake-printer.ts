// Fake-Zebra für Tests: nimmt Aufträge auf Port 9100-ähnlichem Socket an und beantwortet ~HS / ~HI / ^HH.
import { createServer } from "node:net";
import { writeFileSync, appendFileSync } from "node:fs";

const port = Number(process.argv[2] || 9191);
const out = process.argv[3] || "/tmp/fake-printer.zpl";
writeFileSync(out, "");
createServer((s) => {
  s.on("data", (d) => {
    const t = d.toString("latin1");
    if (t.includes("~HS")) s.write("\x02030,0,0,0406,000,0,0,0,000,0,0,0\x03\r\n\x02001,0,0,0,1,2,6,0,00000000,1,000\x03\r\n\x021234,0\x03\r\n");
    else if (t.includes("~HI")) s.write("\x02ZD421-300dpi,V93.21.26Z,12,8176KB\x03\r\n");
    else if (t.includes("^HH")) s.write("\x02  PRINTER CONFIGURATION\r\n    1248 PRINT WIDTH\r\n    1218 LABEL LENGTH\r\n\x03\r\n");
    else appendFileSync(out, d);
  });
  s.on("error", () => {});
}).listen(port, "127.0.0.1", () => console.log("fake printer on", port));
