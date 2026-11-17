"""Reclasifica las banderas «sanción vigente» de los agentes cuando la ficha del proveedor en el OECE ya no lista la sanción.

Por qué (2026-11-17): A & G INDUSTRIES ganó 2026-2409-58 (buena pro 25-06-2026) con dos banderas altas, «Sanción vigente
en el OECE» y «Proveedor sancionado», por una inhabilitación definitiva de 2016 que el Tribunal sustituyó el 11-12-2025
(Res. 8608-2025-TCP-S3). Los datos abiertos de sancionados no reflejan las sustituciones; la ficha del proveedor sí
(migración 337, `sancion_segun_ficha`). Para los análisis nuevos lo corrigen la vista `osce_sancionados_vigentes`
(migración 341) y el expediente del agente; esto arregla lo ya publicado.

La regla es la de `ajustar_sanciones_con_ficha()`: la sanción ya no figura y la buena pro es desde la Ley 32069
(22-04-2025, desde cuando se sustituyen definitivas por retroactividad benigna), o la ficha le da un fin anterior a la
buena pro. Cada bandera pasa a contexto sin puntaje (`puntua=false`, severidad baja) con la evidencia de la ficha, y se
recalcula el puntaje de su alerta con la función del agente. Lo previo queda en `banderas_reclasificadas` (reversible).

Por defecto sólo simula; con --aplicar escribe.

    python -X utf8 backend/scripts/reclasificar_sancion_ficha.py [prod|dev] [--aplicar]
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
sys.path.insert(0, str(RAIZ / "backend" / "agent"))
from tunel_rds import conexion  # noqa: E402

REGLAS = ("sancion_vigente_oece", "proveedor_sancionado_osce")
LEY_32069 = date(2025, 4, 22)
MOTIVO = "la ficha del proveedor en el OECE ya no lista la sanción (sustituida, reducida o anulada por el Tribunal)"
VERSION = "reclasificada-2026-11-17-ficha-oece"
# Un integrante de consorcio: el RUC y la buena pro van en el texto («Integrante X (RUC …): OECE reporta 1 sanción vigente a la
# fecha de la buena pro (2026-05-07) para el RUC …»), y la alerta trae el código del consorcio.
RE_RUC = re.compile(r"para el RUC (20\d{9})")
RE_BP = re.compile(r"buena pro \((\d{4}-\d{2}-\d{2})\)")
RE_RES = re.compile(r"\b(\d{1,5}-\d{4}-[A-Z]{2,5}(?:-[A-Z0-9]{1,4})?)\b", re.I)


def nivel(score: int) -> str:
    return "alto" if score >= 70 else "medio" if score >= 40 else "bajo"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", nargs="?", default="prod", choices=["prod", "dev"])
    ap.add_argument("--aplicar", action="store_true")
    args = ap.parse_args()
    from tools.persistence.shared import _recalcular_score, puntaje_de  # noqa: PLC0415 — el puntaje del agente

    with conexion(args.entorno) as cn:
        cur = cn.cursor()
        cur.execute("SET statement_timeout = '120s'")
        cur.execute("""SELECT b.id, b.alerta_id, b.regla, b.severidad, b.evidencia, a.score, a.estado, a.proveedor_ruc, a.fecha_buena_pro
                         FROM banderas b JOIN alertas a ON a.id = b.alerta_id
                        WHERE b.regla = ANY(%s) AND COALESCE(b.puntua, true)""", (list(REGLAS),))
        objetivo = cur.fetchall()
        print(f"banderas de sanción vigente que puntúan: {len(objetivo)}")
        cambios, clases = [], Counter()
        for bid, aid, regla, sev, ev, score, estado, ruc, fecha_bp in objetivo:
            m = RE_RES.search(ev or "")
            mr, mb = RE_RUC.search(ev or ""), RE_BP.search(ev or "")
            ruc = mr.group(1) if mr else ruc
            fecha_bp = date.fromisoformat(mb.group(1)) if mb else fecha_bp
            if not (m and ruc):
                clases["sin resolución o sin RUC en el texto: no se toca"] += 1
                continue
            cur.execute("""SELECT estado_ficha, fin_ficha, to_char(consultado_at, 'YYYY-MM-DD') FROM sancion_segun_ficha
                            WHERE ruc = %s AND resolucion_norm(resolucion) = resolucion_norm(%s) LIMIT 1""", (ruc, m.group(1)))
            f = cur.fetchone()
            if not f:
                clases["sin ficha consultada: se queda"] += 1
                continue
            estado_ficha, fin, consultada = f
            bp = fecha_bp if isinstance(fecha_bp, date) else None
            if estado_ficha == "no_figura" and bp and bp >= LEY_32069:
                nueva = (f"{(ev or '').rstrip('. ')}. Según la ficha del proveedor en el OECE (consultada el {consultada}), la Res. "
                         f"{m.group(1)} ya no figura: el Tribunal la sustituyó, redujo o anuló (desde la Ley 32069, de abril de "
                         f"2025, se sustituyen inhabilitaciones definitivas por retroactividad benigna). No se sabe que estuviera "
                         f"vigente el día de la buena pro ({bp.isoformat()}): queda como antecedente y no suma al puntaje.")
                clases["ya no figura, buena pro desde la Ley 32069: a contexto"] += 1
            elif fin and bp and fin < bp:
                nueva = (f"{(ev or '').rstrip('. ')}. Según la ficha del proveedor en el OECE (consultada el {consultada}), la Res. "
                         f"{m.group(1)} terminó el {fin.isoformat()}, antes de la buena pro ({bp.isoformat()}): no estaba vigente ese "
                         f"día. Queda como antecedente y no suma al puntaje.")
                clases["terminó antes de la buena pro: a contexto"] += 1
            else:
                clases[f"la ficha la da {estado_ficha}: se queda"] += 1
                continue
            cambios.append((bid, aid, regla, sev, ev, score, estado, nueva))

        tabla = Counter()
        ids = {c[0] for c in cambios}
        for aid in sorted({c[1] for c in cambios}, key=str):
            antes = next(c[5] for c in cambios if c[1] == aid)
            est = next(c[6] for c in cambios if c[1] == aid)
            cur.execute("SELECT id, regla, severidad, agente_origen, puntua FROM banderas WHERE alerta_id = %s", (aid,))
            quedan = [{"regla": r, "severidad": s, "agente_origen": ag, "puntua": True if p is None else bool(p)}
                      for i, r, s, ag, p in cur.fetchall() if i not in ids]
            tabla[(est, nivel(antes or 0), nivel(puntaje_de(quedan)))] += 1
        for k, v in clases.most_common():
            print(f"  {v:4d}  {k}")
        print("estado     | nivel antes -> después | alertas")
        for (e, a, n), c in sorted(tabla.items()):
            print(f"{e:10} | {a:5} -> {n:5} | {c}")
        if not args.aplicar:
            print("simulación: no se escribió nada")
            return
        for bid, aid, _regla, sev, ev, score, _est, nueva in cambios:
            cur.execute("""INSERT INTO banderas_reclasificadas (bandera_id, alerta_id, severidad_previa, evidencia_previa, score_previo, motivo)
                           VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (bandera_id) DO NOTHING""", (bid, aid, sev, ev, score, MOTIVO))
            cur.execute("UPDATE banderas SET severidad = 'baja', puntua = false, regla_version = %s, evidencia = %s WHERE id = %s",
                        (VERSION, nueva, bid))
        for aid in sorted({c[1] for c in cambios}, key=str):
            _recalcular_score(cur, aid)
        cn.commit()
        print(f"aplicado: {len(cambios)} banderas en {len({c[1] for c in cambios})} alertas (lo previo, en banderas_reclasificadas)")


if __name__ == "__main__":
    main()
