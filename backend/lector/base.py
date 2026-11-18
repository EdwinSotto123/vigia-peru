"""Lo que comparten los lectores de documentos: llamar a Claude por el Worker vigia-llm (ruta /nativo, la API de
Anthropic tal cual con la clave de respaldo), bajar documentos del R2 por vigia-r2-sync y sacar los PDF de un ZIP.
Las llaves salen de SSM, nunca de un archivo.
"""
from __future__ import annotations

import base64
import io
import os
import re
import subprocess
import unicodedata
import zipfile
from functools import lru_cache
from pathlib import Path

LLM_URL = "https://vigia-llm.vigiaperu.workers.dev/nativo"
R2_URL = "https://vigia-r2-sync.vigiaperu.workers.dev/objeto"
CLIENTE = "vigia-lector/1.0"                 # Cloudflare corta a «Python-urllib» con el error 1010

# USD por millón de tokens (precios de lista, 2026-11). Haiku 5.5 cobra más cuando el prompt pasa de 100 mil tokens.
PRECIOS = {
    "claude-haiku-5-5": {"in": 0.10, "out": 0.50, "in_largo": 0.50, "out_largo": 2.50, "umbral": 100_000},
    "claude-sonnet-5-5": {"in": 2.0, "out": 10.0},
    "claude-opus-5-5": {"in": 4.0, "out": 20.0},
}


def costo_usd(modelo: str, tokens_in: int, tokens_out: int, lote: bool = False) -> float:
    p = next((v for k, v in PRECIOS.items() if modelo.startswith(k)), None)
    if p is None:
        return float("nan")
    largo = "umbral" in p and tokens_in > p["umbral"]
    c = tokens_in * p["in_largo" if largo else "in"] / 1e6 + tokens_out * p["out_largo" if largo else "out"] / 1e6
    return c / 2 if lote else c


@lru_cache(maxsize=None)
def ssm(nombre: str) -> str:
    # En GitLab CI las credenciales vienen del token OIDC: sin perfil (forzarlo rompería la cadena de credenciales).
    env = dict(os.environ, MSYS_NO_PATHCONV="1") if os.environ.get("AWS_WEB_IDENTITY_TOKEN_FILE")         else dict(os.environ, AWS_PROFILE="founder.edwin", MSYS_NO_PATHCONV="1")
    return subprocess.run(["aws", "ssm", "get-parameter", "--region", "us-east-2", "--name", nombre, "--with-decryption",
                           "--query", "Parameter.Value", "--output", "text"], capture_output=True, text=True, env=env,
                          check=True).stdout.strip()


def cliente_claude():
    import anthropic
    return anthropic.Anthropic(api_key=ssm("/vigia/llm/token"), base_url=LLM_URL, default_headers={"user-agent": CLIENTE},
                               max_retries=3, timeout=300)


