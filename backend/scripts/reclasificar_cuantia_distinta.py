"""Reclasifica las banderas «Discrepancia de cuantía» de la regla `inconsistencia_doc_vs_ocds`.

Por qué (2026-11-16): la regla comparaba `cuantia_total`, un monto SIN TIPO que el extractor de documentos saca de las
bases o del requerimiento, contra lo adjudicado en el registro. Ese monto es casi siempre el valor referencial (adjudicar
por menos es lo normal) y a veces la experiencia que se exige al postor (un usuario vio «154 % de diferencia»: eran los
S/ 24,98 M de facturación que pedía un factor de evaluación, 2,5 veces el referencial). En PROD había 144 banderas así,
todas del análisis masivo de noviembre, sumando al puntaje como «señal media cotejada».

Qué hace: cada bandera pasa a dato de contexto sin puntaje (`puntua=false`, severidad baja) con una evidencia que dice lo
que de verdad se sabe del monto (es la experiencia exigida, es el referencial, o no se pudo establecer), y se recalcula
el puntaje de su alerta con la misma función del agente. Guarda lo previo en `banderas_reclasificadas` (reversible). No
reanaliza ni llama a ningún modelo. El texto del dictamen ya escrito no cambia.

Por defecto sólo simula; con --aplicar escribe.

    python -X utf8 backend/scripts/reclasificar_cuantia_distinta.py [prod|dev] [--aplicar]
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
sys.path.insert(0, str(RAIZ / "backend" / "agent"))
from tunel_rds import conexion  # noqa: E402

REGLA = "inconsistencia_doc_vs_ocds"
MOTIVO = ("regla corregida el 2026-11-16: comparaba un monto sin tipo de las bases (referencial o experiencia exigida) "
          "contra lo adjudicado")
VERSION = "reclasificada-2026-11-16"
MULTIPLOS = (1.5, 2, 2.5, 3, 4, 5)


def soles(n: float) -> str:
    return f"S/ {n:,.2f}"


def cerca(a: float | None, b: float | None, tol: float = 1.0) -> bool:
    return bool(a and b and abs(a - b) / max(b, 1) * 100 <= tol)


def nivel(score: int) -> str:
    return "alto" if score >= 70 else "medio" if score >= 40 else "bajo"


def clasificar(doc: float, registro: float, referencial: float | None, vr_bases: float | None, exp_min: float | None) -> tuple[str, str]:
    """(clase, evidencia nueva) de una bandera, con lo que se sabe del monto leído."""
    refs = [r for r in (referencial, vr_bases) if r]
    k = next((q for r in refs + [registro] for q in MULTIPLOS if cerca(doc, q * r)), None)
    if cerca(doc, exp_min) or k:
        veces = f" ({str(k).replace('.', ',')} veces el valor referencial)" if k else ""
        return "experiencia", (
            f"En las bases figura un monto de {soles(doc)}{veces}: es la experiencia (lo facturado en trabajos parecidos) "
            f"que se exige al postor, no el monto del contrato, que el registro publica en {soles(registro)}. No es una "
            f"discrepancia y no suma al puntaje.")
    if any(cerca(doc, r) for r in refs) and doc > registro:
        menos = (doc - registro) / doc * 100
        return "referencial", (
            f"El monto de {soles(doc)} que figura en las bases es el valor referencial; el registro publica {soles(registro)} "
            f"adjudicados o contratados ({menos:.1f} % menos). Adjudicar por debajo del referencial es lo esperado: no es "
            f"una discrepancia y no suma al puntaje.")
    return "sin_tipo", (
        f"En las bases o el requerimiento figura un monto de {soles(doc)} que no coincide con el del registro "
        f"({soles(registro)}). Vigía no pudo establecer a qué corresponde ese monto (puede ser el valor referencial, el de "
        f"otro ítem o un total con otros conceptos): hay que verificarlo en el documento. No suma al puntaje.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", nargs="?", default="prod", choices=["prod", "dev"])
    ap.add_argument("--aplicar", action="store_true")
    args = ap.parse_args()
    from tools.persistence.shared import _leer_banderas, _recalcular_score, puntaje_de  # noqa: PLC0415 — el puntaje del agente

    with conexion(args.entorno) as cn:
        cur = cn.cursor()
        cur.execute("SET statement_timeout = '120s'")
        cur.execute("""SELECT b.id, b.alerta_id, b.severidad, b.evidencia, a.score, a.estado, a.codigo, a.ocid,
                              a.monto_referencial::float
                         FROM banderas b JOIN alertas a ON a.id = b.alerta_id
                        WHERE b.regla = %s AND b.puntua AND b.evidencia ILIKE 'Discrepancia de cuant%%'""", (REGLA,))
        objetivo = cur.fetchall()
        print(f"banderas a reclasificar: {len(objetivo)}")
        num = lambda t: float(t.replace(",", ""))  # noqa: E731
        cambios, clases = [], Counter()
        for bid, aid, sev, ev, score, estado, codigo, ocid, referencial in objetivo:
            m = re.search(r"OCDS publica S/ ([\d,]+\.\d\d).*?documento del expediente indica S/ ([\d,]+\.\d\d)", ev or "")
            if not m:
                clases["sin montos en el texto: no se toca"] += 1
                continue
            registro, doc = num(m.group(1)), num(m.group(2))
            # Lo que la lectura de las bases (documento_lectura) dice del referencial y de la experiencia exigida.
            cur.execute("""SELECT (salida->>'valor_referencial')::float, (salida->'experiencia_postor'->>'monto_minimo')::float
                             FROM documento_lectura
                            WHERE clase = 'bases' AND estado = 'ok' AND ocid IN (%s, regexp_replace(%s, '^ocds-[a-z0-9]+-seacev3-', ''))
                            ORDER BY leido_at DESC LIMIT 1""", (ocid, ocid or ""))
            fila = cur.fetchone() or (None, None)
            clase, nueva = clasificar(doc, registro, referencial, fila[0], fila[1])
            clases[clase] += 1
            cambios.append((bid, aid, sev, ev, score, estado, codigo, nueva))

        # El puntaje que le quedaría a cada alerta: el del agente, sin esas banderas.
        ids = {c[0] for c in cambios}
        tabla = Counter()
        for aid in sorted({c[1] for c in cambios}, key=str):
            antes = next(c[4] for c in cambios if c[1] == aid)
            estado = next(c[5] for c in cambios if c[1] == aid)
            cur.execute("SELECT id FROM banderas WHERE alerta_id = %s AND id = ANY(%s)", (aid, list(ids)))
            fuera = {r[0] for r in cur.fetchall()}
            cur.execute("SELECT id, regla, severidad, agente_origen, puntua FROM banderas WHERE alerta_id = %s", (aid,))
            quedan = [{"regla": r, "severidad": s, "agente_origen": ag, "puntua": True if p is None else bool(p)}
                      for i, r, s, ag, p in cur.fetchall() if i not in fuera]
            despues = puntaje_de(quedan)
            tabla[(estado, nivel(antes or 0), nivel(despues))] += 1
        for k, v in clases.most_common():
            print(f"  {v:4d}  {k}")
        print("estado     | nivel antes -> después | alertas")
        for (e, a, n), c in sorted(tabla.items()):
            print(f"{e:10} | {a:5} -> {n:5} | {c}")
        if not args.aplicar:
            print("simulación: no se escribió nada")
            return
        for bid, aid, sev, ev, score, _estado, _codigo, nueva in cambios:
            cur.execute("""INSERT INTO banderas_reclasificadas (bandera_id, alerta_id, severidad_previa, evidencia_previa, score_previo, motivo)
                           VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (bandera_id) DO NOTHING""", (bid, aid, sev, ev, score, MOTIVO))
            cur.execute("UPDATE banderas SET severidad = 'baja', puntua = false, regla_version = %s, evidencia = %s WHERE id = %s",
                        (VERSION, nueva, bid))
        for aid in sorted({c[1] for c in cambios}, key=str):
            _recalcular_score(cur, aid)
        cn.commit()
        print(f"aplicado: {len(cambios)} banderas en {len({c[1] for c in cambios})} alertas (lo previo, en banderas_reclasificadas)")
        _ = _leer_banderas  # el mismo lector que usa _recalcular_score


if __name__ == "__main__":
    main()
