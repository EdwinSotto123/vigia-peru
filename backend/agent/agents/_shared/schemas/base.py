"""Schemas de salida (pydantic v2) de los agentes con juicio: legal, market, web, news,
entity_personnel y person_network.

Principios (AUDITORIA_ORQUESTADOR §2.2 / §6.2-3):
  · Todo hallazgo lleva `estado` ("hallado" | "sin_dato" | "no_verificable") y `evidencia[]`.
    Un `hallado` sin evidencia es inválido (`Hallazgo` lo rechaza). Dentro de una salida, el
    ítem inválido se DESCARTA y queda anotado en `descartes_schema[]` (formato de
    `state["descartes"]`) sin tumbar el resto de la salida.
  · `Evidencia.cita` es literal y corta (≤ 240 chars): un fragmento del documento / página /
    URL, no una paráfrasis. Una cita más larga se trunca; `evidencia` en forma de string se
    coacciona a `[{cita}]` (revisión lote 1, T4: nunca se pierde una bandera por formato).
  · Enums tolerantes (`_Base._normalizar_entrada`): "ALTA" → alta, "Media-Alta" → alta,
    "parentesco" → apellidos_familiares, "no_hallado" → sin_dato…; un valor realmente
    desconocido cae al fallback del campo y, si describe una relación, el ítem pasa a
    `no_verificable`. Todo cambio no trivial queda en `descartes_schema`; lo que perdió
    información, en `descartes_relevantes()` (el driver lo vuelca a state['descartes']).
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
import difflib
import re
import types
import typing
import unicodedata
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, PrivateAttr, ValidationError, WrapValidator, model_validator

# ── Vocabulario ─────────────────────────────────────────────────────────────


# ── Símbolos compartidos por 2+ dominios (legal/market/web/news/entity/person) ──

Estado = Literal["hallado", "sin_dato", "no_verificable"]
Severidad = Literal["alta", "media", "baja"]
SeveridadInfo = Literal["alta", "media", "baja", "info"]
Confianza = Literal["alta", "media", "baja"]

CITA_MAX = 240

# Colector de descartes de la validación en curso (lo abre el modelo raíz, lo llenan las
# listas tolerantes y lo vacía el `after` del raíz en `descartes_schema`).
_COLECTOR: contextvars.ContextVar[list | None] = contextvars.ContextVar("schemas_descartes", default=None)


def _anotar(donde: str, motivo: str, detalle: str) -> None:
    col = _COLECTOR.get()
    if col is not None:
        col.append({"donde": donde, "motivo": motivo, "detalle": detalle[:300]})


# ── Normalización tolerante (revisión lote 1, T4) ───────────────────────────
# Los modelos escribían `severidad: "ALTA"`, `evidencia: "texto"`, `tipo_vinculo: "parentesco"`,
# `cita` de 300 chars o `monto: "S/ 120,000.00"` y el validador descartaba la bandera ENTERA
# (10 informes: 2-3 banderas legales por contrato, cruces de red, hallazgos web). Aquí cada
# valor se normaliza ANTES del Literal/constraint: minúsculas sin tildes, sinónimos, valor más
# cercano (difflib) o fallback declarado; strings se truncan al `max_length`; montos texto →
# float; `evidencia` string → [{cita}]. Lo que cambió de forma NO trivial queda anotado en
# `descartes_schema` (motivo `enum_normalizado` / `texto_truncado` / `enum_fallback`).

def _norm_token(s) -> str:
    """'Media-Alta ' → 'media_alta'; 'Sin Vínculo' → 'sin_vinculo'."""
    t = unicodedata.normalize("NFKD", str(s or ""))
    t = "".join(ch for ch in t if not unicodedata.combining(ch)).strip().lower()
    t = re.sub(r"[^a-z0-9]+", "_", t).strip("_")
    return re.sub(r"_+", "_", t)


# token normalizado → candidatos canónicos en orden de prioridad (se usa el primero que
# pertenezca al vocabulario del campo). Cubre severidad/confianza, estado, categorías y los
# tipos de vínculo que los modelos escriben libremente.
_SINONIMOS: dict[str, tuple[str, ...]] = {
    # severidad / confianza
    "alto": ("alta",), "high": ("alta",), "critica": ("alta",), "critico": ("alta",), "grave": ("alta",),
    "muy_alta": ("alta",), "muy_alto": ("alta",), "media_alta": ("alta",), "medio_alto": ("alta",),
    "severa": ("alta",), "elevada": ("alta",), "elevado": ("alta",), "mayor": ("alta",),
    "medio": ("media",), "medium": ("media",), "moderada": ("media",), "moderado": ("media",),
    "media_baja": ("media",), "medio_bajo": ("media",), "intermedia": ("media",), "intermedio": ("media",),
    "bajo": ("baja",), "low": ("baja",), "leve": ("baja",), "menor": ("baja",), "minima": ("baja",),
    "informativa": ("info", "baja"), "informativo": ("info", "baja"), "neutral": ("info", "menciones_sin_riesgo", "baja"),
    "neutra": ("info", "baja"), "none": ("info", "ninguna", "sin_vinculo", "sin_relacion"),
    # estado (Hallazgo / HallazgoFuente)
    "completado": ("hallado",), "completo": ("hallado",), "exito": ("hallado",), "exitoso": ("hallado",),
    "done": ("hallado",), "encontrado": ("hallado", "alerta"), "con_hallazgos": ("hallado", "alerta"),
    "hallazgo": ("hallado", "alerta"), "verificado": ("hallado", "ok"), "confirmado": ("hallado", "ok"),
    "ok": ("hallado",), "success": ("hallado", "ok"), "positivo": ("hallado", "alerta"),
    "sin_datos": ("sin_dato", "sin_menciones"), "sin_informacion": ("sin_dato", "sin_menciones"),
    "sin_info": ("sin_dato", "sin_menciones"), "vacio": ("sin_dato", "sin_menciones"),
    "no_aplica": ("sin_dato", "sin_menciones"), "sin_menciones": ("sin_dato",), "sin_resultados": ("sin_dato", "sin_menciones"),
    "no_hallado": ("sin_dato", "sin_menciones"), "no_encontrado": ("sin_dato", "sin_menciones"),
    "sin_hallazgos": ("sin_dato", "sin_menciones"), "negativo": ("sin_dato", "sin_menciones"),
    "no_hallazgo": ("sin_dato", "sin_menciones"), "sin_evidencia": ("sin_dato", "sin_menciones"),
    "no_disponible": ("sin_dato", "sin_menciones"), "no_aplicable": ("sin_dato", "sin_menciones"),
    "n_a": ("sin_dato", "sin_menciones"), "na": ("sin_dato", "sin_menciones"), "null": ("sin_dato", "sin_menciones"),
    "info": ("baja",), "informacion": ("info", "baja"),
    "no_verificado": ("no_verificable",), "sin_verificar": ("no_verificable",), "pendiente": ("no_verificable",),
    "no_confirmado": ("no_verificable",), "dudoso": ("no_verificable",), "parcial": ("no_verificable",),
    "fallo": ("error",), "fallido": ("error",), "timeout": ("error",), "bloqueado": ("error",),
    # categoria (HallazgoFuente): fuente → familia
    "sunat": ("empresas",), "rnp": ("empresas",), "registro": ("empresas",), "registros": ("empresas",),
    "registro_publico": ("empresas",), "registros_publicos": ("empresas",), "sunarp": ("empresas",),
    "empresa": ("empresas",), "directorio": ("empresas",), "directorios": ("empresas",), "personas_clave": ("empresas",),
    "osce": ("sanciones",), "oece": ("sanciones",), "tribunal": ("sanciones",), "sancion": ("sanciones", "sancion"),
    "inhabilitacion": ("sanciones", "sancion"), "inhabilitaciones": ("sanciones",), "multa": ("sanciones", "sancion"),
    "contraloria": ("sanciones", "contraloria"), "oefa": ("sanciones",),
    "judicial": ("justicia", "investigacion"), "poder_judicial": ("justicia",), "fiscalia": ("justicia", "investigacion"),
    "expediente": ("justicia",), "expedientes": ("justicia",), "expediente_judicial": ("justicia",),
    "medios": ("prensa",), "noticias": ("prensa", "prensa_general"), "noticia": ("prensa", "prensa_general"),
    "prensa_investigacion": ("prensa",), "prensa_de_investigacion": ("prensa",), "periodismo": ("prensa",),
    "onpe": ("politica",), "jne": ("politica",), "aportes": ("politica",), "aporte": ("politica",),
    "partidos": ("politica",), "partido": ("politica", "mismo_partido"), "politico": ("politica",), "politicos": ("politica",),
    "electoral": ("politica",), "electorales": ("politica",), "infogob": ("politica",),
    "claridad": ("politica",), "funcion_publica": ("funcionarios", "politica"),
    "seace": ("contratos",), "contrataciones": ("contratos",), "contrato": ("contratos",),
    "historial": ("contratos",), "historial_contractual": ("contratos",), "contratos_estado": ("contratos",),
    "licitaciones": ("contratos",), "adjudicaciones": ("contratos",), "buena_pro": ("contratos",),
    "designaciones": ("funcionarios",), "funcionario": ("funcionarios",), "organigrama": ("funcionarios",),
    "obra": ("obras",), "infobras": ("obras",),
    # categoria (Noticia)
    "colusion": ("corrupcion",), "soborno": ("corrupcion",), "lavado": ("corrupcion",), "cohecho": ("corrupcion",),
    "peculado": ("corrupcion",), "anticorrupcion": ("corrupcion", "investigacion"),
    "investigacion_fiscal": ("investigacion",), "carpeta_fiscal": ("investigacion",), "fiscal": ("investigacion",),
    "sanciones": ("sancion",), "denuncias": ("denuncia",), "oci": ("contraloria",), "auditoria": ("contraloria",),
    "proyecto": ("proyecto_publico",), "inauguracion": ("proyecto_publico",), "gestion": ("proyecto_publico", "prensa_general"),
    "sin_riesgo": ("menciones_sin_riesgo",), "mencion": ("menciones_sin_riesgo",), "menciones": ("menciones_sin_riesgo",),
    "general": ("prensa_general",), "otro": ("prensa_general", "otro"), "otros": ("prensa_general", "otro"),
    # tipo_mencion / tipo_cargo / plataforma / moneda
    "directo": ("directa",), "indirecto": ("indirecta",),
    "designado": ("confianza_designado",), "confianza": ("confianza_designado",), "designada": ("confianza_designado",),
    "electa": ("electo",), "eleccion": ("electo",), "elegido": ("electo",),
    "twitter": ("x",), "fb": ("facebook",), "ig": ("instagram",), "tiktok": ("otra",), "youtube": ("otra",),
    "soles": ("PEN",), "s": ("PEN",), "pen": ("PEN",), "sol": ("PEN",), "dolares": ("USD",), "usd": ("USD",), "us": ("USD",),
    # tipo_vinculo (LazoPostores)
    "parentesco": ("apellidos_familiares", "parentesco_documentado", "familiar"),
    "familiar": ("apellidos_familiares", "familiar", "parentesco_documentado"),
    "familiares": ("apellidos_familiares", "familiar"), "vinculo_familiar": ("apellidos_familiares", "familiar"),
    "lazo_familiar": ("apellidos_familiares", "familiar"), "posible_parentesco": ("apellidos_familiares", "apellido_compartido"),
    "apellido_compartido": ("apellidos_familiares",), "apellidos_compartidos": ("apellidos_familiares", "apellido_compartido"),
    "apellidos_coincidentes": ("apellidos_familiares", "apellido_compartido"), "mismo_apellido": ("apellidos_familiares", "apellido_compartido"),
    "coincidencia_apellidos": ("apellidos_familiares", "apellido_compartido"), "coincidencia_de_apellidos": ("apellidos_familiares", "apellido_compartido"),
    "apellido": ("apellidos_familiares", "apellido_compartido"),
    "socios_comunes": ("mismo_titular", "codireccion_empresa"), "socio_comun": ("mismo_titular", "codireccion_empresa"),
    "mismo_socio": ("mismo_titular", "codireccion_empresa"), "socios_compartidos": ("mismo_titular", "codireccion_empresa"),
    "mismo_representante": ("mismo_titular", "codireccion_empresa"), "representante_comun": ("mismo_titular", "codireccion_empresa"),
    "mismo_gerente": ("mismo_titular", "codireccion_empresa"), "misma_persona": ("mismo_titular",),
    "mismo_propietario": ("mismo_titular",), "mismo_dueno": ("mismo_titular",), "titular_comun": ("mismo_titular",),
    "titular": ("mismo_titular",), "representante": ("mismo_titular", "codireccion_empresa"),
    "societario": ("mismo_titular", "codireccion_empresa", "socio_empresarial"),
    "societaria": ("mismo_titular", "codireccion_empresa", "socio_empresarial"),
    "accionista": ("mismo_titular", "codireccion_empresa"), "cargo": ("cargo_publico_compartido",),
    "mismo_domicilio": ("misma_direccion",), "domicilio_compartido": ("misma_direccion",), "domicilio": ("misma_direccion",),
    "misma_direccion_fiscal": ("misma_direccion",), "direccion_compartida": ("misma_direccion",), "direccion": ("misma_direccion",),
    "co_postulacion": ("co_postulan_otros_procesos",), "copostulan": ("co_postulan_otros_procesos",),
    "co_ocurrencia": ("co_postulan_otros_procesos",), "coocurrencia": ("co_postulan_otros_procesos",),
    "postulan_juntos": ("co_postulan_otros_procesos",), "otros_procesos": ("co_postulan_otros_procesos",),
    "ninguno": ("sin_vinculo", "sin_relacion", "ninguna"), "ninguna": ("sin_vinculo", "sin_relacion"),
    "sin_relacion": ("sin_vinculo",), "sin_vinculo": ("sin_relacion",), "no_vinculo": ("sin_vinculo", "sin_relacion"),
    "sin_hallazgo": ("sin_relacion", "sin_vinculo"),
    # tipo_relacion (CruceFirmante)
    "pariente": ("parentesco_documentado",), "parentesco_directo": ("parentesco_documentado",),
    "posible_familiar": ("apellido_compartido", "posible_familiar"),
    "mismo_partido": ("partido_politico_compartido",), "militancia": ("partido_politico_compartido",),
    "partido_politico": ("partido_politico_compartido",),
    "misma_empresa": ("codireccion_empresa",), "socios": ("codireccion_empresa", "socio_empresarial"),
    "socio": ("codireccion_empresa", "socio_empresarial"), "codirector": ("codireccion_empresa",),
    "co_direccion": ("codireccion_empresa",), "empresa_compartida": ("codireccion_empresa",),
    "cargo_publico": ("cargo_publico_compartido", "funcionario"), "ex_funcionario": ("cargo_publico_compartido", "funcionario"),
    "misma_entidad": ("cargo_publico_compartido",), "redes_sociales": ("red_social_compartida", "misma_red_social"),
    "red_social": ("red_social_compartida", "misma_red_social"), "amistad": ("red_social_compartida", "misma_red_social"),
    # vinculo_con_gerente (VinculoAutoridad)
    "empresarial": ("socio_empresarial",), "negocio": ("socio_empresarial",), "negocios": ("socio_empresarial",),
    "redes": ("misma_red_social",),
    # actividad_publica (Familiar)
    "servidor_publico": ("funcionario",), "funcionaria": ("funcionario",), "autoridad": ("funcionario",),
    "alcalde": ("funcionario", "electo"), "alcaldesa": ("funcionario", "electo"), "regidor": ("funcionario", "electo"),
    "regidora": ("funcionario", "electo"), "gobernador": ("funcionario", "electo"), "consejero": ("funcionario", "electo"),
    "congresista": ("funcionario", "electo"), "gerente_municipal": ("funcionario", "confianza_designado"),
    "candidata": ("candidato",), "postulante": ("candidato",),
    "empresario": ("empresario_contratista",), "empresaria": ("empresario_contratista",),
    "contratista": ("empresario_contratista",), "proveedor": ("empresario_contratista",),
    "proveedor_del_estado": ("empresario_contratista",), "militante": ("fundador_partido",),
    "dirigente_partidario": ("fundador_partido",), "fundador": ("fundador_partido",), "fundadora": ("fundador_partido",),
    "sin_actividad": ("ninguna",), "no": ("ninguna",), "desconocida": ("ninguna",), "no_identificada": ("ninguna",),
    # parentesco (Familiar)
    "esposa": ("conyuge",), "esposo": ("conyuge",), "pareja": ("conyuge",), "conyugue": ("conyuge",),
    "conviviente": ("conyuge",), "hijo": ("hijo_a",), "hija": ("hijo_a",), "padre": ("padre_madre",),
    "madre": ("padre_madre",), "hermano": ("hermano_a",), "hermana": ("hermano_a",),
    "primo": ("otro_familiar",), "prima": ("otro_familiar",), "tio": ("otro_familiar",), "tia": ("otro_familiar",),
    "sobrino": ("otro_familiar",), "sobrina": ("otro_familiar",), "cunado": ("otro_familiar",), "cunada": ("otro_familiar",),
    "suegro": ("otro_familiar",), "suegra": ("otro_familiar",), "yerno": ("otro_familiar",), "nuera": ("otro_familiar",),
    "posible": ("posible_familiar",), "probable": ("posible_familiar",),
    # vector legal
    "marca": ("marca_unica",), "marca_exclusiva": ("marca_unica",), "certificacion": ("certificacion_atipica",),
    "certificaciones": ("certificacion_atipica",), "plazo": ("plazo_imposible", "plazo_irreal"),
    "plazo_corto": ("plazo_imposible", "plazo_irreal"), "experiencia": ("experiencia_desproporcionada", "experiencia_excesiva"),
    "specs": ("specs_convergentes",), "especificaciones": ("specs_convergentes",),
    "especificaciones_convergentes": ("specs_convergentes",), "ficha_tecnica": ("specs_convergentes",),
    "personal_clave": ("personal_clave_sobreexigido",), "subcontratacion": ("subcontratacion_prohibida",),
    "penalidad": ("penalidad_atipica", "penalidades"), "adicional": ("adicional_sin_autorizacion",),
    "adicionales": ("adicional_sin_autorizacion",), "ampliacion": ("ampliaciones_reiteradas",),
    "ampliaciones": ("ampliaciones_reiteradas",), "causal": ("causal_incongruente",),
    "acto_resolutivo": ("sin_acto_resolutivo",), "publicacion": ("publicacion_tardia",),
    "requisitos_restrictivos": ("otro",), "requisito_restrictivo": ("otro",), "restriccion": ("otro",),
}

# Fallbacks genéricos (primero que exista en el vocabulario del campo) cuando ni el valor,
# ni sus sinónimos, ni el más cercano encajan. `estado` → no_verificable; vínculos → sin_*.
_FALLBACKS_GENERICOS = ("no_verificable", "sin_dato", "sin_vinculo", "sin_relacion", "ninguna",
                        "otro", "otra", "prensa_general", "sin_menciones", "prensa", "info", "media")

# Campos de relación: si el valor era desconocido y se cayó al fallback, el ítem no puede
# seguir como `hallado` (describe una relación que no supimos clasificar) → `no_verificable`.
_DEGRADAR_SI_FALLBACK = frozenset({"tipo_vinculo", "tipo_relacion", "vinculo_con_gerente",
                                   "parentesco", "actividad_publica"})

_NUM_RE = re.compile(r"-?\d[\d.,]*")


def _parse_num(v):
    """'S/ 120,000.00' → 120000.0; '1.234,56' → 1234.56; '12,500' → 12500.0; '2018' → 2018.0.
    Devuelve None si no hay número."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = _NUM_RE.search(str(v or ""))
    if not m:
        return None
    s = m.group(0)
    try:
        if "," in s and "." in s:
            s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
        elif "," in s:
            tail = s.rsplit(",", 1)[1]
            s = s.replace(",", "") if len(tail) == 3 else s.replace(",", ".")
        elif s.count(".") > 1:           # 1.234.567 → miles europeo
            s = s.replace(".", "")
        return float(s)
    except ValueError:
        return None