def solo_digitos(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")


def norma(s: str | None) -> str:
    """Texto comparable: sin tildes, mayúsculas, sólo letras y números, espacios simples."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", s).split())


R2_URL = "https://vigia-r2-sync.vigiaperu.workers.dev/objeto"


def ocids_de_archivo(ruta: str | None) -> list[str] | None:
    """Los procesos de un archivo (uno por línea; vale el OCID completo o el corto). None si no hay archivo: todos."""
    if not ruta:
        return None
    return [x.strip() for x in Path(ruta).read_text(encoding="utf-8").splitlines() if x.strip() and not x.startswith("#")]


def bajar_r2(url_gcs: str) -> bytes:
    """gs://bucket/ruta → el objeto, por vigia-r2-sync (réplica en R2)."""
    import requests
    bucket, key = url_gcs.removeprefix("gs://").split("/", 1)
    r = requests.get(R2_URL, params={"bucket": bucket, "key": key},
                     headers={"Authorization": f"Bearer {ssm('/vigia/r2/lector-token')}", "user-agent": CLIENTE}, timeout=180)
    r.raise_for_status()
    return r.content


_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def texto_docx(datos: bytes) -> list[str]:
    """Los párrafos de un .docx en orden (las celdas de una tabla, en una línea separadas por « | »). Sólo lee
    word/document.xml con ElementTree: nada se ejecuta. Vacío si no es un .docx."""
    import xml.etree.ElementTree as ET
    try:
        with zipfile.ZipFile(io.BytesIO(datos)) as z:
            raiz = ET.fromstring(z.read("word/document.xml"))
    except (zipfile.BadZipFile, KeyError, ET.ParseError):
        return []
    cuerpo = raiz.find(f"{_W}body")
    if cuerpo is None:
        return []

    def texto(p) -> str:
        return "".join(t.text or "" for t in p.iter(f"{_W}t")).strip()

    out: list[str] = []
    for hijo in cuerpo:
        if hijo.tag == f"{_W}p":
            t = texto(hijo)
            if t:
                out.append(t)
        elif hijo.tag == f"{_W}tbl":
            for fila in hijo.iter(f"{_W}tr"):
                celdas = [" ".join(texto(p) for p in c.iter(f"{_W}p") if texto(p)) for c in fila.iter(f"{_W}tc")]
                if any(celdas):
                    out.append(" | ".join(celdas))
    return out


def docx_a_pdf(datos: bytes) -> bytes | None:
    """Un .docx como PDF con su texto (seleccionable, A4, paginado por PyMuPDF): así lo leen igual los lectores, el texto
    por página y las citas. La página es la del PDF armado, no la del Word original. None si no tiene texto."""
    import html

    import fitz  # PyMuPDF

    parrafos = texto_docx(datos)
    if not parrafos:
        return None
    cuerpo = "".join(f"<p>{html.escape(p)}</p>" for p in parrafos)
    story = fitz.Story(html=f"<body style='font-family: sans-serif; font-size: 9pt'>{cuerpo}</body>")
    buf = io.BytesIO()
    escritor = fitz.DocumentWriter(buf)
    hoja = fitz.paper_rect("a4")
    caja = hoja + (40, 40, -40, -40)
    mas = 1
    while mas:
        dispositivo = escritor.begin_page(hoja)
        mas, _ = story.place(caja)
        story.draw(dispositivo)
        escritor.end_page()
    escritor.close()
    return buf.getvalue()


def pdfs_de(datos: bytes, formato: str, tope_bytes: int = 20 * 1024 * 1024) -> list[tuple[str, bytes]]:
    """Los PDF de un documento: él mismo si es PDF, o los PDF de adentro si es ZIP (en memoria; nada se ejecuta ni se
    descomprime a disco). Un .docx (suelto o dentro del ZIP) se convierte a PDF con su texto: en 2026, 139 procesos tenían
    las bases sólo en Word y no se leían (2026-11-18). RAR y 7z no se leen."""
    f = (formato or "").lower()
    if f == "pdf" or datos.startswith(b"%PDF"):
        return [("documento.pdf", datos)] if datos.startswith(b"%PDF") and len(datos) <= tope_bytes else []
    if f == "docx":
        # El tope va sobre el PDF armado: un Word pesa por sus imágenes (unas bases de 39 MB son sólo texto aquí).
        pdf = docx_a_pdf(datos)
        return [("documento.pdf", pdf)] if pdf and len(pdf) <= tope_bytes else []
    if f != "zip":
        return []
    out, total = [], 0
    try:
        with zipfile.ZipFile(io.BytesIO(datos)) as z:
            for i in sorted(z.infolist(), key=lambda x: x.filename):
                nombre = i.filename.lower()
                es_docx = nombre.endswith(".docx")
                if i.is_dir() or not (nombre.endswith(".pdf") or es_docx) or (not es_docx and total + i.file_size > tope_bytes):
                    continue
                b = z.read(i)
                if es_docx:
                    b = docx_a_pdf(b) or b""
                if b.startswith(b"%PDF") and total + len(b) <= tope_bytes:
                    out.append((Path(i.filename).name[:200], b))
                    total += len(b)
    except zipfile.BadZipFile:
        return []
    return out


def bloques_pdf(pdfs: list[tuple[str, bytes]], pedido: str) -> list[dict]:
    """El mensaje del usuario: cada PDF como documento y, al final, el pedido."""
    bloques = [{"type": "document", "title": n[:200],
                "source": {"type": "base64", "media_type": "application/pdf", "data": base64.standard_b64encode(b).decode()}}
               for n, b in pdfs]
    return [{"role": "user", "content": bloques + [{"type": "text", "text": pedido}]}]
