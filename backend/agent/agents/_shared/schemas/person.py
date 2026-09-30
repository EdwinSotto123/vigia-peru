from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, ValidationError, WrapValidator, model_validator
from .base import CITA_MAX, Confianza, Evidencia, Hallazgo, Lista, NotaPrensa, Opcional, Severidad, _BanderaBase, _Base, _Raiz, _digitos


class CargoEmpresa(_Base):
    cargo: str = Field(..., min_length=1, max_length=120)
    empresa: str = Field(..., min_length=1, max_length=300)
    ruc: str | None = Field(default=None, pattern=r"^\d{11}$")
    desde: str | None = Field(default=None, max_length=20)
    fuente_url: str | None = None


class CargoPublico(_Base):
    cargo: str = Field(..., min_length=1, max_length=160)
    entidad: str = Field(..., min_length=1, max_length=300)
    region: str | None = Field(default=None, max_length=80)
    periodo: str | None = Field(default=None, max_length=40)
    partido_autoridad: str | None = Field(default=None, max_length=120)
    fuente_url: str | None = None
    observacion: str | None = Field(default=None, max_length=300)


class EmpresaVinculada(_Base):
    ruc: str | None = Field(default=None, pattern=r"^\d{11}$")
    razon_social: str = Field(..., min_length=1, max_length=300)
    rol: str | None = Field(default=None, max_length=80)
    vinculo: str | None = Field(default=None, max_length=200)
    fuente_url: str | None = None


class Candidatura(_Base):
    anio: int | None = Field(default=None, ge=1990, le=2100)
    partido: str | None = Field(default=None, max_length=160)
    cargo: str | None = Field(default=None, max_length=120)
    resultado: str | None = Field(default=None, max_length=60)
    fuente_url: str | None = None


class AporteCampana(_Base):
    anio: int | None = Field(default=None, ge=1990, le=2100)
    partido: str | None = Field(default=None, max_length=160)
    monto: float | None = None
    fuente_url: str | None = None


class RedSocial(_Base):
    plataforma: Literal["facebook", "x", "instagram", "linkedin", "otra"] = "otra"
    url: str | None = None
    observacion: str | None = Field(default=None, max_length=300)


class PersonaPrincipal(Hallazgo):
    nombre_completo: str | None = Field(default=None, max_length=200)
    cargo_actual: str | None = Field(default=None, max_length=200)
    dni: str | None = Field(default=None, pattern=r"^\d{8}$")
    otros_cargos_actuales: Lista(CargoEmpresa) = Field(default_factory=list)
    cargos_pasados: Lista(CargoPublico) = Field(default_factory=list)
    otras_empresas_vinculadas: Lista(EmpresaVinculada) = Field(default_factory=list)
    candidaturas: Lista(Candidatura) = Field(default_factory=list)
    aportes_campanas: Lista(AporteCampana) = Field(default_factory=list)
    menciones_prensa: Lista(NotaPrensa) = Field(default_factory=list)
    presencia_redes_sociales: Lista(RedSocial) = Field(default_factory=list)
    sintesis_personal: str | None = Field(default=None, max_length=1200)

    def _derivar_evidencia(self):
        ev = []
        for grupo in (self.otros_cargos_actuales, self.cargos_pasados, self.otras_empresas_vinculadas,
                      self.candidaturas, self.aportes_campanas, self.presencia_redes_sociales):
            for x in grupo:
                url = getattr(x, "fuente_url", None) or getattr(x, "url", None)
                if url:
                    ev.append(Evidencia(url=url, cita=(getattr(x, "cargo", None) or getattr(x, "razon_social", None)
                                                       or getattr(x, "partido", None) or getattr(x, "observacion", None) or "fuente")[:CITA_MAX]))
        ev += [e for n in self.menciones_prensa for e in n.evidencia]
        return ev


Parentesco = Literal["conyuge", "hijo_a", "padre_madre", "hermano_a", "otro_familiar", "posible_familiar"]
ActividadPublica = Literal["funcionario", "candidato", "fundador_partido", "empresario_contratista", "ninguna"]


class Familiar(Hallazgo):
    nombre: str = Field(..., min_length=1, max_length=200)
    parentesco: Parentesco = "posible_familiar"
    actividad_publica: ActividadPublica = "ninguna"
    detalles: str | None = Field(default=None, max_length=600)
    confianza: Confianza = "baja"
    cargos_publicos: Lista(CargoPublico) = Field(default_factory=list)


class EmpresaRed(_Base):
    ruc: str | None = Field(default=None, pattern=r"^\d{11}$")
    razon_social: str = Field(..., min_length=1, max_length=300)
    direccion: str | None = Field(default=None, max_length=300)
    rol_del_gerente: str | None = Field(default=None, max_length=80)
    observacion: str | None = Field(default=None, max_length=300)
    fuente_url: str | None = None


class RedEmpresarial(_Base):
    empresas_misma_direccion: Lista(EmpresaRed) = Field(default_factory=list)
    empresas_mismo_titular: Lista(EmpresaRed) = Field(default_factory=list)
    observaciones: str | None = Field(default=None, max_length=1200)


