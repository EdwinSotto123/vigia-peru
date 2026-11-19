"""Baja el texto de las resoluciones del Tribunal de Contrataciones (TCE / TCP) listadas en el sitemap público de gob.pe.

    NORMAS_DESCARGAS=C:/Users/usuario/rag-legal-pe python -X utf8 backend/scripts/normas_descarga/bajar_tribunal.py [--desde 2024] [--max N]

Para qué: las apelaciones que el Tribunal declara fundadas son la verdad de la etapa de selección que Vigía no tenía (ver
docs/DATOS_Y_SENALES.md §15.1): una buena pro que el Tribunal revoca es un hecho oficial, y con ellas se valida si las
señales de competencia aciertan.

Cómo: del manifiesto del sitemap (sitemap_oece.py → 00_manifiesto/sitemap_oece.json) toma las páginas «normas-legales»
cuyo nombre termina en -AAAA-tce-sN o -AAAA-tcp-sN, de la más nueva a la más vieja. Por cada una: la página (para
encontrar el PDF) y el PDF. Guarda SÓLO el texto (PyMuPDF; las resoluciones son digitales) en
<NORMAS_DESCARGAS>/tribunal/<año>/<id>.json con la URL de la página, la del PDF, el título, las páginas y el texto. No
guarda el PDF (≈ 12 GB para 2024-2026). Reanudable: lo ya bajado se salta.

Cortesía: User-Agent honesto, un pedido cada ESPERA segundos, y se detiene a los tres fallos seguidos (gob.pe responde
418 desde fuera del Perú: corre desde la PC). robots.txt anuncia el sitemap; no se usa `?sheet=`.
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

import fitz  # PyMuPDF

if not os.environ.get("NORMAS_DESCARGAS"):
    raise SystemExit("Falta NORMAS_DESCARGAS: la carpeta donde se guardan las normas descargadas.")
RAIZ = Path(os.environ["NORMAS_DESCARGAS"])
MANIFIESTO = RAIZ / "00_manifiesto" / "sitemap_oece.json"
SALIDA = RAIZ / "tribunal"
UA = "vigia-rag/1.0 (descarga de normas publicas)"
ESPERA = 3.0
PATRON = re.compile(r"/normas-legales/(\d+)-[^/]*?-(20\d\d)-(tce|tcp)-s(\d)$", re.I)


def pedir(url: str) -> bytes:
    time.sleep(ESPERA)
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120) as r:
        if r.status != 200:
            raise RuntimeError(f"HTTP {r.status}")
        return r.read()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--desde", type=int, default=2024, help="el año más viejo que se baja")
    ap.add_argument("--max", type=int, default=0, help="a lo más tantas resoluciones nuevas en esta corrida (0 = todas)")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    paginas = []
    for x in json.loads(MANIFIESTO.read_text(encoding="utf-8")):
        m = PATRON.search(x["url"])
        if m and int(m.group(2)) >= a.desde:
            paginas.append((int(m.group(2)), int(m.group(1)), x["url"].replace("http://", "https://")))
    paginas.sort(reverse=True)   # lo más nuevo primero: es lo que se cruza con las actas leídas
    print(f"{len(paginas)} resoluciones desde {a.desde}", flush=True)
    nuevas = fallos = 0
    for anio, pid, url in paginas:
        destino = SALIDA / str(anio) / f"{pid}.json"
        if destino.exists():
            continue
        try:
            html = pedir(url).decode("utf-8", "replace")
            titulo = re.search(r"<title>(.*?)</title>", html, re.S)
            pdf = re.search(r"(https://cdn\.www\.gob\.pe/uploads/document/file/[^\"']+?\.pdf)", html)
            if not pdf:
                raise RuntimeError("sin PDF en la página")
            doc = fitz.open(stream=pedir(pdf.group(1)), filetype="pdf")
            texto = "\n".join(p.get_text() for p in doc)
            destino.parent.mkdir(parents=True, exist_ok=True)
            # A un temporal y después el cambio de nombre (atómico): el lector (tribunal_cargar.py) puede correr a la vez
            # y no debe encontrar un .json a medio escribir.
            tmp = destino.with_suffix(".tmp")
            tmp.write_text(json.dumps({
                "id": pid, "anio": anio, "url": url, "pdf": pdf.group(1),
                "titulo": re.sub(r"\s+", " ", titulo.group(1)).split(" - ")[0].strip() if titulo else None,
                "paginas": len(doc), "texto": texto,
            }, ensure_ascii=False), encoding="utf-8")
            tmp.replace(destino)
            fallos = 0
            nuevas += 1
            if nuevas % 50 == 0:
                print(f"{nuevas} nuevas (última: {anio} {pid})", flush=True)
            if a.max and nuevas >= a.max:
                break
        except Exception as e:  # noqa: BLE001 — una resolución que falla no detiene el recorrido; tres seguidas, sí
            fallos += 1
            print(f"   fallo {url}: {str(e)[:120]}", flush=True)
            if fallos >= 3:
                print("tres fallos seguidos: gob.pe no quiere más pedidos por ahora; se detiene", flush=True)
                break
    print(f"fin: {nuevas} nuevas", flush=True)


if __name__ == "__main__":
    main()