def _digitos(v, n: int) -> str | None:
    """Extrae un identificador de `n` dígitos ('RUC 20123456789' → '20123456789'); None si no hay
    exactamente uno."""
    if v is None:
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(int(v))
    found = re.findall(rf"(?<!\d)\d{{{n}}}(?!\d)", str(v))
    return found[0] if len(found) == 1 else None


def _literal_values(annotation) -> tuple | None:
    """Valores de un `Literal[...]` (también dentro de `X | None`); None si no es enum."""
    origin = typing.get_origin(annotation)
    if origin is Literal:
        return tuple(typing.get_args(annotation))
    if origin in (typing.Union, types.UnionType):
        for a in typing.get_args(annotation):
            vals = _literal_values(a)
            if vals:
                return vals
    return None


def _tipo_base(annotation):
    """float / int / str si la anotación es ese tipo (o `tipo | None`); si no, None."""
    origin = typing.get_origin(annotation)
    if origin in (typing.Union, types.UnionType):
        for a in typing.get_args(annotation):
            if a is not type(None):
                return _tipo_base(a)
        return None
    if annotation in (float, int, str):
        return annotation
    return None


_SPEC_CACHE: dict[type, dict] = {}


def _spec_campos(cls) -> dict:
    """Por clase: {campo: {"enum": (valores, {token: valor}), "default", "requerido", "max_len",
    "num": float|int, "patron_digitos": 8|11}} — solo lo que hace falta para normalizar."""
    spec = _SPEC_CACHE.get(cls)
    if spec is not None:
        return spec
    spec = {}
    for nombre, f in cls.model_fields.items():
        entry: dict = {}
        vals = _literal_values(f.annotation)
        if vals and all(isinstance(x, str) for x in vals):
            entry["enum"] = (vals, {_norm_token(x): x for x in vals})
            entry["default"] = f.default if isinstance(f.default, str) else None
            entry["requerido"] = f.is_required()
        for m in f.metadata:
            ml = getattr(m, "max_length", None)
            if isinstance(ml, int):
                entry["max_len"] = ml
            pat = getattr(m, "pattern", None)
            if isinstance(pat, str):
                mm = re.fullmatch(r"\^\\d\{(\d+)\}\$", pat)
                if mm:
                    entry["patron_digitos"] = int(mm.group(1))
        tb = _tipo_base(f.annotation)
        if tb in (float, int):
            entry["num"] = tb
        if entry:
            spec[nombre] = entry
    _SPEC_CACHE[cls] = spec
    return spec


