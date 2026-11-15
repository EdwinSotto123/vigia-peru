"""Convierte las normas descargadas (PDF, DOCX, HTML, TXT) en fichas .json por artículo para `cargar_normas.py … carpeta`.

    python -X utf8 backend/scripts/normas_fichas.py <carpeta_descargas> <carpeta_fichas> [--solo <id>] [--catalogo <json>]

`<carpeta_descargas>` es la raíz de la descarga (rag-legal-pe): lee `scripts/corpus_docs.json` + `00_manifiesto/verificacion.csv`
(primera descarga) y `00_manifiesto/lote*_resultado.json` (lo que bajaron los agentes). Sólo entra lo que tiene texto y
cuyo identificador coincide con el archivo. Escribe además `<carpeta_fichas>/_informe.json`: qué entró, qué no y por qué.

Cómo corta:
  · ley, reglamento, decreto: un fragmento por artículo y por disposición complementaria;
  · directiva, lineamiento: por numeral (6.1, 7.2…), con el título de su sección;
  · opinión, acuerdo, bases estándar y lo demás: por párrafos, hasta ~1 800 caracteres, con el título de la sección;
  · un artículo largo se parte en trozos que conservan su número y su epígrafe.

Las reglas de régimen, materia, tipo y versión están en `clasificar()` y en AJUSTES (lo que no se deduce del nombre).
"""
from __future__ import annotations

import argparse
import bisect
import csv
import json
import re
import sys
import unicodedata
from pathlib import Path

MAX = 2000          # caracteres por trozo
MIN = 60

