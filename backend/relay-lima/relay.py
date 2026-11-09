#!/usr/bin/env python3
"""Relay de Lima: la salida con IP peruana de los scrapers.

La Contraloría (buscador de informes e INFOBRAS), SERVIR y la Procuraduría del MINJUS sólo responden a IPs del Perú: desde
Cloudflare (también por el relay de Zúrich) dan 522, 403 o no resuelven. Este relay corre en una instancia EC2 de la Local
Zone de AWS en Lima (us-east-1-lim-1a, IP que ipinfo e ip-api ubican en Lima) y escucha SÓLO en 127.0.0.1:8080: la
instancia no tiene puertos abiertos. Los Workers llegan por el túnel de Cloudflare `vigia-lima` (cloudflared en la misma
instancia) con el binding de Workers VPC `RELAY_LIMA` del Worker vigia-scrapers (src/http.ts, `relay: "lima"`).

Misma API que POST /raw del relay de Zúrich (backend/relay-worker), con lo que SERVIR necesita para su sesión:

  GET  /health → {"ok": true, "nombre": "pc" | "aws-lima", "ip": "...", "zona": "...", "version": "...", "desde": "..."}
  POST /raw    {"url": "https://….gob.pe/…", "metodo"?: "GET" | "HEAD" | "POST", "cabeceras"?: {...}, "cuerpo"?: "..."}
               → los bytes del origen tal cual, con su status y:
                 x-relay-status   el status del origen (sin ella, el error es del relay: 400, 401, 502)
                 x-relay-url      la URL final, después de las redirecciones
                 x-relay-cookies  las cookies que dejó el origen, en JSON ({"JSESSIONID": "…"}), para la página siguiente

Sólo *.gob.pe, y también tras cada redirección; nunca una IP privada. Pide la cabecera X-Vigia-Token (el secreto de SSM
/vigia/relay-lima/token, que el arranque deja en /etc/vigia-relay/entorno). Sin dependencias: el Python 3.9 de Amazon Linux.
Instalación y actualización: infrastructure/deploy/aws/relay_lima.sh y backend/relay-lima/README.md.
"""
from __future__ import annotations

import hmac
import ipaddress
import json
import os
import socket
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

VERSION = "2026-11-01"
PUERTO = int(os.environ.get("RELAY_PUERTO", "8080"))
TOKEN = os.environ.get("RELAY_TOKEN", "").strip()
# Lo que tarda como mucho cada operación de red con el origen (conectar, o esperar el siguiente pedazo de la respuesta).
ESPERA_S = 120

# Webs del Estado con el TLS roto (2026-11-09, docs/automatizacion_cas.md): Piura manda el certificado sin el intermedio,
# SUNAFIL sólo acepta un cifrado viejo (AES128-SHA) y la OECE tiene la cadena de otro emisor. Son páginas públicas que
# sólo se leen: con ellas no se verifica el certificado ni se exige un cifrado moderno. Cualquier otro sitio, estricto.
TLS_TOLERANTE = {"convocatorias.regionpiura.gob.pe", "contenidos.regionpiura.gob.pe", "aplicativosweb2.sunafil.gob.pe", "caspublico.oece.gob.pe",
                 "app.hrayacucho.gob.pe", "www.hrayacucho.gob.pe", "hrayacucho.gob.pe", "convocatorias.cofopri.gob.pe"}


def contexto_tolerante() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    ctx.set_ciphers("DEFAULT:@SECLEVEL=0")
    return ctx
TROZO = 64 * 1024
# UA de navegador real: casi todo .gob.pe responde 403 a un cliente «robot».
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
# Las cabeceras que el que llama puede mandar al origen. Sin Accept-Encoding: el cuerpo vuelve tal cual, sin comprimir.
CABECERAS_PERMITIDAS = {
    "accept", "accept-language", "content-type", "cookie", "faces-request", "if-modified-since", "if-none-match",
    "origin", "range", "referer", "user-agent", "x-requested-with",
}
# Del origen al que llama: lo que describe el cuerpo. Lo demás (Set-Cookie incluida) queda en el relay.
CABECERAS_DEVUELTAS = ("content-type", "content-disposition", "content-language", "content-encoding", "last-modified", "etag",
                       "content-range")
DESDE = datetime.now(timezone.utc).isoformat(timespec="seconds")


def registrar(texto: str) -> None:
    """Una línea por pedido, a journald (journalctl -u vigia-relay). Nunca el token ni las cookies."""
    print(f"{datetime.now(timezone.utc).isoformat(timespec='seconds')} {texto}", flush=True)


