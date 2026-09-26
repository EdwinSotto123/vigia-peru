"""Lado Python de la prueba de paridad (scripts/paridad_eventos.ts): pasa cada stream NDJSON por el
mismo camino que backend/dispatcher/main.py — requests.iter_lines(decode_unicode=True), json.loads,
filtro de `kind`, events.reduce_event, state.update, main._evento y el tope de `eventos` del UPDATE —
con marcas de tiempo fijas (una por evento visible) para poder comparar al carácter.

    python scripts/paridad_eventos.py manifiesto.json   → JSON con el resultado de cada caso
"""
from __future__ import annotations

import datetime as dt
import io
import json
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(RAIZ))

import requests  # noqa: E402

from backend.dispatcher import main as disp  # noqa: E402
from backend.dispatcher.events import VISIBLES, reduce_event  # noqa: E402

BASE = dt.datetime(2026, 9, 26, tzinfo=dt.timezone.utc)


def marca(i: int) -> str:
    return (BASE + dt.timedelta(seconds=i)).isoformat(timespec="seconds")


def correr(datos: bytes, trozo: int, max_eventos: int) -> dict:
    r = requests.models.Response()
    r.raw = io.BytesIO(datos)
    r.status_code = 200
    r.headers["content-type"] = "application/x-ndjson; charset=utf-8"
    r.encoding = requests.utils.get_encoding_from_headers(r.headers)
    state: dict = {}
    eventos: list = []
    escrituras: list = []  # lo que `actualizar` escribe en cada evento: fase_actual, fase_index, error, fases
    resultado = disp.FAIL
    n = 0
    for line in r.iter_lines(chunk_size=trozo, decode_unicode=True):
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(ev, dict) or ev.get("kind") not in VISIBLES:
            continue
        ts = marca(n)
        n += 1
        cambios = reduce_event(state, ev, ts)
        state.update(cambios)
        escrituras.append({k: cambios[k] for k in ("fase_actual", "fase_index", "error", "fases") if k in cambios})
        if len(eventos) >= max_eventos:
            eventos = eventos[1:]
        eventos.append(disp._evento(ev, cambios, ts))
        if cambios.get("terminado"):
            resultado = disp.ABORT if cambios.get("abortado") else disp.OK
    # lo que queda en la fila: el JSON de `fases`/`eventos` pasa por jsonb (json.dumps → Postgres)
    return json.loads(json.dumps({"state": state, "eventos": eventos, "escrituras": escrituras, "resultado": resultado, "visibles": n}, default=str))


def main() -> int:
    manifiesto = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    salida = {c["nombre"]: correr(pathlib.Path(c["archivo"]).read_bytes(), c["trozo"], c["max_eventos"]) for c in manifiesto}
    sys.stdout.buffer.write(json.dumps(salida, ensure_ascii=True).encode("ascii"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
