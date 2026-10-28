"""
DJI tier 3 (fase 5 del plan del 2026-10-27): prepara la descarga de las declaraciones del registro completo de la
Contraloría, priorizada. Aplica la migración 185 (el RUC de cada entidad del registro: dji_entidad_ruc), y agrega a
targets_dji.csv los declarantes vigentes que todavía no están en el ledger (dji_descargas), los que deciden primero:

  1. alta dirección, compras y finanzas (alcalde, gobernador, gerente, director, jefe, administrador, logística,
     abastecimiento, contrataciones, tesorería, comités, ministro, presidente, secretario general, procurador);
  2. regidores, consejeros, subgerentes, coordinadores, asesores y especialistas;
  3. el resto.

Dentro de cada grupo, las entidades que más contratan primero. Con --tope, sólo los primeros N (una tanda: el orquestador
los baja en rondas de CI). Los del grupo 1 van al PRINCIPIO del CSV y el resto al final: el orquestador pide los pendientes
en el orden del CSV, y un alcalde de una entidad que recién tiene RUC no debe esperar detrás de todo el tier 3. El
orquestador lee el universo al arrancar: los nuevos entran en su próxima corrida. Luego, desacoplado:
python -u backend/scripts/orquestar_dji.py --rondas N --desde-ronda M.

    MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin python backend/scripts/preparar_dji_tier3.py [--tope 60000] [--seco]
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

# La 185, la 190 (el paso «por todos sus nombres») y la 194 (variantes con guarda): cada una redefine la función de la
# anterior, así que van en ese orden.
MIGRACIONES = [ROOT / "backend" / "db" / "migrations" / f for f in ("185_dji_entidad_ruc.sql", "190_dji_entidad_nombres.sql", "194_dji_entidad_variantes.sql")]
TODOS = ROOT / "backend" / "scrapers-worker" / "dji_targets" / "targets_dji.csv"

PRIORIDAD = r"""CASE
  WHEN mef_norm(f.cargo) ~ '\m(ALCALDE|ALCALDESA|GOBERNADOR|GOBERNADORA|GERENTE|DIRECTOR|DIRECTORA|JEFE|JEFA|ADMINISTRADOR|ADMINISTRADORA|LOGISTICA|ABASTECIMIENTO|CONTRATACIONES|TESORERO|TESORERA|COMITE|MINISTRO|MINISTRA|VICEMINISTRO|VICEMINISTRA|PRESIDENTE|PRESIDENTA|SECRETARIO GENERAL|SECRETARIA GENERAL|PROCURADOR|PROCURADORA)\M' THEN 1
  WHEN mef_norm(f.cargo) ~ '\m(REGIDOR|REGIDORA|CONSEJERO|CONSEJERA|SUBGERENTE|COORDINADOR|COORDINADORA|ASESOR|ASESORA|ESPECIALISTA)\M' THEN 2
  ELSE 3 END"""


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tope", type=int, default=60000, help="cuántos objetivos nuevos agregar (los de más prioridad)")
    ap.add_argument("--seco", action="store_true", help="sólo cuenta, no escribe el CSV")
    a = ap.parse_args()
    with conexion("prod") as c:
        c.autocommit = True
        cur = c.cursor()
        cur.execute("SET statement_timeout = 0")
        for m in MIGRACIONES:
            cur.execute(m.read_text(encoding="utf-8"))
        cur.execute("SELECT refrescar_dji_entidad_ruc()")
        print(f"entidades del registro con RUC: {cur.fetchone()[0]}", flush=True)
        cur.execute("SELECT como, count(*) FROM dji_entidad_ruc GROUP BY 1 ORDER BY 2 DESC")
        print("  por cómo:", cur.fetchall(), flush=True)
        cur.execute(f"""
          WITH gasto AS (SELECT entidad_ruc, sum(monto) AS monto FROM empresa_orden_anual GROUP BY 1),
               f AS (
                 SELECT DISTINCT ON (m.ruc, btrim(f.apellido_paterno || ' ' || COALESCE(f.apellido_materno, '')))
                        m.ruc, btrim(f.apellido_paterno || ' ' || COALESCE(f.apellido_materno, '')) AS apellidos,
                        btrim(f.nombres) AS nombres, {PRIORIDAD} AS prioridad
                   FROM dji_funcionarios f JOIN dji_entidad_ruc m ON m.entidad = f.entidad
                  WHERE (f.fecha_cese_cargo IS NULL OR btrim(f.fecha_cese_cargo) = '')
                    AND COALESCE(btrim(f.apellido_paterno), '') <> '' AND COALESCE(btrim(f.nombres), '') <> ''
                  ORDER BY m.ruc, btrim(f.apellido_paterno || ' ' || COALESCE(f.apellido_materno, '')), {PRIORIDAD})
          SELECT f.ruc, f.apellidos, f.nombres, f.prioridad
            FROM f LEFT JOIN gasto g ON g.entidad_ruc = f.ruc
           WHERE NOT EXISTS (SELECT 1 FROM dji_descargas d WHERE d.ruc = f.ruc AND d.apellidos = f.apellidos)
           ORDER BY f.prioridad, g.monto DESC NULLS LAST, f.ruc, f.apellidos""")
        filas = cur.fetchall()
    por = {}
    for _, _, _, p in filas:
        por[p] = por.get(p, 0) + 1
    print(f"declarantes vigentes fuera del ledger: {len(filas)} (por prioridad: {dict(sorted(por.items()))})", flush=True)
    # Los que ya están en el CSV (de otra corrida) no se repiten.
    ya = set()
    with open(TODOS, encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            ya.add(((r.get("ruc") or "").strip(), (r.get("apellidos") or "").strip()))
    nuevos = [x for x in filas if (x[0], x[1]) not in ya][: a.tope]
    print(f"nuevos para el CSV: {len(nuevos)} (tope {a.tope})", flush=True)
    if a.seco or not nuevos:
        return
    primero = [x for x in nuevos if x[3] == 1]
    despues = [x for x in nuevos if x[3] != 1]

    def lineas(xs: list) -> str:
        buf = io.StringIO()
        csv.writer(buf).writerows([ruc, apellidos, nombres] for ruc, apellidos, nombres, _ in xs)
        return buf.getvalue()

    with open(TODOS, encoding="utf-8", newline="") as f:
        texto = f.read()
    cabecera, _, resto = texto.partition("\n")
    if resto and not resto.endswith("\n"):
        resto += "\r\n"
    # Se escribe aparte y se reemplaza de una vez: el orquestador relee el CSV al armar cada ronda.
    tmp = TODOS.with_name(TODOS.name + ".tmp")
    with open(tmp, "w", encoding="utf-8", newline="") as f:
        f.write(cabecera + "\n" + lineas(primero) + resto + lineas(despues))
    for intento in range(20):
        try:
            os.replace(tmp, TODOS)
            break
        except PermissionError:  # el orquestador lo tiene abierto (unos segundos por ronda)
            if intento == 19:
                raise
            time.sleep(3)
    print(f"{len(primero)} al principio y {len(despues)} al final de {TODOS.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    os.environ.setdefault("AWS_PROFILE", "founder.edwin")
    main()