# Lo que no se deduce del identificador: versiones, fechas de corte y lo que ya está en la base (cargado desde Chroma).
YA_ESTA = "ya está en la base con el texto consolidado"
SALTAR = {
    "A-N1-L32069": YA_ESTA, "X-LEY-CONSOLIDADA": YA_ESTA, "A-N2-DS009-2025-EF": YA_ESTA, "X-REGL-CONSOLIDADO": YA_ESTA,
    "X-LEY-ORIGINAL-32069": "sólo se usa su artículo 30 (X-IMPEDIMENTOS)",
    "F-N1-L32513": YA_ESTA, "X-L32513": YA_ESTA, "G-N1-DS082-2019-EF": YA_ESTA, "CAT-LEY-27444": YA_ESTA, "CAT-LEY-31358": YA_ESTA,
    "EXTRA-LEY31288": YA_ESTA, "EXTRA-013-2022-CG-NORM": YA_ESTA, "EXTRA-013-2022-CG-NORM-integrada": YA_ESTA,
    "G-N2-DS344-2018-EF": "la base tiene el reglamento anterior consolidado; este es el texto de 2018 sin modificatorias",
    "DIR-OECE-INDICE-17072026": "es un índice, no una norma",
    "A-N2-DS009-2025-EF-original": "es el texto actualizado, que ya está en la base (el original oficial es un escaneo)",
    "EXTRA-TUO-L31589": "repetida (ley-31589)",
    "DGA-DIRECTIVA-0004-2025-EF5401": "repetida (directiva-0004-2025-ef-54-01)", "DGA-DIRECTIVA-0006-2025-EF5401": "repetida (directiva-0006-2025-ef-54-01)",
    "SERVIR-000965-2026": "repetida (lote 4)", "SERVIR-RPE-000076-2026": "repetida (lote 4)",
    **{f"C-BASE-{i:02d}": "bases estándar de 2025: la base ya tiene las de uso frecuente" for i in range(1, 15)},
}
AJUSTES = {
    # El texto que publicó El Peruano el 24-06-2024 trae el cuadro del artículo 30.1; el consolidado sólo pone un enlace.
    "X-IMPEDIMENTOS": {"slug": "ley-32069-art-30-impedimentos", "tipo": "ley", "regimen": "32069", "materia": "contrataciones",
                       "documento": "Ley N° 32069, artículo 30: impedimentos para contratar (cuadro del numeral 30.1)", "numero": "32069",
                       "fecha_emision": "2024-06-24", "vigencia_desde": "2025-04-22", "vigencia_hasta": None, "solo_articulos": ["30"],
                       "nota": "Texto publicado el 24-06-2024. Las modificaciones posteriores están en el texto consolidado de la ley."},
    # El Reglamento como regía antes del D.S. 001-2026-EF (cambió 123 artículos el 14-01-2026). El PDF oficial del texto
    # original es un escaneo; el texto ANTERIOR de cada artículo modificado está en la columna izquierda del cuadro
    # comparativo del OECE. `version_de` hace que la búsqueda sirva este texto, y no el vigente, a un proceso anterior.
    "X-CUADRO-DS001-2026": {"slug": "ds-009-2025-ef-anterior", "version_de": "ds-009-2025-ef", "tipo": "reglamento", "regimen": "32069",
                            "materia": "contrataciones", "numero": "009-2025-EF", "fecha_emision": "2025-01-22", "columna": "izquierda",
                            "documento": "Reglamento de la Ley N° 32069 (D.S. N° 009-2025-EF), texto anterior al 14-01-2026",
                            "vigencia_desde": "2025-04-22", "vigencia_hasta": "2026-01-13", "estado": "vigente_modificada",
                            "nota": "Sólo los artículos que modificó el D.S. 001-2026-EF, como regían antes. Fuente: cuadro comparativo del OECE."},
    "EXTRA-DIR0004-ANEXO": {"slug": "directiva-0004-2025-ef-53-01"}, "EXTRA-DIR0002-2026-ANEXO": {"slug": "directiva-0002-2026-ef-53-01"},
    "CAT-DS-326-2025-EF": {"materia": "empleo_publico"}, "CAT-DU-038-2006": {"materia": "empleo_publico"},
    "X-DS001-2026-EF": {"vigencia_desde": "2026-01-14"}, "A-N2-DS001-2026-EF": {"vigencia_desde": "2026-01-14"},
    "CAT-LEY-32732": {"materia": "contrataciones", "regimen": "32069", "estado": "condicionada"},
    "X-L32515": {"materia": "contrataciones", "regimen": "32069", "vigencia_desde": "2025-12-05"},
    "F-N1-L32515": {"materia": "contrataciones", "regimen": "32069", "vigencia_desde": "2025-12-05"},
    "CAT-LEY-32187": {"materia": "contrataciones", "regimen": "32069", "vigencia_desde": "2025-04-22"},
    "CAT-DL-1715": {"vigencia_desde": "2026-02-05"},
    "DGA-RD-0017-2025-EF5401": {"tipo": "directiva", "slug": "rd-0017-2025-ef-54-01", "vigencia_desde": "2025-05-10"},
    "SERVIR-000213-2026": {"tipo": "opinion", "fecha_emision": "2026-01-01"},
    "D-N1-DL1439": {"materia": "contrataciones", "regimen": "ambos"},
    "E-N2-DS328-2025-EF": {"materia": "empleo_publico"}, "CAT-DS-112-2025-PCM": {"materia": "empleo_publico"},
    "CAT-DS-301-2025-EF": {"materia": "presupuesto", "regimen": "ambos", "vigencia_desde": "2026-01-01", "vigencia_hasta": "2026-12-31"},
    # Las bases estándar de 2026 reemplazan a las de 2025 con el Reglamento modificado.
    **{f"C-BASE26-{i:02d}": {"vigencia_desde": "2026-01-14"} for i in range(1, 20)},
}

RE_ART = re.compile(r"^[ \t]*(?:Art[íi]culo|ART[ÍI]CULO)\s+(\d{1,3}(?:\s?-\s?[A-Z])?)\s*[°º]?\s*[.\-–:]*[ \t]*(.*)$", re.M)
RE_SECCION_DISP = re.compile(r"^[ \t]*(DISPOSICI[OÓ]N(?:ES)?\s+COMPLEMENTARIAS?\s+(FINAL(?:ES)?|TRANSITORIAS?|MODIFICATORIAS?|DEROGATORIAS?))[ \t]*$", re.M | re.I)
ORDINALES = ["ÚNICA", "PRIMERA", "SEGUNDA", "TERCERA", "CUARTA", "QUINTA", "SEXTA", "SÉPTIMA", "OCTAVA", "NOVENA", "DÉCIMA", "UNDÉCIMA",
             "DUODÉCIMA", "DÉCIMA TERCERA", "DÉCIMA CUARTA", "DÉCIMA QUINTA", "DÉCIMA SEXTA", "DÉCIMA SÉPTIMA", "DÉCIMA OCTAVA", "DÉCIMA NOVENA",
             "VIGÉSIMA", "VIGÉSIMA PRIMERA", "VIGÉSIMA SEGUNDA", "VIGÉSIMA TERCERA", "VIGÉSIMA CUARTA", "VIGÉSIMA QUINTA", "VIGÉSIMA SEXTA",
             "VIGÉSIMA SÉPTIMA", "VIGÉSIMA OCTAVA", "VIGÉSIMA NOVENA", "TRIGÉSIMA"]
