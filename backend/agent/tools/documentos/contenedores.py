"""ZIP / RAR / DOCX / XLSX / XLS / DOC / imágenes → unidades de texto para OCR.
Incluye los conversores a PDF sintético (DOCX e imágenes sueltas), usados solo desde acá
aunque estén históricamente ubicados junto al parser legacy en el archivo original."""

from tools._core import *  # noqa: F401,F403
import subprocess as _subprocess
import tempfile as _tempfile
from tools.doc_select import rank_documento, PRIORIDAD_DEFAULT
from ._base import _sha256_hex, _IMG_EXTS


# ── Contenedores: ZIP / RAR / DOCX / XLSX / DOC / imágenes → unidades de texto ────────


def _unidad(nombre: str, kind: str, data=None, paginas=None) -> dict:
    """kind ∈ {'pdf' (data=bytes), 'paginas' (paginas=[{texto}] ya extraídas), 'imagenes' (data=pdf sintético)}."""
    return {"nombre": nombre, "kind": kind, "data": data, "paginas": paginas}


def _paginar_texto(texto: str, max_chars: int = 4500) -> list[str]:
    t = (texto or "").strip()
    if not t:
        return []
    return [t[i:i + max_chars] for i in range(0, len(t), max_chars)]


_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def _docx_rels_media(z: "zipfile.ZipFile") -> dict[str, str]:
    """rId → nombre de entrada del ZIP (word/media/imageN.ext) según document.xml.rels."""
    import xml.etree.ElementTree as ET
    rels: dict[str, str] = {}
    try:
        root = ET.fromstring(z.read("word/_rels/document.xml.rels"))
    except Exception:
        return rels
    for rel in root:
        rid, tgt = rel.get("Id"), (rel.get("Target") or "")
        if not rid or not tgt or str(rel.get("TargetMode") or "").lower() == "external":
            continue
        tgt = tgt.lstrip("/")
        if not tgt.startswith("word/"):
            tgt = "word/" + tgt
        rels[rid] = tgt
    return rels


def _docx_media_en_orden(z: "zipfile.ZipFile") -> tuple[list[str], dict[str, str]]:
    """Imágenes de word/media en ORDEN DE APARICIÓN en el cuerpo (r:embed / r:link de
    word/document.xml) y luego las no referenciadas (namelist). Devuelve (nombres, rId→nombre).
    Antes se usaba `namelist()`: el requerimiento escaneado (image4…image12) quedaba
    intercalado (p.27 = image6, p.30 = image1, …) y el LLM leía las EETT desordenadas."""
    rels = _docx_rels_media(z)
    disponibles = {n for n in z.namelist() if n.startswith("word/media/") and n.lower().endswith(_IMG_EXTS)}
    orden: list[str] = []
    try:
        xml = z.read("word/document.xml").decode("utf-8", errors="replace")
        for m in re.finditer(r'r:(?:embed|link)="([^"]+)"', xml):
            name = rels.get(m.group(1))
            if name and name in disponibles and name not in orden:
                orden.append(name)
    except Exception:
        pass

    def _nat(n: str):
        m = re.search(r"(\d+)", n.rsplit("/", 1)[-1])
        return (int(m.group(1)) if m else 10 ** 9, n)
    for n in sorted(disponibles - set(orden), key=_nat):
        orden.append(n)
    return orden, rels


def _docx_bloques(d, rels: dict[str, str]) -> list[dict]:
    """Cuerpo del DOCX en orden real: [{texto, salto_antes, imagenes:[nombre…]}] por párrafo
    o tabla. `salto_antes` = hubo w:br type=page / w:lastRenderedPageBreak / sectPr antes del
    bloque → permite paginar como Word y no en trozos ficticios de 4500 chars."""
    from docx.table import Table
    from docx.text.paragraph import Paragraph
    W = "{%s}" % _W_NS
    R = "{%s}" % _R_NS
    bloques: list[dict] = []
    pendiente_salto = False
    body = d.element.body
    for child in body.iterchildren():
        tag = child.tag
        if tag == W + "p":
            texto = (Paragraph(child, d).text or "").strip()
            # saltos de página dentro del párrafo
            saltos = [br for br in child.iter(W + "br") if br.get(W + "type") == "page"]
            saltos += list(child.iter(W + "lastRenderedPageBreak"))
            imgs = []
            for blip in child.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}blip"):
                rid = blip.get(R + "embed") or blip.get(R + "link")
                name = rels.get(rid or "")
                if name:
                    imgs.append(name)
            for imd in child.iter("{urn:schemas-microsoft-com:vml}imagedata"):
                rid = imd.get(R + "id")
                name = rels.get(rid or "")
                if name and name not in imgs:
                    imgs.append(name)
            if texto or imgs:
                bloques.append({"texto": texto, "salto_antes": pendiente_salto or bool(saltos), "imagenes": imgs})
                pendiente_salto = False
            elif saltos:
                pendiente_salto = True
            if child.find(".//" + W + "sectPr") is not None:
                pendiente_salto = True
        elif tag == W + "tbl":
            filas = []
            try:
                for row in Table(child, d).rows:
                    cells = [(c.text or "").strip().replace("\n", " ") for c in row.cells]
                    line = " | ".join(c for c in cells if c)
                    if line.strip(" |"):
                        filas.append(line)
            except Exception:
                pass
            if filas:
                bloques.append({"texto": "\n".join(filas), "salto_antes": pendiente_salto, "imagenes": []})
                pendiente_salto = False
        elif tag == W + "sectPr":
            pendiente_salto = True
    return bloques


