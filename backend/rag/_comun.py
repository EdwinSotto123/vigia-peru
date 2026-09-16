"""Configuración y helpers compartidos del RAG normativo (Frente R).

Todo vive en GCP: los PDF/TXT en `gs://vigia-peru-rag/<corpus>/…`, los índices en
Vertex AI RAG Engine (modo *serverless*, sin costo fijo por hora) y las consultas
desde `backend/agent/tools/legal.py` (backend `rag_engine`).

Variables de entorno (todas opcionales):
  GOOGLE_CLOUD_PROJECT / VERTEX_PROJECT   proyecto (default vivid-spot-480905-a4)
  RAG_LOCATION                            región de RAG Engine (default us-central1)
  RAG_BUCKET                              bucket GCS (default vigia-peru-rag)
  RAG_EMBEDDING_MODEL                     modelo de embeddings (default text-multilingual-embedding-002;
                                          gemini-embedding-001 fue rechazado por RAG Engine el 2026-09-16:
                                          "Publisher model is not allowed for use in Vertex RAG yet")
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from pathlib import Path

PROJECT = os.getenv("VERTEX_PROJECT") or os.getenv("GOOGLE_CLOUD_PROJECT", "vivid-spot-480905-a4")
LOCATION = os.getenv("RAG_LOCATION", "us-central1")
BUCKET = os.getenv("RAG_BUCKET", "vigia-peru-rag")
EMBEDDING_MODEL = os.getenv("RAG_EMBEDDING_MODEL", "text-multilingual-embedding-002")

# Corpus del plan 2026-09-16 §3.1. `resoluciones-tce` queda documentado como fase 2 (no se crea).
CORPUS = ("normas-vigentes", "normas-historicas", "criterios-vinculantes", "control-cgr")
CORPUS_FASE_2 = ("resoluciones-tce",)

# Corte temporal: Ley 32069 + D.S. 009-2025-EF rigen para convocatorias desde el 22-04-2025.
INICIO_LEY_32069 = "2025-04-22"

AQUI = Path(__file__).resolve().parent
FUENTES_YAML = AQUI / "fuentes.yaml"
CACHE_DIR = Path(os.getenv("RAG_CACHE_DIR", AQUI / ".cache"))
CATALOGO_BLOB = "catalogo.json"          # gs://<bucket>/catalogo.json → metadata por gs:// uri
CORPUS_ESTADO_BLOB = "corpus.json"      # gs://<bucket>/corpus.json → resource names por corpus

UA_NAVEGADOR = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s or "doc"


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def cargar_fuentes() -> list[dict]:
    """Lee fuentes.yaml y normaliza: `corpus` siempre lista; `slug` obligatorio."""
    import yaml
    data = yaml.safe_load(FUENTES_YAML.read_text(encoding="utf-8")) or {}
    out = []
    for f in data.get("fuentes") or []:
        f = dict(f)
        c = f.get("corpus")
        f["corpus"] = [c] if isinstance(c, str) else list(c or [])
        for corp in f["corpus"]:
            if corp not in CORPUS:
                raise ValueError(f"{f.get('slug')}: corpus desconocido {corp!r}")
        if not f.get("slug"):
            raise ValueError(f"fuente sin slug: {f}")
        f.setdefault("regimen", "ambos")
        f.setdefault("tipo", "norma")
        f.setdefault("segmentar", False)
        f.setdefault("importar_pdf", True)
        out.append(f)
    return out


def gcs_client():
    from google.cloud import storage
    return storage.Client(project=PROJECT)


def asegurar_bucket(client=None):
    """Crea gs://<bucket> en LOCATION (Standard, sin lifecycle) si no existe. Idempotente."""
    from google.api_core.exceptions import NotFound
    client = client or gcs_client()
    try:
        b = client.get_bucket(BUCKET)
    except NotFound:
        b = client.bucket(BUCKET)
        b.storage_class = "STANDARD"
        b.iam_configuration.uniform_bucket_level_access_enabled = True
        b = client.create_bucket(b, location=LOCATION)
        print(f"bucket creado: gs://{BUCKET} ({LOCATION}, STANDARD)")
    return b


def gcs_uri(*partes: str) -> str:
    return f"gs://{BUCKET}/" + "/".join(p.strip("/") for p in partes if p)


def leer_json_gcs(blob_name: str, default=None):
    from google.api_core.exceptions import NotFound
    try:
        b = gcs_client().bucket(BUCKET).blob(blob_name)
        return json.loads(b.download_as_text(encoding="utf-8"))
    except NotFound:
        return default
    except Exception as e:  # bucket inexistente, sin permisos…
        if default is not None:
            return default
        raise e


def escribir_json_gcs(blob_name: str, data) -> None:
    b = gcs_client().bucket(BUCKET).blob(blob_name)
    b.upload_from_string(json.dumps(data, ensure_ascii=False, indent=1), content_type="application/json")


def subir_si_cambio(bucket, blob_name: str, data: bytes, content_type: str) -> bool:
    """Sube solo si el blob no existe o su sha256 (metadata) difiere. Devuelve True si subió."""
    blob = bucket.blob(blob_name)
    sha = sha256_bytes(data)
    if blob.exists():
        blob.reload()
        if (blob.metadata or {}).get("sha256") == sha:
            return False
    blob.metadata = {"sha256": sha}
    blob.upload_from_string(data, content_type=content_type)
    return True


def token_acceso() -> str:
    import google.auth
    from google.auth.transport.requests import Request
    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds.refresh(Request())
    return creds.token


def rag_api(version: str = "v1") -> str:
    return f"https://{LOCATION}-aiplatform.googleapis.com/{version}/projects/{PROJECT}/locations/{LOCATION}"
