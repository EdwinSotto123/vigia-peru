"""Descarga de bytes de un documento: b64 inline, GCS, downloader local (relay
residencial PE) y descarga directa, en ese orden."""

from tools._core import *  # noqa: F401,F403
from tools._core import downloader_base


def _fetch_doc_bytes(document_url: str, tool_context: ToolContext) -> tuple[bytes | None, str, str | None]:
    """Obtiene los bytes de un documento intentando 4 caminos en orden:

      1. state['docs_b64'][url]      → b64 inline (path rápido, cuando el
                                       bridge pre-cargó por POST).
      2. state['doc_urls'][url]      → URL pública de GCS donde el bridge
                                       archivó el PDF. Descargamos con
                                       google-cloud-storage (auth automática
                                       con la SA del Cloud Run).
      3. OECE_RELAY_URL (env var)    → Cloudflare Worker que bypassa el WAF.
      4. Descarga directa            → último recurso (SEACE bloquea IPs GCP,
                                       devuelve 403 casi seguro).

    Returns:
        (bytes_o_None, fuente_str, mensaje_error_o_None)
        fuente_str ∈ {'inline_b64', 'gcs', 'relay', 'direct'}
    """
    # Helper: normalizar URL para matching robusto (sin query/fragment, sin trailing slash).
    # Necesario porque la URL del OCDS puede tener variantes (?v=1, /, encoding) que
    # difieren de la URL que el cliente registró en doc_urls/docs_b64.
    def _norm(u: str) -> str:
        try:
            from urllib.parse import urlparse, urlunparse
            p = urlparse(u)
            path = p.path.rstrip("/")
            return urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", "", "")).lower()
        except Exception:
            return (u or "").lower()

    target_norm = _norm(document_url)

    def _lookup(d: dict):
        if document_url in d:
            return d[document_url]
        # Fallback: match por URL normalizada
        for k, v in d.items():
            if _norm(k) == target_norm:
                return v
        return None

    # 1) inline b64
    docs_b64 = tool_context.state.get("docs_b64") or {}
    pdf_b64 = _lookup(docs_b64)
    if pdf_b64:
        try:
            return base64.b64decode(pdf_b64, validate=True), "inline_b64", None
        except Exception as e:
            return None, "inline_b64", f"invalid_b64: {e}"

    # 2) GCS (preferido cuando no hay b64)
    doc_urls = tool_context.state.get("doc_urls") or {}
    gcs_target = _lookup(doc_urls)
    if gcs_target:
        blob, err = _download_from_gcs(gcs_target)
        if blob is not None:
            return blob, "gcs", None
        # si GCS falla, seguimos a relay/directo
        gcs_error = err
    else:
        gcs_error = None

    # 2.5) Downloader local (puente residencial peruano vía túnel) — el path
    #      CONFIABLE: SEACE bloquea IPs de datacenter (Cloud Run, colos de CF)
    #      con 403 pero acepta IPs residenciales PE. El servicio corre en la
    #      máquina del usuario, descarga con su IP, sube a GCS y devuelve gs://.
    dl_base = downloader_base()
    if dl_base:
        try:
            ocid_hint = (
                tool_context.state.get("ocid")
                or tool_context.state.get("ocid_preloaded")
                or ""
            )
            r = requests.post(
                f"{dl_base.rstrip('/')}/download",
                json={"url": document_url, "ocid": ocid_hint},
                headers={"X-Vigia-Token": os.getenv("LOCAL_DOWNLOADER_TOKEN", "")},
                timeout=180,
            )
            if r.status_code == 200:
                gs = (r.json() or {}).get("gcs_path")
                if gs:
                    blob, err = _download_from_gcs(gs)
                    if blob is not None:
                        return blob, "local_downloader", None
                    downloader_error = f"downloader_gcs_read={err}"
                else:
                    downloader_error = "downloader_sin_gcs_path"
            else:
                downloader_error = f"downloader HTTP {r.status_code}"
        except Exception as e:
            downloader_error = f"downloader_exception: {str(e)[:120]}"
    else:
        downloader_error = None

    # 3) relay (Cloudflare Worker)
    relay_base = os.getenv("OECE_RELAY_URL", "").strip()
    if relay_base:
        try:
            relay_url = (
                f"{relay_base.rstrip('/')}/?url={requests.utils.quote(document_url, safe='')}"
            )
            r = requests.get(relay_url, headers=BROWSER, timeout=60)
            if r.status_code == 200 and len(r.content) > 100:
                return r.content, "relay", None
            relay_error = f"relay HTTP {r.status_code}"
        except Exception as e:
            relay_error = f"relay_exception: {str(e)[:120]}"
    else:
        relay_error = "OECE_RELAY_URL no configurado"

    # 4) directo
    try:
        r = requests.get(document_url, headers=BROWSER, timeout=30)
        if r.status_code == 200:
            return r.content, "direct", None
        direct_error = f"direct HTTP {r.status_code}"
    except Exception as e:
        direct_error = f"direct_exception: {str(e)[:120]}"

    # Todo falló — construimos error compuesto
    parts = []
    if gcs_target:
        parts.append(f"gcs={gcs_error or 'failed'}")
    if dl_base:
        parts.append(f"downloader={downloader_error}")
    parts.append(f"relay={relay_error}")
    parts.append(direct_error)
    return None, "failed", " · ".join(parts)

def _download_from_gcs(gcs_or_https_url: str) -> tuple[bytes | None, str | None]:
    """Descarga bytes desde GCS. Acepta dos formas de URL:
      · gs://bucket/path                          → usa google-cloud-storage SDK
      · https://storage.googleapis.com/bucket/p   → requests.get directo (más rápido,
        sin auth — funciona con buckets públicos de lectura que es nuestro caso).

    Para buckets privados con SA en Cloud Run, el path SDK se autentica con
    Application Default Credentials.
    """
    if gcs_or_https_url.startswith("https://"):
        try:
            r = requests.get(gcs_or_https_url, timeout=60)
            if r.status_code == 200 and len(r.content) > 100:
                return r.content, None
            return None, f"https GET HTTP {r.status_code}"
        except Exception as e:
            return None, f"https_exception: {str(e)[:200]}"

    # gs:// → SDK
    if not gcs_or_https_url.startswith("gs://"):
        return None, f"url GCS no parseable: {gcs_or_https_url[:120]}"
    try:
        from google.cloud import storage
    except Exception as e:
        return None, f"google-cloud-storage no instalado: {e}"
    rest = gcs_or_https_url[5:]
    if "/" not in rest:
        return None, f"url GCS no parseable: {gcs_or_https_url[:120]}"
    bucket_name, blob_path = rest.split("/", 1)
    try:
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        data = blob.download_as_bytes()
        if data and len(data) > 100:
            return data, None
        return None, "gcs blob vacío o muy chico"
    except Exception as e:
        return None, f"gcs_exception: {str(e)[:200]}"
