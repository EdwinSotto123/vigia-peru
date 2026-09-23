"""ID tokens para invocar los servicios de agentes (Cloud Run) con IAM (roles/run.invoker).

Los servicios de agentes (agent-orchestrator-adk, agente-servicios/obras/otros) van a pasar a
IAM-only (sin `allUsers`): Cloud Run exige `Authorization: Bearer <ID token>` firmado por Google con
audiencia = URL del servicio. En Cloud Run (este job) el token sale del servidor de metadatos con
la identidad de la cuenta de servicio del job, que necesita roles/run.invoker en cada servicio.
Se guarda ~50 min (el token dura 60) por audiencia; el dispatcher corre hilos en paralelo → lock.

Local (laptop con IP peruana, ver README): sin servidor de metadatos no se manda cabecera y se
avisa una vez. Con el orquestador ya IAM-only, exportar
`AGENT_ID_TOKEN="$(gcloud auth print-identity-token)"` (la cuenta necesita run.invoker; el token
dura 1 h, alcanza para una corrida de DISPATCHER_MAX_MINUTES=55).
"""
from __future__ import annotations

import logging
import os
import threading
import time
from urllib.parse import urlsplit

import requests

log = logging.getLogger("dispatcher")

METADATA_IDENTITY = ("http://metadata.google.internal/computeMetadata/v1/instance/"
                     "service-accounts/default/identity")
TTL_S = 50 * 60
METADATA_TIMEOUT_S = 2
# K_SERVICE: servicio Cloud Run · CLOUD_RUN_JOB: job. Fuera de Cloud Run un fallo del servidor de
# metadatos es definitivo (no se reintenta en cada contrato); dentro, se reintenta la próxima vez.
EN_CLOUD_RUN = bool(os.getenv("K_SERVICE") or os.getenv("CLOUD_RUN_JOB"))

_cache: dict[str, tuple[float, str]] = {}
_lock = threading.Lock()
_estado = {"sin_metadatos": False, "avisado": False}


def audiencia_de(url: str) -> str:
    """Origen del servicio (sin path ni query): es la audiencia que valida Cloud Run."""
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def id_token(url: str) -> str | None:
    """ID token para invocar `url`, o None si no se pudo obtener (local sin metadatos)."""
    manual = (os.getenv("AGENT_ID_TOKEN") or "").strip()
    if manual:
        return manual
    aud = audiencia_de(url)
    with _lock:
        hit = _cache.get(aud)
        if hit and hit[0] > time.time():
            return hit[1]
        if _estado["sin_metadatos"]:
            return None
        try:
            r = requests.get(METADATA_IDENTITY, params={"audience": aud},
                             headers={"Metadata-Flavor": "Google"}, timeout=METADATA_TIMEOUT_S)
            r.raise_for_status()
            token = r.text.strip()
            if not token:
                raise ValueError("respuesta vacía")
        except (requests.RequestException, ValueError) as e:
            if not EN_CLOUD_RUN:
                _estado["sin_metadatos"] = True
            if not _estado["avisado"] or EN_CLOUD_RUN:
                _estado["avisado"] = True
                log.warning("sin ID token para %s (%s): la llamada va sin Authorization%s", aud,
                            str(e)[:120], "" if EN_CLOUD_RUN else
                            " (normal en local; con el orquestador IAM-only exportar AGENT_ID_TOKEN)")
            return None
        _cache[aud] = (time.time() + TTL_S, token)
        return token


def cabeceras(url: str) -> dict[str, str]:
    """`{"Authorization": "Bearer <ID token>"}` para invocar `url`, o `{}` si no hay token."""
    token = id_token(url)
    return {"Authorization": f"Bearer {token}"} if token else {}