_ORD = {unicodedata.normalize("NFD", o).encode("ascii", "ignore").decode(): i for i, o in enumerate(ORDINALES)}
RE_DISP = re.compile(r"^[ \t]*((?:D[ÉE]CIMO?A?|VIG[ÉE]SIMA|TRIG[ÉE]SIMA|[ÚU]NICA|PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|S[ÉE]PTIMA|OCTAVA|NOVENA|"
                     r"UND[ÉE]CIMA|DUOD[ÉE]CIMA)(?:[ \t]+(?:PRIMERA|SEGUNDA|TERCERA|CUARTA|QUINTA|SEXTA|S[ÉE]PTIMA|OCTAVA|NOVENA))?)[ \t]*[.\-–:]+[ \t]*(.*)$",
                     re.M | re.I)
RE_NUMERAL = re.compile(r"^[ \t]*(\d{1,2}\.\d{1,2})\.?[ \t]+(\S.*)$", re.M)
RE_ROMANO = re.compile(r"^[ \t]*((?:[IVX]{1,5})\.)[ \t]+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ,/()\-]{3,90})[ \t]*$", re.M)
RE_TITULO = re.compile(r"^[ \t]*((?:T[ÍI]TULO|CAP[ÍI]TULO|SUBCAP[ÍI]TULO|SECCI[OÓ]N)\s+[IVXLC\d]+.*)$", re.M)


def sin_tildes(s: str) -> str:
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()


def slug_de(ident: str, id_: str = "") -> str:
    """El mismo slug para la misma norma venga de la descarga que venga: «Directiva N° 001-2025-OECE-CD», «DIR-OECE-001-2025»."""
    m = re.match(r"^(?:CAT-)?(DIR|LIN)-(?:OECE-)?(LIN-)?(\d{3})-(20\d{2})", id_ or "")
    if m and "OECE" in (id_ + ident).upper():
        return f"{'lineamiento' if m.group(1) == 'LIN' or m.group(2) else 'directiva'}-{m.group(3)}-{m.group(4)}-oece-cd"
    s = re.sub(r"\bN\s*[°ºo]\.?\s*(?=\d|lineamiento)", "", ident, flags=re.I)
    s = re.sub(r"\(.*$", "", s)
    s = sin_tildes(s).lower()
    s = s.replace("d.s.", "ds").replace("d.l.", "dl").replace("d.u.", "du").replace("r.d.", "rd").replace("r.c.", "rc")
    s = re.sub(r"^directiva\s+lineamiento", "lineamiento", s.strip())
    s = re.sub(r"^acuerdo de sala plena", "acuerdo-sala-plena", s)
    s = re.sub(r"\b0+(\d{4})-(20\d{2})", r"\1-\2", s)          # «00016-2026» = «0016-2026»
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:80]


# ---------------------------------------------------------------- texto

def texto_paginas(archivo: Path, columna: str | None = None) -> list[str]:
    suf = archivo.suffix.lower()
    if suf == ".pdf":
        import fitz
        with fitz.open(archivo) as pdf:
            if columna:          # cuadro a dos columnas (páginas apaisadas): sólo los bloques de ese lado, sin cabecera ni pie
                paginas = []
                for p in pdf:
                    if p.rect.width < p.rect.height:
                        continue
                    medio, alto = p.rect.width / 2, p.rect.height
                    bloques = [b for b in p.get_text("blocks")
                               if (b[2] <= medio + 8 if columna == "izquierda" else b[0] >= medio - 8) and b[1] > 104 and b[3] < alto - 52]
                    bloques.sort(key=lambda b: (round(b[1]), b[0]))
                    paginas.append("\n".join(b[4] for b in bloques if not b[4].strip().startswith("Decreto Supremo N")))
                return paginas
            return [p.get_text("text") for p in pdf]
    if suf == ".docx":
        import docx
        d = docx.Document(str(archivo))
        partes = [p.text for p in d.paragraphs]
        for t in d.tables:
            for fila in t.rows:
                celdas = []
                for c in fila.cells:
                    x = c.text.strip()
                    if x and (not celdas or celdas[-1] != x):
                        celdas.append(x)
                if celdas:
                    partes.append(" | ".join(celdas))
        return ["\n".join(partes)]
    if suf in (".html", ".htm"):
        from bs4 import BeautifulSoup
        return [BeautifulSoup(archivo.read_text(encoding="utf-8", errors="ignore"), "html.parser").get_text("\n")]
    return [archivo.read_text(encoding="utf-8", errors="ignore")]


