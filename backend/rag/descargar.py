"""Descarga las fuentes de fuentes.yaml y las sube a gs://vigia-peru-rag/<corpus>/<slug>.pdf
con su <slug>.metadata.json al lado. Idempotente: si el sha256 no cambió, no re-sube.

Uso:
    python -m backend.rag.descargar                 # todas las fuentes activas
    python -m backend.rag.descargar --solo ley-32069 ds-009-2025-ef
    python -m backend.rag.descargar --dry-run       # descarga y verifica, no sube

Por cada fuente:
  1. Resuelve el PDF: `pdf` directo o, si falta, el primer enlace .pdf de cdn.www.gob.pe en la
     página oficial (`pagina`) que cumpla `pdf_match`.
  2. Descarga con User-Agent de navegador y reintentos; verifica que sea PDF (%PDF- al inicio y
     Content-Type coherente), no una página HTML de error.
  3. Verifica que `pagina` (url_oficial) responda 200 y quede en el mismo dominio institucional.
  4. Sube el PDF + metadata (sha256, url_oficial, regimen, tipo, vigencia, emisor, numero, páginas).
  5. Actualiza gs://vigia-peru-rag/catalogo.json (gs:// uri → metadata), que legal.py usa para
     devolver `url_oficial` y `documento` con cada chunk recuperado.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html
import io
import json
import re
import sys
import time
from urllib.parse import urljoin

import requests

from ._comun import (BUCKET, CACHE_DIR, CATALOGO_BLOB, UA_NAVEGADOR, asegurar_bucket, cargar_fuentes,
                     escribir_json_gcs, gcs_uri, leer_json_gcs, sha256_bytes, subir_si_cambio)

_PDF_LINK_RE = re.compile(r'https://cdn\.www\.gob\.pe/[^"\'\s<>]+?\.(?:pdf|PDF)(?:\?[^"\'\s<>]*)?')


def _sesion() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA_NAVEGADOR, "Accept": "*/*", "Accept-Language": "es-PE,es;q=0.9"})
    return s


def _get(sess: requests.Session, url: str, intentos: int = 4, timeout: int = 120) -> requests.Response:
    ultimo = None
    for i in range(intentos):
        try:
            r = sess.get(url, timeout=timeout, allow_redirects=True)
            if r.status_code < 500:
                return r
            ultimo = RuntimeError(f"HTTP {r.status_code}")
        except requests.RequestException as e:
            ultimo = e
        time.sleep(2 * (i + 1))
    raise RuntimeError(f"sin respuesta tras {intentos} intentos: {ultimo}")


def resolver_pdf(sess: requests.Session, fuente: dict) -> str:
    if fuente.get("pdf"):
        return fuente["pdf"]
    pagina = fuente["pagina"]
    r = _get(sess, pagina)
    if r.status_code != 200:
        raise RuntimeError(f"página oficial HTTP {r.status_code}: {pagina}")
    if r.headers.get("Content-Type", "").lower().startswith("application/pdf"):
        return pagina
    enlaces = [html.unescape(u) for u in _PDF_LINK_RE.findall(r.text)]
    enlaces = [u for u in enlaces if "/preview_" not in u]
    patron = fuente.get("pdf_match")
    if patron:
        enlaces = [u for u in enlaces if re.search(patron, u, flags=re.I)]
    if not enlaces:
        raise RuntimeError(f"no se halló PDF en {pagina}")
    # sin duplicados, preservando orden
    vistos, unicos = set(), []
    for u in enlaces:
        if u not in vistos:
            vistos.add(u); unicos.append(urljoin(pagina, u))
    return unicos[0]


def descargar_pdf(sess: requests.Session, url: str) -> bytes:
    r = _get(sess, url)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code} al bajar {url}")
    data = r.content
    ctype = r.headers.get("Content-Type", "").lower()
    if not data.startswith(b"%PDF-"):
        muestra = data[:200].decode("latin-1", "ignore").replace("\n", " ")
        raise RuntimeError(f"no es PDF (Content-Type={ctype!r}; inicio={muestra[:80]!r}) {url}")
    if len(data) < 5_000:
        raise RuntimeError(f"PDF sospechosamente pequeño ({len(data)} bytes) {url}")
    return data


def paginas_pdf(data: bytes) -> int | None:
    try:
        from pypdf import PdfReader
        return len(PdfReader(io.BytesIO(data)).pages)
    except Exception:
        return None


def verificar_pagina(sess: requests.Session, pagina: str) -> dict:
    """La url_oficial debe existir (200) y mantenerse en el dominio institucional (gob.pe)."""
    try:
        r = sess.head(pagina, timeout=30, allow_redirects=True)
        if r.status_code in (403, 405):
            r = _get(sess, pagina, intentos=2, timeout=60)
    except requests.RequestException as e:
        return {"ok": False, "motivo": f"sin_respuesta: {str(e)[:80]}"}
    host_orig = re.sub(r"^https?://", "", pagina).split("/")[0].lower()
    host_fin = re.sub(r"^https?://", "", r.url).split("/")[0].lower()
    if r.status_code != 200:
        return {"ok": False, "motivo": f"http_{r.status_code}", "url_final": r.url}
    if not (host_fin == host_orig or host_fin.endswith(".gob.pe")):
        return {"ok": False, "motivo": "redirige_fuera_de_gob_pe", "url_final": r.url}
    # gob.pe redirige por ID numérico e ignora el slug: exigimos que la institución se conserve.
    m = re.search(r"/institucion/([^/]+)/", pagina)
    if m:
        inst = m.group(1)
        # El OSCE pasó a llamarse OECE (Ley 32069): gob.pe redirige /institucion/osce/ → /institucion/oece/.
        equivalentes = {"osce": {"osce", "oece"}, "oece": {"osce", "oece"}}.get(inst, {inst})
        if not any(f"/institucion/{i}/" in r.url for i in equivalentes):
            return {"ok": False, "motivo": "redirige_a_otra_institucion", "url_final": r.url}
    return {"ok": True, "url_final": r.url}


def metadata_de(fuente: dict, corpus: str, pdf_url: str, data: bytes, n_pag: int | None, ver: dict) -> dict:
    return {
        "slug": fuente["slug"],
        "documento": fuente.get("documento") or fuente["slug"],
        "numero": fuente.get("numero"),
        "emisor": fuente.get("emisor"),
        "corpus": corpus,
        "regimen": str(fuente.get("regimen", "ambos")),
        "tipo": fuente.get("tipo"),
        "vigencia_desde": fuente.get("vigencia_desde"),
        "vigencia_hasta": fuente.get("vigencia_hasta"),
        # Si la página redirige dentro de gob.pe (p. ej. osce → oece) se guarda la URL final, que es
        # la que verify.py podrá comprobar con HEAD sin sorpresas.
        "url_oficial": (ver.get("url_final") or fuente["pagina"]).split("?")[0] if ver.get("ok") else fuente["pagina"],
        "url_oficial_verificada": bool(ver.get("ok")),
        "url_pdf": pdf_url,
        "sha256": sha256_bytes(data),
        "bytes": len(data),
        "paginas": n_pag,
        "segmentar": bool(fuente.get("segmentar")),
        "importar_pdf": bool(fuente.get("importar_pdf", True)) and not bool(fuente.get("segmentar")),
        "descargado_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "nota": fuente.get("nota"),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--solo", nargs="*", help="slugs a procesar (default: todas las activas)")
    ap.add_argument("--dry-run", action="store_true", help="descarga y verifica, sin subir a GCS")
    args = ap.parse_args(argv)

    fuentes = [f for f in cargar_fuentes() if f.get("activa", True)]
    if args.solo:
        fuentes = [f for f in fuentes if f["slug"] in set(args.solo)]
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    sess = _sesion()
    bucket = None if args.dry_run else asegurar_bucket()
    catalogo = {} if args.dry_run else (leer_json_gcs(CATALOGO_BLOB, default={}) or {})

    ok, errores = 0, []
    for f in fuentes:
        slug = f["slug"]
        try:
            pdf_url = resolver_pdf(sess, f)
            cache = CACHE_DIR / f"{slug}.pdf"
            if cache.exists():
                data = cache.read_bytes()
            else:
                data = descargar_pdf(sess, pdf_url)
                cache.write_bytes(data)
            n_pag = paginas_pdf(data)
            ver = verificar_pagina(sess, f["pagina"])
            if not ver.get("ok"):
                print(f"  ! {slug}: url_oficial no verificada ({ver.get('motivo')})", file=sys.stderr)
            for corpus in f["corpus"]:
                meta = metadata_de(f, corpus, pdf_url, data, n_pag, ver)
                uri_pdf = gcs_uri(corpus, f"{slug}.pdf")
                if not args.dry_run:
                    subio = subir_si_cambio(bucket, f"{corpus}/{slug}.pdf", data, "application/pdf")
                    subir_si_cambio(bucket, f"{corpus}/{slug}.metadata.json",
                                    json.dumps(meta, ensure_ascii=False, indent=1).encode("utf-8"),
                                    "application/json")
                    catalogo[uri_pdf] = meta
                    estado = "subido" if subio else "sin cambios"
                else:
                    estado = "dry-run"
                print(f"  ✓ {slug} → {uri_pdf} ({len(data)//1024} KiB, {n_pag} pág., {estado})")
            ok += 1
        except Exception as e:
            errores.append((slug, str(e)))
            print(f"  ✗ {slug}: {e}", file=sys.stderr)

    if not args.dry_run and catalogo:
        # Fuentes desactivadas (activa: false) salen del catálogo para que corpus.py no las importe.
        inactivas = {f["slug"] for f in cargar_fuentes() if not f.get("activa", True)}
        for uri in [u for u, m in catalogo.items() if m.get("slug") in inactivas]:
            catalogo.pop(uri, None)
        escribir_json_gcs(CATALOGO_BLOB, catalogo)
        print(f"catálogo: gs://{BUCKET}/{CATALOGO_BLOB} ({len(catalogo)} entradas)")
    print(f"\n{ok} fuentes OK, {len(errores)} con error")
    for slug, err in errores:
        print(f"  - {slug}: {err}")
    return 1 if errores else 0


if __name__ == "__main__":
    sys.exit(main())
