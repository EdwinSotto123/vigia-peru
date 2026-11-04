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


def _tapar_simple(nombre: str) -> str:
    p = nombre.split()
    if len(p) < 3:
        return nombre
    return " ".join([p[0], TAPA_NOMBRE, *p[2:]])


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


def _patron(palabras: list[str]) -> re.Pattern:
    cuerpo = r"\s+".join(re.escape(_sin_tildes(w)) for w in palabras)
    return re.compile(rf"(?<!{_LETRA}){cuerpo}(?!{_LETRA})", re.UNICODE)


def tapar_en_texto(texto: str | None, nombres) -> str | None:
    """Tapa en `texto` cada nombre de `nombres` («APELLIDO1 APELLIDO2 NOMBRES»), sin importar tildes ni mayúsculas, en el
    orden SUNAT, en el hablado («NOMBRES APELLIDO1 APELLIDO2») y en el hablado con un solo nombre de pila. Se tapa el
    segundo apellido, el mismo que en `tapar_nombre`."""
    if not texto:
        return texto
    for nombre in sorted({n.strip() for n in (nombres or []) if n and n.strip()}, key=len, reverse=True):
        p = _PARENTESIS.sub("", nombre).split()
        if len(p) < 3:
            continue
        ap1, ap2, nombres_pila = p[0], p[1], p[2:]
        variantes = [[ap1, ap2, *nombres_pila], [*nombres_pila, ap1, ap2]]
        if len(nombres_pila) > 1:
            variantes.append([nombres_pila[0], ap1, ap2])
        for v in variantes:
            i2 = v.index(ap2) if ap2 in v else None
            plano = _sin_tildes(texto)
            spans = [m.span() for m in _patron(v).finditer(plano)]
            for ini, fin in reversed(spans):
                trozo = texto[ini:fin].split()
                if i2 is not None and i2 < len(trozo):
                    trozo[i2] = TAPA_NOMBRE
                texto = texto[:ini] + " ".join(trozo) + texto[fin:]
    return texto


def es_persona_natural(ruc: str | None) -> bool:
    return bool(ruc) and str(ruc).startswith("10")
