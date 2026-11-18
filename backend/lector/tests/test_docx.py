"""Un .docx se lee como PDF con su texto (lector/base.py: texto_docx, docx_a_pdf, pdfs_de).

  python -m pytest backend/lector/tests -q
"""
import io
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from lector import base  # noqa: E402

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'


def docx(cuerpo: str) -> bytes:
    """Un .docx mínimo con ese cuerpo (lo que importa es word/document.xml)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr("word/document.xml", f'<?xml version="1.0" encoding="UTF-8"?><w:document {W}><w:body>{cuerpo}</w:body></w:document>')
    return buf.getvalue()


def p(t: str) -> str:
    return f"<w:p><w:r><w:t>{t}</w:t></w:r></w:p>"


BASES = docx(p("BASES ADMINISTRATIVAS") + p("CAPÍTULO I: GENERALIDADES") + p("Cuantía de la contratación: S/ 792 083,66")
             + "<w:tbl><w:tr><w:tc>" + p("Ítem") + "</w:tc><w:tc>" + p("Descripción") + "</w:tc></w:tr>"
             + "<w:tr><w:tc>" + p("1") + "</w:tc><w:tc>" + p("Grupo electrógeno encapsulado") + "</w:tc></w:tr></w:tbl>"
             + "".join(p(f"Requisito número {i}: experiencia del postor en la especialidad.") for i in range(400)))


def test_texto_con_tablas_y_tildes():
    t = base.texto_docx(BASES)
    assert t[:3] == ["BASES ADMINISTRATIVAS", "CAPÍTULO I: GENERALIDADES", "Cuantía de la contratación: S/ 792 083,66"]
    assert "1 | Grupo electrógeno encapsulado" in t


def test_pdf_paginado_y_legible():
    import fitz
    pdf = base.docx_a_pdf(BASES)
    assert pdf and pdf.startswith(b"%PDF")
    with fitz.open(stream=pdf, filetype="pdf") as doc:
        assert doc.page_count > 1                       # 400 requisitos no caben en una hoja
        texto = "".join(pg.get_text() for pg in doc)
    assert "Cuantía de la contratación: S/ 792 083,66" in texto
    assert "Requisito número 399" in texto


def test_pdfs_de_docx_suelto_y_dentro_de_un_zip():
    assert len(base.pdfs_de(BASES, "docx")) == 1
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("bases/Bases integradas.docx", BASES)
        z.writestr("leeme.txt", "nada")
    partes = base.pdfs_de(buf.getvalue(), "zip")
    assert [n for n, _ in partes] == ["Bases integradas.docx"] and partes[0][1].startswith(b"%PDF")
    assert base.pdfs_de(b"no es un docx", "docx") == []
