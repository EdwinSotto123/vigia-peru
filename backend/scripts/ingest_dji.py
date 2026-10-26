#!/usr/bin/env python3
"""Lee los PDFs de DJI bajados (scrape_dji.py) y carga los parientes en `dji_vinculos` (migración 134).

Atribución a nivel ENTIDAD (primer pase): el RUC de la entidad sale del nombre del archivo
(<entidad_ruc>_<apellidos>.pdf); los parientes se deduplican por (entidad_ruc, pariente_doc). Idempotente:
borra y recarga los vínculos de cada entidad que procesa. La identidad del pariente es interna (ver migración).

  python backend/scripts/ingest_dji.py --entorno prod --pdfs dataset/declaracion_jurada/pdfs
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from tunel_rds import conexion              # noqa: E402
from parse_dji_pdf import familiares_pdf    # noqa: E402

_norm = lambda s: " ".join((s or "").split()).upper()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entorno", choices=["dev", "prod"], required=True)
    ap.add_argument("--pdfs", default=r"dataset/declaracion_jurada/pdfs")
    a = ap.parse_args()
    pdfs = sorted(Path(a.pdfs).glob("*.pdf"))
    print(f"{len(pdfs)} PDFs en {a.pdfs}")

    total_v = total_e = fallos = 0
    with conexion(a.entorno) as c:
        cur = c.cursor()
        for pdf in pdfs:
            ruc = pdf.name.split("_", 1)[0]
            apellidos = pdf.stem.split("_", 1)[1].replace("_", " ") if "_" in pdf.stem else ""
            if not ruc.isdigit():
                continue
            try:
                fams = familiares_pdf(str(pdf))
            except Exception as e:
                fallos += 1
                print(f"  ! {pdf.name}: {str(e)[:70]}")
                continue
            cur.execute("DELETE FROM dji_vinculos WHERE entidad_ruc = %s", (ruc,))
            vistos = set()
            for f in fams:
                doc = f["doc"]
                if doc in vistos:
                    continue
                vistos.add(doc)
                cur.execute(
                    """INSERT INTO dji_vinculos (codigo_ddjj, declarante_norm, entidad_ruc, pariente_doc, pariente_norm, parentesco, grado, ocupacion)
                       VALUES (NULL, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT DO NOTHING""",
                    (_norm(apellidos), ruc, doc, _norm(f.get("nombre")), f.get("parentesco"), f.get("grado"), None))
            total_v += len(vistos)
            total_e += 1
            if total_e % 100 == 0:
                c.commit()
                print(f"  {total_e} entidades, {total_v} vínculos…", flush=True)
        c.commit()
        cur.execute("SELECT count(*), count(DISTINCT entidad_ruc), count(DISTINCT pariente_doc) FROM dji_vinculos")
        v, e, pd = cur.fetchone()
    print(f"\n✓ {a.entorno}: {v:,} vínculos · {e:,} entidades · {pd:,} parientes distintos (fallos lectura: {fallos})")


if __name__ == "__main__":
    main()
