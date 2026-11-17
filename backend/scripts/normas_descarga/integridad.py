"""Lote 8 del RAG normativo: las normas de INTEGRIDAD, con su TEXTO VIGENTE armado por artículo (2026-11-17).

    export NORMAS_DESCARGAS=C:/ruta/rag-legal-pe
    python -X utf8 -P backend/scripts/normas_descarga/integridad.py bajar      # baja las fuentes oficiales (lo ya bajado no se pide)
    python -X utf8 -P backend/scripts/normas_descarga/integridad.py armar      # arma cada norma por artículo y el manifiesto del lote
    python -X utf8 -P backend/scripts/normas_descarga/integridad.py revisar    # contrasta lo armado con otra copia oficial

Después, las fichas y la carga (la materia, las fechas y los nombres que no salen del manifiesto están en INTEGRIDAD, en
backend/scripts/normas_fichas.py; las fichas se copian también a 14_fichas para que `cargar_normas.py … podar` no las borre):
    python -X utf8 -P backend/scripts/normas_fichas.py $NORMAS_DESCARGAS $NORMAS_DESCARGAS/16_lote8_integridad/fichas --solo INT-LEY-28024,…
    python -X utf8 backend/scripts/cargar_normas.py prod carpeta $NORMAS_DESCARGAS/16_lote8_integridad/fichas
    python -X utf8 backend/scripts/cargar_normas.py prod vectores

Qué entra (todas con materia `integridad`, fuera de la búsqueda general: migración 331):
  · Ley 28024 (gestión de intereses y registro de visitas), texto vigente, y su Reglamento (D.S. 120-2019-PCM);
  · Ley 27815 (Código de Ética de la Función Pública), texto vigente, y su Reglamento (D.S. 033-2005-PCM: lo vigente y,
    aparte, los títulos I a IV que derogó el D.S. 040-2014-PCM);
  · Ley 31227 (declaración jurada de intereses), texto vigente, y su Reglamento (R.C. 158-2021-CG con sus modificatorias);
  · Ley 27588 y su Reglamento (D.S. 019-2002-PCM): DEROGADOS por la Ley 31564; rigieron hasta el 19-07-2023;
  · Ley 31564 (conflicto de intereses al entrar y salir del servicio público) y su Reglamento (D.S. 082-2023-PCM): lo que
    rige desde el 20-07-2023 en lugar de la Ley 27588;
  · Código Penal (D. Leg. 635): sólo los delitos de funcionarios que sirven a Vigía, del texto actualizado de El Peruano.

Por qué un guion propio: el texto vigente de varias de estas normas no existe en una sola fuente oficial abierta (el SPIJ
pide iniciar sesión). Se arma con el texto original y, para cada artículo modificado, el texto que publicó El Peruano en la
norma que lo modificó; cada artículo cambiado lleva una nota «(*)» que dice qué norma lo cambió y cuándo se publicó. Nada se
escribe a mano: todo párrafo sale de un archivo descargado. `revisar` compara el resultado, párrafo a párrafo, con otra
copia oficial (los textos del SPIJ que alojan entidades del Estado).

Deja en `16_lote8_integridad/`: `fuentes/` (lo descargado), un `<ID>.json` por norma (las unidades ya cortadas: artículo,
epígrafe y texto, que `normas_fichas.py` convierte en fichas), un `<ID>.txt` para leer y `00_manifiesto/lote8_resultado.json`.

Reglas de conducta: un pedido cada 1,2 s por dominio y cada 5 s en gob.pe, agente propio, sin sesiones ni captchas. No se
piden PDF a leyes.congreso.gob.pe (su robots.txt los veta) ni el índice de Normas Legales Actualizadas (vetado).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

if not os.environ.get("NORMAS_DESCARGAS"):
    raise SystemExit("Falta NORMAS_DESCARGAS: la carpeta donde se guardan las normas descargadas.")
RAIZ = Path(os.environ["NORMAS_DESCARGAS"])
DEST = RAIZ / "16_lote8_integridad"
FTE = DEST / "fuentes"
MANIFIESTO = RAIZ / "00_manifiesto" / "lote8_resultado.json"
UA = "vigia-rag/1.0 (descarga de normas publicas)"
CONSULTA = "2026-11-17"
EP = "https://busquedas.elperuano.pe"
GOB = "https://cdn.www.gob.pe/uploads/document/file"

# clave: (dirección, archivo, qué es). Un dispositivo de El Peruano sin texto en la página trae además su PDF (mismo nombre).
FUENTES = {
    "cp": ("https://diariooficial.elperuano.pe/Normas/obtenerDocumento?idNorma=2", "codigo-penal_normas-legales-actualizadas.pdf",
           "Código Penal, Normas Legales Actualizadas de Editora Perú"),
    "dl1353": (f"{EP}/dispositivo/NL/1471551-5", "NL_1471551-5.html", "D. Leg. 1353 (07-01-2017): modifica y deroga artículos de la Ley 28024"),
    "dl1415": (f"{EP}/dispositivo/NL/1691026-4", "NL_1691026-4.html", "D. Leg. 1415 (13-09-2018): modifica la Ley 28024"),
    "ds120": (f"{EP}/dispositivo/NL/1784086-1", "NL_1784086-1.html", "D.S. 120-2019-PCM (01-07-2019): Reglamento de la Ley 28024"),
    "l31227": (f"{EP}/dispositivo/NL/1965810-1", "NL_1965810-1.html", "Ley 31227 (23-06-2021)"),
    "l32058": (f"{EP}/dispositivo/NL/2297823-2", "NL_2297823-2.html", "Ley 32058 (14-06-2024): su artículo 8 modifica el artículo 13 de la Ley 31227"),
    "regl31227": (f"{EP}/dispositivo/SE/1981693-1", "SE_1981693-1.html", "Separata especial (13-08-2021): Reglamento de la Ley 31227"),
    "rc265": (f"{EP}/dispositivo/NL/2092701-1", "NL_2092701-1.html", "R.C. 265-2022-CG (05-08-2022): modifica el Reglamento de la Ley 31227"),
    "rc291": (f"{EP}/dispositivo/NL/2202652-1", "NL_2202652-1.html", "R.C. 291-2023-CG (08-08-2023): modifica el Reglamento de la Ley 31227"),
    "rc295": (f"{EP}/dispositivo/NL/2419288-1", "NL_2419288-1.html", "R.C. 295-2025-CG (15-07-2025): modifica el Reglamento de la Ley 31227"),
    "l31564": (f"{EP}/dispositivo/NL/2096431-2", "NL_2096431-2.html", "Ley 31564 (17-08-2022): deroga la Ley 27588"),
    "ds082": (f"{EP}/dispositivo/NL/2197427-1", "NL_2197427-1.html", "D.S. 082-2023-PCM (19-07-2023): Reglamento de la Ley 31564"),
    "l28024": (f"{GOB}/7476944/6364437-l-n-28024-2003.pdf", "gobpe_ley-28024_texto-original.pdf", "Ley 28024, texto original (copia del SPIJ en gob.pe)"),
    "l27815": (f"{GOB}/1010779/NormaHomVigente_0420200715-20664-1jmgiv3.pdf", "gobpe_ley-27815_spij.pdf",
               "Ley 27815 con las notas de la Ley 28496 (copia del SPIJ en gob.pe)"),
    "ds033": (f"{GOB}/301897/Reglamento_Ley_del_Codigo_de_Etica.pdf?v=1553296196", "gobpe_ds-033-2005-pcm.pdf", "D.S. 033-2005-PCM (PCM en gob.pe)"),
    "ds040": (f"{GOB}/2147983/DECRETO%20SUPREMO%20N%C2%BA%20040-2014-PCM.pdf.pdf", "gobpe_ds-040-2014-pcm_senace.pdf",
              "D.S. 040-2014-PCM (copia del SPIJ que publica el SENACE en gob.pe): el literal g) de su Única Disposición Complementaria "
              "Derogatoria deroga los títulos I a IV del D.S. 033-2005-PCM"),
    "compendio": (f"{GOB}/3270843/1c.%20ANEXO%201.%20Compendio%20Normativo_V11.05.2022_11-05-2022_20-13-32.pdf.pdf",
                  "gobpe_compendio-impedimentos-2022.pdf", "Compendio normativo sobre impedimentos (gob.pe, 11-05-2022): texto de la Ley 27588"),
    "l27588_escaneo": (f"{GOB}/181485/182272_Ley_2027588.pdf20180807-3081-domyol.pdf?v=1533684983", "gobpe_ley-27588_escaneo.pdf",
                       "Ley 27588 en gob.pe: sólo imagen, sin texto"),
    "ds019_escaneo": (f"{GOB}/181488/182273_DS_20019-2002-PCM.pdf20180807-3081-17hr4iv.pdf?v=1533684985", "gobpe_ds-019-2002-pcm_escaneo.pdf",
                      "D.S. 019-2002-PCM en gob.pe: sólo imagen, sin texto"),
    "ds019": ("http://www.sutran.gob.pe/wp-content/uploads/2015/08/ds_019-2002-pcm.pdf", "sutran_ds-019-2002-pcm_el-peruano.pdf",
              "Página de El Peruano del 08-03-2002 con el D.S. 019-2002-PCM (copia con texto que aloja la SUTRAN)"),
    # Sólo para contrastar (`revisar`): textos del SPIJ que alojan otras entidades del Estado.
    "x_l27588": ("https://www.smv.gob.pe/uploads/c-1-LEY_27588.pdf", "smv_ley-27588.pdf", "Ley 27588 (copia en la SMV)"),
    "x_l28024": ("https://www.senamhi.gob.pe/pdf/etica-integridad/03/02.pdf", "senamhi_ley-28024_spij.pdf", "Ley 28024 con notas (SPIJ, copia en el SENAMHI)"),
    "x_l31227": ("https://www.senamhi.gob.pe/pdf/etica-integridad/03/03.pdf", "senamhi_ley-31227_spij.pdf", "Ley 31227 con notas (SPIJ, copia en el SENAMHI)"),
    "x_regl31227": ("https://www.senamhi.gob.pe/pdf/etica-integridad/03/08.pdf", "senamhi_rc-158-2021-cg_spij.pdf",
                    "Reglamento de la Ley 31227 con notas (SPIJ, copia en el SENAMHI)"),
    "x_l27815": (f"{GOB}/2466908/Ley_del_C%C3%B3digo_de_%C3%89tica_de_la_Funci%C3%B3n_P%C3%BAblica-_Ley_N%C2%B0_27815_2012.pdf.pdf",
                 "gobpe_ley-27815_y_reglamento_2012.pdf", "Ley 27815 y su Reglamento, texto integrado de 2012 (gob.pe)"),
}


def _url(clave: str) -> str:
    return FUENTES[clave][0]


def _archivo(clave: str, sufijo: str | None = None) -> Path:
    f = FTE / FUENTES[clave][1]
    return f.with_suffix(sufijo) if sufijo else f


# ---------------------------------------------------------------- descarga

_ULTIMO: dict[str, float] = {}


def pedir(url: str, destino: Path) -> bool:
    """Baja `url` a `destino` si no está. Espera entre pedidos al mismo dominio; un fallo no se reintenta."""
    if destino.exists() and destino.stat().st_size > 0:
        return True
    dominio = urlparse(url).netloc.lower()
    espera = 5.0 if dominio in ("www.gob.pe", "cdn.www.gob.pe") else 1.2
    falta = _ULTIMO.get(dominio, 0) + espera - time.time()
    if falta > 0:
        time.sleep(falta)
    cuerpo = b""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=120) as r:
            cuerpo = r.read() if r.status == 200 else b""
    except Exception:  # noqa: BLE001  (algunos servidores del Estado no negocian TLS con Python: se prueba con curl)
        r = subprocess.run(["curl", "-sS", "-L", "-m", "120", "-A", UA, "-o", "-", "-w", "", url], capture_output=True)
        cuerpo = r.stdout if r.returncode == 0 else b""
    _ULTIMO[dominio] = time.time()
    if not cuerpo or cuerpo[:9].lower().startswith(b"<!doctype") and destino.suffix == ".pdf":
        print("   sin respuesta útil:", url[:110], flush=True)
        return False
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(cuerpo)
    return True


def bajar() -> None:
    for clave, (url, nombre, que) in FUENTES.items():
        f = FTE / nombre
        ok = pedir(url, f)
        if ok and f.suffix == ".html" and "div class=\"story\"" not in f.read_text(encoding="utf-8", errors="replace"):
            # La página del dispositivo no trae el texto: se baja el PDF de la separata, que la misma página enlaza.
            m = re.search(r"/api/archivo/file/[A-Za-z0-9_-]+/\*/[A-Za-z0-9_.-]+\.(?:pdf|PDF)", f.read_text(encoding="utf-8", errors="replace"))
            ok = bool(m) and pedir(EP + m.group(0), f.with_suffix(".pdf"))
        print(("ok   " if ok else "FALTA"), clave, "|", que, flush=True)


# ---------------------------------------------------------------- texto

ORDINALES = ["ÚNICA", "PRIMERA", "SEGUNDA", "TERCERA", "CUARTA", "QUINTA", "SEXTA", "SÉPTIMA", "OCTAVA", "NOVENA", "DÉCIMA"]
_ORD = {o: i for i, o in enumerate(ORDINALES)} | {"UNICA": 0, "SEPTIMA": 7, "SETIMA": 7, "DECIMA": 10}
RE_ORD = re.compile(r"^[“\"]?\s*(" + "|".join(sorted(_ORD, key=len, reverse=True)) + r")\s*[.\-–:]+\s*(.*)$", re.I | re.S)
RE_ART = re.compile(r"^[“\"]?\s*Art[íi]culo\s+(\d{1,3}(?:\s?-\s?[A-Z])?)\s*[º°]?\s*[.\-–:]+\s*(.*)$", re.I | re.S)
# Lo que abre párrafo aunque la línea anterior no termine en punto. Las palabras van en MAYÚSCULAS a propósito: «Título
# Preliminar», «Anexo N° 1» o «Disposición Complementaria» al empezar una línea suelen ser el medio de una oración.
RE_TITULAR = re.compile(r"^[“\"]?\s*(?:(?:Art[íi]culo|ART[ÍI]CULO)\s+\d{1,3}(?:\s?-\s?[A-Z])?\s*[º°]?\s*[.\-–]|T[ÍI]TULO\b|CAP[ÍI]TULO\b|"
                        r"SUBCAP[ÍI]TULO\b|SECCI[ÓO]N\b|DISPOSICI[ÓO]N|ANEXOS?\b|(?:"
                        + "|".join(sorted({x for o in _ORD for x in (o, o.capitalize())}, key=len, reverse=True)) + r")\s*[.\-–])")
RE_CLAVE = re.compile(r"^(?:T[ÍI]TULO|CAP[ÍI]TULO|SUBCAP[ÍI]TULO|SECCI[ÓO]N|DISPOSICI[ÓO]N|ANEXO|ART[ÍI]CULO)\b")
RE_SECCION = re.compile(r"\bDISPOSICI[ÓO]N(?:ES)?\s+(?:COMPLEMENTARIAS?|TRANSITORIAS?|FINAL(?:ES)?|MODIFICATORIAS?|DEROGATORIAS?)\b")
RE_FIRMA = re.compile(r"^(?:Comun[íi]quese al se[ñn]or|Comun[íi]quese a la se[ñn]ora|POR TANTO|Mando se publique|Mando que se publique|"
                      r"Dado en la Casa de Gobierno|Reg[íi]strese, comun[íi]quese|En Lima, a los)")
# Lo que no es texto de la norma: cabeceras y pies de página, sellos de firma digital, llamadas de notas del compendio.
BASURA = re.compile(r"^(?:\d{1,6}|NORMAS\s+LEGALES(?: ACTUALIZADAS)?|SEPARATA ESPECIAL|Inicio|Código Penal|/|El Peruano\s*/?|/\s*El Peruano|"
                    r"(?:Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo) \d{1,2} de \w+ de \d{4}\s*/?|Lima, \w+ \d{1,2} de \w+ de \d{4}|"
                    r"Pág\. \d+|Firmado [Dd]igitalmente por:?.*|EDITORA PERU|Fecha: [\d/: -]+|.*\bFAU|\d{11} hard|Motivo: .*|"
                    r"\d{1,3}\s+Publicad[ao] el .*|“AÑO DEL .*”)$")


def _mayus(t: str) -> bool:
    letras = [c for c in t if c.upper() != c.lower()]          # «º» y «ª» son letras para Python, pero no tienen mayúscula
    return len(letras) > 3 and all(c.isupper() for c in letras)


def _limpio(t: str) -> str:
    t = re.sub(r"ﬁ\s?", "fi", t)
    t = re.sub(r"ﬂ\s?", "fl", t)
    return t.replace("\xa0", " ").replace("­", "")


def parrafos_html(archivo: Path) -> list[str]:
    """El texto de un dispositivo de El Peruano (su página trae un <p> por párrafo)."""
    from bs4 import BeautifulSoup
    sopa = BeautifulSoup(archivo.read_text(encoding="utf-8", errors="replace"), "html.parser")
    historias = sopa.select("div.story")
    if not historias:
        raise ValueError(f"{archivo.name}: la página no trae el texto")
    pars = []
    for st in historias:
        for el in st.find_all(["p", "h1", "h2", "h3", "h4", "tr", "li"]):
            if el.name == "p" and el.find_parent("tr"):
                continue
            t = " | ".join(x for x in (re.sub(r"\s+", " ", c.get_text(" ")).strip() for c in el.find_all(["td", "th"])) if x) if el.name == "tr" \
                else re.sub(r"\s+", " ", el.get_text("")).strip()
            if t:
                pars.append(_limpio(t))
    return unir_mayusculas(pars)


def unir_mayusculas(pars: list[str]) -> list[str]:
    """Un título en mayúsculas partido en dos párrafos («DISPOSICIONES» y «COMPLEMENTARIAS FINALES») vuelve a ser uno."""
    salida: list[str] = []
    for p in pars:
        if salida and _mayus(salida[-1]) and _mayus(p) and not RE_CLAVE.match(p) and len(salida[-1]) + len(p) < 200 and not RE_ORD.match(p):
            salida[-1] += " " + p
        else:
            salida.append(p)
    return salida


def lineas_pdf(archivo: Path, paginas: set[int] | None = None, columnas: set[int] | None = None) -> list[dict]:
    """Las líneas de un PDF con texto, en orden de lectura: texto, si va en negrita, sangría y si hubo una línea en blanco.
    `columnas`: páginas a dos columnas cuyos bloques vienen desordenados en el PDF; se leen la izquierda y luego la derecha."""
    import fitz
    lineas = []
    with fitz.open(archivo) as pdf:
        for n, pagina in enumerate(pdf, 1):
            if paginas and n not in paginas:
                continue
            blanco = False
            bloques = pagina.get_text("dict")["blocks"]
            if columnas and n in columnas:
                medio = pagina.rect.width / 2
                bloques = sorted(bloques, key=lambda b: (0 if b["bbox"][0] < medio - 10 else 1, b["bbox"][1]))
            for bloque in bloques:
                for linea in bloque.get("lines", []):
                    t = _limpio("".join(s["text"] for s in linea["spans"]))
                    if not t.strip():
                        blanco = True
                        continue
                    if BASURA.match(t.strip()):
                        continue
                    tramos = [s for s in linea["spans"] if s["text"].strip()]
                    negrita = all("Bold" in s["font"] or s["flags"] & 16 for s in tramos)
                    lineas.append({"t": t.rstrip(), "neg": negrita, "x": linea["bbox"][0], "blanco": blanco, "pag": n})
                    blanco = False
    return lineas


def parrafos_pdf(lineas: list[dict], guiones: bool = False) -> list[dict]:
    """Junta las líneas en párrafos. Empieza párrafo: una línea en blanco, una sangría, un titular (artículo, título,
    disposición), el paso de un titular en negrita al cuerpo, o un punto final seguido de mayúscula, numeral o literal.
    `guiones`: la fuente corta palabras con guion al final de la línea (El Peruano de 2002)."""
    pars: list[dict] = []
    for i, l in enumerate(lineas):
        t = l["t"]
        sig = lineas[i + 1] if i + 1 < len(lineas) else None
        if pars:
            a = pars[-1]
            previo = a["t"].rstrip()
            fin = bool(re.search(r"[.:;][”\"’)]*$", previo))
            sangria = len(t) - len(t.lstrip(" ")) >= 3 or (sig is not None and sig["pag"] == l["pag"] and 5 <= l["x"] - sig["x"] <= 45)
            titular = bool(RE_TITULAR.match(t.strip())) or _mayus(t)
            sigue_titulo = _mayus(previo) and _mayus(t) and not RE_CLAVE.match(t.strip()) and not l["blanco"]
            blanco = l["blanco"] and (fin or not t.strip()[:1].islower())      # un salto de página en medio de una oración no parte el párrafo
            nuevo = not sigue_titulo and (blanco or titular or (sangria and fin) or (a["titular"] and a["neg"] and not l["neg"])
                                         or (fin and re.match(r"[A-ZÁÉÍÓÚÑ“\"¿(\d]|[a-z]\)(?:\s|$)|[a-z]\.\s", t.strip())))
            if not nuevo:
                if previo.endswith("-") and guiones and t.strip()[:1].islower():
                    a["t"] = previo[:-1] + t.strip()
                elif previo.endswith("-") and re.match(r"\d", t.strip()):
                    a["t"] = previo + t.strip()                       # «004-» y «2019-JUS»
                else:
                    a["t"] = previo + " " + t.strip()
                continue
        pars.append({"t": t.strip(), "neg": l["neg"], "x": l["x"], "titular": bool(RE_TITULAR.match(t.strip())) or _mayus(t)})
    for p in pars:
        p["t"] = re.sub(r"\s+", " ", p["t"]).strip()
    return pars


def sin_concordancias(pars: list[dict]) -> list[dict]:
    """Quita los bloques «CONCORDANCIAS:» del SPIJ (la lista de normas relacionadas, sangrada a la derecha)."""
    salida, quitando = [], False
    for p in pars:
        if p["t"].startswith("CONCORDANCIAS"):
            quitando = True
            continue
        if quitando and p["x"] >= 170:
            continue
        quitando = False
        salida.append(p)
    return salida


def rango(pars: list[str], desde: str, hasta: str | None = None, vez: int = 1) -> list[str]:
    """Los párrafos desde el que casa con `desde` (su `vez`-ésima aparición) hasta antes del que casa con `hasta`."""
    inicios = [i for i, p in enumerate(pars) if re.search(desde, p)]
    if len(inicios) < vez:
        raise ValueError(f"no aparece {desde!r}")
    i = inicios[vez - 1]
    if hasta:
        for j in range(i + 1, len(pars)):
            if re.search(hasta, pars[j]):
                return pars[i:j]
    return pars[i:]


def bloque_citado(pars: list[str], inicio: str) -> list[str]:
    """El texto nuevo de un artículo dentro de la norma que lo modifica: desde «“Artículo N…» hasta el párrafo que cierra
    las comillas. Devuelve los párrafos sin las comillas de apertura y de cierre."""
    i = next(k for k, p in enumerate(pars) if re.match(r"^[“\"]\s*" + inicio, p))
    for j in range(i, len(pars)):
        if re.search(r"[”\"]\s*\.?\s*$", pars[j]) and (j > i or len(pars[j]) > 80):
            bloque = pars[i:j + 1]
            bloque[0] = re.sub(r"^[“\"]\s*", "", bloque[0])
            bloque[-1] = re.sub(r"[”\"]\s*(\.?)\s*$", "", bloque[-1])
            if not bloque[-1].rstrip().endswith((".", ":", ";")):
                bloque[-1] = bloque[-1].rstrip() + "."
            return bloque
    raise ValueError(f"no cierra la cita de {inicio!r}")


# ---------------------------------------------------------------- cortes

def cortar(pars: list[str]) -> list[dict]:
    """[{articulo, epigrafe, parrafos}] de una norma ya limpia: sus artículos y, después, sus disposiciones."""
    unidades: list[dict] = []
    seccion = None                                   # (letra, nombre) de la sección de disposiciones en curso
    for p in pars:
        if RE_SECCION.search(p) and _mayus(p):          # también «TÍTULO X DISPOSICIONES COMPLEMENTARIAS FINALES»
            s = p.upper()
            seccion = ("F", "Final") if "FINAL" in s else ("T", "Transitoria") if "TRANSITORIA" in s else \
                ("M", "Modificatoria") if "MODIFICATORIA" in s else ("D", "Derogatoria") if "DEROGATORIA" in s else ("C", "")
            unidades.append({"articulo": None, "epigrafe": None, "parrafos": [], "_seccion": True})
            continue
        m = RE_ART.match(p) if seccion is None else None
        o = RE_ORD.match(p) if seccion is not None else None
        if m:
            resto = m.group(2).strip()
            unidades.append({"articulo": re.sub(r"\s", "", m.group(1)).upper(), "epigrafe": _epigrafe(resto), "parrafos": [p]})
        elif o:
            letra, nombre = seccion
            n = _ORD[o.group(1).upper()]
            titulo = _epigrafe(o.group(2).strip())
            rotulo = f"{o.group(1).capitalize()} Disposición Complementaria {nombre}".strip()
            unidades.append({"articulo": f"DC{letra}-{n or 'U'}", "epigrafe": rotulo + (f". {titulo}" if titulo else ""), "parrafos": [p],
                             "_titulo": bool(titulo)})
        elif RE_CLAVE.match(p) and _mayus(p) or (_mayus(p) and len(p) < 120 and not unidades):
            continue                                  # «TÍTULO II…», «CAPÍTULO I…»: no son texto del artículo
        elif unidades and unidades[-1].get("_seccion"):
            letra, nombre = seccion                   # una disposición sin ordinal («DISPOSICIÓN TRANSITORIA» y su texto)
            unidades[-1] = {"articulo": f"DC{letra}-U", "epigrafe": f"Disposición {nombre}".strip(), "parrafos": [p]}
        elif unidades:
            if _mayus(p) and len(p) < 120:
                continue                              # un título suelto entre artículos
            unidades[-1]["parrafos"].append(p)
    unidades = [u for u in unidades if u["parrafos"]]
    for u in unidades:
        # Un artículo o una disposición de un solo párrafo no tiene epígrafe aparte: ese párrafo es su texto.
        if len(u["parrafos"]) == 1 and u.pop("_titulo", True) and u["articulo"] and (u["epigrafe"] or "").endswith(tuple(".;:")) is False:
            cuerpo = RE_ART.match(u["parrafos"][0]) or RE_ORD.match(u["parrafos"][0])
            if cuerpo and len(cuerpo.group(2)) > 60:
                u["epigrafe"] = u["epigrafe"].split(". ")[0] if u["articulo"].startswith("DC") and ". " in (u["epigrafe"] or "") else \
                    (None if not u["articulo"].startswith("DC") else u["epigrafe"])
        u.pop("_titulo", None)
    return unidades


def _epigrafe(resto: str) -> str | None:
    r = resto.strip()
    # Hasta 200 caracteres: los epígrafes del D.S. 019-2002-PCM («Impedimentos aplicables a altos funcionarios, asesores…»).
    if not r or len(r) > 200 or r.endswith((":", ",", ";")) or re.search(r"[.;:]\s+\S", r.strip(" .")):
        return None
    return r.strip(" .") or None


def unidad(unidades: list[dict], articulo: str) -> dict:
    return next(u for u in unidades if u["articulo"] == articulo)


def poner(unidades: list[dict], articulo: str, bloque: list[str], nota: str, despues_de: str | None = None) -> None:
    """Cambia (o agrega después de otro) el artículo `articulo` por los párrafos de `bloque` (texto de la norma que lo
    modificó) y le pone la nota que dice de dónde sale."""
    m = RE_ART.match(bloque[0]) or RE_ORD.match(bloque[0])
    nueva = {"articulo": articulo, "epigrafe": _epigrafe(m.group(2)) if m else None, "parrafos": [*bloque, nota]}
    if despues_de:
        unidades.insert(unidades.index(unidad(unidades, despues_de)) + 1, nueva)
    else:
        vieja = unidad(unidades, articulo)
        if articulo.startswith("DC"):
            nueva["epigrafe"] = vieja["epigrafe"]
        unidades[unidades.index(vieja)] = nueva


def sin_firmas(pars: list[str]) -> list[str]:
    """Corta en la fórmula de promulgación: lo que sigue son fechas y firmas, no texto de la norma."""
    visto = False
    for i, p in enumerate(pars):
        visto = visto or bool(RE_ART.match(p))
        if visto and RE_FIRMA.match(p):
            return pars[:i]
    return pars


# ---------------------------------------------------------------- las normas

def ley_31227() -> dict:
    pars = sin_firmas(rango(parrafos_html(_archivo("l31227")), r"^Artículo 1\b"))
    u = cortar(pars)
    # Artículo 13: el texto de la Ley 32058. Su «[…]» mantiene un párrafo del texto original, que se pone en su lugar.
    nuevo = bloque_citado(parrafos_html(_archivo("l32058")), r"Artículo 13\. Declaración jurada de intereses de carácter preventivo")
    conservado = next(p for p in unidad(u, "13")["parrafos"] if p.startswith("En el caso de las autoridades que no postulan"))
    hueco = [i for i, p in enumerate(nuevo) if re.fullmatch(r"\[\s*(?:…|\.\.\.)\s*\]", p)]
    assert len(hueco) == 1, "la Ley 32058 debe traer un solo «[…]» en el artículo 13"
    nuevo[hueco[0]] = conservado
    poner(u, "13", nuevo, "(*) Artículo modificado por el artículo 8 de la Ley N° 32058, publicada el 14-06-2024 (antes, por el artículo único de "
          "la Ley N° 31506, publicada el 03-07-2022). El párrafo «En el caso de las autoridades que no postulan…» es del texto original de "
          "2021: la Ley N° 32058 lo mantiene con «[…]».")
    return {"id": "INT-LEY-31227", "identificador": "Ley N° 31227", "tipo_documento": "Ley", "emisor": "Congreso de la República",
            "titulo": "Ley que transfiere a la Contraloría General de la República la competencia para recibir y ejercer el control, fiscalización "
                      "y sanción respecto a la declaración jurada de intereses de autoridades, servidores y candidatos a cargos públicos",
            "fecha_publicacion": "2021-06-23", "vigente_desde": "2021-06-24", "estado_norma": "vigente, modificada", "url_pagina": _url("l31227"),
            "url_origen": _url("l31227"), "unidades": u, "fuentes": ["l31227", "l32058"],
            "observacion": "Texto de El Peruano (23-06-2021) con el artículo 13 según la Ley 32058 (El Peruano, 14-06-2024; antes lo cambió la "
                           "Ley 31506, 03-07-2022). Contrastado con el texto del SPIJ."}


def ley_28024() -> dict:
    pars = sin_concordancias(parrafos_pdf(lineas_pdf(_archivo("l28024"))))
    u = cortar(sin_firmas(rango([p["t"] for p in pars], r"^Artículo 1\.-")))
    dl1353 = [p["t"] for p in parrafos_pdf(lineas_pdf(_archivo("dl1353", ".pdf")))]
    dl1415 = parrafos_html(_archivo("dl1415"))
    n1353 = ("(*) Artículo modificado por la Sexta Disposición Complementaria Modificatoria del Decreto Legislativo N° 1353, publicado el "
             "07-01-2017, que rige desde el día siguiente de publicado su Reglamento.")
    n1415 = ("(*) Artículo {} por el artículo {} del Decreto Legislativo N° 1415, publicado el 13-09-2018, que rige a los treinta días naturales de "
             "emitido el Reglamento de la Ley (D.S. N° 120-2019-PCM, publicado el 01-07-2019).")
    poner(u, "1", bloque_citado(dl1353, r"Artículo 1\.- Objeto y fines"), n1353)
    poner(u, "7", bloque_citado(dl1353, r"Artículo 7\.- Del gestor de intereses"), n1353)
    poner(u, "5", bloque_citado(dl1415, r"Artículo 5\.- De los funcionarios"), n1415.format("modificado", 2))
    poner(u, "16", bloque_citado(dl1415, r"Artículo 16\.- Registro de Visitas"),
          n1415.format("modificado", 2) + " Antes lo había modificado el Decreto Legislativo N° 1353.")
    poner(u, "16-A", bloque_citado(dl1415, r"Artículo 16-A"), n1415.format("incorporado", 3), despues_de="16")
    # Derogados por el D. Leg. 1353: artículos 8, 11 a 15 y 19 a 21, y el literal e) del artículo 10.
    derogados = ["8", "11", "12", "13", "14", "15", "19", "20", "21"]
    faltan = [a for a in derogados if not any(x["articulo"] == a for x in u)]
    assert not faltan, f"el texto original no trae los artículos {faltan}"
    eran = "; ".join(f"{x['articulo']} ({x['epigrafe']})" for x in u if x["articulo"] in derogados)
    u[:] = [x for x in u if x["articulo"] not in derogados]
    diez = unidad(u, "10")
    literal_e = [p for p in diez["parrafos"] if re.match(r"^e\)\s", p)]
    assert len(literal_e) == 1, "el artículo 10 debe traer un literal e)"
    # El PDF junta «e) … período; y» con «f) Otras que se indiquen…» (la línea no cierra con punto): el f) sigue vigente.
    e_y_f = re.split(r"\s+(?=f\)\s)", literal_e[0], maxsplit=1)
    assert len(e_y_f) == 2 and e_y_f[1].startswith("f) Otras que se indiquen"), "el literal f) del artículo 10 no está donde se esperaba"
    diez["parrafos"][diez["parrafos"].index(literal_e[0])] = e_y_f[1]
    nota = ("Derogados por la Única Disposición Complementaria Derogatoria del Decreto Legislativo N° 1353 (publicado el 07-01-2017): los "
            "artículos 8, 11, 12, 13, 14, 15, 19, 20 y 21 y el literal e) del artículo 10 de la Ley N° 28024. Sus epígrafes eran: " + eran + ".")
    diez["parrafos"].append("(*) Literal e) derogado por la Única Disposición Complementaria Derogatoria del Decreto Legislativo N° 1353, "
                            "publicado el 07-01-2017.")
    u.append({"articulo": None, "epigrafe": "Artículos derogados", "parrafos": [nota]})
    return {"id": "INT-LEY-28024", "identificador": "Ley N° 28024", "tipo_documento": "Ley", "emisor": "Congreso de la República",
            "titulo": "Ley que regula la gestión de intereses en la administración pública", "fecha_emision": "2003-07-11",
            "estado_norma": "vigente, modificada", "url_pagina": _url("l28024"), "url_origen": _url("l28024"), "unidades": u,
            "fuentes": ["l28024", "dl1353", "dl1415"],
            "observacion": "Texto vigente armado: texto original (copia del SPIJ en gob.pe; promulgada el 11-07-2003), artículos 1 y 7 según el "
                           "D. Leg. 1353 (El Peruano, 07-01-2017), artículos 5, 16 y 16-A según el D. Leg. 1415 (El Peruano, 13-09-2018; rigen a "
                           "los 30 días de emitido el Reglamento, D.S. 120-2019-PCM del 01-07-2019). Sin los artículos que derogó el D. Leg. 1353. "
                           "Contrastado con el texto del SPIJ."}


def ds_120_2019() -> dict:
    pars = [p["t"] for p in parrafos_pdf(lineas_pdf(_archivo("ds120", ".pdf")))]
    u = cortar(rango(pars, r"^REGLAMENTO DE LA LEY Nº 28024", r"^Aceptan renuncia|^RESOLUCI[ÓO]N SUPREMA|^Art[íi]culo 1º"))
    return {"id": "INT-DS-120-2019-PCM", "identificador": "D.S. N° 120-2019-PCM", "tipo_documento": "Decreto Supremo", "emisor": "PCM",
            "titulo": "Reglamento de la Ley N° 28024, Ley que regula la gestión de intereses en la administración pública",
            "fecha_publicacion": "2019-07-01", "vigente_desde": "2019-07-02", "estado_norma": "vigente", "url_pagina": _url("ds120"),
            "url_origen": _url("ds120"), "unidades": u, "fuentes": ["ds120"],
            "observacion": "Texto de El Peruano (01-07-2019). Derogó el reglamento anterior (D.S. 099-2003-PCM). No se halló norma que lo modifique."}


def ley_27815() -> dict:
    pars = sin_concordancias(parrafos_pdf(lineas_pdf(_archivo("l27815"))))
    textos = [p["t"] for p in pars]
    u = cortar(sin_firmas(rango(textos, r"^Artículo 1\.-")))
    # La copia del SPIJ trae el texto original y, en una nota «(*)», el que puso la Ley 28496: queda el vigente.
    cuatro = unidad(u, "4")
    i = next(k for k, p in enumerate(cuatro["parrafos"]) if p.startswith("4.1 A los efectos"))
    j = next(k for k, p in enumerate(cuatro["parrafos"]) if p.startswith("(*) Numeral modificado"))
    nuevo = next(p for p in cuatro["parrafos"][j:] if re.match(r"^[“\"]4\.1 Para los efectos", p))
    assert j == i + 1 and cuatro["parrafos"].index(nuevo) == j + 1, "la nota del numeral 4.1 no está donde se esperaba"
    cuatro["parrafos"][i:j + 2] = [re.sub(r"[”\"]\s*$", "", re.sub(r"^[“\"]", "", nuevo)),
                                   "(*) Numeral 4.1 modificado por el artículo único de la Ley N° 28496, publicada el 16-04-2005."]
    onces = [x for x in u if x["articulo"] == "11"]          # el texto original (con la nota) y, entre comillas, el nuevo
    assert len(onces) == 2 and onces[0]["parrafos"][-1].startswith("(*) Artículo modificado") and onces[1]["parrafos"][0].startswith(("\"", "“"))
    bloque = [re.sub(r"[”\"]\s*$", "", re.sub(r"^[“\"]", "", p)) for p in onces[1]["parrafos"]]
    assert RE_ART.match(bloque[0]) and len(bloque) == 2, "la nota del artículo 11 no trae el artículo nuevo completo"
    u.remove(onces[0])
    poner(u, "11", bloque, "(*) Artículo modificado por el artículo único de la Ley N° 28496, publicada el 16-04-2005.")
    assert unidad(u, "13")["epigrafe"] == "Registro de Sanciones"
    u[:] = [x for x in u if x["articulo"] != "13"]
    u.append({"articulo": None, "epigrafe": "Modificaciones y artículo derogado", "parrafos": [
        "El artículo 13 (Registro de Sanciones) fue derogado por el literal a) de la Única Disposición Complementaria Derogatoria de la Ley "
        "N° 30057, Ley del Servicio Civil, publicada el 04-07-2013. Según la Décima Disposición Complementaria Final de esa ley, el Código de "
        "Ética de la Función Pública se aplica en los supuestos no previstos en ella y no puede aplicarse a la vez que su régimen disciplinario "
        "por una misma conducta.",
        "De conformidad con la Única Disposición Complementaria de la Ley N° 28496, publicada el 16-04-2005, toda referencia al «servidor "
        "público» en la Ley del Código de Ética de la Función Pública se entiende hecha al «empleado público»."]})
    return {"id": "INT-LEY-27815", "identificador": "Ley N° 27815", "tipo_documento": "Ley", "emisor": "Congreso de la República",
            "titulo": "Ley del Código de Ética de la Función Pública", "fecha_publicacion": "2002-08-13", "vigente_desde": "2002-08-14",
            "estado_norma": "vigente, modificada", "url_pagina": _url("l27815"), "url_origen": _url("l27815"), "unidades": u, "fuentes": ["l27815"],
            "observacion": "Texto vigente armado desde la copia del SPIJ en gob.pe: numeral 4.1 y artículo 11 según la Ley 28496 (16-04-2005); sin el "
                           "artículo 13, que derogó la Ley 30057 (El Peruano, 04-07-2013). Contrastado con el texto integrado de 2012 en gob.pe."}


def ds_033_2005() -> list[dict]:
    pars = [p["t"] for p in parrafos_pdf(lineas_pdf(_archivo("ds033")))]
    u = cortar(rango(pars, r"^TÍTULO I\b", None, 1))
    assert [x["articulo"] for x in u[:23]] == [str(n) for n in range(1, 24)], "el Reglamento debe traer sus 23 artículos"
    comun = {"tipo_documento": "Decreto Supremo", "emisor": "PCM", "url_pagina": "https://www.gob.pe/institucion/pcm/normas-legales/268595-033-2005-pcm",
             "url_origen": _url("ds033"), "fecha_emision": "2005-04-18", "fuentes": ["ds033", "ds040"]}
    derogado = [x for x in u if x["articulo"].isdigit() and int(x["articulo"]) <= 18]
    vigente = [x for x in u if x not in derogado]
    vigente.append({"articulo": None, "epigrafe": "Títulos derogados", "parrafos": [
        "Los títulos I, II, III y IV de este Reglamento (artículos 1 al 18: disposiciones generales y definiciones, principios y deberes, "
        "infracciones, sanciones y procedimiento) fueron derogados por el literal g) de la Única Disposición Complementaria Derogatoria del "
        "Reglamento General de la Ley del Servicio Civil (D.S. N° 040-2014-PCM, publicado el 13-06-2014). Siguen vigentes los títulos V "
        "(incentivos y estímulos) y VI (difusión del Código y campañas educativas). Las faltas al Código de Ética se tramitan con el régimen "
        "disciplinario de la Ley N° 30057."]})
    return [
        {**comun, "id": "INT-DS-033-2005-PCM", "identificador": "D.S. N° 033-2005-PCM", "estado_norma": "vigente, modificada", "unidades": vigente,
         "titulo": "Reglamento de la Ley del Código de Ética de la Función Pública",
         "observacion": "Texto de la PCM en gob.pe. Sólo lo vigente (títulos V y VI): los títulos I a IV los derogó el D.S. 040-2014-PCM "
                        "(dado el 11-06-2014 y publicado el 13-06-2014) y están aparte, como texto que rigió hasta esa fecha. La fecha es la "
                        "de la firma (18-04-2005), que muestra gob.pe; la de publicación no se comprobó en una fuente oficial."},
        {**comun, "id": "INT-DS-033-2005-PCM-DEROGADO", "identificador": "D.S. N° 033-2005-PCM (títulos I a IV, derogados)",
         "estado_norma": "derogada", "vigente_hasta": "2014-06-13", "unidades": derogado,
         "titulo": "Reglamento de la Ley del Código de Ética de la Función Pública: títulos I a IV, que rigieron hasta el 13-06-2014",
         "observacion": "Artículos 1 al 18 (definiciones de intereses en conflicto, ventaja indebida e información privilegiada; infracciones, "
                        "sanciones y procedimiento), derogados por el literal g) de la Única Disposición Complementaria Derogatoria del D.S. "
                        "040-2014-PCM, publicado el 13-06-2014."},
    ]


def _regl_31227_base() -> list[str]:
    # En la página 2 de la separata los bloques vienen en desorden (la columna derecha antes que la izquierda): sin
    # ordenarlos, los considerandos de la R.C. 162-2021-CG caían dentro del artículo 2 del Reglamento.
    pars = [p["t"] for p in parrafos_pdf(lineas_pdf(_archivo("regl31227", ".pdf"), columnas={2}))]
    return rango(pars, r"^Artículo 1\.- Finalidad", r"^ANEXOS$", 1)


def regl_31227() -> dict:
    u = cortar(_regl_31227_base())
    rc265, rc291, rc295 = (parrafos_html(_archivo(k)) for k in ("rc265", "rc291", "rc295"))
    n295 = "(*) {} por la Resolución de Contraloría N° 295-2025-CG, publicada el 15-07-2025."
    # Artículo 7: la R.C. 295-2025-CG cambia su último párrafo.
    siete, nuevo7 = unidad(u, "7"), bloque_citado(rc295, r"Artículo 7\.- Obligatoriedad")
    assert siete["parrafos"][-1].startswith("Asimismo, la presentación de la DJI de carácter preventivo") and re.fullmatch(r"\(\s*(?:…|\.\.\.)\s*\)", nuevo7[1])
    siete["parrafos"][-1:] = [nuevo7[2], n295.format("Último párrafo modificado")]
    # Artículo 8: la R.C. 291-2023-CG cambia los literales m) y q).
    ocho, nuevo8 = unidad(u, "8"), bloque_citado(rc291, r"Artículo 8\.- Sujetos obligados")
    m_nuevo = next(p for p in nuevo8 if p.startswith("m) "))
    q_nuevo = nuevo8[next(k for k, p in enumerate(nuevo8) if p.startswith("q) ")):]
    q_nuevo = [p for p in q_nuevo if not re.fullmatch(r"\(\s*(?:…|\.\.\.)\s*\)\.?", p)]
    assert len(q_nuevo) == 2 and q_nuevo[1].startswith("Cuando se menciona “consultores de la alta dirección”")
    im = next(k for k, p in enumerate(ocho["parrafos"]) if p.startswith("m) "))
    ocho["parrafos"][im] = m_nuevo
    iq = next(k for k, p in enumerate(ocho["parrafos"]) if p.startswith("q) "))
    assert ocho["parrafos"][iq + 1].startswith("Cuando se menciona “consultores de la alta dirección”") and ocho["parrafos"][iq + 2].startswith("r) ")
    ocho["parrafos"][iq:iq + 2] = q_nuevo
    ocho["parrafos"].append("(*) Literales m) y q) modificados por la Resolución de Contraloría N° 291-2023-CG, publicada el 08-08-2023, que rige a "
                            "los treinta días hábiles de su publicación.")
    # Artículos 23 y 24: texto completo de la R.C. 295-2025-CG (antes los cambiaron las R.C. 265-2022-CG y 291-2023-CG).
    poner(u, "23", bloque_citado(rc295, r"Artículo 23\.- Sujetos obligados"),
          n295.format("Artículo modificado") + " Antes lo modificaron las Resoluciones de Contraloría N° 265-2022-CG (05-08-2022) y N° 291-2023-CG (08-08-2023).")
    poner(u, "24", bloque_citado(rc295, r"Artículo 24\.- Registro de sujetos obligados"),
          n295.format("Artículo modificado") + " Antes lo modificó la Resolución de Contraloría N° 265-2022-CG (05-08-2022).")
    # Sexta Disposición Complementaria Transitoria: la incorporó la R.C. 265-2022-CG (elecciones de 2022).
    sexta = bloque_citado(rc265, r"Sexta\.- Aspectos complementarios")
    quinta = next(x for x in u if x["articulo"] == "DCT-5")
    u.insert(u.index(quinta) + 1, {"articulo": "DCT-6", "epigrafe": "Sexta Disposición Complementaria Transitoria", "parrafos": [
        *sexta, "(*) Disposición incorporada por el artículo 2 de la Resolución de Contraloría N° 265-2022-CG, publicada el 05-08-2022."]})
    return {"id": "INT-RC-158-2021-CG", "identificador": "R.C. N° 158-2021-CG", "tipo_documento": "Resolución de Contraloría",
            "emisor": "Contraloría General de la República",
            "titulo": "Reglamento para implementar la Ley N° 31227, respecto a la recepción, el ejercicio del control, fiscalización y sanción de la "
                      "declaración jurada de intereses",
            "fecha_publicacion": "2021-08-13", "vigente_desde": "2021-08-14", "estado_norma": "vigente, modificada",
            "url_pagina": "https://www.gob.pe/institucion/contraloria/normas-legales/2062779-158-2021-cg", "url_origen": _url("regl31227"),
            "unidades": u, "fuentes": ["regl31227", "rc265", "rc291", "rc295"],
            "observacion": "Texto vigente armado: Reglamento publicado en la separata especial de El Peruano del 13-08-2021 (R.C. 162-2021-CG), con "
                           "el artículo 7 (último párrafo) y los artículos 23 y 24 según la R.C. 295-2025-CG (15-07-2025), los literales m) y q) "
                           "del artículo 8 según la R.C. 291-2023-CG (08-08-2023) y la Sexta Disposición Complementaria Transitoria de la R.C. "
                           "265-2022-CG (05-08-2022). Sin los anexos (formatos). Contrastado con el texto del SPIJ."}


def ley_27588() -> dict:
    pars = [p["t"] for p in parrafos_pdf(lineas_pdf(_archivo("compendio"), {115, 116}))]
    u = cortar(rango(pars, r"^Artículo 1\.- Objeto de la ley"))
    return {"id": "INT-LEY-27588", "identificador": "Ley N° 27588", "tipo_documento": "Ley", "emisor": "Congreso de la República",
            "titulo": "Ley que establece prohibiciones e incompatibilidades de funcionarios y servidores públicos, así como de las personas que "
                      "presten servicios al Estado bajo cualquier modalidad contractual",
            "fecha_publicacion": "2001-12-13", "vigente_desde": "2001-12-14", "vigente_hasta": "2023-07-19", "estado_norma": "derogada",
            "url_pagina": "https://www.gob.pe/institucion/mindef/normas-legales/182272-27588", "url_origen": _url("compendio"), "unidades": u,
            "fuentes": ["compendio", "l27588_escaneo"],
            "observacion": "DEROGADA por la Única Disposición Complementaria Derogatoria de la Ley 31564 (El Peruano, 17-08-2022), que rige desde el "
                           "20-07-2023, día siguiente de publicado su Reglamento. Rigió del 14-12-2001 al 19-07-2023. El PDF oficial de gob.pe es "
                           "una imagen sin texto; el texto sale del compendio normativo sobre impedimentos publicado en gob.pe (11-05-2022, páginas "
                           "115 y 116) y se contrastó con la copia de la SMV."}


def ds_019_2002() -> dict:
    pars = [p["t"] for p in parrafos_pdf(lineas_pdf(_archivo("ds019")), guiones=True)]
    cuerpo = rango(pars, r"^Artículo 1º\.- Objeto del Reglamento", r"^Dado en la Casa de Gobierno")
    u = cortar(cuerpo)
    return {"id": "INT-DS-019-2002-PCM", "identificador": "D.S. N° 019-2002-PCM", "tipo_documento": "Decreto Supremo", "emisor": "PCM",
            "titulo": "Reglamento de la Ley N° 27588, que establece prohibiciones e incompatibilidades de funcionarios y servidores públicos",
            "fecha_publicacion": "2002-03-08", "vigente_desde": "2002-03-09", "vigente_hasta": "2023-07-19", "estado_norma": "derogada",
            "url_pagina": "https://www.gob.pe/institucion/mindef/normas-legales/182273-019-2002-pcm", "url_origen": _url("ds019"), "unidades": u,
            "fuentes": ["ds019", "ds019_escaneo", "compendio"],
            "observacion": "SIN EFECTO desde el 20-07-2023 por la Única Disposición Complementaria Derogatoria de la Ley 31564. Rigió del 09-03-2002 "
                           "al 19-07-2023. El PDF oficial de gob.pe es una imagen sin texto; el texto sale de la página de El Peruano del "
                           "08-03-2002 (copia con texto que aloja la SUTRAN) y se contrastó con el compendio normativo publicado en gob.pe."}


def ley_31564() -> dict:
    u = cortar(sin_firmas(rango(parrafos_html(_archivo("l31564")), r"^Artículo 1\b")))
    return {"id": "INT-LEY-31564", "identificador": "Ley N° 31564", "tipo_documento": "Ley", "emisor": "Congreso de la República",
            "titulo": "Ley de prevención y mitigación del conflicto de intereses en el acceso y salida de personal del servicio público",
            "fecha_publicacion": "2022-08-17", "vigente_desde": "2023-07-20", "estado_norma": "vigente", "url_pagina": _url("l31564"),
            "url_origen": _url("l31564"), "unidades": u, "fuentes": ["l31564"],
            "observacion": "Texto de El Peruano (17-08-2022). Rige desde el 20-07-2023, día siguiente de publicado su Reglamento (Primera Disposición "
                           "Complementaria Final). Deroga la Ley 27588 y deja sin efecto el D.S. 019-2002-PCM."}


def ds_082_2023() -> dict:
    pars = parrafos_html(_archivo("ds082"))
    u = cortar(rango(pars, r"^REGLAMENTO DE LA LEY N° 31564", r"^ANEXO\b"))
    return {"id": "INT-DS-082-2023-PCM", "identificador": "D.S. N° 082-2023-PCM", "tipo_documento": "Decreto Supremo", "emisor": "PCM",
            "titulo": "Reglamento de la Ley N° 31564, Ley de prevención y mitigación del conflicto de intereses en el acceso y salida de personal "
                      "del servicio público",
            "fecha_publicacion": "2023-07-19", "vigente_desde": "2023-07-20", "estado_norma": "vigente", "url_pagina": _url("ds082"),
            "url_origen": _url("ds082"), "unidades": u, "fuentes": ["ds082"],
            "observacion": "Texto de El Peruano (19-07-2023), sin el anexo (formato de declaración jurada). No se halló norma que lo modifique."}


# Los delitos de funcionarios que sirven a los indicadores de Vigía (visitas, conflicto de intereses, contratación): del
# Título XVIII (Delitos contra la administración pública), su Capítulo II (cometidos por funcionarios públicos, artículos
# 376 al 401) y, del Capítulo IV (disposiciones comunes), el artículo 425 (quién es funcionario o servidor público).
CP_ARTICULOS = ["376", "381", "384", "385", "387", "388", "389", "393", "393-A", "394", "395", "395-A", "395-B", "396", "397", "397-A", "398",
                "398-A", "398-B", "399", "400", "401", "425"]
# El epígrafe que cada artículo debe traer en el texto de Editora Perú (comprobado a mano contra el PDF el 17-11-2026).
CP_EPIGRAFES = {"376": "Abuso de autoridad", "381": "Nombramiento, designación, contratación, encargatura o aceptación ilegal de cargo",
                "384": "Colusión simple y agravada", "385": "Patrocinio ilegal", "387": "Peculado doloso y culposo", "388": "Peculado de uso",
                "389": "Malversación", "393": "Cohecho pasivo propio", "393-A": "Soborno internacional pasivo", "394": "Cohecho pasivo impropio",
                "395": "Cohecho pasivo específico", "396": "Corrupción pasiva de auxiliares jurisdiccionales", "397": "Cohecho activo genérico",
                "397-A": "Cohecho activo transnacional", "398": "Cohecho activo específico", "399": "Negociación incompatible o aprovechamiento indebido de cargo",
                "400": "Tráfico de influencias", "401": "Enriquecimiento ilícito", "425": "Funcionario o servidor público"}
RE_CAB_CP = re.compile(r"^[“\"]?\s*Art[íi]culo\s+(\d{1,3}(?:[\s-]?[A-Z])?)\s*\.?\s*-\s*")


def lineas_cp(archivo: Path) -> list[dict]:
    """Las líneas del Código Penal de Editora Perú, con sus tramos clasificados por la letra: «nota» (negrita cursiva de
    8 pt: las notas «(*)»), «neg» (negrita: epígrafes, títulos y la cabecera «Artículo N.-») y «txt» (el texto). La nota
    empieza en la misma línea en que termina el artículo y sigue en las siguientes: por eso se separa por la letra."""
    import fitz
    salida = []
    with fitz.open(archivo) as pdf:
        for n, pagina in enumerate(pdf, 1):
            for b in pagina.get_text("dict")["blocks"]:
                for l in b.get("lines", []):
                    tramos: list[list[str]] = []
                    for s in l["spans"]:
                        if not s["font"].startswith("Arial") or s["size"] < 7.5:
                            continue                     # cabecera, pie de página y el enlace «Inicio»
                        clase = "nota" if "Italic" in s["font"] else "neg" if ("Bold" in s["font"] or s["flags"] & 16) else "txt"
                        if tramos and tramos[-1][0] == clase:
                            tramos[-1][1] += s["text"]
                        else:
                            tramos.append([clase, s["text"]])
                    tramos = [[c, _limpio(t)] for c, t in tramos if t.strip()]
                    if tramos:
                        salida.append({"tramos": tramos, "x": l["bbox"][0], "pag": n})
    for l in salida:
        c0, t0 = l["tramos"][0]
        texto = " ".join(t for _, t in l["tramos"]).strip()
        if c0 == "neg" and RE_CAB_CP.match(t0.strip()):
            l["tipo"] = "cabecera"
        elif all(c == "neg" for c, _ in l["tramos"]) and texto.strip(" ”“\""):
            l["tipo"] = "titulo" if _mayus(texto) else "negrita"
        else:
            l["tipo"] = "texto"
    return salida


def codigo_penal() -> dict:
    lineas = lineas_cp(_archivo("cp"))
    cabeceras = [i for i, l in enumerate(lineas) if l["tipo"] == "cabecera"]

    def inicio_epigrafe(i: int) -> int:
        """El epígrafe del artículo que empieza en la línea i: las líneas enteras en negrita JUSTO antes de la cabecera. Una
        línea en negrita en medio del texto (las hay) no cuenta: entre ella y el epígrafe siempre hay texto o una nota."""
        k = i
        while k > 0 and lineas[k - 1]["tipo"] == "negrita":
            k -= 1
        return k

    u = []
    for n, i in enumerate(cabeceras):
        cab = lineas[i]["tramos"][0][1].strip()
        art = re.sub(r"\s+", "-", RE_CAB_CP.match(cab).group(1).strip())
        if art not in CP_ARTICULOS:
            continue
        if any(x["articulo"] == art for x in u):
            raise ValueError(f"el artículo {art} aparece dos veces")
        fin = inicio_epigrafe(cabeceras[n + 1]) if n + 1 < len(cabeceras) else len(lineas)
        cuerpo, notas = [], []
        for k in range(i, fin):
            l = lineas[k]
            if l["tipo"] == "titulo":
                break                                   # SECCIÓN, CAPÍTULO o TÍTULO que sigue
            tramos = l["tramos"]
            if k == i:                                  # la cabecera «Artículo N.-»: el texto empieza después
                resto = RE_CAB_CP.sub("", tramos[0][1].strip(), count=1)
                tramos = ([["txt", resto]] if resto.strip() else []) + tramos[1:]
            texto = "".join(t for c, t in tramos if c != "nota")
            notas += [t for c, t in tramos if c == "nota"]
            if texto.strip():
                cuerpo.append({"t": texto.rstrip(), "neg": False, "x": l["x"], "blanco": False, "pag": l["pag"]})
        epigrafe = re.sub(r"\s+", " ", " ".join(" ".join(t for _, t in lineas[k]["tramos"]) for k in range(inicio_epigrafe(i), i))).strip(" “\"")
        if CP_EPIGRAFES.get(art, epigrafe) != epigrafe:
            raise ValueError(f"artículo {art}: el epígrafe leído ({epigrafe!r}) no es el esperado ({CP_EPIGRAFES[art]!r})")
        if not epigrafe or not epigrafe[0].isupper():
            raise ValueError(f"artículo {art}: epígrafe dudoso {epigrafe!r}")
        pars = [p["t"] for p in parrafos_pdf(cuerpo)]
        pars[0] = f"Artículo {art}.- " + pars[0]
        pars = [re.sub(r"\s*[”\"]\s*$", "", re.sub(r"^[“\"]\s*", "", p)).strip() for p in pars]
        nota = re.sub(r"\s+", " ", " ".join(notas)).strip()
        notas_sep = [("(*)" + x).strip() for x in nota.split("(*)") if x.strip()] if nota else []
        u.append({"articulo": art, "epigrafe": epigrafe, "parrafos": [epigrafe, *pars, *notas_sep]})
    faltan = [a for a in CP_ARTICULOS if not any(x["articulo"] == a for x in u)]
    assert not faltan, f"no se hallaron los artículos {faltan}"
    return {"id": "INT-DL-635-CODIGO-PENAL", "identificador": "Código Penal (D. Leg. N° 635)", "tipo_documento": "Decreto Legislativo",
            "emisor": "Poder Ejecutivo",
            "titulo": "delitos contra la administración pública cometidos por funcionarios (artículos escogidos del Título XVIII)",
            "fecha_publicacion": "1991-04-08", "estado_norma": "vigente, modificada",
            "url_pagina": _url("cp"), "url_origen": _url("cp"), "unidades": u, "fuentes": ["cp"],
            "observacion": "Sólo los artículos " + ", ".join(CP_ARTICULOS) + " del texto actualizado al 08-11-2026 que publica Editora Perú (Normas "
                           "Legales Actualizadas de El Peruano; el Código se publicó el 08-04-1991). Es el texto VIGENTE: cada artículo modificado "
                           "termina con la nota «(*)» de Editora Perú, que dice qué norma lo cambió y cuándo se publicó; a un hecho anterior a esa "
                           "fecha se le aplica el texto que regía entonces, que no está en este corpus."}


NORMAS = [ley_28024, ds_120_2019, ley_27815, ds_033_2005, ley_31227, regl_31227, ley_27588, ds_019_2002, ley_31564, ds_082_2023, codigo_penal]


# ---------------------------------------------------------------- salida

def _sha(f: Path) -> str:
    return hashlib.sha256(f.read_bytes()).hexdigest()


def armar() -> list[dict]:
    DEST.mkdir(parents=True, exist_ok=True)
    filas = []
    for f in NORMAS:
        r = f()
        for d in (r if isinstance(r, list) else [r]):
            unidades = [{"articulo": x["articulo"], "epigrafe": x["epigrafe"], "texto": "\n".join(x["parrafos"])} for x in d.pop("unidades")]
            fuentes = [{"clave": k, "que": FUENTES[k][2], "url": FUENTES[k][0], "archivo": f"fuentes/{FUENTES[k][1]}",
                        "sha256": _sha(_archivo(k)) if _archivo(k).exists() else None} for k in d.pop("fuentes")]
            salida = DEST / f"{d['id']}.json"
            salida.write_text(json.dumps({"id": d["id"], "identificador": d["identificador"], "consultado": CONSULTA, "fuentes": fuentes,
                                          "unidades": unidades}, ensure_ascii=False, indent=1), encoding="utf-8")
            (DEST / f"{d['id']}.txt").write_text("\n\n".join(
                f"[{x['articulo'] or '-'}] {x['epigrafe'] or ''}\n{x['texto']}" for x in unidades), encoding="utf-8")
            filas.append({**d, "tipo": "norma", "estado": "descargado", "tiene_texto": True, "coincide_identificador": True, "fuente_tipo": "oficial",
                          "archivo_local": f"16_lote8_integridad/{d['id']}.json", "sha256": _sha(salida), "consultado": CONSULTA})
            print(f"{d['id']}: {len(unidades)} unidades, {sum(len(x['texto']) for x in unidades)} caracteres", flush=True)
    MANIFIESTO.write_text(json.dumps(filas, ensure_ascii=False, indent=1), encoding="utf-8")
    print("manifiesto:", MANIFIESTO, len(filas), "normas", flush=True)
    return filas


def _plano(t: str) -> str:
    return re.sub(r"[^a-z0-9áéíóúñü]", "", _limpio(t).lower())


def _texto_pdf(f: Path) -> str:
    import fitz
    with fitz.open(f) as pdf:
        return "\n".join(p.get_text("text") for p in pdf)


def revisar() -> None:
    """Cada párrafo armado debe estar, letra por letra (sin contar espacios ni signos), en otra copia oficial de la norma."""
    pares = [("INT-LEY-28024", "x_l28024"), ("INT-LEY-31227", "x_l31227"), ("INT-RC-158-2021-CG", "x_regl31227"), ("INT-LEY-27588", "x_l27588"),
             ("INT-LEY-27815", "x_l27815"), ("INT-DS-033-2005-PCM", "x_l27815"), ("INT-DS-033-2005-PCM-DEROGADO", "x_l27815"),
             ("INT-DS-019-2002-PCM", "compendio")]
    for ident, clave in pares:
        otra = _plano(_texto_pdf(_archivo(clave)))
        dato = json.loads((DEST / f"{ident}.json").read_text(encoding="utf-8"))
        total = fuera = 0
        for x in dato["unidades"]:
            for p in x["texto"].split("\n"):
                if p.startswith("(*)") or x["articulo"] is None or len(_plano(p)) < 25:
                    continue                          # las notas son de este guion, no de la norma
                total += 1
                if _plano(p) not in otra:
                    fuera += 1
                    print(f"   {ident} art. {x['articulo']}: no está en la otra copia: {p[:150]}")
        print(f"{ident} contra {FUENTES[clave][1]}: {total - fuera} de {total} párrafos coinciden", flush=True)


if __name__ == "__main__":
    orden = sys.argv[1] if len(sys.argv) > 1 else ""
    if orden == "bajar":
        bajar()
    elif orden == "armar":
        armar()
    elif orden == "revisar":
        revisar()
    else:
        raise SystemExit(__doc__)