def _docx_a_unidades(blob: bytes, nombre: str) -> list[dict]:
    """DOCX → páginas de texto (cuerpo en orden: párrafos y tablas intercalados, cortado por
    los saltos de página reales del documento; si no hay, trozos ⟦bloque⟧ de 4500 chars) +
    una unidad 'imagenes' (PDF sintético) con las imágenes embebidas EN ORDEN DE APARICIÓN
    en el cuerpo (r:embed), para OCR. Cada imagen deja un marcador
    `[imagen N: word/media/imageK.jpg]` en el texto donde estaba."""
    out: list[dict] = []
    orden_imgs: list[str] = []
    rels: dict[str, str] = {}
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            orden_imgs, rels = _docx_media_en_orden(z)
    except Exception:
        pass
    idx_img = {n: i + 1 for i, n in enumerate(orden_imgs)}
    paginas_txt: list[str] = []
    try:
        from docx import Document
        d = Document(io.BytesIO(blob))
        bloques = _docx_bloques(d, rels)
        hay_saltos = any(b["salto_antes"] for b in bloques)
        cur: list[str] = []
        for b in bloques:
            if b["salto_antes"] and cur:
                paginas_txt.append("\n".join(cur))
                cur = []
            if b["texto"]:
                cur.append(b["texto"])
            for n in b["imagenes"]:
                cur.append(f"[imagen {idx_img.get(n, '?')}: {n} — ver páginas OCR de 'imágenes embebidas']")
        if cur:
            paginas_txt.append("\n".join(cur))
        if not hay_saltos:
            paginas_txt = _paginar_texto("\n".join(paginas_txt))
        else:
            # páginas reales pero muy largas (tablas enormes) → sub-cortar para no exceder el tope
            rec: list[str] = []
            for pg in paginas_txt:
                rec.extend(_paginar_texto(pg, 12000) or [""])
            paginas_txt = [x for x in rec if x.strip()]
    except Exception as e:
        print(f"[lote] python-docx falló en {nombre[:60]}: {str(e)[:100]}", flush=True)
    if paginas_txt:
        out.append(_unidad(nombre, "paginas", paginas=[{"texto": p} for p in paginas_txt]))
    images: list[tuple[str, bytes]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            for name in orden_imgs:
                try:
                    images.append((name, z.read(name)))
                except Exception:
                    continue
    except Exception:
        pass
    if images:
        synth = _images_to_synthetic_pdf(images)
        if synth:
            u = _unidad(f"{nombre} (imágenes embebidas)", "imagenes", data=synth)
            u["orden_imagenes"] = [n for n, _ in images]
            out.append(u)
    return out


def _xlsx_a_unidades(blob: bytes, nombre: str) -> tuple[list[dict], list[dict]]:
    """XLSX → una página por hoja (filas ' | '); requiere openpyxl (si falta → recorte)."""
    try:
        import openpyxl
    except Exception:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado",
                     "omitido": f"{nombre} (openpyxl no instalado)"}]
    try:
        wb = openpyxl.load_workbook(io.BytesIO(blob), read_only=True, data_only=True)
    except Exception as e:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "xlsx_ilegible",
                     "omitido": f"{nombre} ({str(e)[:80]})"}]
    paginas: list[dict] = []
    for ws in wb.worksheets:
        lines = []
        for row in ws.iter_rows(values_only=True):
            cells = ["" if v is None else str(v).strip() for v in row]
            if any(cells):
                lines.append(" | ".join(cells).rstrip(" |"))
        txt = f"[hoja: {ws.title}]\n" + "\n".join(lines)
        for chunk in _paginar_texto(txt, 12000):
            paginas.append({"texto": chunk})
    return ([_unidad(nombre, "paginas", paginas=paginas)] if paginas else []), []