def host_permitido(host: str | None) -> bool:
    h = (host or "").lower().rstrip(".")
    return h == "gob.pe" or h.endswith(".gob.pe")


def ip_publica(host: str, puerto: int) -> None:
    """Corta si el nombre resuelve a una IP que no es pública (127.0.0.1, la red de la VPC, 169.254.169.254 de IMDS…)."""
    for *_, direccion in socket.getaddrinfo(host, puerto, proto=socket.IPPROTO_TCP):
        ip = ipaddress.ip_address(direccion[0])
        if not ip.is_global:
            raise PermissionError(f"{host} resuelve a una IP no pública")


def validar(url: str) -> urllib.parse.SplitResult:
    p = urllib.parse.urlsplit(url)
    if p.scheme not in ("http", "https") or not host_permitido(p.hostname) or p.username or p.password:
        raise PermissionError("url inválida o fuera de *.gob.pe")
    ip_publica(p.hostname or "", p.port or (443 if p.scheme == "https" else 80))
    return p


class Redirecciones(urllib.request.HTTPRedirectHandler):
    """Sigue las redirecciones del origen sólo dentro de *.gob.pe (y nunca hacia una IP privada)."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        validar(urllib.parse.urljoin(req.full_url, newurl))
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def ip_de_la_instancia() -> tuple[str, str]:
    """La IP pública y la zona, de IMDSv2 (para /health). Vacío fuera de EC2."""
    try:
        tok = urllib.request.urlopen(urllib.request.Request(
            "http://169.254.169.254/latest/api/token", method="PUT",
            headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"}), timeout=2).read().decode()
        leer = lambda ruta: urllib.request.urlopen(urllib.request.Request(  # noqa: E731
            f"http://169.254.169.254/latest/meta-data/{ruta}", headers={"X-aws-ec2-metadata-token": tok}), timeout=2).read().decode()
        return leer("public-ipv4"), leer("placement/availability-zone")
    except Exception:  # noqa: BLE001
        return "", ""


IP, ZONA = ip_de_la_instancia()
# Quién es esta salida en /health: «pc» en la PC del Perú (backend/scrapers-pc/salida_peru), «aws-lima» en la instancia.
NOMBRE = os.environ.get("RELAY_NOMBRE", "").strip() or ("aws-lima" if ZONA else "relay")


class Relay(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "vigia-relay-lima"
    sys_version = ""

    def log_message(self, *_args) -> None:  # el registro va en registrar(), sin cabeceras
        return

    def responder_json(self, status: int, datos: dict) -> None:
        cuerpo = json.dumps(datos, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/health":
            return self.responder_json(404, {"detail": "no encontrado"})
        self.responder_json(200, {"ok": True, "nombre": NOMBRE, "ip": IP, "zona": ZONA, "version": VERSION, "desde": DESDE,
                                  "protegido": bool(TOKEN)})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?")[0] != "/raw":
            return self.responder_json(404, {"detail": "no encontrado"})
        dado = (self.headers.get("X-Vigia-Token") or "").strip()
        if not TOKEN or not hmac.compare_digest(dado.encode(), TOKEN.encode()):
            return self.responder_json(401, {"detail": "token inválido"})
        try:
            largo = int(self.headers.get("Content-Length") or 0)
            if largo > 4 * 1024 * 1024:
                self.close_connection = True
                return self.responder_json(413, {"detail": "pedido de más de 4 MB"})
            pedido = json.loads(self.rfile.read(largo) or b"{}")
            if not isinstance(pedido, dict):
                raise ValueError("se espera un objeto")
        except (ValueError, json.JSONDecodeError):
            return self.responder_json(400, {"detail": "cuerpo JSON inválido"})
        self.reenviar(pedido)

    def reenviar(self, pedido: dict) -> None:
        t0 = time.monotonic()
        url = str(pedido.get("url") or "")
        metodo = str(pedido.get("metodo") or "GET").upper()
        if metodo not in ("GET", "HEAD", "POST"):
            return self.responder_json(400, {"detail": "metodo: GET, HEAD o POST"})
        try:
            destino = validar(url)
        except (PermissionError, ValueError) as e:
            registrar(f"400 {metodo} {url[:200]} ({e})")
            return self.responder_json(400, {"detail": f"{e}"[:300]})
        except OSError as e:  # el nombre no resuelve (MINJUS fuera del Perú daba eso): es del origen, no del pedido
            registrar(f"502 {metodo} {url[:200]} (DNS: {e})")
            return self.responder_json(502, {"detail": f"el nombre no resuelve: {e}"[:300]})
        cabeceras = {"User-Agent": UA, "Accept": "*/*", "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
                     "Referer": f"{destino.scheme}://{destino.netloc}/"}
        for k, v in (pedido.get("cabeceras") or {}).items():
            if str(k).lower() in CABECERAS_PERMITIDAS and isinstance(v, str) and "\n" not in v and "\r" not in v:
                cabeceras[str(k)] = v
        cuerpo = pedido.get("cuerpo")
        datos = cuerpo.encode() if isinstance(cuerpo, str) and metodo == "POST" else None
        frasco = CookieJar()
        manejadores = [Redirecciones(), urllib.request.HTTPCookieProcessor(frasco)]
        if (destino.hostname or "").lower() in TLS_TOLERANTE:
            manejadores.append(urllib.request.HTTPSHandler(context=contexto_tolerante()))
        abridor = urllib.request.build_opener(*manejadores)
        req = urllib.request.Request(url, data=datos, method=metodo, headers=cabeceras)
        try:
            r = abridor.open(req, timeout=ESPERA_S)
        except urllib.error.HTTPError as e:
            r = e  # 4xx/5xx del origen: también se devuelve tal cual, con su status
        except PermissionError as e:
            registrar(f"400 {metodo} {url[:200]} (redirección: {e})")
            return self.responder_json(400, {"detail": f"redirección fuera de lo permitido: {e}"[:300]})
        except Exception as e:  # noqa: BLE001 — sin respuesta del origen (DNS, conexión, tiempo)
            registrar(f"502 {metodo} {url[:200]} {type(e).__name__}: {str(e)[:150]} {time.monotonic() - t0:.1f}s")
            return self.responder_json(502, {"detail": f"sin respuesta del origen: {type(e).__name__}: {str(e)[:200]}"})
        status = r.status if hasattr(r, "status") else r.code
        enviados = 0
        try:
            self.send_response(status)
            self.send_header("x-relay-status", str(status))
            self.send_header("x-relay-url", r.geturl() or url)
            galletas = {c.name: c.value for c in frasco}
            if galletas:
                self.send_header("x-relay-cookies", json.dumps(galletas))
            for k in CABECERAS_DEVUELTAS:
                if r.headers.get(k):
                    self.send_header(k, r.headers[k])
            if metodo == "HEAD":
                # La respuesta al POST /raw no lleva cuerpo: el largo del origen va aparte.
                if r.headers.get("Content-Length"):
                    self.send_header("x-relay-content-length", r.headers["Content-Length"])
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            # El cuerpo pasa por pedazos, sin guardarlo entero. Con el largo del origen, tal cual (el Worker lo sube a R2 sin
            # tenerlo en memoria, Almacen.bajar); sin él, en chunked.
            largo = r.headers.get("Content-Length") or ""
            con_largo = largo.isdigit() and not r.headers.get("Content-Encoding")
            if con_largo:
                self.send_header("Content-Length", largo)
            else:
                self.send_header("Transfer-Encoding", "chunked")
            self.end_headers()
            while True:
                trozo = r.read(TROZO)
                if not trozo:
                    break
                self.wfile.write(trozo if con_largo else f"{len(trozo):x}\r\n".encode() + trozo + b"\r\n")
                enviados += len(trozo)
            if not con_largo:
                self.wfile.write(b"0\r\n\r\n")
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as e:  # noqa: BLE001 — el origen cortó a mitad: el que llama ve el cuerpo incompleto
            registrar(f"corte {metodo} {url[:200]} tras {enviados} B: {type(e).__name__}: {str(e)[:150]}")
            self.close_connection = True
            return
        finally:
            r.close()
        registrar(f"{status} {metodo} {destino.hostname}{destino.path[:160]} {enviados} B {time.monotonic() - t0:.1f}s")


def main() -> None:
    if not TOKEN:
        sys.exit("falta RELAY_TOKEN (/etc/vigia-relay/entorno)")
    servidor = ThreadingHTTPServer(("127.0.0.1", PUERTO), Relay)
    servidor.daemon_threads = True
    registrar(f"relay de Lima {VERSION} ({NOMBRE}) en 127.0.0.1:{PUERTO} (ip {IP or '?'}, zona {ZONA or '?'})")
    servidor.serve_forever()


if __name__ == "__main__":
    main()
