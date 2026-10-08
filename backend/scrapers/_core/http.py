"""Cliente HTTP compartido por todos los scrapers.

- User-Agent de navegador real: casi todo `.gob.pe` devuelve 403 al UA por defecto
  de `requests`.
- Reintentos con backoff en 429/5xx.
- Descarga en streaming con sha256 (los CSV de la PNDA llegan a 700 MB).
"""

from __future__ import annotations

import hashlib
import logging
import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

log = logging.getLogger("scrapers.http")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
DEFAULT_TIMEOUT = (15, 120)  # (connect, read) segundos


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": USER_AGENT,
        "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
        "Accept": "*/*",
    })
    retry = Retry(
        total=4,
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=("GET", "HEAD"),
    )
    s.mount("https://", HTTPAdapter(max_retries=retry))
    s.mount("http://", HTTPAdapter(max_retries=retry))
    return s


_session: requests.Session | None = None


def session() -> requests.Session:
    global _session
    if _session is None:
        _session = make_session()
    return _session


def _por_relay(url: str) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return bool(os.getenv("RELAY_URL", "").strip()) and (host == "gob.pe" or host.endswith(".gob.pe"))


def get(url: str, params: dict | None = None, timeout=(15, 90)) -> requests.Response:
    """GET de un *.gob.pe. La API OCDS del OECE y el SEACE responden 403 a las IP de GCP: con `RELAY_URL`
    (+ `RELAY_TOKEN`) el pedido sale por el Worker `vigia-relay` (backend/relay-worker, fijado en Zúrich,
    donde responden 200) y `status_code` es el del ORIGEN. Sin `RELAY_URL`, GET directo como siempre
    (una PC con IP peruana sigue sirviendo)."""
    if not _por_relay(url):
        return session().get(url, params=params, timeout=timeout)
    p = urlsplit(url)
    query = parse_qsl(p.query, keep_blank_values=True) + [(k, str(v)) for k, v in (params or {}).items() if v is not None]
    destino = urlunsplit((p.scheme, p.netloc, p.path, urlencode(query), p.fragment))
    base = os.environ["RELAY_URL"].strip().rstrip("/")
    conexion, lectura = timeout if isinstance(timeout, tuple) else (timeout, timeout)
    r = requests.post(f"{base}/raw", json={"url": destino}, timeout=(conexion, max(lectura, 120)),
                      headers={"X-Vigia-Token": os.getenv("RELAY_TOKEN", "").strip(), "User-Agent": USER_AGENT})
    if r.status_code == 401 and not r.headers.get("x-relay-status"):
        raise RuntimeError("el relay rechazó RELAY_TOKEN (401)")
    return r


def get_text(url: str, **kw) -> str:
    r = session().get(url, timeout=kw.pop("timeout", DEFAULT_TIMEOUT), **kw)
    r.raise_for_status()
    return r.text


def head(url: str) -> dict[str, str]:
    """Cabeceras (Content-Length, Last-Modified) sin bajar el cuerpo."""
    r = session().head(url, timeout=DEFAULT_TIMEOUT, allow_redirects=True)
    r.raise_for_status()
    return {k.lower(): v for k, v in r.headers.items()}


def download(url: str, dest: Path, chunk: int = 1 << 20) -> tuple[Path, str, int]:
    """Baja `url` a `dest` en streaming. Devuelve (ruta, sha256, bytes)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    h = hashlib.sha256()
    n = 0
    with session().get(url, stream=True, timeout=DEFAULT_TIMEOUT) as r:
        r.raise_for_status()
        with tmp.open("wb") as f:
            for block in r.iter_content(chunk_size=chunk):
                if not block:
                    continue
                f.write(block)
                h.update(block)
                n += len(block)
    tmp.replace(dest)
    log.info("↓ %s (%.1f MB)", dest.name, n / 1e6)
    return dest, h.hexdigest(), n
