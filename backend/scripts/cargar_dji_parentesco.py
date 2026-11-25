#!/usr/bin/env python3
"""Carga `dji_parentesco` (migración 133): grados de parentesco declarados por cada DJI, agregados por codigo_ddjj.

Lee el CSV masivo de "Familiares declarados" de la Contraloría (Reporte2, ~15.9M filas, 4 columnas:
CODIGO_DDJJ, FECHA_ELABORACION_DDJJ, TIPO_DOCUMENTO_FAMILIAR, PARENTESCO). El dato abierto NO trae nombre ni
DNI del pariente, solo el parentesco; por eso aquí solo contamos grados por declaración (ver la migración).

  python backend/scripts/cargar_dji_parentesco.py --entorno dev
  python backend/scripts/cargar_dji_parentesco.py --entorno prod --csv "ruta/ListadoFamiliares.csv" [--seco]

Desde el 2026-11-25 (migración 445) anota cada carga en `dji_parentesco_carga` con la fecha más nueva del archivo: una
declaración más antigua que no tenga fila aquí es una que no declara familiares (funcionario_dji_estado). La Contraloría
publicó el 2026-11-02 `ListadoFamiliares.csv` (16.9 M filas, al 28 de octubre de 2026), que contiene todo el Reporte2.

Requiere psycopg2, la CLI de AWS y session-manager-plugin (túnel de infrastructure/aws/tunel_rds.py).
"""
from __future__ import annotations

import argparse
import csv
import io
import sys
import time
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

CSV_DEFECTO = r"C:\Users\usuario\Desktop\PROYECTOS\vigia-peru\dataset\declaracion_jurada\listado_2026_11\ListadoFamiliares.csv"

# índice en la tupla [hermanos, hijos, padres, conyuge, otros]
HERMANOS, HIJOS, PADRES, CONYUGE, OTROS = 0, 1, 2, 3, 4


def grupo(parentesco: str) -> int:
    p = parentesco.strip().upper()
    if p == "HERMANO(A) DEL DECLARANTE":
        return HERMANOS
    if p == "HIJO(A)":
        return HIJOS
    if p in ("PADRE DEL DECLARANTE", "MADRE DEL DECLARANTE"):
        return PADRES
    if p in ("CONYUGE", "CÓNYUGE", "CONVIVIENTE"):
        return CONYUGE
    return OTROS


def fecha(t: str) -> date | None:
    """«17/09/23» → 2023-09-17 (la fecha de elaboración del archivo); None si no se entiende."""
    try:
        d, m, a = t.strip().split("/")
        return date(2000 + int(a) if len(a) == 2 else int(a), int(m), int(d))
    except ValueError:
        return None


def agregar(csv_path: str) -> tuple[dict[int, list[int]], int, date | None]:
    acc: dict[int, list[int]] = {}
    n = 0
    hasta: date | None = None
    hoy = date.today()
    t0 = time.time()
    with open(csv_path, encoding="utf-8", errors="replace", newline="") as f:
        r = csv.reader(f)
        next(r, None)  # cabecera
        for row in r:
            if len(row) < 4:
                continue
            try:
                cod = int(row[0])
            except ValueError:
                continue
            fila = acc.get(cod)
            if fila is None:
                fila = [0, 0, 0, 0, 0]
                acc[cod] = fila
            fila[grupo(row[3])] += 1
            n += 1
            f = fecha(row[1])
            if f and f <= hoy and (hasta is None or f > hasta):
                hasta = f
            if n % 2_000_000 == 0:
                print(f"  {n:,} filas, {len(acc):,} declaraciones ({int(time.time() - t0)}s)", flush=True)
    print(f"  total {n:,} filas → {len(acc):,} declaraciones, la más nueva del {hasta} ({int(time.time() - t0)}s)", flush=True)
    return acc, n, hasta


def cargar(entorno: str, acc: dict[int, list[int]], archivo: str, filas_csv: int, hasta: date | None) -> None:
    buf = io.StringIO()
    w = csv.writer(buf)
    for cod, (h, hi, pa, co, ot) in acc.items():
        w.writerow([cod, h, hi, pa, co, ot, h + hi + pa + co + ot])
    buf.seek(0)
    with conexion(entorno) as c:
        cur = c.cursor()
        cur.execute("TRUNCATE dji_parentesco")
        cur.copy_expert(
            "COPY dji_parentesco (codigo_ddjj, n_hermanos, n_hijos, n_padres, n_conyuge, n_otros, n_total) "
            "FROM STDIN WITH (FORMAT csv)", buf)
        # En la misma transacción: la carga y su fecha de corte (migración 445; sin la tabla, se omite).
        cur.execute("SELECT to_regclass('public.dji_parentesco_carga') IS NOT NULL")
        if cur.fetchone()[0]:
            cur.execute("INSERT INTO dji_parentesco_carga (archivo, filas, declaraciones, hasta) VALUES (%s, %s, %s, %s)",
                        (Path(archivo).name, filas_csv, len(acc), hasta))
        c.commit()
        cur.execute("SELECT count(*), sum(n_total), count(*) FILTER (WHERE n_hermanos > 0) FROM dji_parentesco")
        filas, parientes, con_hermano = cur.fetchone()
        print(f"✓ {entorno}: {filas:,} declaraciones, {parientes:,} parientes; {con_hermano:,} declararon ≥1 hermano")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entorno", choices=["dev", "prod"], required=True)
    ap.add_argument("--csv", default=CSV_DEFECTO)
    ap.add_argument("--seco", action="store_true", help="sólo agrega y cuenta; no escribe")
    a = ap.parse_args()
    print(f"Agregando {a.csv} …", flush=True)
    acc, filas_csv, hasta = agregar(a.csv)
    if a.seco:
        print(f"(seco) {len(acc):,} declaraciones, {sum(sum(x) for x in acc.values()):,} familiares, hasta {hasta}")
        return
    cargar(a.entorno, acc, a.csv, filas_csv, hasta)


if __name__ == "__main__":
    main()
