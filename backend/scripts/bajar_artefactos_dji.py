#!/usr/bin/env python3
"""Baja y descomprime los artefactos (dji_pdfs/) de todos los nodos scrape:dji de un pipeline de GitLab.

Deja todos los PDFs + _log.csv de los N nodos en una carpeta, lista para procesar_dji.py.

  python backend/scripts/bajar_artefactos_dji.py <pipeline_id> [--out <dir>]
Requiere glab autenticado (token OAuth del keyring).
"""
import argparse
import io
import json
import subprocess
import sys
import zipfile
from pathlib import Path

GLAB = r"C:\Users\usuario\AppData\Local\Programs\glab\glab.exe"
PROJ = "simplia-group%2Fvigia-peru"


def glab_api(path: str, binary: bool = False):
    r = subprocess.run([GLAB, "api", path], capture_output=True, timeout=300)
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pipeline")
    ap.add_argument("--out", default=r"C:\Users\usuario\Desktop\PROYECTOS\vigia-peru\dataset\declaracion_jurada\pdfs_ci")
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    jobs = json.loads(glab_api(f"projects/{PROJ}/pipelines/{a.pipeline}/jobs?per_page=100"))
    nodos = [j for j in jobs if j["name"].startswith("scrape:dji")]
    print(f"{len(nodos)} nodos scrape:dji")
    total = 0
    for j in nodos:
        if not (j.get("artifacts") or []):
            print(f"  {j['name']}: {j['status']} (sin artefacto)"); continue
        try:
            raw = glab_api(f"projects/{PROJ}/jobs/{j['id']}/artifacts", binary=True)
            z = zipfile.ZipFile(io.BytesIO(raw))
            n = 0
            for name in z.namelist():
                if name.endswith(".pdf"):
                    data = z.read(name)
                    (out / Path(name).name).write_bytes(data); n += 1
                elif name.endswith("_log.csv"):
                    (out / f"_log_{j['id']}.csv").write_bytes(z.read(name))
            total += n
            print(f"  {j['name']}: {n} PDFs")
        except Exception as e:
            print(f"  {j['name']}: error {str(e)[:60]}")
    print(f"\n✓ {total} PDFs en {out}")


if __name__ == "__main__":
    main()