def _normalizar_enum(valor, vals: tuple, canon: dict) -> tuple[str | None, str]:
    """Devuelve (valor canónico | None, cómo): 'exacto' | 'casefold' | 'sinonimo' | 'contiene'
    | 'cercano' | 'ninguno'."""
    if valor in vals:
        return valor, "exacto"
    tok = _norm_token(valor)
    if not tok:
        return None, "ninguno"
    if tok in canon:
        return canon[tok], "casefold"
    for cand in _SINONIMOS.get(tok, ()):
        if cand in vals:
            return cand, "sinonimo"
    # negaciones sobre un vocabulario de estado: 'no_se_hallo', 'sin_coincidencias' → sin_dato
    if tok.startswith(("no_", "sin_", "ningun")):
        for cand in ("sin_dato", "sin_menciones", "sin_relacion", "sin_vinculo", "ninguna"):
            if cand in vals:
                return cand, "sinonimo"
    # contención: 'sanciones_osce' ⊃ 'sanciones'; 'prensa_de_investigacion' ⊃ 'prensa'
    for ctok, cval in sorted(canon.items(), key=lambda kv: -len(kv[0])):
        if len(ctok) >= 4 and (ctok in tok or (len(tok) >= 4 and tok in ctok)):
            return cval, "contiene"
    # por partes: 'vinculo_familiar_directo' → parte 'familiar' con sinónimo
    for parte in tok.split("_"):
        for cand in _SINONIMOS.get(parte, ()):
            if cand in vals:
                return cand, "sinonimo"
    cerca = difflib.get_close_matches(tok, list(canon), n=1, cutoff=0.75)
    if cerca:
        return canon[cerca[0]], "cercano"
    return None, "ninguno"