def _xls_a_unidades(blob: bytes, nombre: str) -> tuple[list[dict], list[dict]]:
    try:
        import xlrd  # type: ignore
    except Exception:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado",
                     "omitido": f"{nombre} (.xls: xlrd no instalado)"}]
    try:
        wb = xlrd.open_workbook(file_contents=blob)
        paginas = []
        for sh in wb.sheets():
            lines = []
            for r in range(sh.nrows):
                cells = [str(sh.cell_value(r, c)).strip() for c in range(sh.ncols)]
                if any(cells):
                    lines.append(" | ".join(cells).rstrip(" |"))
            for chunk in _paginar_texto(f"[hoja: {sh.name}]\n" + "\n".join(lines), 12000):
                paginas.append({"texto": chunk})
        return ([_unidad(nombre, "paginas", paginas=paginas)] if paginas else []), []
    except Exception as e:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "xls_ilegible",
                     "omitido": f"{nombre} ({str(e)[:80]})"}]


def _doc_a_unidades(blob: bytes, nombre: str) -> tuple[list[dict], list[dict]]:
    """`.doc` legado → texto con `antiword` si está en PATH (no está en la imagen de Cloud
    Run por defecto); si no, recorte formato_no_soportado."""
    import shutil
    tool = shutil.which("antiword")
    if not tool:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado",
                     "omitido": f"{nombre} (.doc: antiword no disponible)"}]
    try:
        with _tempfile.NamedTemporaryFile(suffix=".doc", delete=False) as tf:
            tf.write(blob)
            path = tf.name
        try:
            res = _subprocess.run([tool, "-t", path], capture_output=True, timeout=60)
            txt = res.stdout.decode("utf-8", errors="replace")
        finally:
            try:
                os.unlink(path)
            except Exception:
                pass
        pags = [{"texto": p} for p in _paginar_texto(txt)]
        if not pags:
            return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "doc_sin_texto", "omitido": nombre}]
        return [_unidad(nombre, "paginas", paginas=pags)], []
    except Exception as e:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "doc_ilegible",
                     "omitido": f"{nombre} ({str(e)[:80]})"}]


def _leer_rar(blob: bytes) -> list[tuple[str, bytes]]:
    """Lista [(nombre, bytes)] de un RAR con `rarfile` (backends unar/bsdtar/7z/unrar)."""
    import rarfile
    with _tempfile.NamedTemporaryFile(suffix=".rar", delete=False) as tf:
        tf.write(blob)
        rar_path = tf.name
    out: list[tuple[str, bytes]] = []
    try:
        with rarfile.RarFile(rar_path) as rf:
            for info in rf.infolist():
                if info.is_dir():
                    continue
                try:
                    out.append((info.filename, rf.read(info)))
                except Exception as e:
                    out.append((info.filename, b""))
                    print(f"[lote] rar: no pude leer {info.filename[:60]}: {str(e)[:80]}", flush=True)
    finally:
        try:
            os.unlink(rar_path)
        except Exception:
            pass
    return out


