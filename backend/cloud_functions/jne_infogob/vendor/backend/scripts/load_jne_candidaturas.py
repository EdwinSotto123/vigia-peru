"""
load_jne_candidaturas.py · normaliza TODOS los XLSX de candidatos/autoridades JNE
en dataset/ELECCIONES/* y dataset/postulantes_congreso/* → tabla jne_candidaturas.

Estructura de carpetas:
  dataset/ELECCIONES/<TIPO> <AÑO>/<EG|ERM>AÑO_(Candidatos|Autoridades)_X.xlsx
  dataset/postulantes_congreso/postulantes_congreso_2021.xlsx
  dataset/postulantes_congreso/congreso_electo_2021.csv

Cada archivo trae columnas distintas; el loader las detecta por nombre.
Si la fila viene de un archivo "Autoridades" → resultado='electo'; si viene de
"Candidatos" → resultado='no_electo'. Quien ganó está en los dos: unificar() deja una
fila por candidatura (antes se daba por hecho que no se cruzaban y cada ganador quedaba
como «elegido» y «no elegido» a la vez; migración 210).

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


def _cargo_clave(cargo: str | None) -> str:
    """El cargo para comparar entre archivos: el de congresista y el del Parlamento Andino se escriben distinto en cada uno."""
    c = re.sub(r"[^A-Z0-9 ]+", " ", normalize_name(cargo or "")).split()
    t = " ".join(c)
    if "PARLAMENTO ANDINO" in t:
        return "PARLAMENTO ANDINO"
    if t.startswith("CONGRESISTA"):
        return "CONGRESISTA"
    return t


def _lugar(r: dict) -> tuple[str, str, str]:
    return tuple(" ".join(re.sub(r"[^A-Z0-9 ]+", " ", normalize_name(r.get(k) or "")).split()) for k in ("region", "provincia", "distrito"))


def unificar(rows: list[dict]) -> list[dict]:
    """Una fila por candidatura. Quien ganó viene en el archivo «Candidatos» (no_electo) y en el de «Autoridades» (electo):
    sin esto quedaba dos veces, «fue elegido» y «no fue elegido» en la misma elección (2026-10-29: 38 mil en PROD; la
    migración 210 limpió las ya cargadas con estas mismas reglas).
      1. Gemelas (misma persona, año, cargo y lugar; congreso y Parlamento Andino sin lugar): queda la electo, con el número
         en la lista de la otra.
      2. Postuló a un cargo del concejo y figura como autoridad con otro del mismo concejo (regidor que hoy es alcalde): queda
         la candidatura, como electo."""
    nacional = ("CONGRESISTA", "PARLAMENTO ANDINO")
    clave = lambda r: (r["nombre"], r["año"], _cargo_clave(r["cargo"]), () if _cargo_clave(r["cargo"]) in nacional else _lugar(r))
    electos: dict[tuple, dict] = {}
    for r in rows:
        if r["resultado"] == "electo":
            electos.setdefault(clave(r), r)
    con_gemela: set[int] = set()
    out = []
    for r in rows:
        if r["resultado"] == "no_electo":
            e = electos.get(clave(r))
            if e is not None:
                if e.get("numero_lista") is None:
                    e["numero_lista"] = r.get("numero_lista")
                con_gemela.add(id(e))
                continue
        out.append(r)
    municipal = re.compile(r"^(ALCALDE|REGIDOR|ACCESITARIO)")
    por_lugar: dict[tuple, list[dict]] = {}
    for r in out:
        if r["resultado"] == "electo" and id(r) not in con_gemela and municipal.match(_cargo_clave(r["cargo"])):
            por_lugar.setdefault((r["nombre"], r["año"], _lugar(r)), []).append(r)
    quitar: set[int] = set()
    for r in out:
        if r["resultado"] == "no_electo" and municipal.match(_cargo_clave(r["cargo"])):
            e = next((x for x in por_lugar.get((r["nombre"], r["año"], _lugar(r)), []) if id(x) not in quitar), None)
            if e is not None and _cargo_clave(e["cargo"]) != _cargo_clave(r["cargo"]):
                r["resultado"] = "electo"
                quitar.add(id(e))
    print(f"[unificar] {len(rows) - len(out)} gemelas, {len(quitar)} del mismo concejo", file=sys.stderr)
    return [r for r in out if id(r) not in quitar]


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
    all_rows = unificar(all_rows)

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
