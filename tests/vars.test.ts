import { expect, test } from "bun:test";
import { applyVars, pasteBlock, parseDelimited, qtyOf, rowVars, tableFromText, toCsv } from "../web/src/lib/vars";

test("Variablen ersetzen, case-insensitiv, fehlende melden", () => {
  const r = applyVars("Charge {{Charge}} / {{ menge }} kg {{fehlt}}", { Charge: "A1", Menge: "25" });
  expect(r.text).toBe("Charge A1 / 25 kg ");
  expect(r.missing).toEqual(["fehlt"]);
});

test("Excel-Kopie (Tab, Anführungszeichen, Zeilenumbruch in Zelle)", () => {
  const t = tableFromText('Material\tCharge\tAnzahl\r\nEPDM 70\t"A-1\nB"\t2\r\nNBR\tC-3\t\r\n');
  expect(t.columns).toEqual(["Material", "Charge", "Anzahl"]);
  expect(t.rows).toEqual([["EPDM 70", "A-1\nB", "2"], ["NBR", "C-3", ""]]);
  expect(rowVars(t, 1, new Date(2026, 8, 24, 9, 5))).toMatchObject({ Material: "NBR", _nr: "2", _datum: "24.09.2026", _zeit: "09:05" });
  expect(qtyOf(t, 0, "Anzahl", 1)).toBe(2);
  expect(qtyOf(t, 1, "Anzahl", 1)).toBe(1);
});

test("CSV mit Semikolon und doppelten Anführungszeichen", () => {
  expect(parseDelimited('a;b\n"x;""y""";z')).toEqual([["a", "b"], ['x;"y"', "z"]]);
  const t = tableFromText("a;b\n1;2");
  expect(tableFromText(toCsv(t))).toEqual(t);
});

test("Block einfügen vergrößert Tabelle", () => {
  const t = pasteBlock({ columns: ["A"], rows: [["1"]] }, "x\ty\nz\tw", 1, 0);
  expect(t.columns).toEqual(["A", "Spalte2"]);
  expect(t.rows).toEqual([["1", ""], ["x", "y"], ["z", "w"]]);
});
