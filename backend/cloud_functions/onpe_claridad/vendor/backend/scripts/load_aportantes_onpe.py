"""
load_aportantes_onpe.py · normaliza dataset/lista_aportantes/lista-aportantes.csv
y lo carga a Cloud SQL (tabla onpe_aportantes).

CSV original (separador `;`):
  id;Razón Social / Apellido Paterno;Apellido Materno;Nombres;N° de DNI/RUC;<partido en col 5 raw>;Efectivo S/;Especie S/;Fecha del Aporte

Notas del formato:
  · Persona natural → cols 1-3 traen Ap1, Ap2, Nombres y col 4 trae DNI (8 dígitos).
  · Empresa       → col 1 trae razón social, cols 2-3 vacías, col 4 trae RUC (11).
  · Monto formato 'S/. 300.00' (puede venir vacío en efectivo o en especie).
  · Fecha DD/MM/YYYY.

Uso:
  # Con CSV local + Cloud SQL Auth Proxy en localhost:5432
  python backend/scripts/load_aportantes_onpe.py \
      --csv  dataset/lista_aportantes/lista-aportantes.csv \
      --dsn  "host=127.0.0.1 port=5432 dbname=vigia user=postgres password=$PGPASSWORD"

  # Dry-run (no escribe a DB, solo muestra parseo)
  python backend/scripts/load_aportantes_onpe.py --csv ... --dry-run
"""
from __future__ import annotations

import argparse
import csv
import sys
import unicodedata
from datetime import datetime
from decimal import Decimal, InvalidOperation

import psycopg2
import psycopg2.extras


def normalize_name(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.upper().strip()


def parse_money(s: str | None) -> Decimal | None:
    if not s:
        return None
    s = s.strip().replace("S/.", "").replace("S/", "").replace(",", "").strip()
    if not s:
        return None
    try:
        return Decimal(s)
    except InvalidOperation:
        return None


def parse_date(s: str | None) -> datetime | None:
    if not s:
        return None
    s = s.strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_row(row: list[str]) -> dict | None:
    """Devuelve dict listo para INSERT o None si la fila es inválida."""
    if len(row) < 9:
        return None
    _id, ap1, ap2, nombres, doc, partido, efectivo, especie, fecha = row[:9]

    doc = (doc or "").strip()
    es_empresa = len(doc) == 11
    es_persona = len(doc) == 8

    if es_persona:
        nombre = " ".join(filter(None, [ap1, ap2, nombres])).strip()
    elif es_empresa:
        nombre = ap1.strip()
    else:
        nombre = " ".join(filter(None, [ap1, ap2, nombres])).strip()

    if not nombre:
        return None

    monto_efectivo = parse_money(efectivo)
    monto_especie = parse_money(especie)
    monto_total = (monto_efectivo or Decimal(0)) + (monto_especie or Decimal(0))
    if monto_total == 0:
        monto_total = None

    fecha_d = parse_date(fecha)
    año = fecha_d.year if fecha_d else None

    if monto_efectivo and monto_especie:
        tipo = "mixto"
    elif monto_efectivo:
        tipo = "efectivo"
    elif monto_especie:
        tipo = "especie"
    else:
        tipo = None

    return {
        "numero_documento": doc if (es_persona or es_empresa) else None,
        "nombre": normalize_name(nombre),
        "nombre_original": nombre,
        "partido": (partido or "").strip(),
        "año": año,
        "fecha_aporte": fecha_d,
        "monto": monto_total,
        "tipo_aporte": tipo,
        "nivel": None,
        "fuente": "ONPE_Claridad",
        "fuente_url": "https://www.onpe.gob.pe/claridad/",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--dsn", required=False)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--truncate", action="store_true",
                    help="TRUNCATE onpe_aportantes antes de cargar")
    args = ap.parse_args()

    rows_ok = []
    rows_bad = 0
    with open(args.csv, encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f, delimiter=";", quotechar='"')
        next(reader)
        next(reader)
        for raw in reader:
            r = parse_row(raw)
            if r is None:
                rows_bad += 1
                continue
            rows_ok.append(r)

    print(f"[parse] válidas={len(rows_ok)}  descartadas={rows_bad}", file=sys.stderr)

    if args.dry_run:
        for r in rows_ok[:5]:
            print(r)
        return

    if not args.dsn:
        print("ERROR: --dsn requerido (o usá --dry-run)", file=sys.stderr)
        sys.exit(2)

    conn = psycopg2.connect(args.dsn)
    conn.autocommit = False
    with conn.cursor() as cur:
        if args.truncate:
            cur.execute("TRUNCATE onpe_aportantes RESTART IDENTITY")
            print("[db] TRUNCATE ejecutado", file=sys.stderr)

        psycopg2.extras.execute_batch(cur, """
            INSERT INTO onpe_aportantes
              (numero_documento, nombre, nombre_original, partido, año,
               fecha_aporte, monto, tipo_aporte, nivel, fuente, fuente_url)
            VALUES
              (%(numero_documento)s, %(nombre)s, %(nombre_original)s, %(partido)s, %(año)s,
               %(fecha_aporte)s, %(monto)s, %(tipo_aporte)s, %(nivel)s, %(fuente)s, %(fuente_url)s)
        """, rows_ok, page_size=500)
    conn.commit()
    print(f"[db] insertadas {len(rows_ok)} filas en onpe_aportantes", file=sys.stderr)
    conn.close()


if __name__ == "__main__":
    main()