def _fallback_enum(entry: dict) -> str | None:
    vals = entry["enum"][0]
    if entry.get("default") in vals:
        return entry["default"]
    for fb in _FALLBACKS_GENERICOS:
        if fb in vals:
            return fb
    return None


def _normalizar_dict(cls, data: dict) -> dict:
    """Aplica la normalización tolerante a un dict de entrada de `cls` (sin mutar el original)."""
    spec = _spec_campos(cls)
    if not spec:
        return data
    out = dict(data)
    nombre_cls = cls.__name__
    for campo, entry in spec.items():
        if campo not in out:
            continue
        v = out[campo]
        if v is None:
            continue
        if "enum" in entry:
            if not isinstance(v, str):
                v = str(v)
            vals, canon = entry["enum"]
            nuevo, como = _normalizar_enum(v, vals, canon)
            if como in ("exacto", "casefold"):
                out[campo] = nuevo
                continue
            # Otros campos del mismo objeto pueden decir más que el valor libre (p. ej. la
            # `fuente` 'JNE' fija `categoria: politica` aunque el modelo escribió 'registro').
            inferido = cls._inferir_enum(campo, out)
            if inferido in vals:
                out[campo] = inferido
                _anotar(f"{nombre_cls}.{campo}", "enum_normalizado", f"'{v}' → '{inferido}' (inferido)")
            elif nuevo is not None:
                out[campo] = nuevo
                _anotar(f"{nombre_cls}.{campo}", "enum_normalizado", f"'{v}' → '{nuevo}' ({como})")
            else:
                fb = _fallback_enum(entry)
                motivo = "estado_normalizado" if campo == "estado" else "enum_fallback"
                if fb is None and not entry.get("requerido"):
                    out[campo] = None
                    _anotar(f"{nombre_cls}.{campo}", motivo, f"'{v}' desconocido → null")
                elif fb is not None:
                    out[campo] = fb
                    _anotar(f"{nombre_cls}.{campo}", motivo, f"'{v}' desconocido → '{fb}'")
                    if campo in _DEGRADAR_SI_FALLBACK and "estado" in cls.model_fields \
                            and _norm_token(out.get("estado")) not in ("sin_dato",):
                        out["estado"] = "no_verificable"
                        _anotar(f"{nombre_cls}.estado", "estado_degradado",
                                f"{campo} '{v}' no clasificable → estado no_verificable")
                # fb None y requerido: se deja el valor (el ítem fallará y quedará anotado)
            continue
        if "patron_digitos" in entry:
            d = _digitos(v, entry["patron_digitos"])
            if d != v:
                out[campo] = d
                if d is None:
                    _anotar(f"{nombre_cls}.{campo}", "identificador_invalido", f"'{str(v)[:40]}' → null")
            continue
        if "num" in entry and isinstance(v, str):
            n = _parse_num(v)
            if n is None:
                out[campo] = None
                _anotar(f"{nombre_cls}.{campo}", "numero_invalido", f"'{v[:40]}' → null")
            else:
                out[campo] = int(n) if entry["num"] is int and float(n).is_integer() else n
            continue
        if "max_len" in entry and isinstance(v, str) and len(v) > entry["max_len"]:
            ml = entry["max_len"]
            out[campo] = v[:ml].rstrip()
            _anotar(f"{nombre_cls}.{campo}", "texto_truncado", f"{len(v)} → {ml} chars")
    return out


