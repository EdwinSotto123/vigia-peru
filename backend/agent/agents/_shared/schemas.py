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
    "Evidencia", "Hallazgo", "coaccionar_evidencia",
    "LegalOutput", "RedFlagDocumental", "OpinionOECE", "CumplimientoPrincipios", "CausalDirectaEval",
    "MarketOutput", "MarketFinding", "PrecioObservado", "ProveedorPotencial",
    "WebResearchOutput", "EmpresaPerfil", "HallazgoFuente", "ContratoEstado", "BanderaSugerida", "NotaPrensa",
    "NewsOutput", "Noticia", "BanderaPrensa", "ConteoSeveridad",
    "EntityPersonnelOutput", "FuncionarioDesignado",
    "PersonNetworkOutput", "PersonaPrincipal", "Familiar", "CruceFirmante", "VinculoAutoridad", "LazoPostores", "BanderaRed",
    "validar_o_descartar", "OUTPUT_SCHEMAS",
]
