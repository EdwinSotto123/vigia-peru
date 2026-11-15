"""Baja las opiniones de la DTN de 2025 y 2026 desde su página oficial en gob.pe (direcciones del sitemap público).

    python -X utf8 backend/scripts/normas_descarga/bajar_opiniones_sitemap.py [2025,2026] [lote]

Con años anteriores a 2025 (numeración «Opinión N° 001-2019/DTN», todas de la Ley 30225) conviene otro lote:
    python -X utf8 backend/scripts/normas_descarga/bajar_opiniones_sitemap.py 2019,2020,2021,2022,2023,2024 7

Por cada opinión: la página (de ahí salen el número, la fecha de publicación, el asunto y el enlace del PDF) y el PDF.
Un pedido cada 5 segundos, con el agente «vigia-rag/1.0». No pagina con `?sheet=` ni reintenta contra un bloqueo:
tres fallos seguidos y se detiene. Se puede volver a correr: lo ya bajado no se pide otra vez.

En 2025 hay DOS series con la misma numeración: D0000NN-2025-OSCE-DTN (enero a abril, Ley 30225) y
D0000NN-2025-OECE-DTN (desde el 22-04-2025, Ley 32069). El identificador sale del título de la página, no del número.

Deja 15_opiniones_sitemap/*.pdf y 00_manifiesto/lote6_resultado.json (mismo formato que los otros lotes).
"""
import hashlib
import html
import json
import re
import os
import sys
import time
import urllib.request
from pathlib import Path

# La carpeta de descargas (fuera del repositorio): NORMAS_DESCARGAS=C:/ruta/rag-legal-pe
if not os.environ.get("NORMAS_DESCARGAS"):
    raise SystemExit("Falta NORMAS_DESCARGAS: la carpeta donde se guardan las normas descargadas.")
