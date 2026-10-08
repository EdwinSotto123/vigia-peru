"""Transporte HTTP del lote: GET directo (IP peruana) o por el relay de Cloudflare (`RELAY_URL`).

La API OCDS del OECE y prod1.seace.gob.pe responden 403 a las IP de GCP. Con `RELAY_URL` (+ `RELAY_TOKEN`)
cada GET a un `*.gob.pe` sale por `POST <RELAY_URL>/raw {url}` del Worker `vigia-relay`
(backend/relay-worker, fijado en Zúrich), que devuelve los bytes tal cual con el status del ORIGEN
(también en la cabecera `x-relay-status`). Se usa `/raw` y no `/fetch` también para el JSON: no hay que
decodificar texto dentro de un JSON (menos CPU en el Worker, el doble de memoria menos) y el status del
origen llega igual. Sin `RELAY_URL`: GET directo como siempre (una PC con IP peruana sigue sirviendo).

  get(url, params, timeout)  -> requests.Response   (status_code = el del origen)
  descargar(url, dest)       -> (ruta, sha256, bytes) misma firma que scrapers._core.http.download
  verificar()                -> chequeo barato del relay y del token, sin tocar OECE/SEACE

Errores por el relay (mismo trato que el camino directo):
  · status del ORIGEN (viene `x-relay-status`): 200 ok · 429/5xx reintentables · 403/404 y demás 4xx son
    fallo del ítem (el 403 por ráfaga del SEACE tiene su espera propia en descargar.py).
  · error PROPIO del relay (sin `x-relay-status`): 5xx, timeout o conexión → reintentable; 413 (archivo
    > 60 MB, tope del Worker) y 400 (dominio no permitido) → fallo del ítem; 401 → ErrorRelay (token
    rechazado: no tiene sentido seguir la noche).
El token nunca va a un log ni a un mensaje de error.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import requests

from ..scrapers._core import http

log = logging.getLogger("batch.transporte")

TIMEOUT_DOC = (15, 300)          # (conexión, lectura): el Worker junta el archivo entero antes de responder
ESPERAS_RELAY = (3, 10, 30)      # reintentos de un documento ante 5xx/429/timeout (el directo los hace urllib3)
CABECERA_STATUS = "x-relay-status"


class ErrorRelay(RuntimeError):
    """El relay no sirve para esta corrida (token rechazado, mal configurado o caído)."""


def relay() -> tuple[str, str] | None:
    """(url base, token) si el lote va por el relay; None = GET directo. Se lee del entorno en cada
    llamada (barato) para que los tests y los subprocesos no dependan del orden de import."""
    base = (os.getenv("RELAY_URL") or "").strip().rstrip("/")
    if not base:
        return None
    return base, (os.getenv("RELAY_TOKEN") or "").strip()


def activo() -> bool:
    return relay() is not None


def por_relay(url: str) -> bool:
    """Sólo *.gob.pe pasa por el relay (es lo único que acepta); el resto va directo también en la nube."""
    host = (urlsplit(url).hostname or "").lower()
    return activo() and (host == "gob.pe" or host.endswith(".gob.pe"))


def url_con_params(url: str, params: dict | None) -> str:
    """El relay recibe una sola URL: los `params` se agregan a la query que ya tenga."""
    if not params:
        return url
    p = urlsplit(url)
    query = parse_qsl(p.query, keep_blank_values=True) + [(k, str(v)) for k, v in params.items() if v is not None]
    return urlunsplit((p.scheme, p.netloc, p.path, urlencode(query), p.fragment))


_sesion_relay: requests.Session | None = None


def _sesion() -> requests.Session:
    """Sesión propia hacia el Worker, sin reintentos de urllib3 (los POST no se reintentan solos):
    los reintentos son explícitos, aquí y en descargar._get_json."""
    global _sesion_relay
    if _sesion_relay is None:
        s = requests.Session()
        s.headers.update({"User-Agent": http.USER_AGENT, "Accept": "*/*"})
        _sesion_relay = s
    return _sesion_relay


def _cabeceras(token: str) -> dict:
    return {"X-Vigia-Token": token, "Content-Type": "application/json"}


def status_origen(r: requests.Response) -> int | None:
    """Status que dio OECE/SEACE, o None si la respuesta es un error propio del relay."""
    v = (r.headers.get(CABECERA_STATUS) or "").strip()
    return int(v) if v.isdigit() else None


def _detalle(r: requests.Response) -> str:
    try:
        return str((r.json() or {}).get("detail") or "")[:160]
    except ValueError:
        return ""


def _post_raw(url: str, timeout, stream: bool) -> requests.Response:
    base, token = relay()  # type: ignore[misc]
    if not token:
        raise ErrorRelay("RELAY_URL está definido pero falta RELAY_TOKEN")
    r = _sesion().post(f"{base}/raw", json={"url": url}, headers=_cabeceras(token), timeout=timeout, stream=stream)
    if r.status_code == 401 and status_origen(r) is None:
        r.close()
        raise ErrorRelay("el relay rechazó RELAY_TOKEN (HTTP 401)")
    return r


def get(url: str, params: dict | None = None, timeout=(15, 90)) -> requests.Response:
    """GET de un JSON/texto. Por el relay, `status_code` es el del origen (o el error propio del relay:
    5xx reintentable para quien llama, 400/413 fallo del ítem)."""
    if not por_relay(url):
        return http.session().get(url, params=params, timeout=timeout)
    conexion, lectura = timeout if isinstance(timeout, tuple) else (timeout, timeout)
    r = _post_raw(url_con_params(url, params), timeout=(conexion, max(lectura, 120)), stream=False)
    if status_origen(r) is None and r.status_code != 200:
        log.debug("   relay HTTP %d (%s) en %s", r.status_code, _detalle(r), url[-60:])
    return r


def _volcar(r: requests.Response, tmp: Path, chunk: int) -> tuple[str, int]:
    h = hashlib.sha256()
    n = 0
    with tmp.open("wb") as f:
        for block in r.iter_content(chunk_size=chunk):
            if not block:
                continue
            f.write(block)
            h.update(block)
            n += len(block)
    esperado = r.headers.get("content-length")
    if esperado and esperado.isdigit() and not r.headers.get("content-encoding") and int(esperado) != n:
        raise requests.exceptions.ChunkedEncodingError(f"cuerpo truncado: {n} de {esperado} bytes")
    return h.hexdigest(), n


def _error_http(r: requests.Response, origen: int | None, url: str) -> requests.HTTPError:
    if origen is not None:
        return requests.HTTPError(f"HTTP {origen} (vía relay) en {url[-80:]}", response=r)
    motivo = {413: "archivo mayor que el tope del relay (60 MB)", 400: "URL no permitida por el relay"}.get(r.status_code, _detalle(r))
    return requests.HTTPError(f"relay HTTP {r.status_code}: {motivo}", response=r)


def descargar(url: str, dest: Path, chunk: int = 1 << 20) -> tuple[Path, str, int]:
    """Baja `url` a `dest` (escritura atómica vía .part). Directo = scrapers._core.http.download.
    Por el relay: reintenta 429/5xx/timeouts/cuerpos truncados (ESPERAS_RELAY); cualquier otro status
    → requests.HTTPError con `response.status_code` = status del origen (o del relay si fue suyo)."""
    if not por_relay(url):
        return http.download(url, dest, chunk)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    for intento, espera in enumerate((*ESPERAS_RELAY, None), 1):
        try:
            with _post_raw(url, TIMEOUT_DOC, stream=True) as r:
                origen = status_origen(r)
                if origen == 200:
                    sha, n = _volcar(r, tmp, chunk)
                    tmp.replace(dest)
                    log.info("↓ %s (%.1f MB, relay)", dest.name, n / 1e6)
                    return dest, sha, n
                reintentable = r.status_code == 429 or r.status_code >= 500
                if not reintentable or espera is None:
                    raise _error_http(r, origen, url)
                motivo = f"HTTP {r.status_code}" + ("" if origen is not None else " del relay")
        except requests.HTTPError:
            raise
        except requests.RequestException as e:        # timeout, conexión, cuerpo truncado
            tmp.unlink(missing_ok=True)
            if espera is None:
                raise
            motivo = e.__class__.__name__
        log.warning("   %s → %s; reintento %d/%d en %ds", url[-60:], motivo, intento, len(ESPERAS_RELAY), espera)
        time.sleep(espera)
    raise RuntimeError("inalcanzable")  # pragma: no cover


def verificar(timeout: float = 20) -> None:
    """Antes de una corrida: /health responde y el token vale. `POST /raw` sin url contesta 400 con un
    token válido y 401 sin él, así que no toca OECE ni SEACE. ErrorRelay si algo no cuadra."""
    cfg = relay()
    if cfg is None:
        return
    base, token = cfg
    if not token:
        raise ErrorRelay("RELAY_URL está definido pero falta RELAY_TOKEN")
    try:
        salud = _sesion().get(f"{base}/health", timeout=timeout)
        prueba = _sesion().post(f"{base}/raw", json={}, headers=_cabeceras(token), timeout=timeout)
    except requests.RequestException as e:
        raise ErrorRelay(f"relay inalcanzable ({e.__class__.__name__})") from None
    if salud.status_code != 200:
        raise ErrorRelay(f"relay /health → HTTP {salud.status_code}")
    if prueba.status_code == 401:
        raise ErrorRelay("el relay rechazó RELAY_TOKEN (HTTP 401)")
    if prueba.status_code != 400:
        raise ErrorRelay(f"respuesta inesperada del relay a /raw sin url: HTTP {prueba.status_code}")
    log.info("relay ok · %s", base)
