#!/usr/bin/env python3
"""La cadena de refrescos de la planilla, desde la PC: lo mismo que hace pte_personal.ts después de cargar la planilla
del mes (backend/scrapers-worker/src/fuentes/pte_personal.ts, paso 3), pero paso por paso y sin el tope de Hyperdrive.

Para qué: después de un relleno de pte_personal (con `relleno` el Worker no rehace nada), de una migración que cambie
alguna de estas funciones, o cuando la cadena del Worker se cortó a medias. No aplica migraciones: si hace falta una,
aplícala antes por su lado.

Orden (cada paso lee lo que dejó el anterior; del 3 al 12 rehacen lo que los dos primeros borran):
   1. refrescar_planilla()                   la planilla de hoy de cada entidad, la del último mes completo (202)
   2. refrescar_personas_senales(desde)      personas contratadas por orden y sus señales, para los pares con órdenes
                                             desde ese año (--desde; «todo» = toda la historia)
   3. refrescar_nepotismo_senal()            el pariente declarado en la DJI que es locador de su misma entidad (137)
   4. refrescar_senales_politicas()          aportó o financió la campaña del que gobierna y después trabajó ahí (177)
   5. refrescar_senales_extra()              doble planilla, socio de un proveedor y las demás de la 179
   6. refrescar_familia_estado()             familia en el Estado (180)
   7. refrescar_socio_proveedor_locador()    el locador socio de un proveedor de su entidad (181)
   8. refrescar_persona_informe_control()    el locador que un informe de control de su entidad comprende y recibió
                                             órdenes de ella después (308)
   9. refrescar_planilla_extra()             pariente en la planilla, ascenso exprés, visita antes de entrar (182, 196)
  10. refrescar_reserva_parientes()          el caso reservado de una autoridad electa sale de las señales que nombran a
                                             un familiar, y con él la etiqueta del locador o de la planilla (311)
  11. refrescar_entidad_senal_politica()     cuántos de quienes financiaron al que gobierna trabajan en cada entidad (178)
  12. refrescar_organo_nombre_global()       nombres de oficinas con que el organigrama lee las siglas de la planilla (186)
  13. refrescar_personas_resumen()           el resumen de personas que leen las listas (104)

Cada paso abre su propia conexión por el túnel (infrastructure/aws/tunel_rds.py). Si el túnel corta una consulta larga
(~20 min sin datos), espera a que termine en el servidor y sigue con la siguiente. Un paso cuya función no existe en esa
base se salta. Al final muestra cuántas personas quedaron en la planilla de hoy y cuántas en «Trabajó antes».

    python backend/scripts/cadena_planilla.py dev
    python backend/scripts/cadena_planilla.py prod [--desde 2025-01-01 | --desde todo]
"""
from __future__ import annotations

import argparse
import re
import sys
import time
from pathlib import Path

import psycopg2

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

PASOS = [
    "refrescar_planilla()",
    "refrescar_personas_senales({desde})",
    "refrescar_nepotismo_senal()", "refrescar_senales_politicas()", "refrescar_senales_extra()", "refrescar_familia_estado()",
    "refrescar_socio_proveedor_locador()", "refrescar_persona_informe_control()", "refrescar_planilla_extra()",
    "refrescar_reserva_parientes()", "refrescar_entidad_senal_politica()",
    "refrescar_organo_nombre_global()",
    # Quien salió de una planilla queda con el cargo que tuvo más meses y su sueldo habitual (migración 357): antes del
    # índice, que lee ese cargo.
    "planilla_salida_cargo_principal()",
    # El índice de personas con cargo público (planilla de hoy y de antes, y declaraciones juradas; migración 319).
    "refrescar_funcionario_resumen()",
    "refrescar_personas_resumen()",
]


def activa(entorno: str, sql: str) -> bool:
    """¿Ese paso sigue corriendo en el servidor? (por ejemplo, el de una conexión que el túnel cortó)."""
    with conexion(entorno) as c:
        cur = c.cursor()
        cur.execute("SELECT count(*) FROM pg_stat_activity WHERE state <> 'idle' AND query = %s", (f"SELECT {sql}",))
        return cur.fetchone()[0] > 0


def esperar(entorno: str, sql: str) -> None:
    while activa(entorno, sql):
        time.sleep(60)


def main() -> int:
    ap = argparse.ArgumentParser(description="Corre la cadena de refrescos de la planilla, paso por paso.")
    ap.add_argument("entorno", choices=["dev", "prod"], help="dev = vigia-db-dev, prod = vigia-db")
    ap.add_argument("--desde", default="2025-01-01",
                    help="AAAA-MM-DD para refrescar_personas_senales (por defecto %(default)s); «todo» = toda la historia")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    if a.desde == "todo":
        desde = "NULL::DATE"
    elif re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.desde):
        desde = f"DATE '{a.desde}'"
    else:
        ap.error("--desde va como AAAA-MM-DD o «todo»")

    for paso in PASOS:
        sql = paso.format(desde=desde)
        esperar(a.entorno, sql)
        t = time.time()
        try:
            with conexion(a.entorno) as c:
                c.autocommit = True
                cur = c.cursor()
                cur.execute("SET statement_timeout = 0")
                cur.execute("SELECT to_regprocedure(%s) IS NOT NULL",
                            (sql.split("(")[0] + "(" + ("date" if "DATE" in sql else "") + ")",))
                if not cur.fetchone()[0]:
                    print(f"  {sql}: no existe", flush=True)
                    continue
                cur.execute(f"SELECT {sql}")
                print(f"  {sql} → {cur.fetchone()[0]} ({time.time() - t:.0f} s)", flush=True)
        except psycopg2.OperationalError as e:
            print(f"  {sql}: se cortó la conexión ({str(e).strip()[:70]}); espero a que termine en el servidor", flush=True)
            time.sleep(30)
            esperar(a.entorno, sql)
            print(f"  {sql}: terminó en el servidor ({time.time() - t:.0f} s)", flush=True)

    with conexion(a.entorno) as c:
        cur = c.cursor()
        cur.execute("SELECT count(*), count(DISTINCT entidad_ruc), max(ultimo_mes) FROM planilla_persona")
        print("planilla de hoy (personas, entidades, último mes):", cur.fetchone(), flush=True)
        cur.execute("SELECT to_regclass('planilla_salida') IS NOT NULL")
        if cur.fetchone()[0]:
            cur.execute("SELECT count(*), count(DISTINCT entidad_ruc) FROM planilla_salida")
            print("trabajaron antes (personas, entidades):", cur.fetchone(), flush=True)
    print("listo", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