def _lista_tolerante(v, handler, info):
    """WrapValidator para `list[Modelo]`: valida ítem por ítem; el inválido se descarta y se
    anota en el colector (si hay). Así una bandera sin evidencia no tumba toda la salida."""
    if isinstance(v, dict):          # un solo objeto en vez de lista
        v = [v]
    elif isinstance(v, str):         # "ninguno" / "" en vez de lista
        if v.strip():
            _anotar(f"schema.{info.field_name}", "lista_como_texto", v[:120])
        v = []
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
    """Base común: ignora claves desconocidas (los modelos a veces agregan campos) y normaliza
    ANTES de validar: enums a su vocabulario (minúsculas, sin tildes, sinónimos, más cercano,
    fallback), strings al `max_length`, montos texto → número, RUC/DNI → solo dígitos."""

    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    @model_validator(mode="before")
    @classmethod
    def _normalizar_entrada(cls, data):
        if isinstance(data, dict):
            return _normalizar_dict(cls, data)
        return data

    @classmethod
    def _inferir_enum(cls, campo: str, data: dict) -> str | None:
        """Gancho: valor de enum inferido de OTROS campos cuando el emitido es desconocido
        (p. ej. `categoria` desde `fuente`). Por defecto, nada."""
        return None


ESTADOS_OK = frozenset({"hallado", "sin_dato", "no_verificable"})


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
            if isinstance(data, dict) and data.get("descartes_schema"):
                data = {**data, "descartes_schema": []}     # lo escribe el código, nunca el modelo
            obj = handler(data)
            col = _COLECTOR.get() or []
            obj.descartes_schema = [f"{d['donde']}: {d['motivo']} {d['detalle']}".strip() for d in col]
            obj._descartes = col
            return obj
        finally:
            _COLECTOR.reset(token)

    def descartes(self) -> list[dict]:
        """Descartes en el formato de `state["descartes"]` ({donde, motivo, detalle})."""
        return list(self._descartes)

    def descartes_relevantes(self) -> list[dict]:
        """Solo lo que PERDIÓ información (ítems/bloques descartados, raíz degradada, estado o
        vínculo no clasificable); las normalizaciones cosméticas quedan en `descartes_schema`."""
        return [d for d in self._descartes if d.get("motivo") in _MOTIVOS_RELEVANTES]