def limpiar(t: str) -> str:
    t = t.replace("­", "").replace("\xa0", " ")
    t = re.sub(r"^\s*\d*\s*NORMAS LEGALES\s.*$", "", t, flags=re.M)                 # cabecera de El Peruano
    t = re.sub(r"^\s*(?:El Peruano|Firmado por:|Editora Peru|Fecha:).*$", "", t, flags=re.M)
    t = re.sub(r"^\s*(?:P[áa]gina\s+)?\d{1,3}\s*(?:de\s+\d{1,3})?\s*$", "", t, flags=re.M)   # número de página suelto
    t = re.sub(r"[ \t]+", " ", t)
    return re.sub(r"\n{3,}", "\n\n", t)


def unir(paginas: list[str]) -> tuple[str, list[int]]:
    """El texto entero y dónde empieza cada página (para decir en qué página cae un trozo)."""
    texto, inicios = "", []
    for p in paginas:
        inicios.append(len(texto))
        texto += limpiar(p) + "\n"
    return texto, inicios


# ---------------------------------------------------------------- cortes

def _partir(cuerpo: str) -> list[str]:
    """Trozos de hasta MAX caracteres, cortando en párrafo o, si no hay, en oración."""
    cuerpo = cuerpo.strip()
    if len(cuerpo) <= MAX * 1.25:
        return [cuerpo] if cuerpo else []
    piezas, actual = [], ""
    for par in re.split(r"\n\s*\n|\n(?=\s*(?:\d{1,3}\.\d|[a-z]\)|\d{1,2}\.\s))", cuerpo):
        par = par.strip()
        while len(par) > MAX:                       # un párrafo enorme: por oraciones
            corte = par.rfind(". ", 0, MAX)
            corte = corte + 1 if corte > MAX // 3 else MAX
            piezas.append((actual + "\n" + par[:corte]).strip() if actual else par[:corte])
            actual, par = "", par[corte:].strip()
        if len(actual) + len(par) + 1 > MAX and actual:
            piezas.append(actual)
            actual = par
        else:
            actual = (actual + "\n" + par).strip()
    if actual:
        piezas.append(actual)
    return piezas


def _epigrafe(resto: str, cuerpo: str) -> str | None:
    e = resto.strip(" .-–:")
    if not e:                                       # el título va en la línea siguiente
        prim = cuerpo.strip().split("\n", 1)[0].strip(" .-–:")
        e = prim if 3 < len(prim) < 140 and not re.match(r"^\d", prim) else ""
    if len(e) > 150:                                # no era un título: era el texto del artículo
        return None
    return e or None


