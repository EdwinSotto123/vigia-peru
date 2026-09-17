"""MEF — Datos Abiertos (API) → presupuesto por región y entidad.

Fuente: https://api.datosabiertos.mef.gob.pe/DatosAbiertos/v1 (la raíz devuelve 404;
los endpoints concretos viven en fetch_mef_budget.py / fetch_mef_entities.py y
responden — verificado en cada corrida del frontend).

Este pipeline es un envoltorio con calendario: los dos scripts existentes escriben
`frontend/public/mef-budget.json` y `frontend/public/mef-entities.json`, que el
frontend sirve como estáticos y el seed (`seed_db.py --only mef`) carga a
mef_region_budget / mef_entity_budget.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from .._core.pipeline import REPO_ROOT, SCRIPTS_DIR, Pipeline, log, run_loader


class MefPipeline(Pipeline):
    name = "mef_presupuesto"
    description = "MEF Datos Abiertos — presupuesto regional y por entidad → JSON estáticos + mef_* en DB"
    schedule = "mensual (el MEF cierra el devengado del mes ~día 10)"

    def __init__(self, **kw):
        super().__init__(**kw)
        self.quick = False
        self.entities = False

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--quick", action="store_true", help="solo año actual, sin desgloses")
        ap.add_argument("--entities", action="store_true", help="también ejecución por entidad (lento)")

    def configure(self, args: argparse.Namespace) -> None:
        self.quick, self.entities = args.quick, args.entities

    def fetch(self) -> list[Path]:
        cmd = [sys.executable, str(SCRIPTS_DIR / "fetch_mef_budget.py")] + (["--quick"] if self.quick else [])
        log.info("→ %s", " ".join(cmd[1:]))
        subprocess.run(cmd, check=True, cwd=REPO_ROOT)
        out = [REPO_ROOT / "frontend" / "public" / "mef-budget.json"]
        if self.entities:
            subprocess.run([sys.executable, str(SCRIPTS_DIR / "fetch_mef_entities.py"), "--resume"], check=True, cwd=REPO_ROOT)
            out.append(REPO_ROOT / "frontend" / "public" / "mef-entities.json")
        return out

    def load(self, paths: list[Path]) -> None:
        run_loader("seed/seed_db.py", "--only", "mef", dry_run=self.dry_run)


if __name__ == "__main__":
    MefPipeline.cli()
