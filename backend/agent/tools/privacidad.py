"""Privacidad de las personas naturales en lo que el agente escribe: un apellido tapado, como la web.

Port de `taparNombrePropio` (backend/api/src/routes/personas.ts) y de la marca `TAPA_NOMBRE` (lib/privacidad.ts). La API
vuelve a tapar al publicar (`publicar()`); esto evita que el nombre completo llegue al modelo y a `alertas`.

Nombres en orden SUNAT/RNP («APELLIDO1 APELLIDO2 NOMBRES»): se tapa el segundo apellido, y también en el orden hablado
(«NOMBRES APELLIDO1 APELLIDO2»). Con menos de 3 palabras no se tapa nada (no se sabe cuál es el apellido).
"""
from __future__ import annotations

import re
import unicodedata

TAPA_NOMBRE = "•••"
_LETRA = r"[^\W\d_]"


_PARENTESIS = re.compile(r"\(([^()]*)\)")
_PREFIJO_SUCESION = re.compile(r"^\s*(SUCESI[OÓ]N|SUC\.?|SUCESION\s+INDIVISA)\s+", re.IGNORECASE)


# Partículas que forman un solo apellido con la palabra que sigue: «DE LA CRUZ», «DEL CASTILLO», «SAN MARTIN», «VDA. DE».
_PARTICULAS = {"DE", "DEL", "LA", "LAS", "LOS", "SAN", "SANTA", "VDA", "VDA.", "VIUDA", "Y"}


def _grupos(nombre: str) -> list[str]:
    """Las palabras de un nombre, con cada partícula pegada a la que sigue: «DE LA CRUZ UNSIHUAY HECTOR» →
    ["DE LA CRUZ", "UNSIHUAY", "HECTOR"]."""
    out: list[str] = []
    pend: list[str] = []
    for w in nombre.split():
        pend.append(w)
        if _sin_tildes(w) not in _PARTICULAS:
            out.append(" ".join(pend))
            pend = []
    if pend:
        out.append(" ".join(pend))
    return out


def _tapar_simple(nombre: str) -> str:
    g = _grupos(nombre)
    if len(g) < 3:
        return nombre
    return " ".join([g[0], TAPA_NOMBRE, *g[2:]])


def tapar_nombre(nombre: str | None) -> str | None:
    """«ROJAS QUISPE ELENA» → «ROJAS ••• ELENA». Un nombre entre paréntesis («(SUCESION LUISA MORENO CASTILLO)») también."""
    if not nombre:
        return nombre

    def _dentro(m: re.Match) -> str:
        interior = m.group(1)
        pre = _PREFIJO_SUCESION.match(interior)
        cabeza = pre.group(0) if pre else ""
        return f"({cabeza}{_tapar_simple(interior[len(cabeza):])})"

    fuera = _PARENTESIS.sub("", nombre).strip()
    tapado = _tapar_simple(fuera) if fuera else fuera
    parentesis = " ".join(_dentro(m) for m in _PARENTESIS.finditer(nombre))
    return f"{tapado} {parentesis}".strip()


def _sin_tildes(s: str) -> str:
    """Misma longitud que `s` (carácter por carácter), para buscar en la copia y reemplazar en el original."""
    return "".join(unicodedata.normalize("NFD", c)[0] for c in s).upper()


def _patron(grupos: list[str]) -> re.Pattern:
    """Cada grupo (un apellido compuesto, un nombre) en su propio grupo de captura, palabras separadas por espacios."""
    cuerpo = r"\s+".join("(" + r"\s+".join(re.escape(_sin_tildes(w)) for w in g.split()) + ")" for g in grupos)
    return re.compile(rf"(?<!{_LETRA}){cuerpo}(?!{_LETRA})", re.UNICODE)


def tapar_en_texto(texto: str | None, nombres) -> str | None:
    """Tapa en `texto` cada nombre de `nombres` («APELLIDO1 APELLIDO2 NOMBRES»), sin importar tildes ni mayúsculas, en el
    orden SUNAT, en el hablado («NOMBRES APELLIDO1 APELLIDO2») y en el hablado con un solo nombre de pila. Se tapa el
    segundo apellido (entero, aunque sea compuesto), el mismo que en `tapar_nombre`."""
    if not texto:
        return texto
    for nombre in sorted({n.strip() for n in (nombres or []) if n and n.strip()}, key=len, reverse=True):
        g = _grupos(_PARENTESIS.sub("", nombre))
        if len(g) < 3:
            continue
        ap1, ap2, nombres_pila = g[0], g[1], g[2:]
        variantes = [([ap1, ap2, *nombres_pila], 2), ([*nombres_pila, ap1, ap2], len(nombres_pila) + 2)]
        if len(nombres_pila) > 1:
            variantes.append(([nombres_pila[0], ap1, ap2], 3))
        for v, k in variantes:
            plano = _sin_tildes(texto)
            spans = [m.span(k) for m in _patron(v).finditer(plano)]
            for a, b in reversed(spans):
                texto = texto[:a] + TAPA_NOMBRE + texto[b:]
    return texto


def es_persona_natural(ruc: str | None) -> bool:
    """RUC de persona natural: 11 dígitos que empiezan en 10. El código de un consorcio en el SEACE («1016604», 7
    dígitos) también empieza en 10 y no lo es: su nombre salía con una palabra tapada («CONSORCIO ••• NORTE SUR»)."""
    r = str(ruc or "").strip()
    return len(r) == 11 and r.isdigit() and r.startswith("10")
