#!/usr/bin/env python3
"""Corre el extractor sobre el set (datos/casos.jsonl) y guarda cada respuesta, para calificar.py.

  python -X utf8 backend/evals/actas_buena_pro/correr.py --etiqueta haiku-medio
  python -X utf8 backend/evals/actas_buena_pro/correr.py --etiqueta haiku-bajo --esfuerzo low

Sale en datos/corridas/<etiqueta>/:
  results.jsonl  una fila por caso que dio respuesta (ok, truncada por max_tokens, rechazo o JSON inválido), con el modelo
                 que respondió, los tokens y el costo de esos tokens
  errors.jsonl   lo que no llegó a respuesta (red, límite, tiempo): no cuenta como error del modelo
Se puede cortar y volver a correr: salta los casos que ya están en results.jsonl.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from comun import CASOS, DATOS, ESQUEMA, SISTEMA, cliente_claude, costo_usd, mensajes  # noqa: E402

TECHO_S = 420          # tiempo máximo por caso, aparte del de la conexión


def correr_caso(claude, caso: dict, modelo: str, esfuerzo: str) -> dict:
    t0 = time.time()
    r = claude.messages.create(
        model=modelo, max_tokens=16000, system=SISTEMA,
        messages=mensajes([DATOS / p for p in caso["pdfs"]]),
        output_config={"effort": esfuerzo, "format": {"type": "json_schema", "schema": ESQUEMA}})
    u = r.usage
    fila = {"id": caso["id"], "tags": caso["tags"], "modelo": r.model, "esfuerzo": esfuerzo, "stop_reason": r.stop_reason,
            "tokens_in": u.input_tokens, "tokens_out": u.output_tokens,
            "costo_usd": round(costo_usd(r.model, u.input_tokens, u.output_tokens), 6),
            "costo_lote_usd": round(costo_usd(r.model, u.input_tokens, u.output_tokens, lote=True), 6),
            "segundos": round(time.time() - t0, 1)}
    if r.stop_reason == "refusal":
        return {**fila, "status": "rechazo", "detalle": str(getattr(r, "stop_details", ""))[:300], "salida": None}
    texto = next((b.text for b in r.content if b.type == "text"), "")
    if r.stop_reason == "max_tokens":
        return {**fila, "status": "truncada", "salida": None}
    try:
        return {**fila, "status": "ok", "salida": json.loads(texto)}
    except json.JSONDecodeError:
        return {**fila, "status": "json_invalido", "salida": None, "texto": texto[:500]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--etiqueta", required=True)
    ap.add_argument("--modelo", default="claude-haiku-5-5")
    ap.add_argument("--esfuerzo", default="medium", choices=["low", "medium", "high"])
    ap.add_argument("--hilos", type=int, default=6)
    ap.add_argument("--limite", type=int, default=0, help="sólo los primeros N casos (0 = todos)")
    a = ap.parse_args()

    casos = [json.loads(l) for l in CASOS.read_text(encoding="utf-8").splitlines() if l.strip()]
    if a.limite:
        casos = casos[: a.limite]
    salida = DATOS / "corridas" / a.etiqueta
    salida.mkdir(parents=True, exist_ok=True)
    resultados, errores = salida / "results.jsonl", salida / "errors.jsonl"
    hechos = {json.loads(l)["id"] for l in resultados.read_text(encoding="utf-8").splitlines() if l.strip()} \
        if resultados.exists() else set()
    pendientes = [c for c in casos if c["id"] not in hechos]
    print(f"{a.etiqueta}: {len(pendientes)} pendientes de {len(casos)} ({a.modelo}, esfuerzo {a.esfuerzo})", flush=True)

    claude = cliente_claude()
    candado = threading.Lock()
    gastado = 0.0

    def anotar(archivo: Path, fila: dict) -> None:
        with candado, archivo.open("a", encoding="utf-8") as f:
            f.write(json.dumps(fila, ensure_ascii=False) + "\n")

    with ThreadPoolExecutor(max_workers=a.hilos) as pool:
        futuros = {pool.submit(correr_caso, claude, c, a.modelo, a.esfuerzo): c for c in pendientes}
        for fut in as_completed(futuros):
            caso = futuros[fut]
            try:
                fila = fut.result(timeout=TECHO_S)
            except Exception as e:  # noqa: BLE001 — sin respuesta: va a errors.jsonl, no se califica
                anotar(errores, {"id": caso["id"], "clase": type(e).__name__, "detalle": str(e)[:400]})
                print(f"  {caso['id']}: ERROR {type(e).__name__}: {str(e)[:120]}", flush=True)
                continue
            anotar(resultados, fila)
            gastado += fila["costo_usd"]
            s = fila.get("salida") or {}
            print(f"  {caso['id']}: {fila['status']} {fila['tokens_in']}+{fila['tokens_out']} tok USD {fila['costo_usd']:.4f} "
                  f"{fila['segundos']} s | postores {len(s.get('postores') or [])} | acumulado USD {gastado:.3f}", flush=True)
    print(f"FIN {a.etiqueta}: USD {gastado:.3f}", flush=True)


if __name__ == "__main__":
    main()