_MOTIVOS_RELEVANTES = frozenset({"item_invalido", "bloque_invalido", "raiz_sin_evidencia",
                                 "estado_normalizado", "estado_degradado", "enum_fallback",
                                 "lista_como_texto", "evidencia_descartada"})


# ── Evidencia y hallazgo ────────────────────────────────────────────────────
_URL_LIKE_RE = re.compile(r"^https?://\S+$", re.I)
_CITA_ALIAS = ("cita", "texto", "fragmento", "snippet", "quote", "extracto", "cita_literal",
               "texto_literal", "descripcion", "detalle", "mensaje", "titulo")


def _coaccionar_evidencia_item(item) -> dict | None:
    """string / dict laxo → dict de Evidencia (o None si no hay nada citable)."""
    if isinstance(item, str):
        s = item.strip()
        if not s:
            return None
        if _URL_LIKE_RE.match(s):
            return {"url": s, "cita": s[:CITA_MAX]}
        return {"cita": s[:CITA_MAX]}
    if not isinstance(item, dict):
        return None
    d = dict(item)
    cita = d.get("cita")
    if not (isinstance(cita, str) and cita.strip()):
        for k in _CITA_ALIAS[1:]:
            if isinstance(d.get(k), str) and d[k].strip():
                cita = d[k]
                break
        else:
            cita = None
    if not cita:
        url = d.get("url") or d.get("fuente_url") or d.get("fuente")
        doc = d.get("documento") or d.get("documento_sha256")
        if isinstance(url, str) and url.strip():
            cita = url.strip()
        elif isinstance(doc, str) and doc.strip():
            pg = d.get("pagina")
            cita = f"documento {doc.strip()[:16]}" + (f" p.{pg}" if pg else "")
        else:
            return None
    d["cita"] = str(cita).strip()
    if "url" not in d and isinstance(d.get("fuente_url"), str):
        d["url"] = d["fuente_url"]
    if "documento" not in d and isinstance(d.get("documento_sha256"), str):
        d["documento"] = d["documento_sha256"]
    return d


