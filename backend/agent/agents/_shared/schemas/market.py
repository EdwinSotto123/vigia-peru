from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, ValidationError, WrapValidator, model_validator
from .base import CITA_MAX, Evidencia, Hallazgo, Lista, _Base, _Raiz


class PrecioObservado(_Base):
    """Un precio visto en una fuente. `url` la asigna el CÓDIGO desde
    `grounding_metadata.grounding_chunks` (nunca el modelo)."""

    producto: str = Field(..., min_length=1, max_length=300, description="Título del producto tal como aparece en la fuente.")
    precio: float = Field(..., ge=0.01, description="Precio unitario en soles (PEN).")
    unidad: str = Field(default="Unidad", max_length=60)
    url: str | None = Field(default=None, description="URL real (grounding) — la asigna el código.")
    fecha: str | None = Field(default=None, max_length=20)
    proveedor: str | None = Field(default=None, max_length=200)
    moneda_origen: Literal["PEN", "USD"] | None = None
    titulo_fuente: str | None = Field(default=None, max_length=300)
    dominio: str | None = Field(default=None, max_length=120)


class ProveedorPotencial(_Base):
    nombre: str = Field(..., min_length=1, max_length=200)
    url: str | None = None


class MarketFinding(Hallazgo):
    """Un ítem tasado. Mediana, rango, Δ % y veredicto los calcula el código (no el modelo):
    aquí solo van los precios observados y el contexto. Sin precios con URL real no puede ser
    `hallado`: se degrada a `no_verificable` (no se descarta: el ítem debe seguir visible)."""

    item_numero: str
    item_descripcion: str = Field(..., max_length=300)
    cantidad: float | None = None
    unidad: str | None = None
    precio_unitario_referencial: float | None = None
    precio_unitario_ofertado: float | None = None
    precios_observados: Lista(PrecioObservado) = Field(default_factory=list)
    proveedores_potenciales: Lista(ProveedorPotencial) = Field(default_factory=list)
    caracteristicas_solicitadas_clave: list[str] = Field(default_factory=list)
    comentario: str | None = Field(default=None, max_length=800)

    def _derivar_evidencia(self):
        return [Evidencia(url=p.url, cita=f"{p.producto[:180]} · {p.precio:.2f}"[:CITA_MAX])
                for p in self.precios_observados if p.url]

    @model_validator(mode="before")
    @classmethod
    def _degradar_sin_url(cls, data):
        if isinstance(data, dict) and data.get("estado") == "hallado" and not data.get("evidencia"):
            if not any(isinstance(p, dict) and p.get("url") for p in (data.get("precios_observados") or [])):
                data = dict(data)
                data["estado"] = "no_verificable"
        return data


class MarketOutput(_Raiz):
    """Salida del análisis de mercado (todas las estrategias). Los totales y veredictos globales
    los agrega el código en `state["market_analysis"]`; este modelo es la parte que puede
    producir un LLM."""

    findings: Lista(MarketFinding) = Field(default_factory=list)
    observaciones_clave: list[str] = Field(default_factory=list)
    queries_realizadas: list[str] = Field(default_factory=list)


# ── Web research (perfil del proveedor) ─────────────────────────────────────
