"""Resuelve el ubigeo INEI a partir de los nombres que trae el OCDS del OECE en
buyer.address: department (departamento), region (provincia), locality (distrito).

Match por nombre normalizado (mayúsculas, sin tildes, sin guiones ni dobles
espacios) y descendiendo por jerarquía: departamento → provincia → distrito. Si un
nivel no matchea, devuelve el nivel superior resuelto (mejor un dpto que nada).

Sin dependencias: recibe las filas de `zonas` (ubigeo, nivel, nombre, padre_ubigeo)
ya cargadas por quien lo llame."""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import Iterable


def norm(s: str | None) -> str:
    """'  San   Martín-de Porres ' → 'SAN MARTIN DE PORRES'."""
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    return " ".join(s.upper().replace("-", " ").split())


@dataclass
class ZonaIndex:
    dptos: dict[str, str] = field(default_factory=dict)                 # norm(nombre) → ubigeo(2)
    provs: dict[tuple[str, str], str] = field(default_factory=dict)     # (dpto_ubigeo, norm) → ubigeo(4)
    dists: dict[tuple[str, str], str] = field(default_factory=dict)     # (prov_ubigeo, norm) → ubigeo(6)

    @classmethod
    def from_rows(cls, rows: Iterable[tuple[str, str, str, str | None]]) -> "ZonaIndex":
        ix = cls()
        for ubigeo, nivel, nombre, padre in rows:
            n = norm(nombre)
            if nivel == "departamento":
                ix.dptos[n] = ubigeo
            elif nivel == "provincia":
                ix.provs[(padre or "", n)] = ubigeo
            elif nivel == "distrito":
                ix.dists[(padre or "", n)] = ubigeo
        return ix


MIN_PREFIJO = 8   # letras mínimas para aceptar un match por prefijo (nombre truncado)


def _distrito_por_prefijo(ix: ZonaIndex, prov: str, loc: str) -> str | None:
    """El OCDS del OECE trunca `locality` (~19 chars): 'SANTA CRUZ DE TOLED'. Acepta el
    prefijo sólo si es largo y hay UN único distrito de la provincia que empiece así."""
    if len(loc) < MIN_PREFIJO:
        return None
    hits = [u for (pp, n), u in ix.dists.items() if pp == prov and n.startswith(loc)]
    return hits[0] if len(hits) == 1 else None


def resolve_ubigeo(ix: ZonaIndex, department: str | None, region: str | None, locality: str | None) -> str | None:
    """Devuelve el ubigeo más fino que se pueda resolver (6, 4 o 2 dígitos) o None."""
    d = ix.dptos.get(norm(department))
    if not d:
        return None
    p = ix.provs.get((d, norm(region))) if region else None
    if not p:
        return d
    loc = norm(locality)
    z = (ix.dists.get((p, loc)) or _distrito_por_prefijo(ix, p, loc)) if loc else None
    return z or p