TipoVinculoAutoridad = Literal["mismo_partido", "familiar", "socio_empresarial", "misma_red_social", "sin_vinculo"]


class VinculoAutoridad(Hallazgo):
    autoridad: str = Field(..., min_length=1, max_length=200)
    cargo: str | None = Field(default=None, max_length=160)
    entidad: str | None = Field(default=None, max_length=300)
    vinculo_con_gerente: TipoVinculoAutoridad = "sin_vinculo"
    descripcion: str | None = Field(default=None, max_length=600)
    confianza: Confianza = "baja"
    severidad: Severidad = "baja"
    fuente_url: str | None = None


TipoRelacionFirmante = Literal[
    "apellido_compartido", "cargo_publico_compartido", "partido_politico_compartido",
    "misma_direccion", "red_social_compartida", "parentesco_documentado",
    "codireccion_empresa", "sin_relacion",
]


class CruceFirmante(Hallazgo):
    """Cruce firmante del acta × persona del proveedor. `confianza_match='alta'` solo con
    identificador (DNI/RUC) o dos fuentes independientes; `apellido_compartido` a secas es
    `baja` y nunca produce bandera."""

    firmante: str = Field(..., min_length=1, max_length=200)
    cargo_firmante: str | None = Field(default=None, max_length=160)
    entidad_firmante: str | None = Field(default=None, max_length=300)
    persona_proveedor: str | None = Field(default=None, max_length=200)
    tipo_relacion: TipoRelacionFirmante = "sin_relacion"
    descripcion: str | None = Field(default=None, max_length=800)
    confianza_match: Confianza = "baja"
    severidad: Severidad = "baja"
    fuente_url: str | None = None

    @model_validator(mode="after")
    def _apellido_solo_no_es_bandera(self):
        if self.tipo_relacion == "apellido_compartido":
            self.confianza_match = "baja"
            self.severidad = "baja"
        return self


TipoLazoPostores = Literal["mismo_titular", "misma_direccion", "apellidos_familiares", "co_postulan_otros_procesos", "sin_vinculo"]


class PostorRef(_Base):
    ruc: str | None = Field(default=None, pattern=r"^\d{11}$")
    razon_social: str = Field(..., min_length=1, max_length=300)

    @model_validator(mode="before")
    @classmethod
    def _desde_texto(cls, data):
        if isinstance(data, str):                       # "EMPRESA X S.A.C. (RUC 20…)"
            return {"razon_social": re.sub(r"\(?\s*RUC\s*:?\s*\d{11}\s*\)?", "", data, flags=re.I).strip() or data,
                    "ruc": _digitos(data, 11)}
        if isinstance(data, dict) and not data.get("razon_social"):
            for k in ("nombre", "name", "empresa", "postor"):
                if isinstance(data.get(k), str) and data[k].strip():
                    return {**data, "razon_social": data[k]}
        return data


class LazoPostores(Hallazgo):
    postor_a: PostorRef
    postor_b: PostorRef
    tipo_vinculo: TipoLazoPostores = "sin_vinculo"
    descripcion: str | None = Field(default=None, max_length=600)
    confianza: Confianza = "baja"
    severidad: Severidad = "baja"
    fuente_url: str | None = None


class BanderaRed(_BanderaBase):
    titulo: str = Field(..., min_length=1, max_length=160)
    descripcion: str = Field(..., min_length=1, max_length=1000)
    severidad: Severidad = "media"
    confianza: Confianza = "media"
    requiere_verificacion: bool = True
    fuentes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def _fuentes_desde_evidencia(self):
        if not self.fuentes:
            self.fuentes = [e.url for e in self.evidencia if e.url]
        return self


class PersonNetworkOutput(_Raiz, Hallazgo):
    """Salida de person_network_agent (output_key `person_network`). Las relaciones van en
    cuatro listas tipadas (firmantes, autoridades, postores, familia), todas con `confianza`
    y `evidencia[]`."""

    persona_principal: Opcional(PersonaPrincipal) = None
    pareja_o_familia: Lista(Familiar) = Field(default_factory=list)
    red_empresarial: Opcional(RedEmpresarial) = None
    vinculo_autoridades: Lista(VinculoAutoridad) = Field(default_factory=list)
    cruce_firmantes_ganador: Lista(CruceFirmante) = Field(default_factory=list)
    lazos_entre_postores: Lista(LazoPostores) = Field(default_factory=list)
    banderas_red: Lista(BanderaRed) = Field(default_factory=list)
    queries_realizadas: list[str] = Field(default_factory=list)
    sintesis: str | None = Field(default=None, max_length=2000)

    def _derivar_evidencia(self):
        ev = list(self.persona_principal.evidencia) if self.persona_principal else []
        for grupo in (self.pareja_o_familia, self.vinculo_autoridades, self.cruce_firmantes_ganador,
                      self.lazos_entre_postores, self.banderas_red):
            ev += [e for x in grupo for e in x.evidencia]
        return ev
