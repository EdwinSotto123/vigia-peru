"""Normaliza el CSV estructurado de opiniones OECE para Cloud SQL.

Entrada: dataset/opiniones_oece_estructurado.csv
  · Encoding: UTF-8 con BOM
  · Separador: ;
  · 721 filas (333 opiniones únicas — varias filas por opinión, una por artículo)
  · Columnas: AÑO_OPINION, NORMA, NUM_OPINION, Artículos de la Ley,
    Numeral del Art. Ley, Literal del Art. Ley, Artículos del Reglamento,
    INTERPRETACIÓN, LINK_DOCUMENTO

Salida: dataset/opiniones_oece_estructurado_clean.csv (UTF-8, coma-delim).

Limpiezas:
  · Trim de todos los campos.
  · año: removemos comas y validamos entero 2010-2099.
  · norma: normalizamos espacios.
  · num_opinion: trim.
  · INTERPRETACIÓN: colapsa whitespace múltiple (incluye saltos de línea internos)
    a UN espacio para que el CSV de salida quede en 1 línea por fila.
  · link: trim.
"""
import csv
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent  # raíz del repo
SRC = ROOT / "dataset/opiniones_oece_estructurado.csv"
DST = ROOT / "dataset/opiniones_oece_estructurado_clean.csv"


def collapse_ws(s: str) -> str:
    if not s:
        return ""
    s = s.replace("\r", " ").replace("\n", " ").replace("\t", " ")
    s = re.sub(r"\s{2,}", " ", s)
    return s.strip()


def main() -> int:
    if not SRC.exists():
        print(f"FATAL: no encuentro {SRC}", file=sys.stderr)
        return 1
    total = 0
    out_count = 0
    dropped = 0
    with SRC.open("r", encoding="utf-8-sig", newline="") as fi, \
         DST.open("w", encoding="utf-8", newline="") as fo:
        reader = csv.reader(fi, delimiter=";")
        writer = csv.writer(fo, delimiter=",", quoting=csv.QUOTE_MINIMAL,
                            lineterminator="\n")
        header = next(reader)
        if len(header) != 9:
            print(f"FATAL: header inesperado: {header}", file=sys.stderr)
            return 2
        for row in reader:
            total += 1
            if len(row) != 9:
                dropped += 1
                continue
            (ano_raw, norma, num_opinion, art_ley, numeral_art,
             literal_art, art_reglamento, interpretacion, link) = row
            ano = ano_raw.replace(",", "").replace(".", "").strip()
            try:
                ano_int = int(ano)
                if not (2010 <= ano_int <= 2099):
                    dropped += 1
                    continue
            except ValueError:
                dropped += 1
                continue
            interpretacion_clean = collapse_ws(interpretacion)
            if not interpretacion_clean:
                dropped += 1
                continue
            link = (link or "").strip()
            writer.writerow([
                ano_int,
                norma.strip(),
                num_opinion.strip(),
                art_ley.strip(),
                numeral_art.strip(),
                literal_art.strip(),
                art_reglamento.strip(),
                interpretacion_clean,
                link,
            ])
            out_count += 1
    print(f"Procesadas: {total}")
    print(f"Escritas:   {out_count}")
    print(f"Descartes:  {dropped}")
    print(f"Salida:     {DST}")
    print(f"Tamaño:     {DST.stat().st_size / 1024:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
