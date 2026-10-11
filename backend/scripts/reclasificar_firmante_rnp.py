"""Reclasifica las banderas `firmante_con_empresa_rnp` publicadas con la regla v1.

Auditoría de señales (docs/auditoria-senales/00-diagnostico-y-plan.md, Fase 0): la regla v1 daba
MEDIA/ALTA por coincidencia de nombre, sin confirmar lado ni DNI ni relación con el proceso. Con
la regla v2 ninguna de las banderas guardadas cumple las condiciones de señal, así que pasan a
contexto sin puntaje (`puntua=false`, severidad baja) y se recalcula el score de cada alerta.

No reanaliza ni llama al modelo. Guarda lo previo en `banderas_reclasificadas` (reversible).
Por defecto solo simula; con --aplicar escribe.

    PGHOST=... PGPASSWORD=$(cat .cloudsql-password) python backend/scripts/reclasificar_firmante_rnp.py [--aplicar]
"""
from __future__ import annotations

import argparse
import os
from collections import Counter

import psycopg2

REGLA = "firmante_con_empresa_rnp"
MOTIVO = "regla v2 (2026-10-11): sin lado de la entidad confirmado, sin DNI o sin relación con el proceso"
EVIDENCIA_NUEVA = (
    "Un firmante del expediente figura en el RNP como socio o representante de una empresa proveedora. "
    "Dato de contexto: no se confirmó que firme por la entidad con DNI ni que esa empresa participe en este "
    "proceso. Estar en el RNP no es una irregularidad; no suma al nivel de la señal."
)
PESO_COMPLIANCE = {"alta": 35, "media": 18, "baja": 8}
PESO_DEFAULT = {"alta": 25, "media": 12, "baja": 5}


def nivel(score: int) -> str:
    return "alto" if score >= 70 else "medio" if score >= 40 else "bajo"


def peso(agente: str | None, sev: str) -> int:
    return (PESO_COMPLIANCE if agente == "compliance_agent" else PESO_DEFAULT).get(sev, 5)


def conectar():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"), port=int(os.getenv("PGPORT", "5432")), user=os.getenv("PGUSER", "postgres"),
        dbname=os.getenv("PGDATABASE", "vigia"), password=os.getenv("PGPASSWORD", ""), sslmode=os.getenv("PGSSLMODE", "prefer"),
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    args = ap.parse_args()
    conn = conectar()
    cur = conn.cursor()
    cur.execute("""SELECT b.id, b.alerta_id, b.severidad, b.evidencia, a.score, a.estado
                     FROM banderas b JOIN alertas a ON a.id = b.alerta_id
                    WHERE b.regla = %s AND b.puntua""", (REGLA,))
    objetivo = cur.fetchall()
    print(f"banderas a reclasificar: {len(objetivo)}")
    ids_alerta = sorted({r[1] for r in objetivo})
    cambios = []
    for aid in ids_alerta:
        cur.execute("SELECT regla, severidad, agente_origen, puntua FROM banderas WHERE alerta_id=%s", (aid,))
        resto = [(g, s, ag) for g, s, ag, p in cur.fetchall() if p and g != REGLA]
        nuevo = min(sum(peso(ag, s) for _, s, ag in resto), 100)
        cur.execute("SELECT score, estado FROM alertas WHERE id=%s", (aid,))
        antes, estado = cur.fetchone()
        cambios.append((aid, antes, nuevo, estado))
    tabla = Counter((e, nivel(a), nivel(n)) for _, a, n, e in cambios)
    print("estado | antes -> después | alertas")
    for (e, a, n), c in sorted(tabla.items()):
        print(f"{e:10} {a:6} -> {n:6} {c}")
    if not args.aplicar:
        print("simulación: no se escribió nada")
        return
    score_prev = {aid: a for aid, a, _, _ in cambios}
    for bid, aid, sev, ev, *_ in objetivo:
        cur.execute("""INSERT INTO banderas_reclasificadas (bandera_id, alerta_id, severidad_previa, evidencia_previa, score_previo, motivo)
                       VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (bandera_id) DO NOTHING""",
                    (bid, aid, sev, ev, score_prev[aid], MOTIVO))
        cur.execute("""UPDATE banderas SET severidad='baja', puntua=false, regla_version='1-reclasificada',
                              identidad='solo_nombre', evidencia=%s WHERE id=%s""", (EVIDENCIA_NUEVA, bid))
    for aid, _, nuevo, _ in cambios:
        cur.execute("UPDATE alertas SET score=%s, updated_at=NOW() WHERE id=%s", (nuevo, aid))
    conn.commit()
    print(f"aplicado: {len(objetivo)} banderas y {len(cambios)} alertas")


if __name__ == "__main__":
    main()
