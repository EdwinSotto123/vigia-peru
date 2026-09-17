from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, ValidationError, WrapValidator, model_validator
from .base import CITA_MAX, Evidencia, Hallazgo, Lista, _Base, _Raiz


class FuncionarioDesignado(Hallazgo):
    nombre_completo: str = Field(..., min_length=1, max_length=200)
    cargo: str = Field(..., min_length=1, max_length=160)
    area: str | None = Field(default=None, max_length=160)
    tipo_cargo: Literal["confianza_designado", "electo", "otro"] = "confianza_designado"
    fecha_designacion: str | None = Field(default=None, max_length=20)
    vigente: bool | None = None
    acto_resolutivo: str | None = Field(default=None, max_length=200)
    fuente_url: str | None = None

    def _derivar_evidencia(self):
        return [Evidencia(url=self.fuente_url, cita=f"{self.nombre_completo} — {self.cargo}"[:CITA_MAX])] if self.fuente_url else []


class ResolucionDesignacion(_Base):
    numero: str = Field(..., min_length=1, max_length=120)
    fecha: str | None = Field(default=None, max_length=20)
    objeto: str | None = Field(default=None, max_length=300)
    url: str | None = None


class EntityPersonnelOutput(_Raiz, Hallazgo):
    """Salida de entity_personnel_agent (output_key `entity_personnel`)."""

    entidad_nombre: str | None = Field(default=None, max_length=300)
    funcionarios_designados: Lista(FuncionarioDesignado) = Field(default_factory=list)
    resoluciones_designacion: Lista(ResolucionDesignacion) = Field(default_factory=list)
    comite_permanente_adquisiciones: Lista(FuncionarioDesignado) = Field(default_factory=list)
    observaciones: str | None = Field(default=None, max_length=1200)
    queries_realizadas: list[str] = Field(default_factory=list)
    n_funcionarios: int = 0
    sin_data_publica: bool = False

    def _derivar_evidencia(self):
        return [e for f in self.funcionarios_designados + self.comite_permanente_adquisiciones for e in f.evidencia]

    @model_validator(mode="after")
    def _recalcular(self):
        self.n_funcionarios = len(self.funcionarios_designados)
        self.sin_data_publica = not self.funcionarios_designados
        return self