def cortar(texto: str, tipo: str) -> list[dict]:
    """[{articulo, epigrafe, cuerpo, pos}] según el tipo de documento."""
    marcas = []                                     # (pos, clase, etiqueta, resto)
    arts = list(RE_ART.finditer(texto))
    usar_articulos = tipo in ("ley", "reglamento") and len(arts) >= 2 or len(arts) >= 6
    if usar_articulos:
        visto = 0
        for m in arts:
            n = re.sub(r"\s", "", m.group(1))
            num = int(re.match(r"\d+", n).group())
            # Dentro de una norma que modifica otra aparecen artículos citados («Artículo 15…»): se quedan en su artículo.
            if num + 40 < visto:
                continue
            visto = max(visto, num)
            marcas.append((m.start(), "art", n, m.group(2)))
        seccion = None
        secs = [(m.start(), m.group(2).upper()) for m in RE_SECCION_DISP.finditer(texto)]
        for m in RE_DISP.finditer(texto):
            previas = [s for s in secs if s[0] < m.start()]
            if not previas:
                continue
            seccion = previas[-1][1]
            letra = "F" if seccion.startswith("FINAL") else "T" if seccion.startswith("TRANS") else "M" if seccion.startswith("MODIF") else "D"
            ordinal = re.sub(r"\s+", " ", sin_tildes(m.group(1)).upper())
            if ordinal not in _ORD:
                continue
            nombre = {"F": "Final", "T": "Transitoria", "M": "Modificatoria", "D": "Derogatoria"}[letra]
            marcas.append((m.start(), "disp", f"DC{letra}-{_ORD[ordinal] or 'U'}", f"{m.group(1).capitalize()} Disposición Complementaria {nombre}. {m.group(2)[:90]}"))
    else:
        nums = list(RE_NUMERAL.finditer(texto))
        if tipo in ("directiva", "bases_estandar", "control") and len(nums) >= 6:
            secciones = [(m.start(), m.group(2).strip().title()) for m in RE_ROMANO.finditer(texto)]
            ultimo = (0, 0)
            for m in nums:
                a, b = (int(x) for x in m.group(1).split("."))
                if (a, b) < ultimo and a + 3 < ultimo[0]:        # un numeral citado, no uno propio
                    continue
                ultimo = (a, b)
                sec = [s for s in secciones if s[0] < m.start()]
                marcas.append((m.start(), "num", m.group(1), sec[-1][1] if sec else ""))
    marcas.sort()
    if not marcas:                                   # sin estructura: por párrafos, con el título de sección más cercano
        tit = [(m.start(), m.group(0).strip()[:120]) for m in list(RE_ROMANO.finditer(texto)) + list(RE_TITULO.finditer(texto))]
        tit.sort()
        salida, pos = [], 0
        for pieza in _partir(texto):
            i = texto.find(pieza[:60], pos)
            pos = i if i >= 0 else pos
            t = [x for x in tit if x[0] <= pos]
            salida.append({"articulo": None, "epigrafe": t[-1][1] if t else None, "cuerpo": pieza, "pos": pos})
        return salida
    salida = []
    if marcas[0][0] > 400:                           # lo anterior al primer artículo (visto y considerando): dos trozos como mucho
        for pieza in _partir(texto[:marcas[0][0]])[:2]:
            salida.append({"articulo": None, "epigrafe": "Parte considerativa", "cuerpo": pieza, "pos": 0})
    for i, (pos, clase, etq, resto) in enumerate(marcas):
        fin = marcas[i + 1][0] if i + 1 < len(marcas) else len(texto)
        bloque = texto[pos:fin].strip()
        cuerpo = bloque.split("\n", 1)[1] if "\n" in bloque else ""
        if clase == "art":
            epi = _epigrafe(resto, cuerpo)
        elif clase == "disp":
            epi = resto.strip(" .")[:150]
        else:
            epi = resto or None
        salida.append({"articulo": etq, "epigrafe": epi, "cuerpo": bloque, "pos": pos})
    return salida


def fragmentos(paginas: list[str], documento: str, tipo: str) -> list[dict]:
    texto, inicios = unir(paginas)
    salida = []
    for u in cortar(texto, tipo):
        piezas = _partir(u["cuerpo"])
        for k, pieza in enumerate(piezas):
            if len(pieza) < MIN:
                continue
            art = u["articulo"]
            if art and art.startswith("DC"):
                cab = f"{documento} — {u['epigrafe'] or art}"
            elif art:
                cab = f"{documento} — {'Artículo' if re.match(r'^\d+(-[A-Z])?$', art) else 'Numeral'} {art}" + (f" — {u['epigrafe']}" if u["epigrafe"] else "")
            else:
                cab = documento + (f" — {u['epigrafe']}" if u["epigrafe"] else "")
            if len(piezas) > 1:
                cab += f" (parte {k + 1} de {len(piezas)})"
            salida.append({"articulo": art, "epigrafe": (u["epigrafe"] or None) and u["epigrafe"][:160],
                           "pagina": (bisect.bisect_right(inicios, u["pos"]) or 1) if len(inicios) > 1 else None,
                           "texto": cab + "\n" + pieza})
    return salida


# ---------------------------------------------------------------- catálogo

def _fecha(v) -> str | None:
    v = str(v or "").strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", v)
    if m:
        return m.group(0)
    m = re.match(r"^(\d{2})/(\d{2})/(\d{4})", v)
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    m = re.match(r"^(\d{4})-(\d{2})$", v)
    return f"{m.group(1)}-{m.group(2)}-01" if m else None


