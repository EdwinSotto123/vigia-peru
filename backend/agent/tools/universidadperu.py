"""Ficha pública de una empresa en universidadperu.com: respaldo de la fecha de inicio de
actividades y el CIIU cuando SUNAT (decolecta) no responde.

La ficha es una lista de definiciones (`<dt>RUC</dt><dd>20605100016</dd>`, `<dt>Fecha Inicio
Actividades</dt><dd>08 / Agosto / 2019</dd>`…). Se lee con el parser HTML de la biblioteca
estándar, campo por campo, y la empresa se acepta solo si el campo RUC de la ficha es el pedido
(antes bastaba con que el número apareciera en cualquier parte de la página, y la búsqueda sin
resultados también lo repite en sus enlaces).

Cómo se llega a la ficha: la búsqueda por RUC del sitio redirige a ella; si no, el slug que el
sitio arma con la razón social sin forma societaria ni artículos ("Banco de Crédito del Perú
S.A.A." → banco-credito-peru). Las personas naturales (RUC 10…) casi nunca tienen ficha.
"""
from __future__ import annotations

import unicodedata
from datetime import date
from html.parser import HTMLParser
from typing import Callable

BASE = "https://www.universidadperu.com/empresas"

_MESES = {"enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7,
          "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12}
# Palabras que el sitio no pone en el slug.
_VACIAS = {"de", "del", "la", "las", "los", "el", "y", "e", "en"}
# Formas societarias, ya juntas las siglas deletreadas ("S. A. C." → "sac").
_FORMAS = {"sac", "saa", "sa", "srl", "srltda", "eirl", "eirltda", "ltda", "scrl", "sacs"}


def clave(texto: str) -> str:
    """Rótulo comparable: sin tildes, en minúsculas y con un solo espacio. El relay decodificaba
    la página (Latin-1) como UTF-8 y dejaba "Condici�n": el carácter de reemplazo se quita."""
    s = unicodedata.normalize("NFD", texto or "").replace("�", "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.casefold().split())


class _Ficha(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.campos: dict[str, str] = {}
        self._en: str | None = None
        self._buf: list[str] = []
        self._rotulo: str | None = None

    def handle_starttag(self, tag, attrs):
        if tag in ("dt", "dd"):
            self._en, self._buf = tag, []

    def handle_endtag(self, tag):
        if tag != self._en:
            return
        texto = " ".join("".join(self._buf).split())
        if tag == "dt":
            self._rotulo = clave(texto)
        elif self._rotulo and self._rotulo not in self.campos:
            self.campos[self._rotulo] = texto
            self._rotulo = None
        self._en = None

    def handle_data(self, data):
        if self._en:
            self._buf.append(data)


def leer_ficha(html: str) -> dict[str, str]:
    """{rótulo normalizado: valor} de la ficha; vacío si la página no tiene ficha."""
    p = _Ficha()
    try:
        p.feed(html or "")
        p.close()
    except Exception:
        return {}
    return p.campos


def fecha_inicio(texto: str | None) -> date | None:
    """"08 / Agosto / 2019" → date(2019, 8, 8)."""
    partes = [p.strip() for p in (texto or "").split("/")]
    if len(partes) != 3:
        return None
    dia, mes, anio = partes
    mm = _MESES.get(clave(mes))
    if not (mm and dia.isdigit() and anio.isdigit()):
        return None
    try:
        return date(int(anio), mm, int(dia))
    except ValueError:
        return None


def slug(razon_social: str) -> str:
    """Slug del sitio desde la razón social, palabra por palabra."""
    s = clave(razon_social)
    palabras = "".join(c if c.isalnum() else " " for c in s).split()
    juntas: list[str] = []
    sigla = ""
    for w in palabras:          # "s a c" → "sac" para reconocer la forma societaria
        if len(w) == 1:
            sigla += w
            continue
        if sigla and w == "ltda":   # "E.I.R.LTDA." → "eirltda"
            juntas.append(sigla + w)
            sigla = ""
            continue
        if sigla:
            juntas.append(sigla)
            sigla = ""
        juntas.append(w)
    if sigla:
        juntas.append(sigla)
    return "-".join(w for w in juntas if w not in _VACIAS and w not in _FORMAS)


def ficha_por_ruc(ruc: str, razon_social: str, traer: Callable[[str], str | None]) -> tuple[dict | None, str | None, str]:
    """(ficha, url, motivo): la ficha cuyo campo RUC es `ruc`, o None con el motivo."""
    urls = [f"{BASE}/busqueda/?buscaempresa={ruc}"]
    s = slug(razon_social)
    if s:
        urls.append(f"{BASE}/{s}.php")
    motivo = "página no encontrada o fetch falló."
    for url in urls:
        html = traer(url)
        if not html:
            continue
        ficha = leer_ficha(html)
        if ficha.get("ruc") == ruc:
            return ficha, url, ""
        motivo = (f"sin ficha con el RUC {ruc}" if not ficha.get("ruc")
                  else f"la ficha encontrada es de otro RUC ({ficha.get('ruc')}): descartada")
    if ruc.startswith("10"):
        motivo = "persona natural (RUC 10…): universidadperu no publica su ficha."
    return None, None, motivo
