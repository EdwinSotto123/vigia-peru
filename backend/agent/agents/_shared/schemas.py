"""Schemas de salida (pydantic v2) de los agentes con juicio: legal, market, web, news,
entity_personnel y person_network.

Principios (AUDITORIA_ORQUESTADOR §2.2 / §6.2-3):
  · Todo hallazgo lleva `estado` ("hallado" | "sin_dato" | "no_verificable") y `evidencia[]`.
    Un `hallado` sin evidencia es inválido (`Hallazgo` lo rechaza). Dentro de una salida, el
    ítem inválido se DESCARTA y queda anotado en `descartes_schema[]` (formato de
    `state["descartes"]`) sin tumbar el resto de la salida.
  · `Evidencia.cita` es literal y corta (≤ 240 chars): un fragmento del documento / página /
    URL, no una paráfrasis.
  · Ningún campo calculado (mediana, Δ %, edad en días, concentración %): los calcula el código.
    Los conteos que el frontend muestra (`noticias_por_severidad`, `n_funcionarios`,
    `historial_resumido`) se recalculan en validadores `after`, nunca los escribe el modelo.
  · Modelos planos para `response_schema` de Gemini: sin `dict` libres, sin `Any`, sin uniones
    de tipos distintos; listas de modelos, `Literal` para enums, `X | None` para opcionales.
  · Nombres de campo compatibles con los consumidores actuales (persistence.py,
    compliance_rules.py, state_loaders.py, frontend): `red_flags_documentales`, `findings`,
    `empresa`, `hallazgos_por_fuente`, `noticias`, `funcionarios_designados`,
    `cruce_firmantes_ganador`, `banderas_red`, …

Se enchufan como `output_schema=schemas.<X>` en `agents/*/__init__.py` (WS P) y como
`response_schema` en las llamadas crudas (market).
"""

from __future__ import annotations

import contextvars
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, ValidationError, WrapValidator, model_validator

# ── Vocabulario ─────────────────────────────────────────────────────────────
Estado = Literal["hallado", "sin_dato", "no_verificable"]
Severidad = Literal["alta", "media", "baja"]
SeveridadInfo = Literal["alta", "media", "baja", "info"]
Confianza = Literal["alta", "media", "baja"]

CITA_MAX = 240

# Colector de descartes de la validación en curso (lo abre el modelo raíz, lo llenan las
# listas tolerantes y lo vacía el `after` del raíz en `descartes_schema`).
_COLECTOR: contextvars.ContextVar[list | None] = contextvars.ContextVar("schemas_descartes", default=None)


def _lista_tolerante(v, handler, info):
    """WrapValidator para `list[Modelo]`: valida ítem por ítem; el inválido se descarta y se
    anota en el colector (si hay). Así una bandera sin evidencia no tumba toda la salida."""
    if not isinstance(v, list):
        return handler(v)
    out = []
    col = _COLECTOR.get()
    for i, item in enumerate(v):
        try:
            out.extend(handler([item]))
        except ValidationError as e:
            if col is not None:
                col.append({
                    "donde": f"schema.{info.field_name}[{i}]",
                    "motivo": "item_invalido",
                    "detalle": "; ".join(f"{'.'.join(str(x) for x in err.get('loc', ()))}: {err.get('msg')}"
                                         for err in e.errors()[:3])[:300],
                })
    return out


def Lista(modelo):  # noqa: N802 — se usa como tipo: Lista(X) ≡ list[X] tolerante
    return Annotated[list[modelo], WrapValidator(_lista_tolerante)]


def _opcional_tolerante(v, handler, info):
    """WrapValidator para un sub-objeto opcional: si no valida (p. ej. `hallado` sin evidencia)
    se descarta SOLO ese bloque (→ None) y se anota; la salida del agente sobrevive."""
    if v is None:
        return None
    try:
        return handler(v)
    except ValidationError as e:
        col = _COLECTOR.get()
        if col is not None:
            col.append({
                "donde": f"schema.{info.field_name}",
                "motivo": "bloque_invalido",
                "detalle": "; ".join(f"{'.'.join(str(x) for x in err.get('loc', ()))}: {err.get('msg')}"
                                     for err in e.errors()[:3])[:300],
            })
        return None


