"""Descarga nocturna por lotes del SEACE (OCDS) y subida a GCP.

Flujo (laptop/VPS con IP peruana → GCS → Cloud Run Job `vigia-ingest`):

  python -m backend.batch.descargar releases   --desde 2026-09-08 --hasta 2026-09-15
  python -m backend.batch.descargar records    --lote <releases-…>
  python -m backend.batch.descargar documentos --lote <records-…> --politica clave
  python -m backend.batch.subir --lote <id>
  gcloud run jobs execute vigia-ingest --args=--lote,<id>

Estado local en SQLite (`dataset/_batch/estado.sqlite`, ver `estado.py`); nada de esto
llama a la DB de producción salvo `ingestar.py`, que corre en GCP (o localmente para probar).
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BATCH_DIR = Path(os.getenv("BATCH_DIR", REPO_ROOT / "dataset" / "_batch"))
BUCKET_DEFAULT = os.getenv("BATCH_BUCKET", "vigia-peru-batch")
PREFIJO_DEFAULT = os.getenv("BATCH_PREFIJO", "batch/")
