#!/usr/bin/env python3
"""Carga `gobierno_periodo` (migración 41): quién gobierna cada región, provincia y distrito en cada
período, a partir de los mismos archivos del JNE que muestra el mapa de partidos
(frontend/public/data/autoridades-<anio>.json, que genera backend/scripts/generar_autoridades.py).

Cada elección gobierna del 1 de enero del año siguiente al 31 de diciembre del cuarto año:
  2014 → 2015-01-01 a 2018-12-31 · 2018 → 2019-01-01 a 2022-12-31 · 2022 → 2023-01-01 a 2026-12-31.

El distrito se busca por (provincia, nombre) en `zonas`, porque el archivo del JNE no trae el ubigeo
del distrito (sí el de la provincia). Lo que no se pueda emparejar NO se inventa: se cuenta y se informa.

Conexión: PGHOST / PGPORT / PGUSER / PGDATABASE / PGPASSWORD / PGSSLMODE (como backend/db/apply_all.py).
Uso:  python backend/scripts/cargar_gobiernos.py [--seco]     (--seco: sólo informa, no escribe)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import date
from pathlib import Path

import psycopg2

RAIZ = Path(__file__).resolve().parents[2]
DATOS = RAIZ / "frontend" / "public" / "data"
PERIODOS = {2014: (date(2015, 1, 1), date(2018, 12, 31)), 2018: (date(2019, 1, 1), date(2022, 12, 31)), 2022: (date(2023, 1, 1), date(2026, 12, 31))}


def normalizar(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def clave_org(nombre: str) -> str:
    return re.sub(r"\s+", "-", normalizar(nombre))[:80]


def conectar():
    return psycopg2.connect(
        host=os.getenv("PGHOST", "127.0.0.1"), port=int(os.getenv("PGPORT", "5432")), user=os.getenv("PGUSER", "postgres"),
        dbname=os.getenv("PGDATABASE", "vigia"), password=os.getenv("PGPASSWORD", ""), sslmode=os.getenv("PGSSLMODE", "prefer"),
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seco", action="store_true")
    args = ap.parse_args()

    con = conectar()
    cur = con.cursor()
    # distritos por (ubigeo de provincia, nombre normalizado)
    cur.execute("SELECT padre_ubigeo, ubigeo, nombre FROM zonas WHERE nivel = 'distrito'")
    distritos: dict[tuple[str, str], str] = {(p, normalizar(n)): u for p, u, n in cur.fetchall()}
    cur.execute("SELECT ubigeo FROM zonas WHERE nivel = 'provincia'")
    provincias = {u for (u,) in cur.fetchall()}
    cur.execute("SELECT ubigeo FROM zonas WHERE nivel = 'departamento'")
    departamentos = {u for (u,) in cur.fetchall()}

    filas: list[tuple] = []
    resumen: dict[int, dict[str, int]] = {}
    for anio, (desde, hasta) in PERIODOS.items():
        d = json.loads((DATOS / f"autoridades-{anio}.json").read_text(encoding="utf-8"))
        orgs = d["orgs"]
        cuenta = {"regional": 0, "provincial": 0, "distrital": 0, "sin_ubigeo": 0}

        def fila(nivel: str, ubigeo: str, autoridad: str | None, o: int) -> None:
            org = orgs[o]
            filas.append((nivel, ubigeo, anio, desde, hasta, autoridad, clave_org(org["n"]), org["n"], org.get("t")))
            cuenta[nivel] += 1

        for g in d["regional"]:
            if g["u"] in departamentos:
                fila("regional", g["u"], g.get("g"), g["o"])
            else:
                cuenta["sin_ubigeo"] += 1
        for g in d["provincial"]:
            if g["u"] in provincias:
                fila("provincial", g["u"], g.get("a"), g["o"])
            else:
                cuenta["sin_ubigeo"] += 1
        for g in d["distrital"]:
            u = distritos.get((g["u"], normalizar(g["n"])))
            if u:
                fila("distrital", u, g.get("a"), g["o"])
            else:
                cuenta["sin_ubigeo"] += 1
        resumen[anio] = cuenta

    for anio, c in resumen.items():
        print(anio, c)
    print("filas:", len(filas))
    if args.seco:
        return

    cur.execute("TRUNCATE gobierno_periodo")
    cur.executemany(
        "INSERT INTO gobierno_periodo (nivel, ubigeo, anio_eleccion, desde, hasta, autoridad, org_clave, org_nombre, org_tipo) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING",
        filas,
    )
    con.commit()
    print("cargado")


if __name__ == "__main__":
    sys.exit(main())
