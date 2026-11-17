#!/usr/bin/env python3
"""Dos lecturas independientes de la misma pieza: la del MODELO (lector/por_pieza.py, versión m1) y la de la REGLA
(lector/plantillas.py p1, lector/secciones.py s1). Cuánto coinciden, dato por dato, y cuando difieren, quién acierta según
el registro oficial.

  python -X utf8 backend/evals/hechos/comparar.py prod                      # los cuatro lectores
  python -X utf8 backend/evals/hechos/comparar.py prod --lector reporte_otorgamiento --ver 5

Sólo lee la base. Imprime cuentas; con --ver N muestra N diferencias sin nombres ni RUC (sólo qué campo difiere y los
valores numéricos).
"""
from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))

PARES = """
SELECT p.id, p.ocid, m.salida AS modelo, r.salida AS regla
  FROM pieza_lectura m JOIN pieza_lectura r ON r.pieza_id = m.pieza_id AND r.lector = m.lector AND r.modelo = 'plantilla'
  JOIN documento_pieza p ON p.id = m.pieza_id
 WHERE m.lector = %(lector)s AND m.modelo <> 'plantilla' AND m.estado = 'ok' AND r.estado = 'ok'
"""


def plano(s) -> str:
    s = unicodedata.normalize("NFKD", str(s or ""))
    return " ".join(re.sub(r"[^A-Z0-9Ñ]+", " ", "".join(c for c in s if not unicodedata.combining(c)).upper()).split())


def cerca(a, b, tol=0.005) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(float(a) - float(b)) <= tol * abs(float(b)) + 0.01


def items_de(salida: dict) -> dict:
    return {it.get("item"): it for it in (salida or {}).get("items") or [] if it.get("item") is not None}


def comparar_reporte(lector: str, modelo: dict, regla: dict, dif: Counter, ejemplos: list) -> tuple[int, int]:
    """→ (filas comparadas, filas iguales). Una «fila» es un ítem con todas sus filas de postores."""
    im, ir = items_de(modelo), items_de(regla)
    filas = iguales = 0
    for n in sorted(set(im) | set(ir)):
        filas += 1
        a, b = im.get(n), ir.get(n)
        if a is None or b is None:
            dif["ítem que sólo trae " + ("la regla" if a is None else "el modelo")] += 1
            continue
        motivo = None
        if lector == "reporte_presentacion":
            ma = {str(o.get("ruc") or ""): (o.get("fecha"), o.get("hora")) for o in a.get("ofertas") or []}
            mb = {str(o.get("ruc") or ""): (o.get("fecha"), o.get("hora")) for o in b.get("ofertas") or []}
            if set(ma) != set(mb):
                motivo = f"postores distintos (modelo {len(ma)}, regla {len(mb)})"
            elif ma != mb:
                motivo = "fecha u hora distinta"
        elif lector == "reporte_evaluacion":
            ma = {plano(o.get("nombre")): (o.get("admitida"), o.get("calificada"), o.get("puntaje_tecnico")) for o in a.get("postores") or []}
            mb = {plano(o.get("nombre")): (o.get("admitida"), o.get("calificada"), o.get("puntaje_tecnico")) for o in b.get("postores") or []}
            if set(ma) != set(mb):
                motivo = f"postores distintos (modelo {len(ma)}, regla {len(mb)})"
            else:
                for k in ma:
                    if ma[k][0] != mb[k][0]:
                        motivo = "admisión distinta"
                    elif ma[k][1] != mb[k][1]:
                        motivo = "calificación distinta"
                    elif not cerca(ma[k][2], mb[k][2], 0.0001):
                        motivo = "puntaje distinto"
        else:
            if a.get("resultado") != b.get("resultado"):
                motivo = f"resultado distinto (modelo {a.get('resultado')}, regla {b.get('resultado')})"
            elif not cerca(a.get("valor_referencial"), b.get("valor_referencial")):
                motivo = f"cuantía distinta (modelo {a.get('valor_referencial')}, regla {b.get('valor_referencial')})"
            else:
                ga = {str(o.get("ruc") or ""): o for o in a.get("adjudicados") or []}
                gb = {str(o.get("ruc") or ""): o for o in b.get("adjudicados") or []}
                if set(ga) != set(gb):
                    motivo = f"ganador distinto (modelo {len(ga)}, regla {len(gb)})"
                elif any(not cerca(ga[k].get("monto"), gb[k].get("monto")) for k in ga):
                    motivo = "monto adjudicado distinto"
                elif any({str(i.get("ruc")) for i in ga[k].get("integrantes") or []} != {str(i.get("ruc")) for i in gb[k].get("integrantes") or []} for k in ga):
                    motivo = "integrantes del consorcio distintos"
        if motivo is None:
            iguales += 1
        else:
            dif[re.sub(r"\(.*\)", "", motivo).strip()] += 1
            if len(ejemplos) < 40:
                ejemplos.append(f"ítem {n}: {motivo}")
    return filas, iguales