def clasificar(d: dict) -> dict:
    """tipo, régimen, materia y fechas de un documento del manifiesto (campos de las dos descargas)."""
    ident = str(d.get("identificador") or "")
    titulo = str(d.get("titulo") or "")
    todo = sin_tildes(f"{d.get('tipo_documento') or d.get('tipo') or ''} {ident} {titulo}").upper()
    t = sin_tildes(f"{d.get('tipo_documento') or d.get('tipo') or ''} {ident}").upper()
    if not re.search(r"LEY|D\.[SLU]\.|DECRETO|DIRECTIVA|R\.[DCMJ]\.|RESOLUCION|ACUERDO|OPINION|BASES|RPE|INFORME|LINEAMIENTO|CONSTITUCION|TUO", t):
        t = todo
    m = re.match(r"^([A-G])-", str(d.get("id") or ""))
    cat = (m.group(1) if m else str(d.get("categoria") or ""))[:1]
    if re.search(r"ACUERDO DE SALA PLENA", t):
        tipo = "acuerdo_sala_plena"
    elif re.search(r"PRECEDENTE", t):
        tipo = "precedente"
    elif re.search(r"^\s*(OPINION\b|INFORME TECNICO)", t.strip()):
        tipo = "opinion"
    elif re.search(r"BASES? ESTANDAR", t) and not re.search(r"^\s*(DIRECTIVA|RESOLUCION|R\.D\.)", t.strip()):
        tipo = "bases_estandar"
    elif re.search(r"-CG\b|CONTRALORIA", t) and not re.search(r"^\s*LEY\b", t.strip()):
        tipo = "control"
    elif re.search(r"DIRECTIVA|LINEAMIENTO|RESOLUCION|R\.D\.|R\.M\.|\bRPE\b|R\.J\.|COMUNICADO|GUIA|MANUAL|INSTRUCTIVO", t):
        tipo = "directiva"
    elif re.search(r"DECRETO SUPREMO|D\.S\.|REGLAMENTO", t) and not re.search(r"^\s*(LEY|DECRETO LEGISLATIVO|D\.L\.)", t.strip()):
        tipo = "reglamento"
    elif re.search(r"\bLEY\b|DECRETO LEGISLATIVO|D\.L\.|DECRETO DE URGENCIA|D\.U\.|CONSTITUCION|TUO|TEXTO UNICO", t):
        tipo = "ley"
    else:
        tipo = "otra"
    t = todo
    if re.search(r"SERVIR|\bCAS\b|\b1057\b|075-2008|31131|32563|30057|040-2014|\b1023\b|28175|\b1442\b|\b1666\b|D\.L\. (N. )?(276|728)\b|31188|29973|29248|26771|27674|"
                 r"018-2007-TR|PLANILLA|AIRHSP|EF/53|NEPOTISMO|DISCAPACIDAD|CONSTITUCION|UNIDAD DE INGRESO", t):
        materia = "empleo_publico"
    elif re.search(r"31589|OBRAS PARALIZADAS", t):
        materia = "contrataciones"
    elif tipo == "control" or re.search(r"27785|SISTEMA NACIONAL DE CONTROL|31288|31358", t):
        materia = "control"
    elif re.search(r"PRESUPUESTO|ENDEUDAMIENTO|\b1440\b|\b1441\b|\b1436\b|\bUIT\b", t):
        materia = "presupuesto"
    elif re.search(r"27444|27806|TRANSPARENCIA|27815|CODIGO DE ETICA DE LA FUNCION", t):
        materia = "administrativo"
    elif re.search(r"INVIERTE|\b1252\b|EF/63|29230|OBRAS POR IMPUESTOS|INFOBRAS", t):
        materia = "inversion"
    else:
        materia = "contrataciones"
    fechas = [x for x in (_fecha(d.get("fecha_emision")), _fecha(d.get("fecha_publicacion")), _fecha(d.get("version_fecha"))) if x]
    m = re.search(r"-(19[89]\d|20[0-3]\d)\b", ident)
    # Si el número trae el año («D000107-2026»), vale la fecha de ese año: la otra suele ser una fecha citada en el texto.
    del_anio = [x for x in fechas if m and x[:4] == m.group(1)] if tipo in ("opinion", "acuerdo_sala_plena", "precedente") else []
    emision = (del_anio or fechas or [None])[0]
    if tipo in ("opinion", "acuerdo_sala_plena", "precedente") and m and emision and emision[:4] != m.group(1):
        emision = None
    anio = int(emision[:4]) if emision else None
    if not anio:
        m = re.search(r"-(19\d{2}|20\d{2})\b", ident)
        anio = int(m.group(1)) if m else None
    desde = _fecha(d.get("vigente_desde")) or emision
    reg = str(d.get("regimen") or "")
    if materia != "contrataciones":
        regimen = "ambos"
    elif "30225" in reg or cat == "G" or re.search(r"30225|344-2018|082-2019|1444|1341", t):
        regimen = "30225"
    elif "32069" in reg or re.search(r"32069|009-2025-EF|001-2026-EF|222-2026|OECE|EF/54", t):
        regimen = "32069"
    elif tipo in ("directiva", "bases_estandar", "opinion", "acuerdo_sala_plena", "precedente") and anio:
        regimen = "32069" if (emision or f"{anio}-06-01") >= "2025-04-22" else "30225"
    else:
        regimen = "ambos"
    # Una norma del régimen vigente no rige antes del 22-04-2025 aunque se publicara antes.
    if regimen == "32069" and tipo in ("ley", "reglamento", "directiva", "bases_estandar"):
        if not desde:
            desde = f"{anio}-01-01" if anio and anio > 2025 else "2025-04-22"
        desde = max(desde, "2025-04-22")
    hasta = _fecha(d.get("vigente_hasta"))
    if regimen == "30225" and tipo in ("ley", "reglamento", "directiva", "bases_estandar") and not hasta:
        hasta = "2025-04-21"
    estado = sin_tildes(str(d.get("estado_norma") or d.get("vigencia") or "")).lower()
    estado = ("derogada" if "derog" in estado else "vigente_modificada" if "modific" in estado else "ultraactiva" if "ultra" in estado
              else "condicionada" if "condicion" in estado else "historica" if "histor" in estado else "vigente")
    return {"tipo": tipo, "materia": materia, "regimen": regimen, "fecha_emision": emision or (f"{anio}-01-01" if anio else None),
            "vigencia_desde": desde, "vigencia_hasta": hasta, "estado": estado}


