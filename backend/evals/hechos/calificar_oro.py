"""Califica la lectura con modelo de un tipo de documento contra su verdad escrita a mano (el conjunto de oro de
extracción, plan del 2026-11-16, fase 5).

La verdad la escribe quien lee el documento entero, a ciegas de la lectura del modelo (la primera tanda, 2026-11-18:
garantías). Cada dato de la verdad es un valor, null (el documento no lo trae) o "no_visto" (no se puntúa). Se puntúa por
dato: acierto, error (dio otro valor), omisión (no lo dio y estaba) e invento (lo dio y el documento no lo trae).

  python -X utf8 backend/evals/hechos/calificar_oro.py <verdad.json> <modelo.json>

`modelo.json`: {pieza_id: {"salida": <salida del lector en pieza_lectura>, ...}} (lo arma la muestra). Sin red ni base.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path


def plano(s: object) -> str:
    t = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().upper()
    return re.sub(r"[^A-Z0-9]+", " ", t).strip()


def valor(x: object) -> object:
    """Los datos citados vienen como {valor, pagina, cita}; el emisor y el afianzado, como {nombre, ruc}; la decisión de una
    modificación, como {sentido, pagina, cita}."""
    if isinstance(x, dict):
        for k in ("valor", "nombre", "sentido"):
            if k in x:
                return x[k]
        return None
    return x


def mismo(campo: str, verdad: object, dado: object) -> bool:
    if campo == "monto":
        try:
            return abs(float(dado) - float(verdad)) <= max(0.01, 0.005 * float(verdad))
        except (TypeError, ValueError):
            return False
    if campo in ("fecha_emision", "vigencia_hasta"):
        return str(dado or "")[:10] == str(verdad)
    if campo in ("es_renovacion", "es_del_tipo"):
        return bool(dado) == bool(verdad)
    if campo.endswith("_pct"):
        try:
            return abs(float(dado) - float(verdad)) <= 0.1
        except (TypeError, ValueError):
            return False
    if campo == "modificacion":
        def clase_mod(x: str) -> str:
            return next((k for k in ("ADICIONAL", "REDUCCION", "AMPLIACION", "DEDUCTIVO") if k in x), x)
        return clase_mod(plano(verdad)) == clase_mod(plano(dado))
    if campo == "decision":
        def clase_dec(x: str) -> str:
            if re.search(r"IMPROCEDENTE|DENEG|DENIEG|NO PROCEDE|RECHAZ|INFUNDAD", x):
                return "DENEGADA"
            return "APROBADA" if re.search(r"APROB|APRUEB|PROCEDENTE|OTORGA|FUNDAD", x) else x
        return clase_dec(plano(verdad)) == clase_dec(plano(dado))
    if campo == "numero":
        # El número tal como está, sin separadores; la verdad puede ser una parte (los PDF le pegan códigos de control).
        a, b = re.sub(r"[^0-9A-Z]", "", plano(verdad)), re.sub(r"[^0-9A-Z]", "", plano(dado))
        return bool(a) and a in b
    if campo == "tipo":
        v, d = plano(verdad), plano(dado)
        return v.split()[0] in d or d.split()[0] in v if v and d else False
    if campo == "garantiza":
        # Por clase: prestaciones accesorias, fiel cumplimiento, adelanto o seriedad de la oferta.
        def clase(x: str) -> str:
            return next((k for k in ("ACCESORIA", "ADELANTO", "SERIEDAD", "CUMPLIMIENTO") if k in x), x)
        return clase(plano(verdad)) == clase(plano(dado))
    if campo == "afianzado" and verdad == "persona natural":
        # Una persona natural no se guarda con nombre: basta que no ponga una empresa.
        return dado is None or not re.search(r"\b(S A C|SAC|E I R L|EIRL|S R L|SRL|CONSORCIO|S A)\b", plano(dado))
    # Nombres: la verdad (o su parte distintiva) contenida en lo que dio.
    return plano(verdad) in plano(dado)


def calificar(verdad: dict, modelo: dict) -> dict:
    por_campo: dict[str, Counter] = defaultdict(Counter)
    errores: list[str] = []
    for pid, v in verdad.items():
        if pid.startswith("_"):
            continue
        m = modelo.get(pid)
        if m is None:
            continue
        salida = m["salida"]
        salida = json.loads(salida) if isinstance(salida, str) else (salida or {})
        for campo, esperado in v.items():
            if campo.startswith("_") or esperado == "no_visto":
                continue
            # Un documento que no es del tipo: sólo cuenta que el lector lo diga.
            if v.get("es_del_tipo") is False and campo != "es_del_tipo":
                continue
            dado = valor(salida.get(campo))
            if campo == "monto" and esperado is None and isinstance(dado, (int, float)) and dado == 0:
                dado = None
            if esperado is None:
                r = "acierto" if dado in (None, "", [], {}) else "invento"
            elif dado in (None, "", [], {}):
                r = "omision"
            else:
                r = "acierto" if mismo(campo, esperado, dado) else "error"
            por_campo[campo][r] += 1
            if r != "acierto":
                errores.append(f"{pid} {campo}: esperado {esperado!r}, dio {dado!r} ({r})")
    return {"por_campo": por_campo, "errores": errores}


def main() -> None:
    verdad = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    modelo = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    r = calificar(verdad, modelo)
    total = Counter()
    print(f"{'dato':16s} acierto error omisión invento  exactitud")
    for campo, c in sorted(r["por_campo"].items()):
        n = sum(c.values())
        total.update(c)
        print(f"{campo:16s} {c['acierto']:7d} {c['error']:5d} {c['omision']:7d} {c['invento']:7d}  {c['acierto'] / n:8.0%}")
    n = sum(total.values())
    print(f"{'TOTAL':16s} {total['acierto']:7d} {total['error']:5d} {total['omision']:7d} {total['invento']:7d}  {total['acierto'] / n:8.0%}")
    print("\nDiferencias:")
    for e in r["errores"]:
        print("  ", e)


if __name__ == "__main__":
    main()
