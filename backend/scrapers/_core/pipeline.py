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


def _password() -> str:
    pw = os.getenv("PGPASSWORD")
    if not pw:
        f = REPO_ROOT / ".cloudsql-password"
        if f.exists():
            import re
            m = re.search(r"password:\s*(\S+)", f.read_text(encoding="utf-8"))
            pw = m.group(1) if m else None
    if not pw:
        raise SystemExit("✗ Falta PGPASSWORD (o .cloudsql-password en la raíz)")
    return pw


def _dsn_sin_password() -> str:
    return (
        f"host={os.getenv('PGHOST', '127.0.0.1')} port={os.getenv('PGPORT', '5432')} "
        f"dbname={os.getenv('PGDATABASE', 'vigia')} user={os.getenv('PGUSER', 'postgres')} "
        f"sslmode={os.getenv('PGSSLMODE', 'prefer')}"
    )


def pg_dsn() -> str:
    """DSN libpq armado con las mismas variables que usan backend/db y backend/scripts.
    Solo para conectar DENTRO de este proceso: nunca va a un argv ni a un log."""
    return f"{_dsn_sin_password()} password={_password()}"


def run_loader(script: str, *args: str, dry_run: bool = False) -> None:
    """Ejecuta un loader de backend/scripts/ como subproceso (misma convención --dsn/--dry-run).

    La contraseña va por la variable PGPASSWORD del subproceso (libpq la lee sola cuando el DSN no
    la trae), NUNCA en los argumentos: `CalledProcessError` imprime el comando completo al fallar y
    así la contraseña del superusuario terminó en Cloud Logging (auditoría 2026-09-25, C1). En un
    Linux además se ve en `ps` mientras corre."""
    cmd = [sys.executable, str(SCRIPTS_DIR / script), *args]
    env = dict(os.environ)
    if dry_run:
        cmd.append("--dry-run")
    else:
        cmd += ["--dsn", _dsn_sin_password()]
        env["PGPASSWORD"] = _password()
    log.info("→ %s", " ".join(cmd[1:]))
    try:
        subprocess.run(cmd, check=True, cwd=REPO_ROOT, env=env)
    except subprocess.CalledProcessError as e:
        # El mensaje por defecto incluye el comando; ya no trae secretos, pero se re-lanza corto y claro.
        raise RuntimeError(f"el loader {script} terminó con código {e.returncode}") from None


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
