"""OECE — Contrataciones Abiertas (API OCDS) → convocatorias/postores/ítems en Cloud SQL.

Fuente verificada 2026-09-14:
  https://contratacionesabiertas.oece.gob.pe/api/v1/releases?page=N   (200, JSON, sin auth)
  https://contratacionesabiertas.oece.gob.pe/api/v1/record/<ocid>

Responde desde IP peruana; desde GCP devuelve 403 (WAF) → en producción el orquestador
pasa por el relay de Lima (backend/relay). Este pipeline está pensado para correr en
una máquina en Perú (o el VPS) como cron y mantener la DB al día por región.

Reutiliza `backend/scripts/ingest/lib/oece.py` (list_releases) e
`ingest_oece_one.py` (ingest_one), que ya hacen la normalización completa
(buyer, suppliers, decolecta para el RUC, etc.).
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

from .._core.pipeline import SCRIPTS_DIR, Pipeline, log

sys.path.insert(0, str(SCRIPTS_DIR / "ingest"))


class OcdsIncrementalPipeline(Pipeline):
    name = "oece_ocds"
    description = "OECE OCDS API — releases nuevos desde una fecha → convocatorias (ingest_one)"
    schedule = "diario"

    def __init__(self, **kw):
        super().__init__(**kw)
        self.since = (dt.date.today() - dt.timedelta(days=1)).isoformat()
        self.region: str | None = None
        self.limit = 200
        self.ocids: list[str] = []

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--since", default=None, help="YYYY-MM-DD (default: ayer)")
        ap.add_argument("--region", default=None, help="filtrar por departamento del buyer (ej. ANCASH)")
        ap.add_argument("--limit", type=int, default=200)

    def configure(self, args: argparse.Namespace) -> None:
        self.since = args.since or self.since
        self.region = args.region.upper() if args.region else None
        self.limit = args.limit

    def fetch(self) -> list[Path]:
        from lib import oece  # type: ignore  # backend/scripts/ingest/lib

        page, found = 1, []
        while len(found) < self.limit:
            batch = oece.list_releases(since=self.since, limit=50, page=page)
            if not batch:
                break
            for rel in batch:
                ocid = rel.get("ocid")
                if not ocid:
                    continue
                if self.region:
                    region = (((rel.get("buyer") or {}).get("address") or {}).get("region") or "").upper()
                    if self.region not in region:
                        continue
                found.append(ocid)
            page += 1
        self.ocids = found[: self.limit]
        log.info("   %d ocid(s) desde %s%s", len(self.ocids), self.since, f" en {self.region}" if self.region else "")
        # Persistimos la lista como "crudo" para trazabilidad.
        out = self.store.dir / dt.date.today().isoformat() / f"ocids_{self.since}.txt"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("\n".join(self.ocids), encoding="utf-8")
        return [out]

    def load(self, paths: list[Path]) -> None:
        if self.dry_run:
            log.info("   [dry-run] ingestaría %d convocatorias", len(self.ocids))
            return
        from ingest_oece_one import ingest_one  # type: ignore

        ok = err = 0
        for ocid in self.ocids:
            try:
                ingest_one(ocid)
                ok += 1
            except Exception as e:  # noqa: BLE001 — un ocid roto no frena el lote
                err += 1
                log.warning("   ✗ %s: %s", ocid, e)
        log.info("   ingestadas %d · errores %d", ok, err)


if __name__ == "__main__":
    OcdsIncrementalPipeline.cli()
