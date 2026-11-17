"""Audita, en las banderas ya publicadas, qué ES en el documento cada monto que la evidencia cita.

Por qué (2026-11-16): una bandera «cotejada» presentó como cuantía del proceso el monto de experiencia que exigían las
bases. La verificación sólo comprobaba que el número existiera en algún documento. Desde ese día `tools/verify.py` mira
además la palabra que precede al monto en el texto (`rol_del_monto`): experiencia exigida, garantía, penalidad o capacidad
financiera. Este guion aplica esa misma prueba a lo ya publicado.

Sólo mira los montos que NO están en un registro estructurado del proceso (referencial, adjudicado, OCDS, CONOSCE): son
los que salieron de un documento. Lee del texto guardado (`documentos_texto`) sólo las ventanas que preceden a cada
aparición del monto; no llama a ningún modelo.

Con --aplicar, la bandera cuyo monto es en el documento otra cosa pasa a dato de contexto sin puntaje (`puntua=false`,
severidad baja), con una nota al inicio de su evidencia; lo previo queda en `banderas_reclasificadas` y se recalcula el
puntaje de la alerta con la función del agente. Por defecto sólo simula.

    python -X utf8 backend/scripts/auditar_rol_montos.py [prod|dev] [--aplicar] [--regla <slug>]
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
sys.path.insert(0, str(RAIZ / "backend" / "agent"))
from tunel_rds import conexion  # noqa: E402

MONTO = re.compile(r"S/\.?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?)")
MOTIVO = "verificación del 2026-11-16: el monto citado es, en el documento, otra cosa (experiencia exigida, garantía, penalidad o capacidad financiera)"
VERSION = "rol-del-monto-2026-11-16"
ROL_TEXTO = {"experiencia_exigida": "la experiencia que se exige al postor", "garantia": "una garantía", "penalidad": "una penalidad",
             "capacidad_financiera": "un requisito de capacidad financiera"}


def nivel(score: int) -> str:
    return "alto" if score >= 70 else "medio" if score >= 40 else "bajo"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", nargs="?", default="prod", choices=["prod", "dev"])
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--regla")
    args = ap.parse_args()
    from tools import verify  # noqa: PLC0415 — la misma prueba que usa el agente
    from tools.persistence.shared import _recalcular_score, puntaje_de  # noqa: PLC0415

    with conexion(args.entorno) as cn:
        cur = cn.cursor()
        cur.execute("SET statement_timeout = '240s'")
        cur.execute("""
          SELECT b.id, b.alerta_id, b.regla, b.severidad, b.evidencia, a.score, a.estado, a.codigo, a.ocid,
                 ARRAY(SELECT v FROM unnest(ARRAY[a.monto_adjudicado::float, a.monto_referencial::float, a.monto_adjudicado_ocds::float,
                                                 (SELECT c.cuantia_referencial::float FROM convocatorias c WHERE c.ocid = a.ocid)]
                                           || COALESCE((SELECT array_agg(x.monto_adjudicado::float) FROM conosce_adjudicaciones x
                                                         WHERE x.codigo_convocatoria::text = a.codigo_convocatoria), '{}')) v WHERE v IS NOT NULL) AS registro
            FROM banderas b JOIN alertas a ON a.id = b.alerta_id
           WHERE a.estado IN ('activa', 'confirmada', 'revision') AND b.puntua AND a.codigo NOT LIKE 'ALT-%%'
             AND b.evidencia ~ 'S/\\.?\\s?[0-9]{1,3},[0-9]{3}' AND (%s::text IS NULL OR b.regla = %s)""", (args.regla, args.regla))
        banderas = cur.fetchall()
        print(f"banderas publicadas con montos: {len(banderas)}")
        por_regla = defaultdict(Counter)
        hallazgos = []
        for bid, aid, regla, sev, ev, score, estado, codigo, ocid, registro in banderas:
            derivados = set(registro)
            for x in registro:
                for y in registro:
                    if x > y:
                        derivados.add(x - y)
            c = por_regla[regla]
            for m in MONTO.finditer(ev or ""):
                raw = m.group(1)
                valor = float(raw.replace(",", ""))
                if valor < 5000 or any(abs(valor - d) / max(d, 1) <= 0.005 for d in derivados):
                    continue                              # montos chicos, o del registro: no se discuten
                c["montos de documento"] += 1
                variantes = sorted(verify._variantes_monto(valor), key=len, reverse=True)
                # Postgres admite hasta 255 repeticiones en una expresión regular: la ventana de aquí es de 250.
                patron = "(.{0,%d}[^0-9.,])(?:%s)(?![0-9])" % (min(verify._VENTANA_ROL, 250), "|".join(re.escape(v) for v in variantes))
                cur.execute("""SELECT (regexp_matches(t.texto, %s, 'g'))[1] FROM documentos_texto t
                                WHERE t.ocid IN (%s, regexp_replace(%s, '^ocds-[a-z0-9]+-seacev3-', '')) AND position(%s in t.texto) > 0
                                LIMIT 40""", (patron, ocid, ocid or "", raw))
                ventanas = [r[0] for r in cur.fetchall()]
                if not ventanas:
                    c["sin texto con ese monto"] += 1
                    continue
                roles = {verify._rol_en_ventana(v) for v in ventanas}
                if None in roles or "cuantia" in roles:
                    c["el texto no lo contradice"] += 1
                    continue
                rol = sorted(r for r in roles if r)[0]
                if verify._bandera_habla_de(ev, raw, rol):
                    c["la bandera ya lo llama por su rol"] += 1
                    continue
                c[f"ES {rol}"] += 1
                hallazgos.append((bid, aid, regla, sev, ev, score, estado, codigo, raw, rol))
                break                                     # una vez por bandera
        print(f"{'regla':40} {'de documento':>12} {'sin texto':>9} {'no contradice':>13} {'por su rol':>10} {'OTRA COSA':>9}")
        for regla, c in sorted(por_regla.items(), key=lambda kv: -sum(v for k, v in kv[1].items() if k.startswith("ES "))):
            if not c["montos de documento"]:
                continue
            otra = sum(v for k, v in c.items() if k.startswith("ES "))
            print(f"{regla[:40]:40} {c['montos de documento']:12d} {c['sin texto con ese monto']:9d} {c['el texto no lo contradice']:13d} "
                  f"{c['la bandera ya lo llama por su rol']:10d} {otra:9d}")
        roles_total = Counter(h[9] for h in hallazgos)
        print("banderas cuyo monto es otra cosa en el documento:", len(hallazgos), dict(roles_total))
        print("ejemplos:", [(h[7], h[2], h[9]) for h in hallazgos[:12]])
        tabla = Counter()
        ids = {h[0] for h in hallazgos}
        for aid in sorted({h[1] for h in hallazgos}, key=str):
            antes = next(h[5] for h in hallazgos if h[1] == aid)
            estado = next(h[6] for h in hallazgos if h[1] == aid)
            cur.execute("SELECT id, regla, severidad, agente_origen, puntua FROM banderas WHERE alerta_id = %s", (aid,))
            quedan = [{"regla": r, "severidad": s, "agente_origen": ag, "puntua": True if p is None else bool(p)}
                      for i, r, s, ag, p in cur.fetchall() if i not in ids]
            tabla[(estado, nivel(antes or 0), nivel(puntaje_de(quedan)))] += 1
        for (e, a, n), c in sorted(tabla.items()):
            print(f"  {e:10} | {a:5} -> {n:5} | {c}")
        if not args.aplicar:
            print("simulación: no se escribió nada")
            return
        for bid, aid, _regla, sev, ev, score, _estado, _codigo, raw, rol in hallazgos:
            nota = (f"Dato a verificar, no suma al puntaje: el monto de S/ {raw} que cita esta señal es, en el documento, "
                    f"{ROL_TEXTO[rol]}, no el monto del proceso. Texto original de la señal: ")
            cur.execute("""INSERT INTO banderas_reclasificadas (bandera_id, alerta_id, severidad_previa, evidencia_previa, score_previo, motivo)
                           VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (bandera_id) DO NOTHING""", (bid, aid, sev, ev, score, MOTIVO))
            cur.execute("UPDATE banderas SET severidad = 'baja', puntua = false, regla_version = %s, evidencia = %s WHERE id = %s",
                        (VERSION, nota + (ev or ""), bid))
        for aid in sorted({h[1] for h in hallazgos}, key=str):
            _recalcular_score(cur, aid)
        cn.commit()
        print(f"aplicado: {len(hallazgos)} banderas (lo previo, en banderas_reclasificadas)")


if __name__ == "__main__":
    main()
