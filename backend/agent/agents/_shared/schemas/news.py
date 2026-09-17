from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, ValidationError, WrapValidator, model_validator
from .base import CITA_MAX, Evidencia, Hallazgo, Lista, Severidad, SeveridadInfo, _BanderaBase, _Base, _Raiz


CategoriaNoticia = Literal[
    "corrupcion", "sancion", "denuncia", "investigacion", "contraloria",
    "proyecto_publico", "menciones_sin_riesgo", "prensa_general",
]


class Noticia(Hallazgo):
    fecha: str | None = Field(default=None, max_length=20)
    fuente: str = Field(..., min_length=1, max_length=120)
    url: str | None = None
    titulo: str = Field(..., min_length=1, max_length=300)
    resumen: str | None = Field(default=None, max_length=600)
    actor_principal: str | None = Field(default=None, max_length=300)
    severidad: SeveridadInfo = "info"
    categoria: CategoriaNoticia = "prensa_general"
    tipo_mencion: Literal["directa", "indirecta"] = "directa"

    def _derivar_evidencia(self):
        return [Evidencia(url=self.url, cita=self.titulo[:CITA_MAX])] if self.url else []


class ConteoSeveridad(_Base):
    alta: int = 0
    media: int = 0
    baja: int = 0
    info: int = 0


class BanderaPrensa(_BanderaBase):
    titulo: str = Field(..., min_length=1, max_length=160)
    descripcion: str = Field(..., min_length=1, max_length=800)
    severidad: Severidad = "media"
    url: str | None = None


class NewsOutput(_Raiz, Hallazgo):
    """Salida de news_research_agent (output_key `news_research`)."""

    noticias: Lista(Noticia) = Field(default_factory=list)
    noticias_por_severidad: ConteoSeveridad | None = None
    n_noticias_totales: int = 0
    resumen_ejecutivo: str | None = Field(default=None, max_length=2000)
    sin_menciones_relevantes: bool = False
    banderas_prensa: Lista(BanderaPrensa) = Field(default_factory=list)
    queries_realizadas: list[str] = Field(default_factory=list)

    def _derivar_evidencia(self):
        return [e for n in self.noticias + self.banderas_prensa for e in n.evidencia]

    @model_validator(mode="after")
    def _recalcular_conteos(self):
        c = ConteoSeveridad()
        for n in self.noticias:
            setattr(c, n.severidad, getattr(c, n.severidad) + 1)
        self.noticias_por_severidad = c
        self.n_noticias_totales = len(self.noticias)
        self.sin_menciones_relevantes = not self.noticias
        return self
