"""Normaliza el CSV de RNP — Conformación Jurídica — para carga a Cloud SQL.

Entrada: dataset/datos_complementarios/rnp_proveedores/conformacion_juridica.csv
  · Encoding: CP1252 (Windows ANSI)
  · Separador: |
  · 1.443.175 filas con header
  · Una persona puede aparecer múltiples veces con la misma empresa
    (roles distintos: socio + representante legal + órgano de administración).

Salida: dataset/datos_complementarios/rnp_proveedores/rnp_clean.csv
  · Encoding: UTF-8
  · Separador: ,  (coma — default de gcloud sql import csv)
  · Campos con coma interna van quoteados con " (csv.QUOTE_MINIMAL)
  · SIN header (Cloud SQL espera filas puras)
  · 9 columnas en orden fijo:
      fecha_corte, tipo_documento, numero_documento, nombre, nombre_original,
      ruc_empresa, tipo_rol, fecha_inicio_vigencia, id_forma_societaria,
      forma_societaria
  · Filtros aplicados:
      - Descarta filas con NUMERO_DOCUMENTO vacío, "NO ESPECIFICADO" o muy corto (<5 chars)
      - Descarta filas con RUC inválido (no 11 dígitos)
  · Normalizaciones:
      - numero_documento: strip espacios y tabs
      - nombre: UPPER + sin tildes (para joins)
      - nombre_original: como viene, sin modificar
      - fechas YYYYMMDD → YYYY-MM-DD
      - ruc: strip
"""
import csv
import re
import sys
import unicodedata
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent.parent  # raíz del repo
SRC = ROOT / "dataset/datos_complementarios/rnp_proveedores/conformacion_juridica.csv"
DST = ROOT / "dataset/datos_complementarios/rnp_proveedores/rnp_clean.csv"


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))


def normalize_name(s: str) -> str:
    """UPPER + sin tildes + colapso de espacios — para joins/búsquedas."""
    if not s:
        return ""
    s = strip_accents(s).upper()
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_date_yyyymmdd(s: str) -> str:
    """YYYYMMDD → YYYY-MM-DD. Retorna string vacío si inválido."""
    s = (s or "").strip()
    if len(s) != 8 or not s.isdigit():
        return ""
    yy, mm, dd = s[:4], s[4:6], s[6:8]
    if not (1900 <= int(yy) <= 2100 and 1 <= int(mm) <= 12 and 1 <= int(dd) <= 31):
        return ""
    return f"{yy}-{mm}-{dd}"


def main() -> int:
    if not SRC.exists():
        print(f"FATAL: no encuentro {SRC}", file=sys.stderr)
        return 1

    total = 0
    out_count = 0
    drop_no_esp = 0
    drop_short_doc = 0
    drop_invalid_ruc = 0
    drop_bad_fecha = 0

    with SRC.open("r", encoding="cp1252", errors="replace", newline="") as fi, \
         DST.open("w", encoding="utf-8", newline="") as fo:
        reader = csv.reader(fi, delimiter="|")
        writer = csv.writer(fo, delimiter=",", quoting=csv.QUOTE_MINIMAL,
                            lineterminator="\n")
        header = next(reader)
        if len(header) != 9 or header[0] != "FECHA_CORTE":
            print(f"FATAL: header inesperado: {header}", file=sys.stderr)
            return 2
        for row in reader:
            total += 1
            if len(row) != 9:
                continue
            (fecha_corte_raw, tipo_documento, numero_documento_raw, nombre_raw,
             ruc_raw, tipo_rol, fecha_vig_raw, id_forma, forma) = row

            numero_documento = numero_documento_raw.strip().replace("\t", "")
            if not numero_documento or numero_documento.upper() == "NO ESPECIFICADO":
                drop_no_esp += 1
                continue
            if len(numero_documento) < 5:
                drop_short_doc += 1
                continue

            ruc = ruc_raw.strip()
            if len(ruc) != 11 or not ruc.isdigit():
                drop_invalid_ruc += 1
                continue

            fecha_corte = parse_date_yyyymmdd(fecha_corte_raw)
            if not fecha_corte:
                drop_bad_fecha += 1
                continue
            fecha_vig = parse_date_yyyymmdd(fecha_vig_raw)  # vacío si inválido

            nombre_original = nombre_raw.strip()
            nombre = normalize_name(nombre_original)

            writer.writerow([
                fecha_corte,
                tipo_documento.strip(),
                numero_documento,
                nombre,
                nombre_original,
                ruc,
                tipo_rol.strip(),
                fecha_vig,  # puede ser ""
                id_forma.strip(),
                forma.strip(),
            ])
            out_count += 1

    print(f"Procesadas:     {total:>10,}")
    print(f"Escritas:       {out_count:>10,}")
    print(f"Descartes:")
    print(f"  numero_doc vacío/NO ESPECIFICADO: {drop_no_esp:,}")
    print(f"  numero_doc muy corto (<5):       {drop_short_doc:,}")
    print(f"  ruc inválido:                    {drop_invalid_ruc:,}")
    print(f"  fecha_corte inválida:            {drop_bad_fecha:,}")
    print(f"\nSalida: {DST}")
    print(f"Tamaño: {DST.stat().st_size / 1024 / 1024:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
