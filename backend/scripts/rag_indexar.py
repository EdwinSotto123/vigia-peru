#!/usr/bin/env python3
"""Llenado inicial del RAG de documentos (migración 258): llama a POST /admin/rag/indexar varias veces a la vez hasta que
no quede nada por trocear ni por embeber. El cron de 10 min de la API hace lo mismo de a poco (40 s y 1 500 embeddings
por vuelta); esto termina el llenado inicial en minutos.

  python -X utf8 backend/scripts/rag_indexar.py dev                  # vigia-api-dev, 4 llamadas a la vez
  python -X utf8 backend/scripts/rag_indexar.py prod --paralelo 6    # vigia-api (pide VIGIA_ADMIN_TOKEN)
  python -X utf8 backend/scripts/rag_indexar.py dev --una            # una sola vuelta (para probar)
  python -X utf8 backend/scripts/rag_indexar.py dev --estado         # GET /admin/rag/estado

La API sólo atiende a nuestros Workers: desde una PC entra con el token del build del CI (x-vigia-build) y el del panel
(x-admin-token). Ninguno se imprime:
  - VIGIA_BUILD_TOKEN, o la variable enmascarada del mismo nombre en GitLab (glab, proyecto simplia-group/vigia-peru);
  - VIGIA_ADMIN_TOKEN, o en DEV el parámetro de SSM /vigia/dev/admin-token (perfil founder.edwin).

Costo (Workers AI, @cf/baai/bge-m3, US$ 0,012 por millón de tokens con el relleno de cada lote): el corpus de PROD
(~1 900 textos de documentos sin el modelo estándar, ~23 600 lecturas, ~400 dictámenes y ~14 000 informes de control)
son ~40 M de tokens: menos de US$ 1, y los primeros ~9 M de cada día entran en los 10 000 neuronas gratis.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

URLS = {"dev": "https://vigia-api-dev.vigiaperu.workers.dev", "prod": "https://vigia-api.vigiaperu.workers.dev"}
ENTORNO = {**os.environ, "MSYS_NO_PATHCONV": "1"}


def _salida(cmd: list[str]) -> str:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, env=ENTORNO, timeout=60)
        return r.stdout.strip() if r.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def token_build() -> str:
    t = os.environ.get("VIGIA_BUILD_TOKEN") or _salida(["glab", "variable", "get", "VIGIA_BUILD_TOKEN", "-R", "simplia-group/vigia-peru"])
    if not t:
        sys.exit("Falta VIGIA_BUILD_TOKEN (o glab con acceso a las variables de simplia-group/vigia-peru).")
    return t


def token_admin(entorno: str) -> str:
    t = os.environ.get("VIGIA_ADMIN_TOKEN")
    if not t and entorno == "dev":
        t = _salida(["aws", "ssm", "get-parameter", "--name", "/vigia/dev/admin-token", "--with-decryption",
                     "--profile", os.environ.get("AWS_PROFILE", "founder.edwin"), "--region", "us-east-2",
                     "--query", "Parameter.Value", "--output", "text"])
    if not t:
        sys.exit("Falta VIGIA_ADMIN_TOKEN (el ADMIN_TOKEN del Worker de ese entorno).")
    return t


def pedir(base: str, ruta: str, cab: dict, metodo: str = "POST", plazo: int = 150) -> dict:
    req = urllib.request.Request(f"{base}{ruta}", method=metodo, headers={**cab, "User-Agent": "vigia-rag-indexar"})
    try:
        with urllib.request.urlopen(req, timeout=plazo) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}", "detail": e.read().decode("utf-8", "replace")[:300]}
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        return {"error": type(e).__name__, "detail": str(e)[:300]}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--paralelo", type=int, default=4, help="llamadas a la vez (cada una ~4 pedidos a Workers AI)")
    ap.add_argument("--segundos", type=int, default=80, help="tope de cada llamada (10 a 110)")
    ap.add_argument("--fuentes", type=int, default=1000, help="tope de fuentes a trocear por llamada")
    ap.add_argument("--una", action="store_true", help="una sola llamada")
    ap.add_argument("--estado", action="store_true", help="sólo GET /admin/rag/estado")
    ap.add_argument("--lineas", choices=["auto", "si", "no"], default="auto", help="recalcular las líneas del modelo estándar")
    a = ap.parse_args()

    base = URLS[a.entorno]
    cab = {"x-vigia-build": token_build(), "x-admin-token": token_admin(a.entorno), "x-admin-actor": "rag_indexar.py"}
    if a.estado:
        print(json.dumps(pedir(base, "/admin/rag/estado", cab, "GET"), ensure_ascii=False, indent=1, default=str))
        return

    # La primera llamada decide las líneas comunes (si hace falta recalcularlas, esa vuelta no hace más).
    r = pedir(base, f"/admin/rag/indexar?segundos={a.segundos}&fuentes={a.fuentes}&lineas={a.lineas}", cab)
    print(json.dumps(r, ensure_ascii=False), flush=True)
    if a.una or r.get("error"):
        return

    totales = {"troceadas": 0, "fragmentosNuevos": 0, "calculados": 0, "reusados": 0, "llamadas": 0, "errores": 0}
    ultimo = {"pendientes": r.get("pendientes", {}), "error": None}
    candado = threading.Lock()
    fin = threading.Event()
    t0 = time.time()

    def trabajar(n: int) -> None:
        vacias = 0
        time.sleep(n * 3)  # escalonadas: que no troceen todas lo mismo al mismo tiempo
        while not fin.is_set():
            x = pedir(base, f"/admin/rag/indexar?segundos={a.segundos}&fuentes={a.fuentes}&lineas=no", cab)
            with candado:
                totales["llamadas"] += 1
                if x.get("error"):
                    totales["errores"] += 1
                    ultimo["error"] = f"{x.get('error')}: {x.get('detail', '')[:160]}"
                else:
                    e = x.get("embeddings", {})
                    totales["troceadas"] += x.get("troceadas", 0)
                    totales["fragmentosNuevos"] += x.get("fragmentosNuevos", 0)
                    totales["calculados"] += e.get("calculados", 0)
                    totales["reusados"] += e.get("reusados", 0)
                    ultimo["pendientes"] = x.get("pendientes", {})
                    ultimo["error"] = e.get("error")
                    if e.get("error"):
                        totales["errores"] += 1
                p = ultimo["pendientes"]
                print(f"[{time.time() - t0:6.0f} s] llamadas {totales['llamadas']} | troceadas {totales['troceadas']} "
                      f"(+{totales['fragmentosNuevos']} fragmentos) | embeddings {totales['calculados']} (+{totales['reusados']} reusados) "
                      f"| faltan {p.get('fuentes', '?')} fuentes y {p.get('fragmentos', '?')} fragmentos"
                      + (f" | error: {ultimo['error']}" if ultimo["error"] else ""), flush=True)
                if totales["errores"] >= 10:
                    print("Diez errores: se corta. Revisa el registro del Worker.", flush=True)
                    fin.set()
            nada = not x.get("error") and not x.get("troceadas") and not x.get("embeddings", {}).get("calculados") \
                and not x.get("embeddings", {}).get("reusados")
            vacias = vacias + 1 if nada else 0
            if nada and not x.get("pendientes", {}).get("fuentes") and not x.get("pendientes", {}).get("fragmentos"):
                fin.set()
            elif vacias >= 3 or x.get("error"):
                time.sleep(20)

    hilos = [threading.Thread(target=trabajar, args=(i,), daemon=True) for i in range(max(1, a.paralelo))]
    for h in hilos:
        h.start()
    try:
        for h in hilos:
            h.join()
    except KeyboardInterrupt:
        fin.set()
    print(json.dumps({**totales, "segundos": round(time.time() - t0)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
