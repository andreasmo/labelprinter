# Unabhängige Prüfung: ^GFA-Grafiken aus einer ZPL-Datei nach der Dekodierlogik von zplgrf (+ '!') auspacken und als PNG speichern.
# Aufruf: python3 tests/verify_zpl.py mitschnitt.zpl  (benötigt Pillow)
import re, sys, binascii, base64, zlib
from PIL import Image

def _calculate_crc_ccitt(data):  # CRC-16/XMODEM wie in zplgrf
    crc = 0
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc
RE_COMPRESSED = re.compile(r'[G-Zg-z]+.')
zpl = open(sys.argv[1], encoding="latin1").read()
for n, m in enumerate(re.finditer(r"\^GFA,(\d+),(\d+),(\d+),([^\^]*)", zpl)):
    total, bpr, data = int(m.group(1)), int(m.group(3)), m.group(4).strip()
    if data.startswith(":Z64:"):
        b64, crc = data[5:-5], data[-4:]
        assert crc.upper() == "%04X" % _calculate_crc_ccitt(b64.encode()), "CRC"
        raw = zlib.decompress(base64.b64decode(b64))
    else:
        for comp in sorted(set(RE_COMPRESSED.findall(data)), reverse=True):
            rep = 0
            for i in comp[:-1]:
                v = ord(i.upper()) - 70
                rep += v * 20 if i.islower() else v
            data = data.replace(comp, comp[-1] * rep)
        rows, row = [], ""
        for c in data:
            if c == ":": rows.append(rows[-1]); continue
            elif c == ",": row = row.ljust(bpr * 2, "0")
            elif c == "!": row = row.ljust(bpr * 2, "F")
            else: row += c
            if len(row) == bpr * 2: rows.append(binascii.unhexlify(row)); row = ""
        raw = b"".join(rows)
    assert len(raw) == total, (len(raw), total)
    h = total // bpr
    img = Image.frombytes("1", (bpr * 8, h), bytes(b ^ 0xFF for b in raw))
    out = f"test-results/decoded-{n}.png"; img.save(out)
    print(out, bpr * 8, "x", h, "Bytes", total, "Daten", len(m.group(4)))
