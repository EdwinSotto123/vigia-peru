from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, ValidationError, WrapValidator, model_validator
from .base import CITA_MAX, Evidencia, Hallazgo, Lista, NotaPrensa, Opcional, Severidad, _BanderaBase, _Base, _Raiz, _norm_token, _normalizar_enum, _spec_campos


class PersonaCargo(_Base):
    nombre: str = Field(..., min_length=1, max_length=200)
    cargo: str | None = Field(default=None, max_length=120)
    desde: str | None = Field(default=None, max_length=20)
    fuente_url: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _desde_texto(cls, data):
        if isinstance(data, str):                       # "Nombre Apellido" a secas
            return {"nombre": data}
        if isinstance(data, dict) and not data.get("nombre"):
            for k in ("nombre_completo", "name", "persona"):
                if isinstance(data.get(k), str) and data[k].strip():
                    return {**data, "nombre": data[k]}
        return data


class EmpresaPerfil(_Base):
    """Datos SUNAT/RNP: se copian del bloque pre-cargado (decolecta), no de Google."""

    ruc: str | None = Field(default=None, pattern=r"^\d{11}$")
    razon_social: str | None = Field(default=None, max_length=300)
    tipo: str | None = Field(default=None, max_length=120)
    condicion: str | None = Field(default=None, max_length=60)
    estado: str | None = Field(default=None, max_length=60)
    fecha_inicio_actividades: str | None = Field(default=None, max_length=20)
    actividades_comerciales: list[str] = Field(default_factory=list)
    ciiu: str | None = Field(default=None, max_length=40)
    direccion_legal: str | None = Field(default=None, max_length=300)
    estado_domicilio: str | None = Field(default=None, max_length=60)
    gerente_general: Opcional(PersonaCargo) = None
    socios: Lista(PersonaCargo) = Field(default_factory=list)
    representantes: Lista(PersonaCargo) = Field(default_factory=list)


class HallazgoFuente(_Base):
    """Estado de una fuente consultada (SUNAT, OSCE, prensa…). `sin_menciones` es válido."""

    fuente: str = Field(..., min_length=1, max_length=120)
    categoria: Literal["empresas", "sanciones", "prensa", "politica", "justicia", "funcionarios", "obras", "contratos"]
    estado: Literal["ok", "sin_menciones", "alerta", "error"]
    mensaje: str | None = Field(default=None, max_length=400)
    url: str | None = None

    @classmethod
    def _inferir_enum(cls, campo: str, data: dict) -> str | None:
        """`categoria` desconocida → se infiere del nombre de la fuente ('SUNAT' → empresas,
        'OSCE Tribunal' → sanciones, 'JNE' → politica)."""
        if campo != "categoria":
            return None
        vals, canon = _spec_campos(cls)["categoria"]["enum"]
        fuente = str(data.get("fuente") or "")
        for parte in [fuente] + _norm_token(fuente).split("_"):
            cand, como = _normalizar_enum(parte, vals, canon)
            if cand is not None and como != "cercano":
                return cand
        return None


class ContratoEstado(Hallazgo):
    entidad: str = Field(..., min_length=1, max_length=300)
    objeto: str | None = Field(default=None, max_length=400)
    monto: float | None = None
    fecha: str | None = Field(default=None, max_length=20)
    ocid_o_contrato: str | None = Field(default=None, max_length=80)
    url: str | None = None


class HistorialResumido(_Base):
    """Solo conteos/fechas que salen de `otros_contratos_con_estado` (se recalculan en código)."""

    n_contratos_estado_hallados: int = 0
    primer_contrato: str | None = None
    ultimo_contrato: str | None = None
    entidades_unicas: list[str] = Field(default_factory=list)


class RelacionProveedorEntidad(Hallazgo):
    contratos_previos: int | None = None
    detalle: str | None = Field(default=None, max_length=600)




class BanderaSugerida(_BanderaBase):
    titulo: str = Field(..., min_length=1, max_length=160)
    descripcion: str = Field(..., min_length=1, max_length=800)
    severidad: Severidad = "media"


class WebResearchOutput(_Raiz, Hallazgo):
    """Salida de web_research_agent (output_key `web_research`)."""

    empresa: Opcional(EmpresaPerfil) = None
    hallazgos_por_fuente: Lista(HallazgoFuente) = Field(default_factory=list)
    otros_contratos_con_estado: Lista(ContratoEstado) = Field(default_factory=list)
    historial_resumido: Opcional(HistorialResumido) = None
    relacion_proveedor_entidad: Opcional(RelacionProveedorEntidad) = None
    hallazgos_prensa: Lista(NotaPrensa) = Field(default_factory=list)
    banderas_sugeridas: Lista(BanderaSugerida) = Field(default_factory=list)
    sintesis: str | None = Field(default=None, max_length=2000)
    queries_realizadas: list[str] = Field(default_factory=list)

    def _derivar_evidencia(self):
        partes = self.otros_contratos_con_estado + self.hallazgos_prensa + self.banderas_sugeridas
        ev = [e for p in partes for e in p.evidencia]
        ev += [Evidencia(url=h.url, cita=(h.mensaje or h.fuente)[:CITA_MAX]) for h in self.hallazgos_por_fuente if h.url]
        return ev

    @model_validator(mode="after")
    def _recalcular_historial(self):
        oc = self.otros_contratos_con_estado
        fechas = sorted(c.fecha for c in oc if c.fecha)
        self.historial_resumido = HistorialResumido(
            n_contratos_estado_hallados=len(oc),
            primer_contrato=fechas[0] if fechas else None,
            ultimo_contrato=fechas[-1] if fechas else None,
            entidades_unicas=sorted({c.entidad for c in oc if c.entidad}),
        )
        return self


# ── Prensa ──────────────────────────────────────────────────────────────────