def coaccionar_evidencia(v) -> list:
    """`evidencia` en cualquiera de las formas que emiten los modelos → lista de dicts válidos.
    'texto' → [{cita}]; 'https://…' → [{url, cita}]; [str | dict] mezclados; dict suelto."""
    if v is None:
        return []
    if isinstance(v, (str, dict)):
        v = [v]
    if not isinstance(v, list):
        return []
    out = []
    for it in v:
        d = _coaccionar_evidencia_item(it)
        if d is not None:
            out.append(d)
        elif it not in (None, "", {}):
            _anotar("Evidencia", "evidencia_descartada", f"sin cita ni fuente: {str(it)[:80]}")
    return out


class Evidencia(_Base):
    """Una pieza de respaldo. Al menos uno de `documento` o `url` debería estar presente; la
    `cita` es texto LITERAL (≤ 240 chars) tomado de esa fuente. Una cita más larga se TRUNCA
    (no se descarta la bandera); `pagina` acepta '12', 'p. 12' o 12 (0/negativo → null)."""

    documento: str | None = Field(default=None, description="sha256 o nombre del documento fuente (si aplica).")
    url: str | None = Field(default=None, description="URL de la fuente (solo si se obtuvo de una tool/grounding, nunca inventada).")
    pagina: int | None = Field(default=None, ge=1, description="Página del documento donde está la cita.")
    cita: str = Field(..., min_length=1, max_length=CITA_MAX, description="Fragmento literal de la fuente (≤ 240 chars).")

    @model_validator(mode="before")
    @classmethod
    def _laxa(cls, data):
        if isinstance(data, str):
            data = _coaccionar_evidencia_item(data) or data
        if not isinstance(data, dict):
            return data
        d = _coaccionar_evidencia_item(data) or dict(data)
        pg = d.get("pagina")
        if isinstance(pg, str):
            m = re.search(r"\d+", pg)
            pg = int(m.group(0)) if m else None
        elif isinstance(pg, float):
            pg = int(pg)
        if isinstance(pg, int) and pg < 1:
            pg = None
        d["pagina"] = pg
        cita = d.get("cita")
        if isinstance(cita, str) and len(cita) > CITA_MAX:
            _anotar("Evidencia.cita", "cita_truncada", f"{len(cita)} → {CITA_MAX} chars")
            d["cita"] = cita[:CITA_MAX].rstrip()
        return d


