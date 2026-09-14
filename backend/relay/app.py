"""
Vigía Perú — Servicio local de descarga de documentos SEACE.

Corre en la máquina del usuario (IP residencial peruana). SEACE/OECE bloquean
las IPs de datacenter (Cloud Run, Cloudflare colos) con 403, pero aceptan IPs
residenciales peruanas. Este servicio es ese "puente residencial":

  1. Recibe una petición {url, ocid} del orquestador (Cloud Run) vía túnel.
  2. Descarga el documento desde SEACE con la IP local (200 OK).
  3. Lo sube al bucket GCS (mismo formato que /api/agent/upload-doc).
  4. NO escribe nada a disco (todo en memoria → nada que limpiar).
  5. Devuelve {gcs_url, gcs_path, bytes, content_type} al orquestador.

Seguridad: como detrás de un túnel TODAS las peticiones parecen venir de
localhost (cloudflared proxea), el control de acceso es un TOKEN compartido
(header `X-Vigia-Token` o `Authorization: Bearer`). Solo el orquestador lo
conoce. Esto es más fuerte que filtrar por IP (que el túnel hace inútil).

Concurrencia: FastAPI corre los endpoints síncronos en un threadpool (anyio,
~40 hilos), así que atiende múltiples descargas en paralelo sin código extra.
"""
from __future__ import annotations

import io
import logging
import os
import re
import unicodedata
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel
from google.cloud import storage

# ── Config (vía env) ─────────────────────────────────────────────────
BUCKET = os.getenv("GCS_BUCKET", "vigia-peru-documentos")
PROJECT = os.getenv("GCP_PROJECT", "vivid-spot-480905-a4")
TOKEN = os.getenv("VIGIA_DL_TOKEN", "").strip()
MAX_BYTES = int(os.getenv("MAX_BYTES", str(60 * 1024 * 1024)))  # 60 MB por doc
HTTP_TIMEOUT = int(os.getenv("HTTP_TIMEOUT", "120"))

# UA de navegador real — SEACE rechaza clientes "robot".
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("vigia-downloader")

app = FastAPI(title="Vigía Downloader", version="1.0")

# Cliente GCS: usa GOOGLE_APPLICATION_CREDENTIALS (el sa-key.json montado).
_storage: storage.Client | None = None


def _gcs() -> storage.Client:
    global _storage
    if _storage is None:
        _storage = storage.Client(project=PROJECT)
    return _storage


def _safe_name(name: str) -> str:
    """Mismo saneo que el upload-doc del frontend (NFD, sin tildes, [A-Za-z0-9._-])."""
    n = unicodedata.normalize("NFD", name or "")
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = re.sub(r"[^a-zA-Z0-9._-]", "_", n)
    return n[:200] or "doc.bin"


def _infer_filename(url: str, content_type: str) -> str:
    try:
        last = (urlparse(url).path.split("/")[-1] or "").split("?")[0]
        if last and re.search(r"\.[a-z0-9]{2,5}$", last, re.I):
            return last
    except Exception:
        pass
    ext = "pdf" if "pdf" in content_type else "zip" if "zip" in content_type else "bin"
    # SEACE usa ?fileCode=<uuid>; lo aprovechamos como nombre estable.
    try:
        from urllib.parse import parse_qs
        fc = parse_qs(urlparse(url).query).get("fileCode", [""])[0]
        if fc:
            return f"{_safe_name(fc)}.{ext}"
    except Exception:
        pass
    return f"doc.{ext}"


def _check_auth(authorization: str | None, x_vigia_token: str | None) -> None:
    if not TOKEN:
        # Sin token configurado → servicio abierto. Lo avisamos fuerte.
        log.warning("VIGIA_DL_TOKEN vacío — el servicio NO está protegido.")
        return
    presented = ""
    if authorization and authorization.lower().startswith("bearer "):
        presented = authorization[7:].strip()
    presented = presented or (x_vigia_token or "").strip()
    if presented != TOKEN:
        raise HTTPException(status_code=401, detail="unauthorized")


class DownloadReq(BaseModel):
    url: str
    ocid: str | None = None
    filename: str | None = None


class FetchReq(BaseModel):
    url: str


