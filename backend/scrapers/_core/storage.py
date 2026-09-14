"""Almacenamiento de crudos + manifiesto por fuente.

Layout local (gitignored):
  dataset/_raw/<fuente>/<YYYY-MM-DD>/<archivo>
  dataset/_raw/<fuente>/manifest.json      ← historial de descargas (url, sha256, bytes, modified)

El manifiesto permite saltar descargas cuando la fuente no cambió (`is_current`).
Si `SCRAPER_GCS_BUCKET` está seteado, cada crudo se sube también a
  gs://<bucket>/raw/<fuente>/<YYYY-MM-DD>/<archivo>
para que el pipeline en Cloud Run (o un colega) pueda reprocesar sin re-scrapear.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
import os
from dataclasses import asdict, dataclass
from pathlib import Path

from . import http

log = logging.getLogger("scrapers.storage")

REPO_ROOT = Path(__file__).resolve().parents[3]
RAW_ROOT = Path(os.getenv("SCRAPER_RAW_DIR", REPO_ROOT / "dataset" / "_raw"))


@dataclass
class Entry:
    url: str
    file: str            # ruta relativa a RAW_ROOT
    sha256: str
    bytes: int
    downloaded_at: str   # ISO
    modified: str | None  # fecha que declara la fuente (si la hay)


class Store:
    def __init__(self, source: str):
        self.source = source
        self.dir = RAW_ROOT / source
        self.dir.mkdir(parents=True, exist_ok=True)
        self.manifest_path = self.dir / "manifest.json"
        self.entries: list[Entry] = self._load()

    # ── manifiesto ──────────────────────────────────────────────────────
    def _load(self) -> list[Entry]:
        if not self.manifest_path.exists():
            return []
        raw = json.loads(self.manifest_path.read_text(encoding="utf-8"))
        return [Entry(**e) for e in raw]

    def _save(self) -> None:
        self.manifest_path.write_text(
            json.dumps([asdict(e) for e in self.entries], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def latest(self, url: str) -> Entry | None:
        for e in reversed(self.entries):
            if e.url == url:
                return e
        return None

    def is_current(self, url: str, modified: str | None) -> bool:
        """True si ya tenemos esta URL y la fuente no declara una fecha más nueva."""
        e = self.latest(url)
        if e is None:
            return False
        if modified and e.modified and modified > e.modified:
            return False
        return (RAW_ROOT / e.file).exists()

    # ── descarga ────────────────────────────────────────────────────────
    def fetch(self, url: str, filename: str | None = None, modified: str | None = None,
              force: bool = False) -> Path:
        if not force and self.is_current(url, modified):
            e = self.latest(url)
            assert e is not None
            log.info("= %s ya está al día (%s)", e.file, e.modified or "sin fecha")
            return RAW_ROOT / e.file
        today = dt.date.today().isoformat()
        name = filename or url.rsplit("/", 1)[-1]
        dest = self.dir / today / name
        path, sha, n = http.download(url, dest)
        prev = self.latest(url)
        if prev and prev.sha256 == sha:
            log.info("= %s sin cambios (mismo sha256); se conserva la copia nueva", name)
        self.entries.append(Entry(
            url=url, file=str(path.relative_to(RAW_ROOT)).replace("\\", "/"),
            sha256=sha, bytes=n, downloaded_at=dt.datetime.now().isoformat(timespec="seconds"),
            modified=modified,
        ))
        self._save()
        self._maybe_upload(path)
        return path

    def _maybe_upload(self, path: Path) -> None:
        bucket = os.getenv("SCRAPER_GCS_BUCKET")
        if not bucket:
            return
        try:
            from google.cloud import storage  # type: ignore
        except ImportError:
            log.warning("SCRAPER_GCS_BUCKET seteado pero google-cloud-storage no está instalado")
            return
        rel = path.relative_to(RAW_ROOT).as_posix()
        blob = storage.Client().bucket(bucket).blob(f"raw/{rel}")
        blob.upload_from_filename(str(path))
        log.info("↑ gs://%s/raw/%s", bucket, rel)
