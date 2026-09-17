#!/usr/bin/env python3
"""Vendoring: copia DENTRO de cada backend/cloud_functions/<fuente>/vendor/ solo el código que
esa fuente necesita — backend/scrapers/_core + backend/scrapers/<fuente> + los backend/scripts/
que su pipeline.py invoca — para que cada carpeta sea un repositorio autocontenido: se puede
`docker build` desde DENTRO de ella sola, sin depender de una imagen base compartida ni de rutas
fuera de la carpeta.

Fuente única de verdad: backend/scrapers/ y backend/scripts/ (editar SIEMPRE ahí, nunca dentro
de vendor/ — se borra y se regenera en cada build). El cloudbuild.yaml de cada carpeta ya corre
esto como primer paso, así que nunca se construye con una copia vieja; correrlo a mano solo hace
falta para probar `docker build` en local sin pasar por Cloud Build.

  python backend/cloud_functions/_vendor.py --all
  python backend/cloud_functions/_vendor.py pnda_sancionados
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # raíz del repo
CF = ROOT / "backend" / "cloud_functions"
SCRAPERS = ROOT / "backend" / "scrapers"
SCRIPTS = ROOT / "backend" / "scripts"

FUENTES = [
    "pnda_sancionados", "pnda_visitas", "pnda_dji", "pnda_oece",
    "jne_infogob", "mef_presupuesto", "oece_ocds", "onpe_claridad",
]

# fuente → scripts de backend/scripts/ que su pipeline.py invoca (subprocess o import de archivo);
# ver `run_loader(...)` / `spec_from_file_location(...)` en cada backend/scrapers/<fuente>/pipeline.py.
SCRIPTS_POR_FUENTE: dict[str, list[str]] = {
    "pnda_visitas": ["load_visitas_entidades.py"],
    "jne_infogob": ["load_jne_candidaturas.py"],
    "mef_presupuesto": ["fetch_mef_budget.py", "fetch_mef_entities.py"],
    "onpe_claridad": ["load_aportantes_onpe.py"],
}


def _limpiar_pycache(p: Path) -> None:
    for d in p.rglob("__pycache__"):
        shutil.rmtree(d, ignore_errors=True)


def vendorizar(fuente: str) -> None:
    if fuente not in FUENTES:
        raise SystemExit(f"fuente desconocida: {fuente} (ver FUENTES en {__file__})")
    dest = CF / fuente / "vendor"
    if dest.exists():
        shutil.rmtree(dest)
    (dest / "backend" / "scrapers").mkdir(parents=True)
    shutil.copytree(SCRAPERS / "_core", dest / "backend" / "scrapers" / "_core")
    shutil.copy2(SCRAPERS / "__init__.py", dest / "backend" / "scrapers" / "__init__.py")
    shutil.copy2(SCRAPERS / "requirements.txt", dest / "backend" / "scrapers" / "requirements.txt")
    shutil.copytree(SCRAPERS / fuente, dest / "backend" / "scrapers" / fuente)
    scripts = SCRIPTS_POR_FUENTE.get(fuente, [])
    if scripts:
        (dest / "backend" / "scripts").mkdir(parents=True)
        for s in scripts:
            shutil.copy2(SCRIPTS / s, dest / "backend" / "scripts" / s)
    _limpiar_pycache(dest)
    print(f"✓ {fuente}: vendor/ actualizado ({len(scripts)} script(s) de backend/scripts)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("fuente", nargs="?", default=None, help="una sola fuente (ver FUENTES)")
    ap.add_argument("--all", action="store_true", help="todas las fuentes")
    args = ap.parse_args()
    if not args.fuente and not args.all:
        ap.error("pasar una fuente o --all")
    for f in (FUENTES if args.all else [args.fuente]):
        vendorizar(f)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