def _expandir_contenedor(blob: bytes, nombre: str, prioridad: tuple[str, ...] | None = None,
                         depth: int = 0, vistos: dict[str, str] | None = None) -> tuple[list[dict], list[dict]]:
    """Blob de cualquier formato → (unidades de texto, recortes). SIN topes de cantidad: un ZIP
    con 9 PDFs produce 9 unidades ordenadas por la prioridad del perfil (título del archivo),
    no por `namelist()`. Lo que no se puede abrir (7z, .doc sin antiword, PDF cifrado, RAR
    sin backend) queda como recorte `formato_no_soportado` / `*_ilegible` — nunca en silencio."""
    recortes: list[dict] = []
    unidades: list[dict] = []
    if vistos is None:
        vistos = {}
    if not blob:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "vacio", "omitido": nombre}]
    if depth > 3:
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "profundidad_zip>3", "omitido": nombre}]
    low = nombre.lower()
    head = blob[:8]

    def _hijos(entries: list[tuple[str, bytes]], prefix: str) -> None:
        # Orden determinista: prioridad del perfil sobre el nombre del archivo, luego nombre.
        ranked = sorted(entries, key=lambda e: (rank_documento(e[0], None, prioridad or PRIORIDAD_DEFAULT)[0],
                                                e[0].lower()))
        imgs: list[tuple[str, bytes]] = []
        for name, data in ranked:
            base = name.rsplit("/", 1)[-1]
            if not base or name.endswith("/"):
                continue
            if base.lower().endswith(_IMG_EXTS):
                imgs.append((name, data))
                continue
            # Mismo archivo publicado varias veces dentro del paquete (acta repetida como
            # "cuadro de evaluación"): se procesa UNA vez y el duplicado queda registrado
            # como recorte `duplicado_sha256` (señal formal: cuadro de evaluación ausente).
            if data:
                sha = _sha256_hex(data)
                if sha in vistos:
                    recortes.append({"donde": f"contenedor:{prefix[:80]}", "limite": "duplicado_sha256",
                                     "omitido": f"{name} (= copia byte a byte de {vistos[sha]})"})
                    continue
                vistos[sha] = f"{prefix}{name}"
            u, r = _expandir_contenedor(data, f"{prefix}{name}", prioridad, depth + 1, vistos)
            unidades.extend(u)
            recortes.extend(r)
        if imgs:
            synth = _images_to_synthetic_pdf(imgs)
            if synth:
                unidades.append(_unidad(f"{prefix}{len(imgs)} imágenes (escaneo→PDF)", "imagenes", data=synth))
            else:
                recortes.append({"donde": f"contenedor:{prefix[:80]}", "limite": "imagenes_ilegibles",
                                 "omitido": [n for n, _ in imgs][:20]})

    if head[:4] == b"Rar!":
        try:
            entries = _leer_rar(blob)
        except Exception as e:
            return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "rar_no_extraible",
                         "omitido": f"{nombre} ({type(e).__name__}: {str(e)[:100]})"}]
        _hijos(entries, f"{nombre}/")
        return unidades, recortes
    if head[:2] == b"PK":
        if _is_docx_blob(blob):
            return _docx_a_unidades(blob, nombre), []
        if low.endswith(".xlsx") or _es_xlsx_blob(blob):
            return _xlsx_a_unidades(blob, nombre)
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                entries = []
                for info in z.infolist():
                    if info.is_dir():
                        continue
                    try:
                        entries.append((info.filename, z.read(info)))
                    except Exception as e:
                        recortes.append({"donde": f"contenedor:{nombre[:80]}", "limite": "zip_entrada_ilegible",
                                         "omitido": f"{info.filename} ({str(e)[:60]})"})
        except zipfile.BadZipFile:
            return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "zip_corrupto", "omitido": nombre}]
        _hijos(entries, f"{nombre}/")
        return unidades, recortes
    if head[:4] == b"%PDF":
        try:
            import fitz
            d = fitz.open(stream=blob, filetype="pdf")
            if d.is_encrypted and not d.authenticate(""):
                d.close()
                return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "pdf_cifrado", "omitido": nombre}]
            d.close()
        except Exception:
            pass
        return [_unidad(nombre, "pdf", data=blob)], []
    if head[:6] == b"7z\xbc\xaf\x27\x1c":
        return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado", "omitido": f"{nombre} (.7z)"}]
    if head[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":  # OLE2: .doc / .xls
        if low.endswith(".xls"):
            return _xls_a_unidades(blob, nombre)
        return _doc_a_unidades(blob, nombre)
    if low.endswith(_IMG_EXTS) or head[:4] in (b"\x89PNG", b"\xff\xd8\xff\xe0", b"\xff\xd8\xff\xe1", b"II*\x00", b"MM\x00*"):
        synth = _images_to_synthetic_pdf([(nombre, blob)])
        if synth:
            return [_unidad(nombre, "imagenes", data=synth)], []
    if low.endswith((".txt", ".csv", ".md")):
        try:
            txt = blob.decode("utf-8", errors="replace")
            return [_unidad(nombre, "paginas", paginas=[{"texto": p} for p in _paginar_texto(txt)])], []
        except Exception:
            pass
    return [], [{"donde": f"contenedor:{nombre[:80]}", "limite": "formato_no_soportado",
                 "omitido": f"{nombre} (bytes {blob[:4].hex()}, {len(blob)} B)"}]


def _es_xlsx_blob(blob: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            return any(n == "xl/workbook.xml" for n in z.namelist())
    except Exception:
        return False


def _is_docx_blob(blob: bytes) -> bool:
    """True si el blob es un archivo DOCX (Office Open XML).
    Un DOCX siempre empieza con PK (ZIP) y contiene `word/document.xml`.
    SEACE V3 publica algunas Bases Administrativas en DOCX en lugar de PDF.
    """
    if not blob or blob[:2] != b"PK":
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            names = z.namelist()
            return any(n == "word/document.xml" for n in names)
    except zipfile.BadZipFile:
        return False

def _docx_to_synthetic_pdf(blob: bytes) -> bytes | None:
    """Convierte un DOCX en un PDF sintético procesable por el pipeline de
    Gemini. Estrategia híbrida:

      1. Extrae texto + tablas con python-docx → páginas de texto plano.
      2. Extrae imágenes embebidas (word/media/*) → páginas separadas con cada
         imagen renderizada full-page.

    El PDF sintético NO es visualmente bonito pero sí leíble por Gemini, que
    hará OCR Vision sobre las imágenes y leerá el texto plano directamente.

    Returns: bytes del PDF resultante o None si la conversión falla.
    """
    try:
        from docx import Document
        import fitz
    except Exception:
        return None

    # 1. Texto + tablas del DOCX
    text_chunks: list[str] = []
    try:
        d = Document(io.BytesIO(blob))
        for para in d.paragraphs:
            t = (para.text or "").strip()
            if t:
                text_chunks.append(t)
        for tbl in d.tables:
            for row in tbl.rows:
                cells = [(c.text or "").strip() for c in row.cells]
                line = " | ".join(c for c in cells if c)
                if line.strip(" |"):
                    text_chunks.append(line)
    except Exception:
        pass

    # 2. Imágenes embebidas (PNG/JPEG/etc en word/media/)
    images: list[tuple[str, bytes]] = []
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            for name in z.namelist():
                if name.startswith("word/media/") and not name.endswith("/"):
                    ext = name.rsplit(".", 1)[-1].lower()
                    if ext in ("png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff"):
                        try:
                            images.append((name, z.read(name)))
                        except Exception:
                            continue
    except Exception:
        pass

    if not text_chunks and not images:
        return None

    # 3. Construir PDF sintético con PyMuPDF
    out_doc = fitz.open()
    full_text = "\n".join(text_chunks)
    # Páginas de texto: A4 portrait, 1700pt de alto, 595pt de ancho
    PAGE_W, PAGE_H = 595, 842
    MARGIN = 36
    FONT_SIZE = 9
    LINE_H = 12
    if full_text:
        # Dividir en chunks que caben en una página
        max_chars_per_page = 4500  # heurístico
        text_pages = [full_text[i:i + max_chars_per_page]
                      for i in range(0, len(full_text), max_chars_per_page)] or [""]
        for chunk in text_pages:
            page = out_doc.new_page(width=PAGE_W, height=PAGE_H)
            try:
                page.insert_textbox(
                    fitz.Rect(MARGIN, MARGIN, PAGE_W - MARGIN, PAGE_H - MARGIN),
                    chunk, fontsize=FONT_SIZE, fontname="helv",
                )
            except Exception:
                # Fallback: insertar como texto plano sin caja
                try:
                    page.insert_text((MARGIN, MARGIN + FONT_SIZE), chunk[:3000], fontsize=FONT_SIZE)
                except Exception:
                    pass
    # Páginas de imagen: una imagen por página (full-bleed)
    for name, img_bytes in images:
        try:
            page = out_doc.new_page(width=PAGE_W, height=PAGE_H)
            page.insert_image(
                fitz.Rect(MARGIN, MARGIN, PAGE_W - MARGIN, PAGE_H - MARGIN),
                stream=img_bytes,
            )
        except Exception:
            continue
    try:
        pdf_bytes = out_doc.tobytes()
    finally:
        out_doc.close()
    return pdf_bytes if pdf_bytes else None

def _images_to_synthetic_pdf(images: list[tuple[str, bytes]]) -> bytes | None:
    """Convierte una lista de imágenes (JPG/PNG/TIFF/BMP) en un PDF sintético
    de 1 imagen por página. Útil para bases SEACE que vienen como ZIP de
    escaneos sueltos. Gemini hace OCR Vision sobre cada página.
    """
    try:
        import fitz  # PyMuPDF
    except Exception:
        return None
    if not images:
        return None
    out = fitz.open()
    try:
        for name, img_bytes in images:
            try:
                # Insertar como página completa A4 (vertical o horizontal según aspect)
                pix = fitz.Pixmap(img_bytes)
                w, h = pix.width, pix.height
                # A4 = 595x842 pt; ajustamos orientación
                if w > h:
                    page = out.new_page(width=842, height=595)
                else:
                    page = out.new_page(width=595, height=842)
                rect = page.rect
                page.insert_image(rect, stream=img_bytes)
            except Exception:
                continue
        if len(out) == 0:
            return None
        pdf_bytes = out.tobytes()
    finally:
        out.close()
    return pdf_bytes if pdf_bytes else None
