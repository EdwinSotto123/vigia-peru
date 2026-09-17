"""Clase base de todos los pipelines: fetch() → normalize/load().

Cada fuente vive en `backend/scrapers/<fuente>/pipeline.py` y define una subclase
con `name`, `fetch()` (devuelve los crudos descargados) y `load(paths)` (los
normaliza y los mete en Postgres, normalmente delegando en los loaders ya
existentes de `backend/scripts/`).

CLI común para todos:
  python -m backend.scrapers.<fuente>.pipeline            # fetch + load
  python -m backend.scrapers.<fuente>.pipeline --fetch-only
  python -m backend.scrapers.<fuente>.pipeline --dry-run   # parsea, no escribe
  python -m backend.scrapers.<fuente>.pipeline --force     # re-descarga aunque no cambió
"""

from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import time
from abc import ABC, abstractmethod
from pathlib import Path

from .storage import REPO_ROOT, Store

log = logging.getLogger("scrapers")

SCRIPTS_DIR = REPO_ROOT / "backend" / "scripts"


def pg_dsn() -> str:
    """DSN libpq armado con las mismas variables que usan backend/db y backend/scripts."""
    pw = os.getenv("PGPASSWORD")
    if not pw:
        f = REPO_ROOT / ".cloudsql-password"
        if f.exists():
            import re
            m = re.search(r"password:\s*(\S+)", f.read_text(encoding="utf-8"))
            pw = m.group(1) if m else None
    if not pw:
        raise SystemExit("✗ Falta PGPASSWORD (o .cloudsql-password en la raíz)")
    return (
        f"host={os.getenv('PGHOST', '127.0.0.1')} port={os.getenv('PGPORT', '5432')} "
        f"dbname={os.getenv('PGDATABASE', 'vigia')} user={os.getenv('PGUSER', 'postgres')} "
        f"password={pw} sslmode={os.getenv('PGSSLMODE', 'prefer')}"
    )


def run_loader(script: str, *args: str, dry_run: bool = False) -> None:
    """Ejecuta un loader de backend/scripts/ como subproceso (misma convención --dsn/--dry-run)."""
    cmd = [sys.executable, str(SCRIPTS_DIR / script), *args]
    if dry_run:
        cmd.append("--dry-run")
    else:
        cmd += ["--dsn", pg_dsn()]
    shown = [c if not c.startswith("host=") else "host=… (dsn oculto)" for c in cmd]
    log.info("→ %s", " ".join(shown[1:]))
    subprocess.run(cmd, check=True, cwd=REPO_ROOT)


class Pipeline(ABC):
    name: str = ""                 # carpeta bajo dataset/_raw/
    description: str = ""
    schedule: str = "manual"       # sugerencia de frecuencia (cron)

    def __init__(self, force: bool = False, dry_run: bool = False):
        self.force = force
        self.dry_run = dry_run
        self.store = Store(self.name)

    @abstractmethod
    def fetch(self) -> list[Path]:
        """Descarga los crudos (usando self.store.fetch) y devuelve sus rutas."""

    @abstractmethod
    def load(self, paths: list[Path]) -> None:
        """Normaliza y carga a Postgres."""

    def run(self, fetch_only: bool = False) -> None:
        t0 = time.time()
        log.info("━━ %s · %s", self.name, self.description)
        paths = self.fetch()
        log.info("   %d archivo(s) crudos", len(paths))
        if not fetch_only:
            self.load(paths)
        log.info("✓ %s en %.0fs", self.name, time.time() - t0)

    # ── CLI ─────────────────────────────────────────────────────────────
    @classmethod
    def cli(cls) -> None:
        ap = argparse.ArgumentParser(description=cls.description or cls.name)
        ap.add_argument("--fetch-only", action="store_true", help="solo descargar")
        ap.add_argument("--dry-run", action="store_true", help="parsear sin escribir en la DB")
        ap.add_argument("--force", action="store_true", help="re-descargar aunque la fuente no cambió")
        ap.add_argument("-v", "--verbose", action="store_true")
        cls.add_arguments(ap)
        args = ap.parse_args()
        logging.basicConfig(
            level=logging.DEBUG if args.verbose else logging.INFO,
            format="%(asctime)s %(levelname).1s %(name)s · %(message)s",
            datefmt="%H:%M:%S",
        )
        p = cls(force=args.force, dry_run=args.dry_run)
        p.configure(args)
        p.run(fetch_only=args.fetch_only)

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:  # hook opcional
        pass

    def configure(self, args: argparse.Namespace) -> None:  # hook opcional
        pass
