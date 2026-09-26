"""Genera test/vectores_py.json: salidas de Python 3 (y de requests.iter_lines) que src/py.ts tiene
que reproducir. Se versiona el JSON; este script solo hace falta para regenerarlo:

    python scripts/vectores_py.py      (venv con requests)
"""
from __future__ import annotations

import io
import json
import pathlib

import requests

NL = chr(10)
CR = chr(13)
RAROS = [chr(c) for c in (0x0B, 0x0C, 0x1C, 0x1D, 0x1E, 0x85, 0x2028, 0x2029)]


def iter_lines(datos: bytes, trozo: int) -> list[str]:
    r = requests.models.Response()
    r.raw = io.BytesIO(datos)
    r.headers["content-type"] = "application/x-ndjson; charset=utf-8"
    r.encoding = "utf-8"
    return list(r.iter_lines(chunk_size=trozo, decode_unicode=True))


def main() -> None:
    textos = ["", "a", "a" + NL, "a" + NL + "b", "a" + CR + NL + "b" + CR + NL, NL + NL + "x", "a" + CR + CR + "b",
              "x" + RAROS[6] + "y", "fin" + RAROS[5], "".join(f"{r}{i}" for i, r in enumerate(RAROS)) + NL]
    splitlines = [{"entrada": t, "salida": t.splitlines()} for t in textos]

    evento = json.dumps({"kind": "phase", "name": "market", "msg": "precio ñandú €" + RAROS[6] + "fin 😀"}, ensure_ascii=False)
    stream = (NL.join([evento, '{"kind":"final","x":1}', "", "no json", evento]) + NL).encode("utf-8")
    stream_crlf = stream.replace(NL.encode(), (CR + NL).encode())
    lineas = [{"bytes": list(d), "trozo": n, "salida": iter_lines(d, n)}
              for d in (stream, stream_crlf, stream.rstrip(NL.encode())) for n in (1, 3, 7, 64, 100000)]

    valores = [None, True, False, 0, 7, -3, 1.5, 0.1, 1e-05, 1.5e-07, 1e16, 123.456, "texto", "con 'comilla'",
               "con \"dobles\" y 'simples'", "tab\tnl" + NL + "fin", "ctl" + chr(1) + chr(0x7F) + chr(0x85) + chr(0xA0),
               "ñandú 😀", [1, "a", None, [True]], {"k": "v", "n": 1, "l": [1.5, {"x": None}]}, [], {}]
    reprs = [{"valor": v, "str": str(v), "repr": repr(v)} for v in (json.loads(json.dumps(v)) for v in valores)]

    strips = [{"entrada": t, "salida": t.strip()} for t in
              ["  a  ", NL + " a" + CR, chr(0x1C) + "a" + chr(0x1F), chr(0x85) + "a", chr(0xFEFF) + "a", chr(0x3000) + "a" + chr(0xA0), ""]]
    cortes = [{"entrada": t, "n": n, "salida": t[:n]} for t in ["abc", "😀😀😀", "a😀b😀c", ""] for n in (0, 1, 2, 4)]

    salida = {"splitlines": splitlines, "iter_lines": lineas, "reprs": reprs, "strip": strips, "cortar": cortes}
    destino = pathlib.Path(__file__).resolve().parent.parent / "test" / "vectores_py.json"
    destino.write_text(json.dumps(salida, ensure_ascii=True, indent=1), encoding="utf-8")
    print(f"vectores: {destino}")


if __name__ == "__main__":
    main()
