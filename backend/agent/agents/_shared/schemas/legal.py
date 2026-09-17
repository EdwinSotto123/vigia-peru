from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, ValidationError, WrapValidator, model_validator
from .base import Hallazgo, Lista, Opcional, Severidad, _Base, _Raiz


VectorLegal = Literal[
    # bienes
    "marca_unica", "certificacion_atipica", "plazo_imposible", "experiencia_desproporcionada",
    "ano_reciente", "specs_convergentes",
    # servicios
    "personal_clave_sobreexigido", "experiencia_excesiva", "plazo_irreal",
    "subcontratacion_prohibida", "causal_personalisimo", "penalidad_atipica",
    # obras
    "adicional_sin_autorizacion", "ampliaciones_reiteradas", "supervisor_por_directa",
    "consorcio_capacidad_rnp",
    # otros (directa / convenio / consultoría)
    "causal_incongruente", "sin_acto_resolutivo", "publicacion_tardia", "fraccionamiento",
    "directa_recurrente",
    # transversales
    "procedimiento", "penalidades", "comite", "otro",
]


class OpinionOECE(_Base):
    num_opinion: str | None = None
    url: str | None = None
    snippet: str | None = Field(default=None, max_length=400)


class RedFlagDocumental(Hallazgo):
    """Un vector de direccionamiento / irregularidad documental. `descripcion` +
    `norma_citada` los persiste `persist_doc_flags_as_banderas`; `evidencia[]` con
    documento/página los verifica `verify.verificar_bandera`."""

    vector: VectorLegal = "otro"
    descripcion: str = Field(..., min_length=1, max_length=600)
    severidad: Severidad = "media"
    norma_citada: str = Field(..., min_length=1, max_length=300, description="Ley + artículo + principio, p.ej. 'Art. 2 TUO Ley 30225 — Libertad de concurrencia'.")
    articulo: str | None = Field(default=None, max_length=60, description="Solo el artículo/numeral (p.ej. '55.1').")
    item_afectado: str | None = None
    opinion_oece_relacionada: OpinionOECE | None = None


class PrincipioEval(_Base):
    cumple: bool | None = None
    observacion: str | None = Field(default=None, max_length=400)


class CumplimientoPrincipios(_Base):
    """Acepta dict por principio o lista [{principio, cumple, observacion}] (forma que suele emitir el modelo)."""

    @model_validator(mode="before")
    @classmethod
    def _desde_lista(cls, data):
        if isinstance(data, list):
            out: dict = {}
            for it in data:
                if not isinstance(it, dict):
                    continue
                nombre = str(it.get("principio") or it.get("nombre") or "").strip().lower()
                nombre = (nombre.replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
                          .replace(" de ", " ").replace(" y ", " ").replace(" ", "_").replace("-", "_"))
                for campo in ("libertad_concurrencia", "igualdad_trato", "transparencia", "publicidad", "competencia",
                              "eficacia_eficiencia", "vigencia_tecnologica", "integridad"):
                    if campo.split("_")[0] in nombre:
                        out[campo] = {"cumple": it.get("cumple"), "observacion": it.get("observacion") or it.get("comentario")}
                        break
            return out
        return data

    libertad_concurrencia: PrincipioEval | None = None
    igualdad_trato: PrincipioEval | None = None
    transparencia: PrincipioEval | None = None
    publicidad: PrincipioEval | None = None
    competencia: PrincipioEval | None = None
    eficacia_eficiencia: PrincipioEval | None = None
    vigencia_tecnologica: PrincipioEval | None = None
    integridad: PrincipioEval | None = None


class Direccionamiento(_Base):
    hay_indicios: bool = False
    justificacion: str | None = Field(default=None, max_length=1200)


class CausalDirectaEval(Hallazgo):
    aplica: bool = False
    causal_invocada: str | None = Field(default=None, max_length=300)
    causal_es_congruente_con_objeto: bool | None = None
    acreditada_con_acto_resolutivo: bool | None = None
    acto_resolutivo_identificado: str | None = Field(default=None, max_length=200)
    observaciones: str | None = Field(default=None, max_length=1200)


class LegalOutput(_Raiz, Hallazgo):
    """Salida de document_legal_analyst_agent (output_key `legal_analysis`)."""

    red_flags_documentales: Lista(RedFlagDocumental) = Field(default_factory=list)
    cumplimiento_principios: Opcional(CumplimientoPrincipios) = None
    direccionamiento_detectado: Opcional(Direccionamiento) = None
    causal_directa_evaluacion: Opcional(CausalDirectaEval) = None
    resumen_ejecutivo: str | None = Field(default=None, max_length=2000)

    def _derivar_evidencia(self):
        return [e for rf in self.red_flags_documentales for e in rf.evidencia]


# ── Mercado ─────────────────────────────────────────────────────────────────
