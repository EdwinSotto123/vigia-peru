#!/usr/bin/env python3
"""El TEXTO por página de cada archivo del expediente, una sola vez y sin modelo (la capa 1 de la lectura de documentos).

  python -X utf8 backend/lector/texto.py prod --casilleros "PRESENTACI|NO FORMULACI|GARANT" --limite 2000
  python -X utf8 backend/lector/texto.py prod --max-mb 15                       # todo lo que pese hasta 15 MB
  python -X utf8 backend/lector/texto.py prod --medir                           # sólo cuenta lo que falta

Hasta el 2026-11-16 el texto de un documento se guardaba sólo cuando un agente analizaba su proceso: 52 mil de 127 mil
archivos. Lo demás quedaba sin texto: no se podía buscar, ni clasificar por tipo, ni leer por plantilla, y cada lector
volvía a abrir el PDF. Aquí se baja cada archivo del R2, se saca el texto de cada página con PyMuPDF (los PDF de un ZIP,
en memoria; nada se ejecuta ni se descomprime a disco) y se guarda en documentos_texto con el mismo formato que usan los
agentes: una entrada por página (`n`, `texto`, `chars`, `archivo`) y el texto corrido con las marcas ⟦archivo: …⟧ y ⟦p.N⟧.

Lo que NO hace: transcribir páginas escaneadas (quedan con su texto vacío y se cuentan; eso es otro paso, con visión) ni
leer los Excel o Word de un ZIP (quedan anotados en `recortes`).

Para no pisar a los agentes: nunca reemplaza una fila existente, y marca `version_parser`
  · 'texto-v1'   sólo si el resultado es el mismo que sacaría un agente (un PDF suelto con texto en todas sus páginas):
                 el agente lo reutiliza y se ahorra la extracción;
  · 'lector-v1'  en lo demás (ZIP, o alguna página escaneada): el agente no lo toma como su caché y, cuando analiza el
                 proceso, hace su propia extracción con OCR y la guarda encima.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import threading
import time
import zipfile
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import ExitStack
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend"))
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from lector.base import bajar_r2  # noqa: E402

MIN_LETRAS_PAGINA = 300                # menos que esto, la página es un escaneo (el mismo umbral que los agentes)
TOPE_PAGINAS = 1500                    # por archivo
TOPE_CARACTERES_PAGINA = 30_000
TOPE_MIEMBRO_MB = 80

PENDIENTES = """
SELECT g.sha256, min(g.ocid) AS ocid, min(g.url_gcs) AS url, max(lower(g.formato)) AS formato, max(g.bytes) AS bytes,
       max(upper(g.titulo)) AS casillero
  FROM documentos_gcs g
 WHERE g.borrado_at IS NULL AND g.sha256 IS NOT NULL AND g.url_gcs IS NOT NULL AND g.ocid IS NOT NULL
   AND lower(g.formato) IN ('pdf', 'zip') AND g.bytes <= %(max_bytes)s
   AND (%(patron)s::text IS NULL OR upper(g.titulo) ~ %(patron)s)
   AND NOT EXISTS (SELECT 1 FROM documentos_texto t WHERE t.sha256 = g.sha256)
 GROUP BY g.sha256
 ORDER BY max(g.bytes)
 LIMIT %(limite)s
"""
GUARDAR = """
INSERT INTO documentos_texto (sha256, ocid, url_gcs, formato, n_paginas, motor, version_parser, texto, paginas, truncado, recortes,
                              actualizado_at)
