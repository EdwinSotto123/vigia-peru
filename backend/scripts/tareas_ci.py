"""Tareas de base cortas que corren en GitLab CI (jobs `tarea:*` de .gitlab-ci.yml) en vez de en la PC: allí no las corta
la falta de memoria y no dependen de que la PC esté prendida (pedido del usuario del 2026-11-05: «¿no puedes correr en
GitLab?»). Entran por el túnel de SSM como `vigia_ci` (miembro de vigia_jobs; ver infrastructure/aws/tunel_rds.py).

  python -X utf8 backend/scripts/tareas_ci.py prod refrescar-menores   # las señales de los contratos menores
  python -X utf8 backend/scripts/tareas_ci.py prod ordenes-anual       # órdenes de cada entidad por año (migr. 148)
  python -X utf8 backend/scripts/tareas_ci.py prod refrescar-piezas    # postores e ítems de los reportes del SEACE y hechos

`ordenes-anual` rehace el año en curso (y, en enero y febrero, también el anterior: las órdenes llegan con atraso).
En el Worker de scrapers ese paso tarda ~150 s y no termina: el 2026-11-05 la tabla seguía en el 5 de octubre.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import date
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402


def refrescar_menores(cur) -> None:
    cur.execute("SELECT refrescar_menor_senales()")
    print(f"refrescar_menor_senales(): {cur.fetchone()[0]} señales", flush=True)


def ordenes_anual(cur) -> None:
    hoy = date.today()
    anios = [hoy.year - 1, hoy.year] if hoy.month <= 2 else [hoy.year]
    for anio in anios:
        t = time.time()
        # Año cerrado: hasta el 31 de diciembre; el año en curso, sin tope (la función llega hasta hoy + 1 mes).
        cur.execute("SELECT refrescar_entidad_ordenes(%s, %s)", (date(anio, 1, 1), None if anio == hoy.year else date(anio, 12, 31)))
        filas = cur.fetchone()[0]
        cur.execute("SELECT max(ultima), sum(ordenes) FROM entidad_orden_anual WHERE anio = %s", (anio,))
        ultima, ordenes = cur.fetchone()
        print(f"entidad_orden_anual {anio}: {filas} filas, {ordenes} órdenes, la última del {ultima} ({round(time.time() - t)} s)",
              flush=True)


def refrescar_piezas(cur) -> None:
    """Tras registrar piezas nuevas (backend/lector/piezas.py): la competencia de cada proceso según los reportes del
    SEACE (migración 326) y los hechos de los documentos, que la leen (migraciones 323 y 327)."""
    # La señal en observación de la admisión (migración 390) lee proceso_postor: va después de refrescarlo.
    for funcion in ("refrescar_proceso_postor", "refrescar_hecho_documento", "refrescar_cruce_solo_admitido",
                    "refrescar_cruce_comite_mismo_ganador", "refrescar_cruce_comite_socio_proveedor"):
        t = time.time()
        cur.execute(f"SELECT {funcion}()")
        print(f"{funcion}(): {cur.fetchone()[0]} filas ({round(time.time() - t)} s)", flush=True)


TAREAS = {"refrescar-menores": refrescar_menores, "ordenes-anual": ordenes_anual, "refrescar-piezas": refrescar_piezas}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("tarea", choices=sorted(TAREAS))
    a = ap.parse_args()
    with conexion(a.entorno) as c:
        cur = c.cursor()
        cur.execute("SET statement_timeout = 0")
        TAREAS[a.tarea](cur)
        c.commit()


if __name__ == "__main__":
    main()
