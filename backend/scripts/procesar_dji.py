#!/usr/bin/env python3
"""Procesa los PDFs de DJI bajados (local o artefactos de CI): actualiza el ledger, sube a R2 y carga vínculos.

Por cada PDF <ruc>_<apellidos>_<nombres>.pdf:
  1. parsea los familiares (parse_dji_pdf, coordenadas) — si 0 y el PDF no tiene texto → parse_estado='parser_fallo' (GLM luego).
  2. upsert en dji_vinculos (atribución por PERSONA: entidad_ruc + declarante_norm), idempotente.
  3. sube el PDF a R2 (vigia-peru-batch/dji/pdfs/<archivo>) con wrangler.
  4. actualiza dji_descargas (estado, parse_estado, n_familiares, pdf_r2).
Además lee los _log.csv (ruc,apellidos,nombres,ok,detalle) para marcar los errores de descarga.

  python backend/scripts/procesar_dji.py --entorno prod --pdfs <dir> [--logs <dir>] [--r2]
"""
from __future__ import annotations

import argparse
import csv
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from tunel_rds import conexion                 # noqa: E402
from parse_dji_pdf import familiares_pdf        # noqa: E402
import pdfplumber                               # noqa: E402

_norm = lambda s: " ".join((s or "").split()).upper()
R2_BUCKET = "vigia-peru-batch"
WR = Path(r"C:\Users\usuario\Desktop\PROYECTOS\vigia-peru\backend\scrapers-worker")


def tiene_texto(pdf: str) -> bool:
    try:
        with pdfplumber.open(pdf) as d:
            return any((p.extract_text() or "").strip() for p in d.pages[:3])
    except Exception:
        return False


def subir_r2(pdf: Path, key: str) -> bool:
    try:
        r = subprocess.run(["npx", "wrangler", "r2", "object", "put", f"{R2_BUCKET}/{key}",
                            "--file", str(pdf), "--remote"], cwd=WR, capture_output=True, text=True, timeout=120, shell=True)
        return "Upload complete" in (r.stdout + r.stderr)
    except Exception:
        return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entorno", choices=["dev", "prod"], required=True)
    ap.add_argument("--pdfs", required=True)
    ap.add_argument("--logs", help="dir con _log.csv (por defecto = --pdfs)")
    ap.add_argument("--r2", action="store_true", help="subir PDFs a R2")
    a = ap.parse_args()
    pdfs = sorted(Path(a.pdfs).rglob("*.pdf"))
    print(f"{len(pdfs)} PDFs")
    with conexion(a.entorno) as c:
        cur = c.cursor()
        # 1) errores de descarga desde los logs
        logdir = Path(a.logs or a.pdfs)
        nlog = 0
        for lg in logdir.rglob("_log.csv"):
            for row in csv.reader(open(lg, encoding="utf-8", errors="replace")):
                if len(row) >= 5 and row[3] == "False":
                    ruc, ape = row[0], row[1]
                    cur.execute("""UPDATE dji_descargas SET estado='error', intentos=intentos+1,
                                   error=%s, actualizado=now() WHERE ruc=%s AND apellidos=%s""", (row[4][:200], ruc, ape))
                    nlog += 1
        c.commit()
        # 2) PDFs: parse + vínculos + R2 + ledger
        v = ok = fallo_parse = 0
        for pdf in pdfs:
            partes = pdf.stem.split("_")
            ruc = partes[0]
            ape = partes[1].replace("-", " ") if len(partes) > 1 else ""
            nom = partes[2].replace("-", " ") if len(partes) > 2 else ""
            decl = _norm(f"{ape} {nom}")
            if not ruc.isdigit():
                continue
            try:
                fams = familiares_pdf(str(pdf))
            except Exception:
                fams = []
            if fams:
                parse_estado = "ok"
            elif not tiene_texto(str(pdf)):
                parse_estado = "sin_texto"      # PDF escaneado → GLM/OCR luego
            else:
                parse_estado = "parser_fallo"   # tiene texto pero 0 familiares → revisar
            # vínculos (idempotente por persona)
            cur.execute("DELETE FROM dji_vinculos WHERE entidad_ruc=%s AND declarante_norm=%s", (ruc, decl))
            vistos = set()
            for f in fams:
                d = f["doc"]
                if d in vistos:
                    continue
                vistos.add(d)
                cur.execute("""INSERT INTO dji_vinculos (codigo_ddjj, declarante_norm, entidad_ruc, pariente_doc, pariente_norm, parentesco, grado)
                               VALUES (NULL,%s,%s,%s,%s,%s,%s)""", (decl, ruc, d, _norm(f.get("nombre")), f.get("parentesco"), f.get("grado")))
            v += len(vistos)
            key = f"dji/pdfs/{pdf.name}"
            if a.r2:
                subir_r2(pdf, key)
            cur.execute("""UPDATE dji_descargas SET estado='ok', parse_estado=%s, n_familiares=%s,
                           pdf_r2=%s, descargado=now(), actualizado=now() WHERE ruc=%s AND apellidos=%s""",
                        (parse_estado, len(vistos), key if a.r2 else None, ruc, ape))
            ok += 1
            fallo_parse += (parse_estado == "parser_fallo")
            if ok % 100 == 0:
                c.commit(); print(f"  {ok} PDFs, {v} vínculos…", flush=True)
        c.commit()
        cur.execute("SELECT count(*), count(DISTINCT entidad_ruc), count(DISTINCT pariente_doc) FROM dji_vinculos")
        tot = cur.fetchone()
    print(f"\n✓ {a.entorno}: {ok} PDFs, {v} vínculos insertados (parser_fallo: {fallo_parse}), {nlog} errores de descarga marcados")
    print(f"  dji_vinculos total: {tot[0]} vínculos · {tot[1]} entidades · {tot[2]} parientes")


if __name__ == "__main__":
    main()
