"""Segmenta las normas (fuentes con `segmentar: true`) por "Artículo N" y sube un .txt por
artículo a gs://vigia-peru-rag/<corpus>/<slug>/art-NNNN.txt (+ <corpus>/<slug>.articulos.json).
La carpeta <slug>/ solo contiene artículos: corpus.py la importa como directorio (RAG Engine
admite ≤ 25 URIs explícitas por import; un directorio cuenta como una).

¿Por qué? El chunking por tokens de RAG Engine no respeta los límites de artículo y el agente
necesita citar "Art. N de <norma> (<url>)". Con un archivo por artículo, cada chunk recuperado
trae el artículo en el nombre del archivo (source_uri) y en la cabecera del texto, y la página
de inicio en la cabecera. Los PDF que no son normas (bases estándar, acuerdos, opiniones,
manuales) se importan enteros con chunking por tokens.

Uso:
    python -m backend.rag.segmentar                    # todas las fuentes con segmentar: true
    python -m backend.rag.segmentar --solo ley-32069 --dry-run --muestra 5

Heurística:
  · Se extrae texto por página (pypdf) quitando cabeceras/pies del diario oficial.
  · Se detectan encabezados `Artículo N.` / `Artículo N.-` (y romanos `Artículo IV.` del Título
    Preliminar). Los PDF del diario oficial traen otras normas antes (p. ej. los 3 artículos del
    D.S. que aprueba el TUO): se elige la secuencia numérica creciente MÁS LARGA como cuerpo de
    la norma; lo anterior se descarta.
  · Lo que sigue al último artículo (disposiciones complementarias, anexos) va a
    `disposiciones-complementarias.txt`.
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import re
import sys
import warnings

from ._comun import (CACHE_DIR, CATALOGO_BLOB, asegurar_bucket, cargar_fuentes, escribir_json_gcs,
                     gcs_uri, leer_json_gcs, subir_si_cambio)

logging.getLogger("pypdf").setLevel(logging.ERROR)
warnings.filterwarnings("ignore")

_ART_RE = re.compile(r"(?m)^[ \t]*Art[íi]culo[ \t]+(\d{1,4}|[IVXLC]{1,6})[ \t]*[\.\-º°]?[\.\-]?[ \t]*(.*)$")
_ROMANOS = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}
_PIE_RE = re.compile(
    r"^[ \t]*(?:\d+[ \t]*)?NORMAS LEGALES.*$|"
    r"^.*El Peruano[ \t]*/.*$|"
    r"^[ \t]*Página[ \t]+\d+[ \t]+de[ \t]+\d+[ \t]*$|"
    r"^[ \t]*\d{1,3}[ \t]*$", re.M)


def _romano(s: str) -> int | None:
    if not re.fullmatch(r"[IVXLC]+", s):
        return None
    total, prev = 0, 0
    for ch in reversed(s):
        v = _ROMANOS[ch]
        total = total - v if v < prev else total + v
        prev = max(prev, v)
    return total


def texto_por_pagina(pdf_bytes: bytes) -> list[str]:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(pdf_bytes))
    paginas = []
    for p in reader.pages:
        t = p.extract_text() or ""
        t = _PIE_RE.sub("", t)
        t = re.sub(r"[ \t]+\n", "\n", t)
        t = re.sub(r"\n{3,}", "\n\n", t)
        paginas.append(t)
    return paginas


def detectar_articulos(paginas: list[str]) -> list[dict]:
    """[{num, romano, titulo, pagina, pos}] en orden de aparición, con offsets sobre el texto unido."""
    partes, offset, indice_pag = [], 0, []
    for i, t in enumerate(paginas):
        partes.append(t)
        indice_pag.append((offset, i + 1))
        offset += len(t) + 1
    texto = "\n".join(partes)

    def pagina_de(pos: int) -> int:
        pag = 1
        for off, n in indice_pag:
            if off <= pos:
                pag = n
            else:
                break
        return pag

    arts = []
    for m in _ART_RE.finditer(texto):
        tok = m.group(1)
        num = int(tok) if tok.isdigit() else _romano(tok)
        if num is None:
            continue
        titulo = m.group(2).strip()
        # Un encabezado real es corto; "Artículo 5 de la Ley señala que…" dentro de un párrafo no lo es.
        if len(titulo) > 140 or titulo.lower().startswith(("de la ", "del ", "de los ", "y ", "o ")):
            continue
        arts.append({"num": num, "romano": not tok.isdigit(), "titulo": titulo,
                     "pagina": pagina_de(m.start()), "pos": m.start(), "fin_cab": m.end()})
    return arts, texto


def secuencia_principal(arts: list[dict]) -> list[dict]:
    """Secuencia creciente más larga de artículos arábigos (tolera saltos ≤ 3) + los romanos
    inmediatamente anteriores (Título Preliminar)."""
    mejor, actual = [], []
    for a in arts:
        if a["romano"]:
            continue
        if not actual:
            actual = [a]
            continue
        diff = a["num"] - actual[-1]["num"]
        if 0 < diff <= 3:
            actual.append(a)
        elif diff == 0:
            # Encabezado repetido (salto de página / texto modificado): se une al mismo artículo.
            continue
        elif a["num"] == 1:
            # Empieza otra norma (p. ej. el D.S. aprobatorio y luego el Reglamento).
            if len(actual) > len(mejor):
                mejor = actual
            actual = [a]
        # Otro caso: referencia suelta ("Artículo 5 …" dentro de un párrafo) → se ignora.
    if len(actual) > len(mejor):
        mejor = actual
    if not mejor:
        return []
    inicio = mejor[0]["pos"]
    romanos = [a for a in arts if a["romano"] and a["pos"] < inicio]
    # Solo los romanos contiguos justo antes del artículo 1 (Título Preliminar), no los de otra norma.
    if romanos:
        ultimo = romanos[-1]
        if inicio - ultimo["pos"] > 60_000:
            romanos = []
    return sorted(romanos + mejor, key=lambda a: a["pos"])


def segmentar(pdf_bytes: bytes, meta: dict) -> tuple[list[dict], str | None]:
    """Devuelve ([{nombre, articulo, titulo, pagina, texto}], texto_disposiciones|None)."""
    paginas = texto_por_pagina(pdf_bytes)
    arts, texto = detectar_articulos(paginas)
    seq = secuencia_principal(arts)
    if not seq:
        return [], None
    cab = f"{meta.get('documento')} — {meta.get('numero') or ''}".strip(" —")
    salida = []
    for i, a in enumerate(seq):
        fin = seq[i + 1]["pos"] if i + 1 < len(seq) else len(texto)
        cuerpo = texto[a["pos"]:fin].strip()
        if i + 1 == len(seq):
            # El último artículo termina donde empiezan las disposiciones complementarias / anexos.
            m = re.search(r"(?m)^[ \t]*DISPOSICI[ÓO]N(?:ES)?\s+COMPLEMENTARIA", cuerpo)
            if m:
                resto = cuerpo[m.start():].strip()
                cuerpo = cuerpo[:m.start()].strip()
            else:
                resto = None
        else:
            resto = None
        etiqueta = (f"Artículo {a['titulo'] and '' or ''}{_num_str(a)}").strip()
        nombre = f"art-{'tp-' if a['romano'] else ''}{a['num']:04d}.txt"
        contenido = (f"{cab}\n{etiqueta}{(' — ' + a['titulo']) if a['titulo'] else ''}"
                     f"\n[página {a['pagina']}]\n\n{cuerpo}\n")
        salida.append({"nombre": nombre, "articulo": _num_str(a), "titulo": a["titulo"],
                       "pagina": a["pagina"], "texto": contenido})
        if i + 1 == len(seq) and resto:
            salida.append({"nombre": "disposiciones-complementarias.txt", "articulo": "DC",
                           "titulo": "Disposiciones complementarias", "pagina": a["pagina"],
                           "texto": f"{cab}\nDisposiciones complementarias y anexos\n[página {a['pagina']}]\n\n{resto}\n"})
    return salida, None


def _num_str(a: dict) -> str:
    if a["romano"]:
        # reconstruye el romano a partir del entero (solo para etiqueta)
        n, out = a["num"], ""
        for v, s in ((100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")):
            while n >= v:
                out += s; n -= v
        return out
    return str(a["num"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--solo", nargs="*")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--muestra", type=int, default=0, help="imprime N artículos de ejemplo")
    args = ap.parse_args(argv)

    fuentes = [f for f in cargar_fuentes() if f.get("activa", True) and f.get("segmentar")]
    if args.solo:
        fuentes = [f for f in fuentes if f["slug"] in set(args.solo)]
    bucket = None if args.dry_run else asegurar_bucket()
    catalogo = {} if args.dry_run else (leer_json_gcs(CATALOGO_BLOB, default={}) or {})
    rc = 0
    for f in fuentes:
        slug = f["slug"]
        cache = CACHE_DIR / f"{slug}.pdf"
        if not cache.exists():
            print(f"  ✗ {slug}: falta {cache} (corré descargar.py primero)", file=sys.stderr)
            rc = 1
            continue
        pdf = cache.read_bytes()
        arts, _ = segmentar(pdf, f)
        if len(arts) < 5:
            print(f"  ✗ {slug}: solo {len(arts)} artículos detectados; revisar heurística", file=sys.stderr)
            rc = 1
            continue
        nums = [a["articulo"] for a in arts if a["articulo"] not in ("DC",) and a["articulo"].isdigit()]
        print(f"  ✓ {slug}: {len(arts)} bloques (art. {nums[0]}…{nums[-1]}), "
              f"{sum(len(a['texto']) for a in arts)//1000} k chars")
        for a in arts[:args.muestra]:
            print("     ·", a["nombre"], "|", a["texto"][:160].replace("\n", " ⏎ "))
        if args.dry_run:
            continue
        indice = []
        for corpus in f["corpus"]:
            base_meta = catalogo.get(gcs_uri(corpus, f"{slug}.pdf")) or {}
            subidos = 0
            for a in arts:
                blob = f"{corpus}/{slug}/{a['nombre']}"
                if subir_si_cambio(bucket, blob, a["texto"].encode("utf-8"), "text/plain; charset=utf-8"):
                    subidos += 1
                meta_art = {**base_meta, "articulo": a["articulo"], "titulo_articulo": a["titulo"],
                            "pagina": a["pagina"], "importar_pdf": False, "es_articulo": True}
                catalogo[gcs_uri(corpus, slug, a["nombre"])] = meta_art
                indice.append({"uri": gcs_uri(corpus, slug, a["nombre"]), "articulo": a["articulo"],
                               "titulo": a["titulo"], "pagina": a["pagina"]})
            # El índice va en la raíz del corpus (no dentro de la carpeta de artículos, que se importa entera).
            subir_si_cambio(bucket, f"{corpus}/{slug}.articulos.json",
                            json.dumps(indice, ensure_ascii=False, indent=1).encode("utf-8"), "application/json")
            print(f"     → gs://…/{corpus}/{slug}/ ({subidos} archivos nuevos o cambiados)")
    if not args.dry_run and catalogo:
        escribir_json_gcs(CATALOGO_BLOB, catalogo)
    return rc


if __name__ == "__main__":
    sys.exit(main())