RAIZ = Path(os.environ["NORMAS_DESCARGAS"])
DEST = RAIZ / "15_opiniones_sitemap"
DEST.mkdir(exist_ok=True)
PAGINAS = RAIZ / "00_manifiesto" / "tmp" / "paginas_opinion"
PAGINAS.mkdir(parents=True, exist_ok=True)
UA = "vigia-rag/1.0 (descarga de normas publicas)"
ESPERA = 5
MESES = {m: i for i, m in enumerate("enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split(), 1)}
MESES["setiembre"] = 9
anios = (sys.argv[1] if len(sys.argv) > 1 else "2025,2026").split(",")
LOTE = sys.argv[2] if len(sys.argv) > 2 else "6"
RESULTADO = RAIZ / "00_manifiesto" / f"lote{LOTE}_resultado.json"


def pedir(url: str) -> bytes | None:
    time.sleep(ESPERA)
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120) as r:
            return r.read() if r.status == 200 else None
    except Exception as e:  # noqa: BLE001
        print("   fallo", url[-70:], str(e)[:80], flush=True)
        return None


def fecha_es(t: str) -> str | None:
    m = re.search(r"(\d{1,2}) de ([a-záéíóú]+) de (20\d\d)", t.lower())
    return f"{m.group(3)}-{MESES[m.group(2)]:02d}-{int(m.group(1)):02d}" if m and m.group(2) in MESES else None


sitemap = json.loads((RAIZ / "00_manifiesto" / "sitemap_oece.json").read_text(encoding="utf-8"))
urls = sorted({x["url"].replace("http://", "https://") for x in sitemap if re.search(rf"/\d+-opinion-n-d?\d+-({'|'.join(anios)})-(?:(?:osce|oece)-)?dtn$", x["url"])},
              key=lambda u: int(u.rsplit("/", 1)[-1].split("-")[0]))
print(len(urls), "opiniones en el sitemap", flush=True)
salida, fallos = [], 0
for i, u in enumerate(urls, 1):
    pid = u.rsplit("/", 1)[-1]
    pag = PAGINAS / f"{pid}.html"
    if not pag.exists():
        b = pedir(u)
        if not b:
            fallos += 1
            salida.append({"id": pid, "identificador": pid, "tipo": "opinion", "estado": "sin_pagina", "url_pagina": u})
            if fallos >= 3:
                print("tres fallos seguidos: se detiene", flush=True)
                break
            continue
        pag.write_bytes(b)
    fallos = 0
    h = pag.read_text(encoding="utf-8", errors="replace")
    titulo = html.unescape((re.search(r"<title>([^<]+)</title>", h) or [None, ""])[1])
    m = re.search(r"Opini[oó]n\s+N[°º]?\s*(D?\d+)\s*-\s*(20\d\d)\s*-\s*(OSCE|OECE)\s*-\s*DTN", titulo, re.I) or \
        re.search(r"opinion-n-(d?\d+)-(20\d\d)-(osce|oece)-dtn", pid, re.I)
    viejo = None if m else re.search(r"opinion-n-(\d+)-(20\d\d)-dtn$", pid, re.I)
    if not m and not viejo:
        salida.append({"id": pid, "identificador": titulo[:80], "tipo": "opinion", "estado": "sin_numero", "url_pagina": u})
        continue
    if viejo:          # hasta 2024: «Opinión N° 001-2019/DTN», emitida por el OSCE bajo la Ley 30225
        num, anio, org = viejo.group(1), viejo.group(2), "OSCE"
        ident = f"Opinión {num}-{anio}/DTN"
    else:
        num, anio, org = m.group(1).upper(), m.group(2), m.group(3).upper()
        ident = f"Opinión {num}-{anio}-{org}-DTN"
    # Hasta 2021 muchas se publicaron en Word (.doc, .docx): se bajan igual y scripts/doc_a_pdf.py las pasa a PDF.
    # El enlace entero y después la extensión: hay nombres como «….pdf.pdf» y una vista previa «preview_….pdf.jpg».
    pdfs = [x for x in re.findall(r"https://cdn\.www\.gob\.pe/uploads/document/file/[^\"'<> ]+", h)
            if re.search(r"\.(?:pdf|docx?)$", x.split("?")[0], re.I) and "/preview_" not in x]
    asunto = html.unescape((re.search(r'<meta[^>]+name="description"[^>]+content="([^"]*)"', h) or [None, ""])[1]).strip()
    fila = {"id": f"OP-{num}-{anio}-{org}" if not viejo else f"OP-{num}-{anio}", "tipo": "opinion", "identificador": ident, "titulo": asunto[:300] or None, "fuente_tipo": "oficial",
            "fecha_publicacion": fecha_es(re.sub(r"<[^>]+>", " ", h)), "url_pagina": u, "url_origen": pdfs[0] if pdfs else None,
            # La serie decide el régimen: OSCE es anterior al 22-04-2025.
            "regimen": "30225" if org == "OSCE" else "32069"}
    if not pdfs:
        salida.append({**fila, "estado": "sin_pdf"})
        continue
    ext = re.search(r"\.(pdf|docx?)$", pdfs[0].split("?")[0], re.I).group(1).lower()
    archivo = DEST / ((f"OP-{num}-{anio}-{org}" if not viejo else f"OP-{num}-{anio}") + "." + ext)
    if not archivo.exists():
        b = pedir(pdfs[0])
        # PDF, Word antiguo (OLE) o Word nuevo (ZIP): cualquier otra cosa es una página de error.
        if not b or not b.startswith((b"%PDF", b"\xd0\xcf\x11\xe0", b"PK")):
            salida.append({**fila, "estado": "pdf_no_bajo"})
            continue
        archivo.write_bytes(b)
    b = archivo.read_bytes()
    if ext != "pdf":
        salida.append({**fila, "estado": "descargado", "archivo_local": str(archivo.relative_to(RAIZ)).replace("\\", "/"), "sha256": hashlib.sha256(b).hexdigest(),
                       "bytes": len(b), "paginas": None, "tiene_texto": True, "coincide_identificador": True, "formato": ext})
        continue
    try:
        import fitz
        with fitz.open(archivo) as pdf:
            paginas = len(pdf)
            texto = "".join(p.get_text("text") for p in pdf)
    except Exception:  # noqa: BLE001
        paginas, texto = None, ""
    con_texto = len(texto.strip()) > 400
    # Una opinión nueva puede absolver una consulta sobre la ley anterior: lo dice su texto.
    n32, n30 = len(re.findall(r"32069", texto)), len(re.findall(r"30225", texto))
    if org == "OECE" and n30 > 3 and n30 > 3 * max(n32, 1):
        fila["regimen"] = "30225"
        fila["observacion"] = f"Emitida por el OECE pero absuelve una consulta sobre la Ley 30225 ({n30} menciones contra {n32} de la Ley 32069)."
    salida.append({**fila, "estado": "descargado", "archivo_local": str(archivo.relative_to(RAIZ)).replace("\\", "/"), "sha256": hashlib.sha256(b).hexdigest(),
                   "bytes": len(b), "paginas": paginas, "tiene_texto": con_texto, "coincide_identificador": True})
    if i % 20 == 0:
        print(f"{i}/{len(urls)} {ident}", flush=True)
        RESULTADO.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
RESULTADO.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
import collections
print(collections.Counter((x.get("estado"), x.get("regimen"), x.get("tiene_texto")) for x in salida))