def Opcional(modelo):  # noqa: N802 — Opcional(X) ≡ X | None tolerante
    return Annotated[modelo | None, WrapValidator(_opcional_tolerante)]


class _Base(BaseModel):
    """Base común: ignora claves desconocidas (los modelos a veces agregan campos)."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


ESTADOS_OK = frozenset({"hallado", "sin_dato", "no_verificable"})
ESTADOS_HALLADO = frozenset({"completado", "completo", "ok", "exito", "éxito", "exitoso", "done", "encontrado", "con_hallazgos"})
ESTADOS_SIN_DATO = frozenset({"sin_datos", "sin_informacion", "sin_información", "vacio", "vacío", "no_aplica", "sin_menciones"})


class _Raiz(_Base):
    """Modelo raíz de una salida de agente: abre el colector de descartes y lo vuelca en
    `descartes_schema` (lo llena el código, no el modelo)."""

    descartes_schema: list[str] = Field(default_factory=list, description="Lo llena el código: ítems descartados por schema. Dejar vacío.")
    _descartes: list = PrivateAttr(default_factory=list)

    @model_validator(mode="wrap")
    @classmethod
    def _con_colector(cls, data, handler):
        token = _COLECTOR.set([])
        try:
            if isinstance(data, dict) and "estado" in data:
                est = str(data.get("estado") or "").strip().lower().replace(" ", "_")
                if est not in ESTADOS_OK:
                    nuevo = "hallado" if est in ESTADOS_HALLADO else ("sin_dato" if est in ESTADOS_SIN_DATO else "no_verificable")
                    data = {**data, "estado": nuevo}
                    _COLECTOR.get().append({"donde": cls.__name__, "motivo": "estado_normalizado",
                                                    "detalle": f"estado '{est}' → '{nuevo}'"})
            obj = handler(data)
            col = _COLECTOR.get() or []
            obj.descartes_schema = [f"{d['donde']}: {d['detalle']}" for d in col]
            obj._descartes = col
            return obj
        finally:
            _COLECTOR.reset(token)

    def descartes(self) -> list[dict]:
        """Descartes en el formato de `state["descartes"]` ({donde, motivo, detalle})."""
        return list(self._descartes)


# ── Evidencia y hallazgo ────────────────────────────────────────────────────
class Evidencia(_Base):
    """Una pieza de respaldo. Al menos uno de `documento` o `url` debería estar presente; la
    `cita` es texto LITERAL (≤ 240 chars) tomado de esa fuente."""

    documento: str | None = Field(default=None, description="sha256 o nombre del documento fuente (si aplica).")
    url: str | None = Field(default=None, description="URL de la fuente (solo si se obtuvo de una tool/grounding, nunca inventada).")
    pagina: int | None = Field(default=None, ge=1, description="Página del documento donde está la cita.")
    cita: str = Field(..., min_length=1, max_length=CITA_MAX, description="Fragmento literal de la fuente (≤ 240 chars).")


class Hallazgo(_Base):
    """Cualquier afirmación con juicio: exige `estado`; si es `hallado`, exige evidencia
    (propia o derivada de sus partes vía `_derivar_evidencia`)."""

    estado: Estado = Field(..., description="hallado | sin_dato | no_verificable")
    evidencia: list[Evidencia] = Field(default_factory=list)

    def _derivar_evidencia(self) -> list[Evidencia]:
        return []

    @model_validator(mode="after")
    def _hallado_requiere_evidencia(self):
        if self.estado == "hallado" and not self.evidencia:
            derivada = self._derivar_evidencia()
            if not derivada:
                if isinstance(self, _Raiz):
                    # La salida completa de un agente nunca se pierde por falta de evidencia en la
                    # raíz: se degrada a no_verificable y queda anotado (los ítems sí se descartan).
                    self.estado = "no_verificable"
                    col = _COLECTOR.get()
                    if col is not None:
                        col.append({"donde": type(self).__name__, "motivo": "raiz_sin_evidencia",
                                    "detalle": "estado='hallado' sin evidencia propia ni derivada → no_verificable"})
                    return self
                raise ValueError("estado='hallado' requiere al menos una evidencia")
            self.evidencia = derivada[:20]
        return self


# ── Legal ───────────────────────────────────────────────────────────────────
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
class PersonaCargo(_Base):
    nombre: str = Field(..., min_length=1, max_length=200)
    cargo: str | None = Field(default=None, max_length=120)
    desde: str | None = Field(default=None, max_length=20)
    fuente_url: str | None = None


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


class NotaPrensa(Hallazgo):
    medio: str = Field(..., min_length=1, max_length=120)
    fecha: str | None = Field(default=None, max_length=20)
    titulo: str = Field(..., min_length=1, max_length=300)
    url: str | None = None
    resumen: str | None = Field(default=None, max_length=600)
    severidad: SeveridadInfo = "info"


class BanderaSugerida(Hallazgo):
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


class BanderaPrensa(Hallazgo):
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


# ── Funcionarios de la entidad ──────────────────────────────────────────────
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


# ── Red de personas ─────────────────────────────────────────────────────────
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


class LazoPostores(Hallazgo):
    postor_a: PostorRef
    postor_b: PostorRef
    tipo_vinculo: TipoLazoPostores = "sin_vinculo"
    descripcion: str | None = Field(default=None, max_length=600)
    confianza: Confianza = "baja"
    severidad: Severidad = "baja"
    fuente_url: str | None = None


class BanderaRed(Hallazgo):
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


# ── Helpers para el driver ──────────────────────────────────────────────────
def validar_o_descartar(modelo: type[BaseModel], data, *, donde: str, descartes: list | None = None):
    """Valida `data` con `modelo`. Si falla, registra el motivo en `descartes` (formato de
    `state["descartes"]`: {donde, motivo, detalle}) y devuelve None. Si valida y el modelo es
    raíz, vuelca también sus descartes de ítems en `descartes`. Nunca levanta."""
    try:
        obj = modelo.model_validate(data)
    except Exception as e:  # ValidationError u otro
        if descartes is not None:
            descartes.append({"donde": donde, "motivo": "schema_invalido", "detalle": str(e)[:400]})
        return None
    if descartes is not None and isinstance(obj, _Raiz):
        for d in obj.descartes():
            descartes.append({"donde": f"{donde}.{d['donde']}", "motivo": d["motivo"], "detalle": d["detalle"]})
    return obj


OUTPUT_SCHEMAS: dict[str, type[BaseModel]] = {
    "document_legal_analyst": LegalOutput,
    "market": MarketOutput,
    "web_research": WebResearchOutput,
    "news_research": NewsOutput,
    "entity_personnel": EntityPersonnelOutput,
    "person_network": PersonNetworkOutput,
}

__all__ = [
    "Estado", "Severidad", "Confianza", "CITA_MAX", "Lista",
    "Evidencia", "Hallazgo",
    "LegalOutput", "RedFlagDocumental", "OpinionOECE", "CumplimientoPrincipios", "CausalDirectaEval",
    "MarketOutput", "MarketFinding", "PrecioObservado", "ProveedorPotencial",
    "WebResearchOutput", "EmpresaPerfil", "HallazgoFuente", "ContratoEstado", "BanderaSugerida", "NotaPrensa",
    "NewsOutput", "Noticia", "BanderaPrensa", "ConteoSeveridad",
    "EntityPersonnelOutput", "FuncionarioDesignado",
    "PersonNetworkOutput", "PersonaPrincipal", "Familiar", "CruceFirmante", "VinculoAutoridad", "LazoPostores", "BanderaRed",
    "validar_o_descartar", "OUTPUT_SCHEMAS",
]