def comparar_bases(modelo: dict, regla: dict, registro, c: Counter, ejemplos: list) -> None:
    cm, cr = (modelo or {}).get("cuantia") or {}, (regla or {}).get("cuantia")
    estado_r = None if cr is None else "reservada" if cr.get("reservada") else "publica" if cr.get("valor") else "sin_monto"
    estado_m = cm.get("estado")
    c[f"cuantía: modelo «{estado_m}», regla «{estado_r or 'no_figura'}»"] += 1
    if estado_m == "publica" and estado_r == "publica":
        c["cuantía pública en las dos: " + ("mismo valor" if cerca(cm.get("valor"), cr.get("valor")) else "valor distinto")] += 1
    for quien, valor in (("modelo", cm.get("valor") if estado_m == "publica" else None), ("regla", cr.get("valor") if cr else None)):
        if valor and registro:
            c[f"cuantía del {quien} contra el registro: " + ("igual" if cerca(valor, registro) else "distinta")] += 1
    if estado_m == "publica" and estado_r == "reservada" and len(ejemplos) < 40:
        ejemplos.append(f"el modelo da cuantía {cm.get('valor')} y la regla dice reservada (registro {registro})")
    em = [e for e in (modelo or {}).get("experiencia_exigida") or [] if e.get("para") != "mype"]
    er = (regla or {}).get("experiencia_exigida") or []
    vm = next((e.get("monto") for e in em if e.get("monto")), None)
    vr = next((e.get("monto") for e in er if e.get("monto")), None)
    c["experiencia exigida (monto): " + ("ninguna la halla" if not vm and not vr else "sólo el modelo" if vm and not vr else
                                         "sólo la regla" if vr and not vm else "las dos, igual" if cerca(vm, vr) else "las dos, distinto")] += 1
    if vm and vr and not cerca(vm, vr) and len(ejemplos) < 40:
        ejemplos.append(f"experiencia exigida: modelo {vm}, regla {vr}")
    am = max((e.get("monto") or 0 for e in (modelo or {}).get("experiencia_adicional") or []), default=0)
    ar = max((e.get("monto") or 0 for e in (regla or {}).get("experiencia_adicional") or []), default=0)
    c["experiencia adicional (monto): " + ("ninguna la halla" if not am and not ar else "sólo el modelo" if am and not ar else
                                           "sólo la regla" if ar and not am else "las dos, igual" if cerca(am, ar) else "las dos, distinto")] += 1
    # El error del 2026-11-16: que la «cuantía» que da un lector sea en realidad un monto de experiencia. Sólo cuenta si
    # además NO es la cuantía del registro: en obras la experiencia se pide como «una vez la cuantía» y los dos montos
    # coinciden de verdad.
    if estado_m == "publica" and cm.get("valor") and any(cerca(cm["valor"], x) for x in [vm, vr, am, ar] if x):
        if registro and not cerca(cm["valor"], registro):
            c["ALERTA: la cuantía del modelo es un monto de experiencia y no la del registro"] += 1
        else:
            c["la cuantía coincide con un monto de experiencia (se pide «una vez la cuantía»)"] += 1
    citas = (modelo or {}).get("citas") or {}
    c["citas del modelo: total"] += citas.get("total", 0)
    c["citas del modelo: están en el texto"] += citas.get("cita_en_texto", 0)
    c["citas del modelo: traen el valor"] += citas.get("valor_en_cita", 0)


def main() -> None:
    from tunel_rds import conexion

    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--lector", default=None)
    ap.add_argument("--ver", type=int, default=0)
    a = ap.parse_args()
    lectores = [a.lector] if a.lector else ["reporte_presentacion", "reporte_evaluacion", "reporte_otorgamiento", "bases_secciones"]
    with conexion(a.entorno) as cn:
        cn.set_session(readonly=True, autocommit=True)
        cur = cn.cursor()
        for lector in lectores:
            cur.execute(PARES, {"lector": lector})
            pares = cur.fetchall()
            if not pares:
                print(f"== {lector}: sin piezas con las dos lecturas")
                continue
            cur.execute("SELECT count(*), round(sum(costo_usd)::numeric, 4), round(avg(costo_usd)::numeric, 5) FROM pieza_lectura WHERE lector = %s AND modelo <> 'plantilla'", (lector,))
            n_modelo, costo, medio = cur.fetchone()
            ejemplos: list[str] = []
            if lector == "bases_secciones":
                cur.execute("SELECT ocid, NULLIF(cuantia_referencial, 0)::float FROM convocatorias WHERE ocid = ANY (%s)", ([p[1] for p in pares],))
                registro = dict(cur.fetchall())
                c: Counter = Counter()
                for _, ocid, modelo, regla in pares:
                    comparar_bases(modelo, regla, registro.get(ocid), c, ejemplos)
                print(f"== {lector}: {len(pares)} bases con las dos lecturas | lecturas con modelo {n_modelo}, USD {costo} ({medio} por pieza)")
                for k, v in sorted(c.items()):
                    print(f"   {v:6d}  {k}")
            else:
                dif: Counter = Counter()
                piezas_iguales = filas = iguales = 0
                for _, _, modelo, regla in pares:
                    f, i = comparar_reporte(lector, modelo, regla, dif, ejemplos)
                    filas += f
                    iguales += i
                    piezas_iguales += f == i
                print(f"== {lector}: {len(pares)} reportes con las dos lecturas | iguales del todo {piezas_iguales} "
                      f"({100 * piezas_iguales / len(pares):.1f} %) | ítems {filas}, iguales {iguales} ({100 * iguales / max(filas, 1):.1f} %) | "
                      f"lecturas con modelo {n_modelo}, USD {costo} ({medio} por pieza)")
                for k, v in dif.most_common():
                    print(f"   {v:6d}  {k}")
            for e in ejemplos[: a.ver]:
                print("      ·", e)


if __name__ == "__main__":
    main()
