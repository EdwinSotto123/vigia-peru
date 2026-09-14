"""
load_jne_candidaturas.py · normaliza TODOS los XLSX de candidatos/autoridades JNE
en dataset/ELECCIONES/* y dataset/postulantes_congreso/* → tabla jne_candidaturas.

Estructura de carpetas:
  dataset/ELECCIONES/<TIPO> <AÑO>/<EG|ERM>AÑO_(Candidatos|Autoridades)_X.xlsx
  dataset/postulantes_congreso/postulantes_congreso_2021.xlsx
  dataset/postulantes_congreso/congreso_electo_2021.csv

Cada archivo trae columnas distintas; el loader las detecta por nombre.
Si la fila viene de un archivo "Autoridades" → resultado='electo'; si viene de
"Candidatos" → resultado='no_electo' (a menos que también aparezca en Autoridades,
caso que NO se cruza acá — se asume disjoint, y el motor de reglas puede
deduplicar por nombre+partido+año).

Uso:
  python backend/scripts/load_jne_candidaturas.py \
      --root dataset/ELECCIONES \
      --congreso dataset/postulantes_congreso \
      --dsn "host=127.0.0.1 port=5432 dbname=vigia user=postgres password=$PGPASSWORD"

  python backend/scripts/load_jne_candidaturas.py --root dataset/ELECCIONES --dry-run
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import unicodedata
from pathlib import Path

import openpyxl
import psycopg2
import psycopg2.extras


def normalize_name(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFD", str(s))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.upper().strip()


def detect_year_from_path(p: Path) -> int | None:
    m = re.search(r"(20\d{2})", p.stem) or re.search(r"(20\d{2})", str(p.parent))
    return int(m.group(1)) if m else None


def detect_resultado(p: Path) -> str:
    name = p.stem.lower()
    if "autoridad" in name or "electo" in name:
        return "electo"
    if "candidato" in name or "postulante" in name:
        return "no_electo"
    return "no_electo"


def detect_cargo_from_path(p: Path) -> str | None:
    name = p.stem.upper()
    if "REGIONAL" in name and "CONSEJERO" not in name:
        return "GOBERNADOR_REGIONAL"
    if "CONSEJERO" in name:
        return "CONSEJERO_REGIONAL"
    if "PROVINCIAL" in name:
        return "ALCALDE_PROVINCIAL"
    if "DISTRITAL" in name:
        return "ALCALDE_DISTRITAL"
    if "CONGRES" in name:
        return "CONGRESISTA"
    if "PARLAMENTO_ANDINO" in name or "PARLAMENTOANDINO" in name or "PARLAMENTO ANDINO" in name:
        return "PARLAMENTO_ANDINO"
    return None


def column_index_map(header: tuple) -> dict[str, int]:
    """Mapea header bruto a slots conocidos. Tolerante a variaciones."""
    m: dict[str, int] = {}
    for i, raw in enumerate(header):
        if not raw:
            continue
        k = normalize_name(str(raw))
        if k in ("REGION", "REGION/DEPARTAMENTO"):
            m["region"] = i
        elif k == "DISTRITO ELECTORAL":
            m["region"] = i
        elif k == "PROVINCIA":
            m["provincia"] = i
        elif k == "DISTRITO":
            m["distrito"] = i
        elif k in ("ORGANIZACION POLITICA", "ORGANIZACION POLITICA/ALIANZA"):
            m["partido"] = i
        elif k in ("CARGO", "CARGO ELECTO"):
            m["cargo"] = i
        elif k in ("PRIMER APELLIDO", "APELLIDO PATERNO"):
            m["ap1"] = i
        elif k in ("SEGUNDO APELLIDO", "APELLIDO MATERNO"):
            m["ap2"] = i
        elif k in ("PRENOMBRES", "NOMBRES"):
            m["nombres"] = i
        elif k in ("N", "NÂ°", "NUMERO", "Nº", "N°", "POSICION"):
            m["numero_lista"] = i
    return m


def parse_xlsx(path: Path) -> list[dict]:
    año = detect_year_from_path(path)
    resultado = detect_resultado(path)
    cargo_default = detect_cargo_from_path(path)

    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active

    header = None
    out = []
    for row in ws.iter_rows(values_only=True):
        if header is None:
            header = row
            colmap = column_index_map(header)
            if "ap1" not in colmap or "nombres" not in colmap:
                wb.close()
                return []
            continue
        if row is None or all(c is None for c in row):
            continue

        def g(k: str) -> str:
            i = colmap.get(k)
            if i is None or i >= len(row):
                return ""
            v = row[i]
            return "" if v is None else str(v).strip()

        ap1 = g("ap1")
        ap2 = g("ap2")
        nombres = g("nombres")
        full = " ".join(filter(None, [ap1, ap2, nombres])).strip()
        if not full:
            continue
        cargo = g("cargo") or cargo_default
        partido = g("partido")
        region = g("region")
        provincia = g("provincia")
        distrito = g("distrito")
        numero_lista = g("numero_lista")
        try:
            numero_lista_int = int(numero_lista) if numero_lista else None
        except ValueError:
            numero_lista_int = None

        out.append({
            "numero_documento": None,
            "nombre": normalize_name(full),
            "nombre_original": full,
            "partido": partido,
            "año": año,
            "cargo": cargo,
            "resultado": resultado,
            "region": region,
            "provincia": provincia,
            "distrito": distrito,
            "numero_lista": numero_lista_int,
            "fuente": "JNE_PNDA",
            "fuente_url": f"file://{path.name}",
        })
    wb.close()
    return out


def parse_csv_electos(path: Path) -> list[dict]:
    """Parser específico para congreso_electo_2021.csv"""
    año = 2021
    out = []
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=";")
        for r in reader:
            ap1 = (r.get("Primer apellido") or "").strip()
            ap2 = (r.get("Segundo apellido") or "").strip()
            nombres = (r.get("Prenombres") or "").strip()
            full = " ".join(filter(None, [ap1, ap2, nombres])).strip()
            if not full:
                continue
            out.append({
                "numero_documento": None,
                "nombre": normalize_name(full),
                "nombre_original": full,
                "partido": (r.get("Organización Política") or "").strip(),
                "año": año,
                "cargo": "CONGRESISTA",
                "resultado": "electo",
                "region": (r.get("Distrito Electoral") or "").strip(),
                "provincia": None,
                "distrito": None,
                "numero_lista": None,
                "fuente": "JNE_PNDA",
                "fuente_url": f"file://{path.name}",
            })
    return out


def walk_root(root: Path) -> list[Path]:
    return [p for p in root.rglob("*.xlsx") if not p.name.startswith("~$")]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="dataset/ELECCIONES")
    ap.add_argument("--congreso", required=False, help="dataset/postulantes_congreso")
    ap.add_argument("--dsn", required=False)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--truncate", action="store_true")
    args = ap.parse_args()

    all_rows: list[dict] = []
    for x in walk_root(Path(args.root)):
        rows = parse_xlsx(x)
        print(f"  [{x.relative_to(args.root)}] {len(rows)} filas", file=sys.stderr)
        all_rows.extend(rows)

    if args.congreso:
        for x in Path(args.congreso).glob("*.xlsx"):
            if x.name.startswith("~$"):
                continue
            rows = parse_xlsx(x)
            print(f"  [{x.name}] {len(rows)} filas", file=sys.stderr)
            all_rows.extend(rows)
        for x in Path(args.congreso).glob("*.csv"):
            rows = parse_csv_electos(x)
            print(f"  [{x.name}] {len(rows)} filas", file=sys.stderr)
            all_rows.extend(rows)

    print(f"\n[parse] total filas={len(all_rows)}", file=sys.stderr)

    if args.dry_run:
        for r in all_rows[:3]:
            print(r)
        print("...")
        for r in all_rows[-3:]:
            print(r)
        return

    if not args.dsn:
        print("ERROR: --dsn requerido (o --dry-run)", file=sys.stderr)
        sys.exit(2)

    conn = psycopg2.connect(args.dsn)
    conn.autocommit = False
    with conn.cursor() as cur:
        if args.truncate:
            cur.execute("TRUNCATE jne_candidaturas RESTART IDENTITY")
            print("[db] TRUNCATE ejecutado", file=sys.stderr)

        psycopg2.extras.execute_batch(cur, """
            INSERT INTO jne_candidaturas
              (numero_documento, nombre, nombre_original, partido, año, cargo,
               resultado, region, provincia, distrito, numero_lista, fuente, fuente_url)
            VALUES
              (%(numero_documento)s, %(nombre)s, %(nombre_original)s, %(partido)s, %(año)s, %(cargo)s,
               %(resultado)s, %(region)s, %(provincia)s, %(distrito)s, %(numero_lista)s, %(fuente)s, %(fuente_url)s)
        """, all_rows, page_size=1000)
    conn.commit()
    print(f"[db] insertadas {len(all_rows)} filas en jne_candidaturas", file=sys.stderr)
    conn.close()


if __name__ == "__main__":
    main()