VALUES %s
ON CONFLICT (sha256) DO NOTHING
"""
MOLDE = "(%s, %s, %s, %s, %s, 'pymupdf', %s, %s, %s::jsonb, false, %s::jsonb, now())"


def _paginas_pdf(datos: bytes, archivo: str, desde: int) -> list[dict]:
    """El texto de cada página de un PDF, numerado a partir de `desde` + 1."""
    import fitz  # PyMuPDF

    paginas = []
    with fitz.open(stream=datos, filetype="pdf") as doc:
        for i, pagina in enumerate(doc):
            t = (pagina.get_text() or "").replace("\x00", "").strip()[:TOPE_CARACTERES_PAGINA]
            paginas.append({"n": desde + i + 1, "texto": t, "chars": len(t), "archivo": archivo})
    return paginas


def extraer(datos: bytes, formato: str, nombre: str) -> dict:
    """El texto de un archivo (PDF, o los PDF de un ZIP) en la forma de documentos_texto. Nunca levanta: lo que no se
    pudo leer queda dicho en `recortes`."""
    paginas: list[dict] = []
    recortes: list[dict] = []
    es_zip = (formato or "").lower() == "zip" and not datos.startswith(b"%PDF")
    if not es_zip:
        try:
            paginas = _paginas_pdf(datos, nombre, 0)
        except Exception as e:  # noqa: BLE001 — un PDF roto
            recortes.append({"donde": "pdf", "limite": "pdf_ilegible", "omitido": f"{nombre} ({str(e)[:80]})"})
    else:
        try:
            with zipfile.ZipFile(io.BytesIO(datos)) as z:
                for m in sorted(z.infolist(), key=lambda x: x.filename):
                    if m.is_dir():
                        continue
                    if not m.filename.lower().endswith(".pdf"):
                        recortes.append({"donde": "contenedor", "limite": "no_es_pdf", "omitido": m.filename[:200]})
                        continue
                    if m.file_size > TOPE_MIEMBRO_MB * 1024 * 1024 or len(paginas) >= TOPE_PAGINAS:
                        recortes.append({"donde": "contenedor", "limite": "tope", "omitido": m.filename[:200]})
                        continue
                    try:
                        paginas.extend(_paginas_pdf(z.read(m), m.filename[:200], len(paginas)))
                    except Exception as e:  # noqa: BLE001
                        recortes.append({"donde": "contenedor", "limite": "pdf_ilegible", "omitido": f"{m.filename[:150]} ({str(e)[:60]})"})
        except zipfile.BadZipFile:
            recortes.append({"donde": "contenedor", "limite": "zip_ilegible", "omitido": nombre})
    paginas = paginas[:TOPE_PAGINAS]
    escaneadas = sum(1 for p in paginas if p["chars"] < MIN_LETRAS_PAGINA)
    if escaneadas:
        recortes.append({"donde": "escaneo_sin_transcribir", "limite": "sin_vision", "omitido": f"{escaneadas} de {len(paginas)} páginas"})
    partes, actual = [], None
    varios = len({p["archivo"] for p in paginas}) > 1
    for p in paginas:
        if varios and p["archivo"] != actual:
            actual = p["archivo"]
            partes.append(f"⟦archivo: {actual}⟧")
        partes.append(f"⟦p.{p['n']}⟧\n{p['texto']}")
    # Igual a lo que sacaría un agente sólo si es un PDF suelto y ninguna página necesita OCR.
    completo = not es_zip and bool(paginas) and escaneadas == 0
    return {"paginas": paginas, "texto": "\n".join(partes).strip(), "n_paginas": len(paginas), "recortes": recortes,
            "escaneadas": escaneadas, "version_parser": "texto-v1" if completo else "lector-v1"}


def main() -> None:
    from psycopg2.extras import execute_values
    from tunel_rds import conexion

    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--casilleros", default=None, help="expresión sobre el título del SEACE en mayúsculas (p. ej. «GARANT|DESIERTO»)")
    ap.add_argument("--max-mb", type=float, default=25)
    ap.add_argument("--limite", type=int, default=100000)
    ap.add_argument("--hilos", type=int, default=6)
    ap.add_argument("--medir", action="store_true")
    a = ap.parse_args()
    params = {"max_bytes": int(a.max_mb * 1024 * 1024), "patron": a.casilleros, "limite": a.limite}
    t0 = time.time()
    cuenta: Counter = Counter()
    with ExitStack() as pila:
        cn = pila.enter_context(conexion(a.entorno))
        cur = cn.cursor()
        if not a.medir:
            # Una sola corrida por casillero a la vez (la PC y el CI leen la misma cola): candado de sesión en la base.
            cur.execute("SELECT pg_try_advisory_lock(hashtext(%s))", (f"lector.texto:{a.casilleros or ''}",))
            if not cur.fetchone()[0]:
                sys.exit("otra corrida igual está en curso: no se hace nada")
        cur.execute(PENDIENTES, params)
        pendientes = cur.fetchall()
        cn.commit()
        total_mb = sum(int(p[4] or 0) for p in pendientes) / 1e6
        print(f"{a.entorno}: {len(pendientes)} archivos sin texto ({total_mb / 1000:.1f} GB) "
              f"{'del casillero ' + a.casilleros if a.casilleros else ''} hasta {a.max_mb} MB", flush=True)
        if a.medir or not pendientes:
            por = Counter(p[5] for p in pendientes)
            for k, v in por.most_common(14):
                print(f"  {v:7d}  {k}")
            return
        lote: list[tuple] = []
        candado = threading.Lock()
        bajados_mb = 0.0

        def uno(fila):
            sha, ocid, url, formato, _bytes, casillero = fila
            datos = bajar_r2(url)
            tx = extraer(datos, formato, f"{(casillero or 'documento').title()}.pdf")
            return fila, len(datos), tx

        with ThreadPoolExecutor(max_workers=a.hilos) as pool:
            futuros = {pool.submit(uno, f): f for f in pendientes}
            for n, fut in enumerate(as_completed(futuros), 1):
                fila = futuros[fut]
                try:
                    _, peso, tx = fut.result()
                except Exception as e:  # noqa: BLE001 — no se pudo bajar: queda para la próxima corrida
                    cuenta[f"sin bajar: {type(e).__name__}"] += 1
                    continue
                bajados_mb += peso / 1e6
                if not tx["n_paginas"]:
                    cuenta["sin páginas legibles"] += 1
                    # También se guarda: que no vuelva a intentarse en cada corrida un archivo que no es legible.
                cuenta["archivos"] += 1
                cuenta["páginas"] += tx["n_paginas"]
                cuenta["páginas escaneadas"] += tx["escaneadas"]
                cuenta["como " + tx["version_parser"]] += 1
                sha, ocid, url, formato, _b, _c = fila
                lote.append((sha, ocid, url, formato, tx["n_paginas"], tx["version_parser"], tx["texto"],
                             json.dumps(tx["paginas"], ensure_ascii=False), json.dumps(tx["recortes"], ensure_ascii=False)))
                if len(lote) >= 60:
                    with candado:
                        execute_values(cur, GUARDAR, lote, template=MOLDE, page_size=20)
                        cn.commit()
                        lote.clear()
                if n % 500 == 0:
                    seg = time.time() - t0
                    print(f"  {n}/{len(pendientes)} {bajados_mb / 1000:.1f} GB {round(seg)} s ({bajados_mb / max(seg, 1):.1f} MB/s) {dict(cuenta)}",
                          flush=True)
        if lote:
            execute_values(cur, GUARDAR, lote, template=MOLDE, page_size=20)
            cn.commit()
    seg = time.time() - t0
    print(f"FIN texto: {dict(cuenta)} en {round(seg)} s; {bajados_mb / 1000:.2f} GB bajados ({bajados_mb / max(seg, 1):.1f} MB/s)")


if __name__ == "__main__":
    main()
