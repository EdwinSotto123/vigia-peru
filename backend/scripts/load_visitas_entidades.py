"""
load_visitas_entidades.py · normaliza dataset/VISITANTES_ENTIDADES/visita_a_entidades.xlsx
→ tabla visitas_entidades (Cloud SQL).

Parsing crítico:
  · "Documento del visitante" = "DNI 42456062" | "CE 12345" | "PASAPORTE X" → split(' ', 1)
  · "Entidad del visitante" tres formatos:
      - "Entidad pública - <RAZON SOCIAL>"   → tipo='publica',    entidad=razon
      - "Entidad privada - <RAZON SOCIAL>"   → tipo='privada',    entidad=razon
      - "Persona natural - a titulo personal" → tipo='persona_natural', entidad=NULL
  · "Funcionario visitado" = "APELLIDOS NOMBRES - AREA - CARGO" → rsplit(' - ', 2)
    (98.3% tiene 2 dashes; 327 tienen 3, donde 'AREA' tiene su propio dash interno)
  · Horas vienen como "HH:MM" string.

Uso:
  python backend/scripts/load_visitas_entidades.py \
      --xlsx dataset/VISITANTES_ENTIDADES/visita_a_entidades.xlsx \
      --dsn  "host=... port=5432 dbname=vigia user=postgres password=..." \
      --truncate
"""
from __future__ import annotations

import argparse
import sys
import unicodedata
from datetime import datetime, time, timedelta

import openpyxl
import psycopg2
import psycopg2.extras


def clean(v) -> str:
    if v is None:
        return ""
    return str(v).replace("\xa0", " ").strip()


def normalize_name(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.upper().strip()


def parse_date(s):
    if isinstance(s, datetime):
        return s.date()
    s = clean(s)
    if not s:
        return None
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def parse_time(s):
    if isinstance(s, time):
        return s
    s = clean(s)
    if not s:
        return None
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).time()
        except ValueError:
            continue
    return None


def parse_documento(raw: str) -> tuple[str | None, str | None]:
    s = clean(raw)
    if not s:
        return None, None
    parts = s.split(None, 1)
    if len(parts) == 2:
        tipo, num = parts[0].upper(), parts[1].strip()
        if tipo.startswith("PASAP"):
            tipo = "PASAPORTE"
        return tipo, num
    return "DESCONOCIDO", s


def parse_entidad_visitante(raw: str) -> tuple[str | None, str | None]:
    s = clean(raw)
    if not s:
        return None, None
    lower = s.lower()
    if lower.startswith("entidad pública") or lower.startswith("entidad publica"):
        return "publica", s.split(" - ", 1)[1] if " - " in s else None
    if lower.startswith("entidad privada"):
        return "privada", s.split(" - ", 1)[1] if " - " in s else None
    if lower.startswith("persona natural"):
        return "persona_natural", None
    return "desconocido", s


def parse_funcionario(raw: str) -> tuple[str | None, str | None, str | None]:
    """APELLIDOS NOMBRES - AREA - CARGO → (nombre, area, cargo)
    Usa rsplit para tolerar dashes dentro del nombre del área."""
    s = clean(raw)
    if not s:
        return None, None, None
    parts = s.rsplit(" - ", 2)
    if len(parts) == 3:
        return parts[0].strip(), parts[1].strip(), parts[2].strip()
    if len(parts) == 2:
        return parts[0].strip(), None, parts[1].strip()
    return s, None, None


def duracion_minutos(ti, to) -> int | None:
    if ti is None or to is None:
        return None
    today = datetime(2000, 1, 1)
    d_in = datetime.combine(today, ti)
    d_out = datetime.combine(today, to)
    if d_out < d_in:
        d_out += timedelta(days=1)
    return int((d_out - d_in).total_seconds() // 60)


def parse_row(row: tuple) -> dict | None:
    if len(row) < 12:
        return None
    visitante = clean(row[3])
    entidad_visitada = clean(row[2])
    if not visitante or not entidad_visitada:
        return None
    tipo_doc, num_doc = parse_documento(clean(row[4]))
    tipo_ent, ent_vis = parse_entidad_visitante(clean(row[5]))
    f_nombre, f_area, f_cargo = parse_funcionario(clean(row[6]))
    ti = parse_time(row[7])
    to = parse_time(row[8])
    return {
        "fecha_registro": parse_date(row[0]),
        "fecha_visita": parse_date(row[1]),
        "entidad_visitada": entidad_visitada,
        "entidad_visitada_norm": normalize_name(entidad_visitada),
        "visitante": visitante,
        "visitante_norm": normalize_name(visitante),
        "tipo_documento": tipo_doc,
        "numero_documento": num_doc,
        "tipo_entidad_visitante": tipo_ent,
        "entidad_visitante": ent_vis,
        "funcionario_visitado": clean(row[6]) or None,
        "funcionario_nombre": normalize_name(f_nombre) if f_nombre else None,
        "funcionario_area": f_area,
        "funcionario_cargo": f_cargo,
        "hora_ingreso": ti,
        "hora_salida": to,
        "duracion_min": duracion_minutos(ti, to),
        "motivo": clean(row[9]) or None,
        "lugar_especifico": clean(row[10]) or None,
        "observacion": clean(row[11]) or None,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--dsn", required=False)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--truncate", action="store_true")
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.xlsx, read_only=True, data_only=True)
    ws = wb.active

    rows: list[dict] = []
    bad = 0
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i == 0:
            continue
        r = parse_row(row)
        if r is None:
            bad += 1
            continue
        rows.append(r)
    wb.close()

    print(f"[parse] válidas={len(rows)}  descartadas={bad}", file=sys.stderr)

    if args.dry_run:
        for r in rows[:3]:
            print(r)
        return

    if not args.dsn:
        print("ERROR: --dsn requerido (o --dry-run)", file=sys.stderr)
        sys.exit(2)

    conn = psycopg2.connect(args.dsn)
    conn.autocommit = False
    with conn.cursor() as cur:
        if args.truncate:
            cur.execute("TRUNCATE visitas_entidades RESTART IDENTITY")
            print("[db] TRUNCATE ejecutado", file=sys.stderr)
        psycopg2.extras.execute_batch(cur, """
            INSERT INTO visitas_entidades (
              fecha_registro, fecha_visita, entidad_visitada, entidad_visitada_norm,
              visitante, visitante_norm, tipo_documento, numero_documento,
              tipo_entidad_visitante, entidad_visitante,
              funcionario_visitado, funcionario_nombre, funcionario_area, funcionario_cargo,
              hora_ingreso, hora_salida, duracion_min, motivo, lugar_especifico, observacion
            ) VALUES (
              %(fecha_registro)s, %(fecha_visita)s, %(entidad_visitada)s, %(entidad_visitada_norm)s,
              %(visitante)s, %(visitante_norm)s, %(tipo_documento)s, %(numero_documento)s,
              %(tipo_entidad_visitante)s, %(entidad_visitante)s,
              %(funcionario_visitado)s, %(funcionario_nombre)s, %(funcionario_area)s, %(funcionario_cargo)s,
              %(hora_ingreso)s, %(hora_salida)s, %(duracion_min)s, %(motivo)s, %(lugar_especifico)s, %(observacion)s
            )
        """, rows, page_size=1000)
    conn.commit()
    print(f"[db] insertadas {len(rows)} filas en visitas_entidades", file=sys.stderr)
    conn.close()


if __name__ == "__main__":
    main()
