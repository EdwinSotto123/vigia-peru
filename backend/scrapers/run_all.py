"""Corre todos los pipelines (o un subconjunto) en orden. Pensado para cron / Cloud Run Job.

  python -m backend.scrapers.run_all                      # todos los automáticos
  python -m backend.scrapers.run_all --only pnda_visitas,pnda_sancionados
  python -m backend.scrapers.run_all --fetch-only --dry-run
  python -m backend.scrapers.run_all --list

Los pipelines con navegador (onpe_claridad) NO entran por defecto: requieren Chromium con
ventana e IP peruana; se corren a mano o desde `batch-nocturno.sh` con `ONPE=1` (host con
sesión gráfica). `jne_infogob` sí es automático: hoy lee los reportes del JNE desde la PNDA.
"""

from __future__ import annotations

import argparse
import logging
import sys

from .jne_infogob.pipeline import InfogobPipeline
from .mef_presupuesto.pipeline import MefPipeline
from .oece_ocds.pipeline import OcdsIncrementalPipeline
from .onpe_claridad.pipeline import ClaridadPipeline
from .pnda_dji.pipeline import DjiPipeline
from .pnda_oece.pipeline import OeceDatasetsPipeline
from .pnda_sancionados.pipeline import SancionadosPipeline
from .pnda_visitas.pipeline import VisitasPipeline

AUTOMATIC = [SancionadosPipeline, VisitasPipeline, InfogobPipeline, DjiPipeline, OeceDatasetsPipeline, OcdsIncrementalPipeline, MefPipeline]
BROWSER = [ClaridadPipeline]
ALL = {p.name: p for p in AUTOMATIC + BROWSER}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="", help="nombres separados por coma")
    ap.add_argument("--fetch-only", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list:
        for name, cls in ALL.items():
            kind = "auto   " if cls in AUTOMATIC else "browser"
            print(f"{kind}  {name:18s} {cls.schedule:60s} {cls.description}")
        return 0

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname).1s %(name)s · %(message)s", datefmt="%H:%M:%S")
    selected = [ALL[n] for n in args.only.split(",") if n] if args.only else AUTOMATIC
    failed = []
    for cls in selected:
        try:
            cls(force=args.force, dry_run=args.dry_run).run(fetch_only=args.fetch_only)
        except Exception as e:  # noqa: BLE001 — un pipeline caído no frena a los demás
            logging.getLogger("scrapers").exception("✗ %s: %s", cls.name, e)
            failed.append(cls.name)
    if failed:
        print("FALLARON:", ", ".join(failed), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
