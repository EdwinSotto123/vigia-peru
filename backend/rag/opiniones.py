"""Migra las opiniones OECE/OSCE (tabla `opiniones_oece_estructurado`, 721 filas: una por
interpretación de artículo) al corpus `criterios-vinculantes`:

    gs://vigia-peru-rag/criterios-vinculantes/opiniones/<id>.txt   (+ metadata en catalogo.json)

Cada .txt lleva una cabecera con norma, número de opinión, año y artículos, y el texto de la
interpretación; el `link` de gob.pe queda como `url_oficial`. Idempotente (sha256 por blob).

Uso:
    PGHOST=<ip pública de Cloud SQL> python -m backend.rag.opiniones            # exporta y sube
    python -m backend.rag.opiniones --dry-run --muestra 3

Conexión: variables PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD; si falta PGPASSWORD se lee
`.cloudsql-password` en la raíz del repo (misma convención que backend/scrapers/_core/pipeline.py).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import ssl
import sys
from pathlib import Path

from ._comun import (AQUI, CATALOGO_BLOB, asegurar_bucket, escribir_json_gcs, gcs_uri, leer_json_gcs,
                     subir_si_cambio)

REPO_ROOT = AQUI.parent.parent
CORPUS = "criterios-vinculantes"
PREFIJO = "opiniones"


def _password() -> str:
    pw = os.getenv("PGPASSWORD")
    if pw:
        return pw
    f = REPO_ROOT / ".cloudsql-password"
    if f.exists():
        m = re.search(r"password:\s*(\S+)", f.read_text(encoding="utf-8"))
        if m:
            return m.group(1)
    raise SystemExit("falta PGPASSWORD (o .cloudsql-password en la raíz del repo)")


def conexion():
    import pg8000.dbapi
    host = os.getenv("PGHOST", "127.0.0.1")
    kw = dict(user=os.getenv("PGUSER", "postgres"), password=_password(), host=host,
              port=int(os.getenv("PGPORT", "5432")), database=os.getenv("PGDATABASE", "vigia"), timeout=30)
    if host not in ("127.0.0.1", "localhost") and not host.startswith("/"):
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        kw["ssl_context"] = ctx
    return pg8000.dbapi.connect(**kw)


def leer_opiniones() -> list[dict]:
    conn = conexion()
    try:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, ano, norma, num_opinion, articulo_ley, numeral_art_ley, literal_art_ley, "
            "       articulo_reglamento, interpretacion, link "
            "  FROM opiniones_oece_estructurado ORDER BY ano, num_opinion, id")
        cols = ["id", "ano", "norma", "num_opinion", "articulo_ley", "numeral", "literal",
                "articulo_reglamento", "interpretacion", "link"]
        return [dict(zip(cols, r)) for r in cur.fetchall()]
    finally:
        conn.close()


def regimen_de(norma: str) -> str:
    n = (norma or "").lower()
    if "32069" in n:
        return "32069"
    if "30225" in n or "1017" in n:
        return "30225"
    return "ambos"


def texto_opinion(o: dict) -> str:
    art = ""
    if o.get("articulo_ley"):
        art = f"Art. {o['articulo_ley']}"
        if o.get("numeral"):
            art += f".{o['numeral']}"
        if o.get("literal"):
            art += f" lit. {o['literal']}"
        art += " de la Ley"
    if o.get("articulo_reglamento"):
        art += (" · " if art else "") + f"Art. {o['articulo_reglamento']} del Reglamento"
    cab = f"Opinión N° {o['num_opinion']} ({o['ano']}) — {o['norma']}"
    if art:
        cab += f" — {art}"
    return f"{cab}\n[opinión de la Dirección Técnico Normativa OSCE/OECE]\n\n{(o.get('interpretacion') or '').strip()}\n"


def metadata_opinion(o: dict) -> dict:
    return {
        "slug": f"opinion-{o['id']}",
        "documento": f"Opinión N° {o['num_opinion']}/DTN ({o['ano']}, {o['norma']})",
        "numero": f"Opinión N° {o['num_opinion']}",
        "num_opinion": o["num_opinion"],
        "ano": o["ano"],
        "norma": o["norma"],
        "articulo_ley": o.get("articulo_ley"),
        "articulo_reglamento": o.get("articulo_reglamento"),
        "articulo": o.get("articulo_ley") or o.get("articulo_reglamento"),
        "emisor": "OSCE/OECE — Dirección Técnico Normativa",
        "corpus": CORPUS,
        "regimen": regimen_de(o["norma"]),
        "tipo": "opinion",
        "vigencia_desde": f"{o['ano']}-01-01" if o.get("ano") else None,
        "vigencia_hasta": None,
        "url_oficial": o.get("link") or "",
        "url_oficial_verificada": bool(o.get("link") and "gob.pe" in o["link"]),
        "importar_pdf": False,
        "es_opinion": True,
        "origen": "opiniones_oece_estructurado",
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--muestra", type=int, default=0)
    args = ap.parse_args(argv)

    ops = leer_opiniones()
    print(f"{len(ops)} filas de opiniones leídas")
    for o in ops[:args.muestra]:
        print("  ·", texto_opinion(o)[:220].replace("\n", " ⏎ "))
    if args.dry_run:
        return 0
    bucket = asegurar_bucket()
    catalogo = leer_json_gcs(CATALOGO_BLOB, default={}) or {}
    nuevos = 0
    for o in ops:
        blob = f"{CORPUS}/{PREFIJO}/{o['id']}.txt"
        if subir_si_cambio(bucket, blob, texto_opinion(o).encode("utf-8"), "text/plain; charset=utf-8"):
            nuevos += 1
        catalogo[gcs_uri(CORPUS, PREFIJO, f"{o['id']}.txt")] = metadata_opinion(o)
    escribir_json_gcs(CATALOGO_BLOB, catalogo)
    print(f"{nuevos} archivos nuevos o cambiados en gs://…/{CORPUS}/{PREFIJO}/ ; catálogo {len(catalogo)} entradas")
    return 0


if __name__ == "__main__":
    sys.exit(main())
