#!/usr/bin/env python3
"""Línea base de la EXTRACCIÓN: cuánto aciertan hoy, dato por dato, el extractor genérico de los agentes y las lecturas
tipadas, contra la verdad escrita a mano de las pruebas de oro (`datos_clave` de cada caso: nadie la puntuaba).

No llama a ningún modelo: usa las corridas que ya existen (backend/scripts/ab_out/<corrida>/<variante>/<ocid>.json) y los
casos de ../vigia-golden.

  python -X utf8 backend/evals/hechos/linea_base.py ab_out/20261116-203101/servicios_abierto=../vigia-golden/redes/servicios/golden …
  python -X utf8 backend/evals/hechos/linea_base.py --ultimas          # la última corrida de cada red

Por cada dato y cada fuente dice: en cuántos casos había verdad, en cuántos la fuente dio un valor (cobertura), en cuántos
acertó y, de los que erró en la cuantía, cuántos pusieron ahí la experiencia exigida (el error del 2026-11-16).
Sólo imprime cuentas: ni nombres ni RUC.
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
AB_OUT = RAIZ / "backend" / "scripts" / "ab_out"
GOLDEN = RAIZ.parent / "vigia-golden"
REDES = {"bienes": GOLDEN / "golden", **{r: GOLDEN / "redes" / r / "golden" for r in ("servicios", "consultoria", "obras", "directas")}}


def num(x) -> float | None:
    try:
        v = float(x)
        return v if v == v else None
    except (TypeError, ValueError):
        return None


def igual(a: float | None, b: float | None, tolerancia: float = 0.005) -> bool:
    return a is not None and b is not None and abs(a - b) <= tolerancia * abs(b) + 0.01


def lectura(estado: dict, clase: str) -> dict:
    """La salida de la lectura tipada de una clase tal como la recibió el análisis (state.lecturas_documentos)."""
    ld = estado.get("lecturas_documentos") or {}
    x = ld.get(clase) or ld.get({"buena_pro": "acta"}.get(clase, clase)) or {}
    return (x.get("salida") if isinstance(x, dict) and isinstance(x.get("salida"), dict) else x) or {}


def fuentes_de(estado: dict) -> dict[str, dict[str, float | None]]:
    """Lo que cada fuente dice de cada dato, en este análisis."""
    da = estado.get("document_analysis") or {}
    cf = estado.get("contrato_final") or {}
    postores = da.get("postores_consolidados") or da.get("postores_extraidos") or []
    bases, acta, contrato = lectura(estado, "bases"), lectura(estado, "buena_pro"), lectura(estado, "contrato")
    return {
        "valor_referencial": {
            "extractor genérico (cuantia_total)": num(da.get("cuantia_total")),
            "lector de bases": num(bases.get("valor_referencial")),
            "lector del acta": num(acta.get("valor_referencial")),
        },
        "n_postores": {
            "extractor genérico (postores)": float(len(postores)) if postores else None,
            "lector del acta": float(len(acta.get("postores") or [])) if acta.get("postores") else None,
        },
        "monto_adjudicado": {
            "extractor genérico (contrato_final)": num(cf.get("precio_final_total")),
            "lector del contrato": num(contrato.get("monto_contratado")),
        },
    }


def ultimas() -> list[tuple[Path, Path]]:
    """La corrida más reciente de cada red: la carpeta de ab_out cuya variante se llama como la red."""
    pares = []
    for red, golden in REDES.items():
        if not golden.is_dir():
            continue
        candidatas = sorted(p for p in AB_OUT.glob("*/*") if p.is_dir() and (p.name.startswith(red + "_") or (red == "bienes" and p.name == "abierto")))
        if candidatas:
            pares.append((candidatas[-1], golden))
    return pares


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pares", nargs="*", help="<carpeta de la variante>=<carpeta golden>")
    ap.add_argument("--ultimas", action="store_true")
    a = ap.parse_args()
    pares = ultimas() if a.ultimas else [(Path(x.split("=")[0]) if Path(x.split("=")[0]).is_absolute() else RAIZ / "backend" / "scripts" / x.split("=")[0],
                                         Path(x.split("=")[1]).resolve()) for x in a.pares]
    if not pares:
        sys.exit("faltan corridas: pasa <variante>=<golden> o --ultimas")
    cuenta: dict = defaultdict(lambda: defaultdict(int))
    es_experiencia: dict = defaultdict(int)
    for corrida, golden in pares:
        casos = 0
        for f in sorted(golden.glob("*.json")):
            caso = json.loads(f.read_text(encoding="utf-8"))
            salida = corrida / f.name
            if not salida.exists():
                continue
            estado = ((json.loads(salida.read_text(encoding="utf-8")).get("final") or {}).get("state")) or {}
            verdad = caso.get("datos_clave") or {}
            casos += 1
            experiencia = num((lectura(estado, "bases").get("experiencia_postor") or {}).get("monto_minimo"))
            for dato, por_fuente in fuentes_de(estado).items():
                v = num(verdad.get(dato))
                if v is None:
                    continue
                for fuente, valor in por_fuente.items():
                    c = cuenta[(dato, fuente)]
                    c["con verdad"] += 1
                    if valor is None:
                        continue
                    c["dio valor"] += 1
                    if igual(valor, v, 0.0 if dato == "n_postores" else 0.005):
                        c["acertó"] += 1
                    elif dato == "valor_referencial":
                        if igual(valor, experiencia, 0.01):
                            es_experiencia[fuente] += 1
                        elif v and 1.5 <= valor / v <= 5 and abs(valor / v - round(valor / v * 2) / 2) < 0.02:
                            es_experiencia[fuente + " (múltiplo de la cuantía)"] += 1
        print(f"{corrida.parent.name}/{corrida.name}: {casos} casos con corrida y verdad")
    print()
    print(f"{'dato':20s} {'fuente':38s} {'verdad':>6s} {'dio':>5s} {'acertó':>6s} {'cobertura':>9s} {'exactitud':>9s}")
    for (dato, fuente), c in sorted(cuenta.items()):
        cob = 100 * c["dio valor"] / c["con verdad"] if c["con verdad"] else 0
        exa = 100 * c["acertó"] / c["dio valor"] if c["dio valor"] else 0
        print(f"{dato:20s} {fuente:38s} {c['con verdad']:6d} {c['dio valor']:5d} {c['acertó']:6d} {cob:8.0f}% {exa:8.0f}%")
    if es_experiencia:
        print("\nde los que erraron la cuantía, pusieron ahí la experiencia:", dict(es_experiencia))


if __name__ == "__main__":
    main()
