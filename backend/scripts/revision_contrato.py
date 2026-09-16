"""Vuelca TODO lo que Vigía tiene de un contrato a una carpeta local para revisarlo a mano:

  PGHOST=34.71.244.66 PGSSLMODE=require PYTHONPATH=. python backend/scripts/revision_contrato.py 1225030 dataset/_revision/1225030

Genera:
  convocatoria.json        record/release OCDS + clasificación (tipo, etapa, agentes, validaciones)
  alerta.json              alertas.* (score, estado, analisis_full completo)
  dictamen.md              dictamen_markdown
  banderas.json            banderas de la alerta (con verificacion)
  procesamiento.json       fila de procesamientos + eventos[] (traza vista por el dispatcher)
  documentos.json          documentos_gcs (url_origen, url_gcs, tipo, sha256, bytes, formato)
  docs/<sha8>.<ext>        archivo original bajado de GCS; ZIP/RAR extraídos en docs/<sha8>_x/
  texto/<sha8>.txt         texto OCR persistido (documentos_texto.texto) y extraccion JSON si existe
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import psycopg

from backend.scrapers._core.pipeline import pg_dsn


def _dump(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def main() -> int:
    ocid, out = sys.argv[1], Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    (out / "docs").mkdir(exist_ok=True)
    (out / "texto").mkdir(exist_ok=True)
    with psycopg.connect(pg_dsn()) as conn, conn.cursor() as cur:
        cur.execute("""SELECT row_to_json(c) FROM (SELECT ocid, codigo, objeto, entidad_ruc, cuantia_referencial, fecha_convocatoria,
                       categoria, tipo_contratacion, etapa, modalidad, procesable, motivo_no_procesable, agentes_aplicables,
                       validaciones_pendientes, proveedor_ruc, ocds_payload FROM convocatorias WHERE ocid = %s) c""", (ocid,))
        row = cur.fetchone()
        if not row:
            print("✗ convocatoria no encontrada"); return 2
        _dump(out / "convocatoria.json", row[0])
        cur.execute("SELECT row_to_json(a) FROM alertas a WHERE ocid = %s ORDER BY id DESC LIMIT 1", (ocid,))
        a = cur.fetchone()
        aid = None
        if a:
            al = a[0]
            (out / "dictamen.md").write_text(al.get("dictamen_markdown") or "", encoding="utf-8")
            aid = al.get("id")
            _dump(out / "alerta.json", al)
            cur.execute("SELECT row_to_json(b) FROM banderas b WHERE alerta_id = %s ORDER BY id", (aid,))
            _dump(out / "banderas.json", [r[0] for r in cur.fetchall()])
        cur.execute("SELECT row_to_json(p) FROM procesamientos p WHERE ocid = %s", (ocid,))
        p = cur.fetchone()
        _dump(out / "procesamiento.json", p[0] if p else None)
        cur.execute("""SELECT row_to_json(d) FROM documentos_gcs d WHERE ocid_corto(d.ocid) = ocid_corto(%s) AND d.borrado_at IS NULL
                       ORDER BY d.id""", (ocid,))
        docs = [r[0] for r in cur.fetchall()]
        _dump(out / "documentos.json", docs)
        cur.execute("SELECT sha256, formato, n_paginas, texto, extraccion FROM documentos_texto WHERE ocid = %s", (ocid,))
        for sha, fmt, npag, texto, extr in cur.fetchall():
            (out / "texto" / f"{sha[:8]}.txt").write_text(texto or "", encoding="utf-8")
            if extr:
                _dump(out / "texto" / f"{sha[:8]}.extraccion.json", extr)
    # archivos originales
    for d in docs:
        gs, sha, fmt = d["url_gcs"], d["sha256"], (d.get("formato") or "bin").lower()
        dest = out / "docs" / f"{sha[:8]}.{fmt}"
        if not dest.exists():
            try:
                from google.cloud import storage  # ADC de gcloud
                b, _, name = gs[5:].partition("/")
                storage.Client().bucket(b).blob(name).download_to_filename(str(dest))
            except Exception as e:  # noqa: BLE001
                print("no bajé", gs, str(e)[:120])
        xdir = out / "docs" / f"{sha[:8]}_x"
        if fmt == "zip" and dest.exists() and not xdir.exists():
            try:
                with zipfile.ZipFile(dest) as z:
                    z.extractall(xdir)
            except Exception as e:  # noqa: BLE001
                print("zip no extraíble", dest.name, e)
        elif fmt == "rar" and dest.exists() and not xdir.exists():
            xdir.mkdir()
            for tool in (["unar", "-o", str(xdir), str(dest)], ["7z", "x", f"-o{xdir}", str(dest)], ["bsdtar", "-xf", str(dest), "-C", str(xdir)]):
                if shutil.which(tool[0]):
                    subprocess.run(tool, check=False, capture_output=True)
                    break
    print(f"✓ {ocid} → {out} · {len(docs)} documentos · alerta {aid}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