class Hallazgo(_Base):
    """Cualquier afirmación con juicio: exige `estado`; si es `hallado`, exige evidencia
    (propia o derivada de sus partes vía `_derivar_evidencia`). `evidencia` acepta string,
    dict o lista mixta (se coacciona); `estado` ausente se infiere de la evidencia."""

    estado: Estado = Field(..., description="hallado | sin_dato | no_verificable")
    evidencia: list[Evidencia] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _evidencia_laxa(cls, data):
        if not isinstance(data, dict):
            return data
        d = dict(data)
        ev = coaccionar_evidencia(d.get("evidencia"))
        if not ev and isinstance(d.get("evidencia_textual"), str):
            ev = coaccionar_evidencia(d["evidencia_textual"])
        d["evidencia"] = ev
        if d.get("estado") in (None, ""):
            d["estado"] = "hallado" if ev else "no_verificable"
        return d

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


class NotaPrensa(Hallazgo):
    medio: str = Field(..., min_length=1, max_length=120)
    fecha: str | None = Field(default=None, max_length=20)
    titulo: str = Field(..., min_length=1, max_length=300)
    url: str | None = None
    resumen: str | None = Field(default=None, max_length=600)
    severidad: SeveridadInfo = "info"


_TITULO_ALIAS = ("titulo", "title", "regla", "nombre", "tipo", "bandera", "titulo_bandera", "senal", "señal")
_DESCRIPCION_ALIAS = ("descripcion", "description", "detalle", "resumen", "justificacion", "texto",
                      "motivo", "explicacion", "mensaje", "observacion")


def _alias_bandera(data):
    """Los modelos llaman `regla`/`nombre` al título y `detalle`/`resumen`/`justificacion` a la
    descripción: se aceptan como alias en vez de descartar la bandera."""
    if not isinstance(data, dict):
        return data
    d = dict(data)
    if not (isinstance(d.get("titulo"), str) and d["titulo"].strip()):
        for k in _TITULO_ALIAS[1:]:
            if isinstance(d.get(k), str) and d[k].strip():
                d["titulo"] = d[k]
                break
    if not (isinstance(d.get("descripcion"), str) and d["descripcion"].strip()):
        for k in _DESCRIPCION_ALIAS[1:]:
            if isinstance(d.get(k), str) and d[k].strip():
                d["descripcion"] = d[k]
                break
        else:
            if isinstance(d.get("titulo"), str) and d["titulo"].strip():
                d["descripcion"] = d["titulo"]
    if not (isinstance(d.get("titulo"), str) and d["titulo"].strip()) and isinstance(d.get("descripcion"), str):
        d["titulo"] = d["descripcion"][:160]
    return d


class _BanderaBase(Hallazgo):
    """Bandera sugerida por un agente de investigación (web / prensa / red)."""

    @model_validator(mode="before")
    @classmethod
    def _alias(cls, data):
        return _alias_bandera(data)


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