APOYO = [
    {"id": "X-CUADRO-DS001-2026", "identificador": "D.S. N° 009-2025-EF (texto anterior al D.S. 001-2026-EF)",
     "archivo_local": "09_lote1_ley_reglamento/X-DS001-2026-EF_cuadro-comparativo.pdf",
     "url_origen": "https://www.gob.pe/institucion/oece/colecciones/45029"},
]


def manifiesto(raiz: Path) -> list[dict]:
    docs = [{**d, "_ok": True, "_coincide": "si", "_lote": "1"} for d in APOYO if (raiz / d["archivo_local"]).exists()]
    viejo = raiz / "scripts" / "corpus_docs.json"
    if viejo.exists():
        ver = {r["id"]: r for r in csv.DictReader(open(raiz / "00_manifiesto" / "verificacion.csv", encoding="utf-8-sig"))}
        for d in json.loads(viejo.read_text(encoding="utf-8")):
            v = ver.get(d["id"]) or {}
            d["_ok"] = v.get("existe") == "True" and v.get("tiene_texto") == "si"
            d["_coincide"] = v.get("coincide_identificador")
            d["_lote"] = "0"
            docs.append(d)
    for f in sorted((raiz / "00_manifiesto").glob("lote*_resultado.json")):
        dato = json.loads(f.read_text(encoding="utf-8"))
        lista = dato if isinstance(dato, list) else dato.get("resultados") or dato.get("documentos") or []
        for d in lista:
            if not isinstance(d, dict):
                continue
            d["_ok"] = str(d.get("estado")) == "descargado" and str(d.get("tiene_texto")).lower() in ("true", "si", "sí", "1")
            d["_coincide"] = str(d.get("coincide_identificador", "si")).lower()
            d["_lote"] = re.search(r"lote(\d)", f.name).group(1)
            docs.append(d)
    return docs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("descargas")
    ap.add_argument("fichas")
    ap.add_argument("--solo")
    ap.add_argument("--catalogo")
    a = ap.parse_args()
    raiz, salida = Path(a.descargas), Path(a.fichas)
    salida.mkdir(parents=True, exist_ok=True)
    catalogo = {}
    if a.catalogo:
        c = json.loads(Path(a.catalogo).read_text(encoding="utf-8"))
        for x in (c if isinstance(c, list) else list(c.values())[0]):
            catalogo[slug_de(x.get("numero") or "")] = x
    informe, usados = [], {}
    for d in manifiesto(raiz):
        ident = str(d.get("identificador") or d.get("id"))
        if a.solo and a.solo != d.get("id"):
            continue
        fila = {"id": d.get("id"), "identificador": ident, "lote": d["_lote"]}
        if d.get("id") in SALTAR:
            informe.append({**fila, "entra": False, "motivo": SALTAR[d.get("id")]})
            continue
        archivo = raiz / str(d.get("archivo_local") or "")
        if not d["_ok"] or not d.get("archivo_local") or not archivo.exists():
            informe.append({**fila, "entra": False, "motivo": "sin archivo con texto"})
            continue
        # En las directivas de Perú Compras el número de la resolución no sale en el texto; el de la directiva sí se confirmó.
        if str(d["_coincide"]).lower() in ("no", "false") and not str(d.get("id") or "").startswith("DIR-PC-00"):
            informe.append({**fila, "entra": False, "motivo": "el archivo no es la norma que dice el identificador"})
            continue
        aj = dict(AJUSTES.get(d.get("id"), {}))
        solo = aj.pop("solo_articulos", None)
        columna = aj.pop("columna", None)
        k = {**clasificar(d), **{x: y for x, y in aj.items() if x in ("tipo", "regimen", "materia", "fecha_emision", "vigencia_desde", "vigencia_hasta", "estado")}}
        slug = aj.get("slug") or slug_de(ident, str(d.get("id") or ""))
        if tipo_bases := (k["tipo"] == "bases_estandar"):
            slug = slug_de(f"bases estandar {d.get('id')}")
        documento = aj.get("documento") or (f"{ident}, {d.get('titulo')}" if d.get("titulo") and str(d.get("titulo"))[:25].lower() not in ident.lower() else ident)
        documento = re.sub(r"\s+", " ", documento)[:170]
        try:
            frag = fragmentos(texto_paginas(archivo, columna), documento if not tipo_bases else str(d.get("titulo") or ident)[:150], k["tipo"])
        except Exception as e:  # noqa: BLE001
            informe.append({**fila, "entra": False, "motivo": f"no se pudo leer: {str(e)[:120]}"})
            continue
        if solo:
            frag = [f for f in frag if f["articulo"] in solo]
        if not frag:
            informe.append({**fila, "entra": False, "motivo": "sin texto útil"})
            continue
        cat = catalogo.get(slug_de(ident, str(d.get("id") or ""))) or {}
        ficha = {"slug": slug, "documento": documento, "numero": re.sub(r"^(Ley|D\.S\.|D\.L\.|D\.U\.|Directiva|R\.D\.|Opini[oó]n|Acuerdo de Sala Plena)\s*N°\s*", "", ident)[:60],
                 "emisor": d.get("emisor") or cat.get("emisor"), "tipo": k["tipo"], "regimen": k["regimen"], "materia": k["materia"], "estado": k["estado"],
                 "fecha_emision": k["fecha_emision"], "vigencia_desde": k["vigencia_desde"], "vigencia_hasta": k["vigencia_hasta"],
                 "url_oficial": d.get("url_pagina") or d.get("url_origen") or d.get("url_oficial"), "url_pdf": d.get("url_origen") or d.get("url_oficial"),
                 "origen": "descarga", "verificacion": cat.get("verificacion") or "C", "catalogo_id": cat.get("id"), "sha256": d.get("sha256"),
                 "nota": (d.get("observacion") or d.get("notas") or None), "fragmentos": frag}
        ficha.update({x: y for x, y in aj.items() if x != "slug"})
        if slug in usados and usados[slug] >= len(frag):          # la misma norma en las dos descargas: queda la más completa
            informe.append({**fila, "entra": False, "motivo": f"repetida ({slug})"})
            continue
        informe[:] = [x for x in informe if not (x.get("entra") and x.get("slug") == slug)]
        usados[slug] = len(frag)
        (salida / f"{slug}.json").write_text(json.dumps(ficha, ensure_ascii=False, indent=1), encoding="utf-8")
        con_art = sum(1 for f in frag if f["articulo"])
        informe.append({**fila, "entra": True, "slug": slug, "tipo": k["tipo"], "regimen": k["regimen"], "materia": k["materia"],
                        "desde": k["vigencia_desde"], "hasta": k["vigencia_hasta"], "fragmentos": len(frag), "con_articulo": con_art})
    (salida / "_informe.json").write_text(json.dumps(informe, ensure_ascii=False, indent=1), encoding="utf-8")
    entra = [x for x in informe if x["entra"]]
    print(f"{len(entra)} fichas, {sum(x['fragmentos'] for x in entra)} fragmentos; fuera: {len(informe) - len(entra)}")
    for x in informe:
        if not x["entra"]:
            print("  fuera:", x["id"], "|", x["identificador"][:50], "|", x["motivo"])


if __name__ == "__main__":
    sys.exit(main())