@app.get("/health")
def health() -> dict:
    return {"ok": True, "bucket": BUCKET, "project": PROJECT, "protected": bool(TOKEN)}


@app.post("/fetch")
def fetch(
    req: FetchReq,
    authorization: str | None = Header(default=None),
    x_vigia_token: str | None = Header(default=None),
) -> dict:
    """Proxy de lectura: trae una URL con la IP local (residencial PE) y devuelve
    el body DIRECTO (sin subir a GCS). Para la metadata OCDS (JSON), que OECE
    bloquea desde datacenter con 403 pero sirve 200 desde IP peruana.
    """
    _check_auth(authorization, x_vigia_token)
    if not req.url or not req.url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="url inválida")

    # Referer del mismo origen pedido (algunos WAF lo exigen).
    try:
        p = urlparse(req.url)
        referer = f"{p.scheme}://{p.netloc}/"
    except Exception:
        referer = req.url

    try:
        r = requests.get(
            req.url,
            headers={"User-Agent": BROWSER_UA, "Referer": referer, "Accept": "application/json, */*"},
            timeout=HTTP_TIMEOUT,
            stream=True,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"fetch_exception: {str(e)[:200]}")

    buf = io.BytesIO()
    total = 0
    for chunk in r.iter_content(chunk_size=65536):
        if not chunk:
            continue
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(status_code=413, detail=f"body > {MAX_BYTES} bytes")
        buf.write(chunk)

    content_type = (r.headers.get("content-type") or "").split(";")[0].strip()
    text = buf.getvalue().decode("utf-8", errors="replace")
    log.info("FETCH %s · HTTP %d · %d bytes · %s", req.url[:80], r.status_code, total, content_type)
    return {
        "ok": r.status_code == 200,
        "status": r.status_code,
        "content_type": content_type,
        "body": text,
    }


@app.post("/download")
def download(
    req: DownloadReq,
    request: Request,
    authorization: str | None = Header(default=None),
    x_vigia_token: str | None = Header(default=None),
) -> dict:
    _check_auth(authorization, x_vigia_token)

    if not req.url or not req.url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="url inválida")

    # ── 1. Descargar desde SEACE con la IP local (residencial PE) ──
    try:
        r = requests.get(
            req.url,
            headers={
                "User-Agent": BROWSER_UA,
                "Referer": "https://prod1.seace.gob.pe/",
                "Accept": "*/*",
            },
            timeout=HTTP_TIMEOUT,
            stream=True,
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"download_exception: {str(e)[:200]}")

    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"upstream HTTP {r.status_code}")

    # Leer en memoria con tope (nada toca disco).
    buf = io.BytesIO()
    total = 0
    for chunk in r.iter_content(chunk_size=65536):
        if not chunk:
            continue
        total += len(chunk)
        if total > MAX_BYTES:
            raise HTTPException(status_code=413, detail=f"file > {MAX_BYTES} bytes")
        buf.write(chunk)
    data = buf.getvalue()
    if not data:
        raise HTTPException(status_code=502, detail="respuesta vacía")

    content_type = (r.headers.get("content-type") or "application/octet-stream").split(";")[0].strip()

    # ── 2. Subir a GCS — MISMO formato que upload-doc del frontend ──
    ocid = _safe_name(req.ocid or "sin-ocid")
    filename = _safe_name(req.filename or _infer_filename(req.url, content_type))
    path = f"convocatorias/{ocid}/{filename}"
    try:
        blob = _gcs().bucket(BUCKET).blob(path)
        blob.cache_control = "public, max-age=86400"
        blob.metadata = {"original_url": req.url, "ocid": ocid, "fuente": "local-downloader"}
        blob.upload_from_string(data, content_type=content_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"gcs_upload_failed: {str(e)[:200]}")

    log.info("OK %s · %d bytes · %s → gs://%s/%s", req.url[:80], total, content_type, BUCKET, path)

    # 3. data sale de scope → memoria liberada. Nada que borrar en disco.
    return {
        "ok": True,
        "original_url": req.url,
        "gcs_url": f"https://storage.googleapis.com/{BUCKET}/{path}",
        "gcs_path": f"gs://{BUCKET}/{path}",
        "bytes": total,
        "content_type": content_type,
    }
