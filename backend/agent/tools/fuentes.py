"""Enlaces a las fuentes oficiales, con los mismos patrones que backend/api/src/lib/fuentes.ts.

Contrataciones Abiertas del OECE abre un proceso SOLO con el OCID completo: /proceso/ocds-dgv273-seacev3-1229308.
Con el ocid que guarda Vigía (convocatorias.ocid: «1229308» o «2018-1534-1») dice «No se encontró el proceso de
contratación» (aviso de 2026-11-04: el dictamen de 1229308 mandaba a /proceso/1229308).
"""
from __future__ import annotations

import re

PREFIJO_OCID = "ocds-dgv273-seacev3-"
_BASE_PROCESO = "https://contratacionesabiertas.oece.gob.pe/proceso/"
_RE_PROCESO_CORTO = re.compile(r"(https?://contratacionesabiertas\.o[es]ce\.gob\.pe/proceso/)(?!ocds-)([0-9][\w-]*)", re.I)


def ocid_completo(ocid) -> str:
    s = str(ocid or "").strip()
    if s.upper().startswith("OECE-"):
        s = s[5:]
    return s if not s or s.startswith("ocds-") else PREFIJO_OCID + s


def proceso_oece(ocid) -> str:
    """El proceso en Contrataciones Abiertas: acepta el OCID completo, el de Vigía o «OECE-<ocid>»."""
    return _BASE_PROCESO + ocid_completo(ocid)


def arreglar_urls_oece(texto: str) -> str:
    """Pone el prefijo del OCID a los enlaces de proceso que no lo tienen (y lleva el dominio viejo al nuevo)."""
    if not texto or "contratacionesabiertas" not in texto:
        return texto
    return _RE_PROCESO_CORTO.sub(lambda m: _BASE_PROCESO + PREFIJO_OCID + m.group(2), texto)
