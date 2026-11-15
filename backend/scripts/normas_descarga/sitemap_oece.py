"""Lista las páginas del OECE (y del OSCE) en el sitemap público de gob.pe: opiniones, acuerdos de Sala Plena, directivas.

    python -X utf8 backend/scripts/normas_descarga/sitemap_oece.py

El sitemap es el índice que gob.pe publica para los rastreadores (robots.txt lo anuncia). No se pagina con `?sheet=`.
Un pedido cada 5 segundos. Deja 00_manifiesto/sitemap_oece.json: [{url, lastmod}] de las publicaciones del OECE/OSCE.
"""
import gzip
import json
import os
import re
import time
import urllib.request
from pathlib import Path

# La carpeta de descargas (fuera del repositorio): NORMAS_DESCARGAS=C:/ruta/rag-legal-pe
if not os.environ.get("NORMAS_DESCARGAS"):
    raise SystemExit("Falta NORMAS_DESCARGAS: la carpeta donde se guardan las normas descargadas.")
RAIZ = Path(os.environ["NORMAS_DESCARGAS"])
TMP = RAIZ / "00_manifiesto" / "tmp" / "sitemap"
TMP.mkdir(parents=True, exist_ok=True)
UA = "vigia-rag/1.0 (descarga de normas publicas)"
ESPERA = 5


def bajar(url: str, destino: Path) -> bool:
    if destino.exists() and destino.stat().st_size > 200:
        return True
    time.sleep(ESPERA)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120) as r:
            if r.status != 200:
                print("  ", r.status, url, flush=True)
                return False
            destino.write_bytes(r.read())
        return True
    except Exception as e:  # noqa: BLE001 — un archivo que falla no detiene el recorrido; no se reintenta contra un bloqueo
        print("   fallo", url, str(e)[:100], flush=True)
        return False


indice = TMP / "indice.xml.gz"
bajar("https://www.gob.pe/sitemaps/sitemap.xml.gz", indice)
locs = re.findall(r"<loc>([^<]+)</loc>", gzip.open(indice).read().decode("utf-8", "replace"))
salida, fallos = [], 0
for i, loc in enumerate(locs, 1):
    f = TMP / loc.rsplit("/", 1)[-1]
    if not bajar(loc.replace("http://", "https://"), f):
        fallos += 1
        if fallos >= 3:          # tres fallos seguidos: el sitio no quiere más pedidos, se deja ahí
            print("tres fallos: se detiene", flush=True)
            break
        continue
    fallos = 0
    try:
        x = gzip.open(f).read().decode("utf-8", "replace")
    except Exception:  # noqa: BLE001
        continue
    n = 0
    for m in re.finditer(r"<url>\s*<loc>([^<]+)</loc>(?:\s*<lastmod>([^<]+)</lastmod>)?", x):
        u = m.group(1)
        if re.search(r"/institucion/(oece|osce)/(informes-publicaciones|normas-legales|colecciones)/", u):
            salida.append({"url": u, "lastmod": m.group(2)})
            n += 1
    if i % 10 == 0 or n:
        print(f"{i}/{len(locs)} {f.name}: {n} del OECE/OSCE (van {len(salida)})", flush=True)
(RAIZ / "00_manifiesto" / "sitemap_oece.json").write_text(json.dumps(salida, ensure_ascii=False, indent=0), encoding="utf-8")
op = [s for s in salida if re.search(r"opinion", s["url"], re.I)]
print("total:", len(salida), "| con «opinion» en la dirección:", len(op))
