"""Schema de extracción (Gemini structured output): base + bloque del perfil
(servicio/obra/sustento_directa) + evidencia por dato."""

from tools._core import *  # noqa: F401,F403
from ._base import CITA_MAX, TEXTO_LITERAL_MAX, _BLOQUES_VALIDOS


# ═══════════════════════════════════════════════════════════════════════════════
# Parser en LOTE (WS D · plan 2026-09-15): documentos elegidos de forma determinista
# (tools/doc_select.py), OCR UNA sola vez por sha256 (tabla documentos_texto, páginas con
# marcador ⟦p.N⟧), extracción con schema base + bloque del perfil y evidencia
# {documento_sha256, pagina, cita} por ítem/firmante/postor/comité/motivo. Ningún tope es
# silencioso: cada recorte va a state['recortes'] = [{donde, limite, omitido}].
# ═══════════════════════════════════════════════════════════════════════════════


# ── Schema del parser: base + bloque del perfil ────────────────────────────────────────
def _schema_evidencia(desc: str = "") -> "gtypes.Schema":
    from google.genai import types as gtypes
    return gtypes.Schema(
        type=gtypes.Type.ARRAY,
        description=(desc or "Respaldo LITERAL de este dato en el documento: "
                     "`pagina` = número N del marcador ⟦p.N⟧ bajo el que aparece la cita (índice real de "
                     "página del archivo, NUNCA el número impreso al pie); `cita` = fragmento textual copiado "
                     f"tal cual (≤ {CITA_MAX} chars). Sin evidencia el dato NO se persiste."),
        items=gtypes.Schema(
            type=gtypes.Type.OBJECT,
            properties={
                "pagina": gtypes.Schema(type=gtypes.Type.INTEGER, nullable=True),
                "folio": gtypes.Schema(type=gtypes.Type.INTEGER, nullable=True,
                                       description="Número IMPRESO en la página (folio/pie 'Página 22 de 69'), si se ve. Distinto de `pagina`."),
                "cita": gtypes.Schema(type=gtypes.Type.STRING),
            },
            required=["cita"],
        ),
    )


def _schema_bloque(bloque: str | None) -> "gtypes.Schema | None":
    """Bloque extra del schema según `parser_bloque` del perfil (§4.2 de la auditoría)."""
    from google.genai import types as gtypes
    S, T = gtypes.Schema, gtypes.Type
    if not bloque:
        return None
    if bloque == "servicio":
        return S(type=T.OBJECT, nullable=True, description=(
            "SOLO para Términos de Referencia / Bases de un SERVICIO o CONSULTORÍA: la unidad de "
            "análisis es el entregable/actividad y la tarifa (HH, mes, visita, km), no un bien físico. "
            "Dejá null si el documento no describe un servicio."),
            properties={
                "alcance": S(type=T.STRING, nullable=True, description="Alcance del servicio, LITERAL (≤ 1500 chars)."),
                "actividades": S(type=T.ARRAY, items=S(type=T.STRING), description="Actividades/tareas exigidas, literales."),
                "entregables": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "nombre": S(type=T.STRING), "plazo_dias": S(type=T.INTEGER, nullable=True),
                    "porcentaje_pago": S(type=T.NUMBER, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["nombre"])),
                "plazo_total_dias": S(type=T.INTEGER, nullable=True),
                "personal_clave": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "cargo": S(type=T.STRING), "profesion": S(type=T.STRING, nullable=True),
                    "experiencia_min_anios": S(type=T.NUMBER, nullable=True),
                    "dedicacion": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["cargo"])),
                "experiencia_postor": S(type=T.OBJECT, nullable=True, properties={
                    "monto_facturado_min": S(type=T.NUMBER, nullable=True),
                    "n_contratos": S(type=T.INTEGER, nullable=True),
                    "rubro": S(type=T.STRING, nullable=True)}),
                "tarifas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "concepto": S(type=T.STRING), "unidad": S(type=T.STRING, nullable=True),
                    "precio_unitario": S(type=T.NUMBER, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["concepto"])),
                "penalidades": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "tipo": S(type=T.STRING), "formula": S(type=T.STRING, nullable=True),
                    "tope_pct": S(type=T.NUMBER, nullable=True)}, required=["tipo"])),
                "subcontratacion_permitida": S(type=T.BOOLEAN, nullable=True),
                "forma_pago": S(type=T.STRING, nullable=True),
                "lugar_prestacion": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia(),
            })
    if bloque == "obra":
        return S(type=T.OBJECT, nullable=True, description=(
            "SOLO para OBRAS: expediente técnico, presupuesto y ejecución (adicionales, ampliaciones, "
            "valorizaciones). Dejá null si el documento no es de una obra."),
            properties={
                "expediente_tecnico": S(type=T.OBJECT, nullable=True, properties={
                    "memoria": S(type=T.STRING, nullable=True, description="Memoria descriptiva, LITERAL (≤ 1500 chars)."),
                    "presupuesto_total": S(type=T.NUMBER, nullable=True),
                    "partidas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                        "codigo": S(type=T.STRING, nullable=True), "descripcion": S(type=T.STRING),
                        "metrado": S(type=T.NUMBER, nullable=True), "unidad": S(type=T.STRING, nullable=True),
                        "precio_unitario": S(type=T.NUMBER, nullable=True), "parcial": S(type=T.NUMBER, nullable=True),
                        "pagina": S(type=T.INTEGER, nullable=True)}, required=["descripcion"])),
                    "gastos_generales_pct": S(type=T.NUMBER, nullable=True),
                    "utilidad_pct": S(type=T.NUMBER, nullable=True),
                    "plazo_dias": S(type=T.INTEGER, nullable=True),
                    "cronograma": S(type=T.STRING, nullable=True)}),
                "residente_requisitos": S(type=T.STRING, nullable=True),
                "supervisor_requisitos": S(type=T.STRING, nullable=True),
                "garantia_fiel_cumplimiento": S(type=T.STRING, nullable=True),
                "adelantos": S(type=T.STRING, nullable=True),
                "adicionales": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "monto": S(type=T.NUMBER, nullable=True),
                    "pct_acumulado": S(type=T.NUMBER, nullable=True), "motivo": S(type=T.STRING, nullable=True),
                    "resolucion": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)})),
                "ampliaciones_plazo": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "dias": S(type=T.INTEGER, nullable=True),
                    "motivo": S(type=T.STRING, nullable=True), "resolucion": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)})),
                "valorizaciones": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "periodo": S(type=T.STRING, nullable=True),
                    "monto": S(type=T.NUMBER, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)})),
                "evidencia": _schema_evidencia(),
            })
    if bloque == "sustento_directa":
        return S(type=T.OBJECT, nullable=True, description=(
            "SOLO para contratación DIRECTA / convenio / consultoría por causal: la causal invocada y el "
            "expediente que la sustenta (informes, acto aprobatorio, cotizaciones). Dejá null si el "
            "documento no sustenta una directa ni es un convenio."),
            properties={
                "causal_articulo": S(type=T.STRING, nullable=True, description="Artículo/literal invocado, LITERAL."),
                "causal_texto": S(type=T.STRING, nullable=True, description="Fundamento textual de la causal (≤ 1500 chars)."),
                "informe_tecnico": S(type=T.OBJECT, nullable=True, properties={
                    "numero": S(type=T.STRING, nullable=True), "fecha": S(type=T.STRING, nullable=True),
                    "firmante": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)}),
                "informe_legal": S(type=T.OBJECT, nullable=True, properties={
                    "numero": S(type=T.STRING, nullable=True), "fecha": S(type=T.STRING, nullable=True),
                    "firmante": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)}),
                "acto_aprobatorio": S(type=T.OBJECT, nullable=True, properties={
                    "tipo": S(type=T.STRING, nullable=True, description="resolución de alcaldía / acuerdo de concejo / resolución ejecutiva regional / …"),
                    "numero": S(type=T.STRING, nullable=True), "fecha": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}),
                "cotizaciones": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "proveedor": S(type=T.STRING), "ruc": S(type=T.STRING, nullable=True),
                    "monto": S(type=T.NUMBER, nullable=True), "fecha": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["proveedor"])),
                "proveedor_unico_justificacion": S(type=T.STRING, nullable=True),
                "fecha_publicacion_seace": S(type=T.STRING, nullable=True),
                "convenio": S(type=T.OBJECT, nullable=True, properties={
                    "entidades_parte": S(type=T.ARRAY, items=S(type=T.STRING)),
                    "objeto": S(type=T.STRING, nullable=True), "aportes": S(type=T.STRING, nullable=True),
                    "vigencia": S(type=T.STRING, nullable=True)}),
                "evidencia": _schema_evidencia(),
            })
    raise ValueError(f"parser_bloque desconocido: {bloque!r} (válidos: {_BLOQUES_VALIDOS})")


# Gemini rechaza (400 INVALID_ARGUMENT) un response_schema demasiado grande: con los bloques de
# procedimiento de selección + ejecución contractual + ítems, el schema completo supera el límite.
# Por eso los bloques pesados entran solo cuando el documento puede contenerlos (por tipo/título).
_SECCIONES_OPCIONALES = ("procedimiento_seleccion", "ejecucion_contractual", "contrato_final", "estudio_mercado")
PARSER_SCHEMA_MAX_CHARS = int(os.getenv("PARSER_SCHEMA_MAX_CHARS", "20500"))


def secciones_para_documento(label: str | None, tipo_hint: str | None, seccion: str | None = None) -> set[str]:
    """Qué bloques opcionales del schema aplican a un documento según su título/tipo OCDS/sección."""
    t = f"{label or ''} {tipo_hint or ''} {seccion or ''}".lower()
    out: set[str] = set()
    if any(k in t for k in ("acta", "buena pro", "evaluaci", "calificaci", "cuadro", "integrada", "absoluci", "consulta",
                            "observaci", "propuesta", "oferta", "award", "tender")):
        out.add("procedimiento_seleccion")
    if any(k in t for k in ("contrato", "contract", "orden de", "adenda", "ampliaci", "penalidad", "resoluci", "garant",
                            "conformidad", "entrega")):
        out.update({"ejecucion_contractual", "contrato_final"})
    if any(k in t for k in ("estudio", "mercado", "indagaci", "informe", "sustento", "cotizaci")):
        out.add("estudio_mercado")
    return out


def _parser_schema(bloque: str | None = None, secciones: set[str] | None = None) -> "gtypes.Schema":
    """Schema de extracción: base (ítems, postores, firmantes, comité, motivos, estudio de
    mercado, contrato final) + bloque del perfil. Cada ítem/firmante/postor/comité/motivo
    lleva `evidencia: [{pagina, cita}]`; el requerimiento va LITERAL en `texto_literal`."""
    from google.genai import types as gtypes
    S, T = gtypes.Schema, gtypes.Type
    props = {
        "cuantia_total": S(type=T.NUMBER, nullable=True),
        "fuente_financiamiento": S(type=T.STRING, nullable=True),
        "modalidad": S(type=T.STRING, nullable=True),
        "tipo_documento_detectado": S(
            type=T.STRING, nullable=True,
            description=(
                "Tipo de documento OECE detectado a partir del contenido: "
                "bases_administrativas, bases_integradas, terminos_de_referencia, expediente_tecnico, "
                "resumen_ejecutivo, informe_sustento, acta_buena_pro, cuadro_evaluacion, contrato, "
                "orden_de_compra, adenda, propuesta_economica, absolucion_consultas, otro."
            ),
        ),
        "contiene_requerimiento": S(
            type=T.BOOLEAN, nullable=True,
            description=(
                "True si en este documento aparece la sección 'REQUERIMIENTO' / 'Términos de "
                "Referencia' / 'Especificaciones Técnicas' / 'Expediente técnico' con detalle técnico."
            ),
        ),
        "items": S(
            type=T.ARRAY,
            items=S(
                type=T.OBJECT,
                properties={
                    "numero": S(type=T.STRING, nullable=True,
                        description="Número del ítem como string: '1', '1.1', '2'. Sub-numeración con punto si el OCDS agrupa varios productos en un ítem."),
                    "padre_ocds_item": S(type=T.STRING, nullable=True,
                        description="Si es desglose de un ítem padre del OCDS, número del padre."),
                    "descripcion_corta": S(type=T.STRING, description="TÍTULO del ítem tal como aparece (1 línea, ≤200 chars)."),
                    "cantidad": S(type=T.NUMBER, nullable=True),
                    "unidad": S(type=T.STRING, nullable=True, description="UND, KG, M3, LITRO, SACO, MES, HH, SERVICIO, etc."),
                    "precio_unitario_referencial": S(type=T.NUMBER, nullable=True,
                        description="SOLO en bases/TDR/EETT/resumen ejecutivo/estudio de mercado: precio unitario del valor referencial. En contrato/orden/acta/propuesta va null (usá precio_unitario_contratado / precio_unitario_ofertado)."),
                    "cuantia_referencial_item": S(type=T.NUMBER, nullable=True,
                        description="Valor referencial / cuantía total del ítem (bases, resumen ejecutivo o reporte del acta)."),
                    "precio_unitario_ofertado": S(type=T.NUMBER, nullable=True,
                        description="SOLO en propuesta económica / acta / cuadro de evaluación: precio unitario ofertado por el ganador."),
                    "precio_unitario_contratado": S(type=T.NUMBER, nullable=True,
                        description="SOLO en contrato / orden de compra o servicio: precio unitario pactado."),
                    "subtotal_contratado": S(type=T.NUMBER, nullable=True,
                        description="SOLO en contrato / orden: subtotal del ítem (cantidad × precio unitario)."),
                    "marca_o_modelo_exigido": S(type=T.STRING, nullable=True,
                        description=("SOLO en bases/TDR/EETT y SOLO si el texto del requerimiento dice literalmente "
                                     "'marca', 'modelo', 'o equivalente' u 'o similar' junto a un nombre comercial: copiá el texto exacto. "
                                     "Null si el requerimiento es genérico, si solo hay códigos de parte, o si el documento es "
                                     "contrato/orden/acta/propuesta (ahí la marca va en marca_ofertada).")),
                    "marca_ofertada": S(type=T.STRING, nullable=True,
                        description="SOLO en contrato/orden/propuesta/acta: marca y modelo del producto ofertado o contratado, literal."),
                    "certificaciones_exigidas": S(type=T.ARRAY, items=S(type=T.STRING),
                        description="Normas/certificaciones exigidas, cada string LITERAL (≤80 chars)."),
                    "valores_tecnicos_clave": S(type=T.OBJECT, nullable=True,
                        description="Valores numéricos discretos del requerimiento. Solo los que aparezcan.",
                        properties={
                            "potencia_min_hp": S(type=T.NUMBER, nullable=True),
                            "potencia_min_kw": S(type=T.NUMBER, nullable=True),
                            "capacidad_volumen": S(type=T.STRING, nullable=True),
                            "capacidad_carga_ton": S(type=T.NUMBER, nullable=True),
                            "peso_operativo_ton": S(type=T.STRING, nullable=True),
                            "alcance_m": S(type=T.NUMBER, nullable=True),
                            "ano_fabricacion_min": S(type=T.INTEGER, nullable=True),
                            "estado": S(type=T.STRING, nullable=True),
                            "presentacion": S(type=T.STRING, nullable=True),
                            "color": S(type=T.STRING, nullable=True),
                            "material": S(type=T.STRING, nullable=True),
                        }),
                    "garantia": S(type=T.OBJECT, nullable=True, properties={
                        "meses": S(type=T.INTEGER, nullable=True), "horas": S(type=T.INTEGER, nullable=True),
                        "alcance": S(type=T.STRING, nullable=True)}),
                    "condiciones_entrega": S(type=T.OBJECT, nullable=True, properties={
                        "plazo_dias_calendario": S(type=T.INTEGER, nullable=True, description="Plazo de ENTREGA (no el de suministro/vigencia)."),
                        "plazo_dias_tipo": S(type=T.STRING, nullable=True, description="'habiles' o 'calendario', tal como lo diga el texto."),
                        "lugar_entrega": S(type=T.STRING, nullable=True),
                        "modalidad": S(type=T.STRING, nullable=True)}),
                    "requisitos_postor": S(type=T.OBJECT, nullable=True,
                        description="Requisitos al postor (no al bien/servicio).",
                        properties={
                            "experiencia_minima_soles": S(type=T.NUMBER, nullable=True, description="Monto facturado acumulado exigido como experiencia."),
                            "anos_experiencia_min": S(type=T.NUMBER, nullable=True,
                                description="SOLO si se exige antigüedad mínima del postor. NO la ventana estándar ('durante los 10 años anteriores') para computar la facturación."),
                            "n_contratos_similares": S(type=T.INTEGER, nullable=True,
                                description="SOLO si se exige un número mínimo de contratos. NO el tope 'máximo de 20 contrataciones'."),
                            "certificaciones_postor": S(type=T.ARRAY, items=S(type=T.STRING)),
                            "infraestructura_exigida": S(type=T.STRING, nullable=True),
                            "personal_clave": S(type=T.ARRAY, items=S(type=T.STRING)),
                        }),
                    "penalidades": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                        "causal": S(type=T.STRING), "monto_o_porcentaje": S(type=T.STRING, nullable=True),
                        "base_calculo": S(type=T.STRING, nullable=True)}, required=["causal"])),
                    "subitems": S(type=T.ARRAY,
                        description="Si el ítem es un PAQUETE/LOTE/CANASTA con N productos distintos, listalos acá.",
                        items=S(type=T.OBJECT, properties={
                            "descripcion": S(type=T.STRING), "cantidad": S(type=T.NUMBER, nullable=True),
                            "unidad": S(type=T.STRING, nullable=True), "presentacion": S(type=T.STRING, nullable=True),
                            "specs_clave": S(type=T.STRING, nullable=True)}, required=["descripcion"])),
                    "texto_literal": S(type=T.STRING, nullable=True,
                        description=(
                            f"EXTRACTO LITERAL (copiado tal cual, SIN resumir ni reescribir) del requerimiento "
                            "técnico de este ítem: especificaciones, normas, garantía, plazo, requisitos del postor. "
                            f"Copiá el requerimiento COMPLETO hasta agotar los {TEXTO_LITERAL_MAX} chars (no elijas un "
                            "fragmento corto: si hay 3 páginas de especificaciones, transcribí las 3 hasta el tope). "
                            "Si es más largo que el tope, copiá desde el inicio y declará en `texto_literal_paginas` "
                            "TODAS las páginas que abarca. Null si el documento no tiene requerimiento para este ítem."
                        )),
                    "texto_literal_paginas": S(type=T.ARRAY, items=S(type=T.INTEGER),
                        description="Páginas (N de ⟦p.N⟧) donde vive el requerimiento de este ítem."),
                    "evidencia": _schema_evidencia(),
                },
                required=["descripcion_corta"],
            ),
        ),
        "postores": S(type=T.ARRAY,
            description=("TODOS los postores/participantes que el documento nombra (reporte de propuestas, acta, "
                         "cuadro, Formato 11): con su RUC, el precio de su oferta (sección 'precio de la oferta' / "
                         "orden de prelación), si ganó, puntaje total y estado. Un postor por fila, aunque no haya ganado."),
            items=S(type=T.OBJECT, properties={
            "ruc": S(type=T.STRING, nullable=True), "razon_social": S(type=T.STRING),
            "monto_oferta": S(type=T.NUMBER, nullable=True, description="Precio ofertado por ESTE postor (número, sin separadores)."),
            "es_ganador": S(type=T.BOOLEAN, nullable=True),
            "puntaje": S(type=T.NUMBER, nullable=True, description="Puntaje total (técnico + económico) si el cuadro/acta lo trae."),
            "orden_prelacion": S(type=T.INTEGER, nullable=True),
            "estado": S(type=T.STRING, nullable=True,
                        description="admitido | no_admitido | descalificado | desierto | invitado | participante_sin_oferta — según el documento."),
            "motivo_estado": S(type=T.STRING, nullable=True, description="Razón literal de la no admisión / descalificación, si la hay."),
            "item": S(type=T.STRING, nullable=True), "evidencia": _schema_evidencia()},
            required=["razon_social"])),
        "invitados": S(type=T.ARRAY,
            description=("SOLO si el documento trae una lista de proveedores INVITADOS (Comparación de Precios: "
                         "'Formato de invitación', 'Anexo 1', informe de invitación): cada invitado con RUC y nombre."),
            items=S(type=T.OBJECT, properties={
                "ruc": S(type=T.STRING, nullable=True), "razon_social": S(type=T.STRING),
                "fecha_invitacion": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia()}, required=["razon_social"])),
        "cuantia_reservada": S(type=T.BOOLEAN, nullable=True,
            description="True si las bases dicen que el valor referencial / cuantía NO se publica (reservada, 'no se dará a conocer')."),
        "firmantes": S(type=T.ARRAY,
            description="Personas que FIRMAN el documento (actas, cuadros, contratos). Solo con DNI, entidad real o firma visible.",
            items=S(type=T.OBJECT, properties={
                "nombre_completo": S(type=T.STRING), "dni": S(type=T.STRING, nullable=True),
                "cargo": S(type=T.STRING, nullable=True),
                "rol_en_documento": S(type=T.STRING, nullable=True,
                    description="area_usuaria (firma el requerimiento/EETT en las bases), comite, oec, contratista, entidad, elaboro, aprobo, otro."),
                "entidad": S(type=T.STRING, nullable=True), "fecha_firma": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia()}, required=["nombre_completo"])),
        "comite_evaluacion": S(type=T.ARRAY,
            description="Composición del Comité de Selección si el documento lo lista (solo actas/cuadros/contratos).",
            items=S(type=T.OBJECT, properties={
                "nombre_completo": S(type=T.STRING), "cargo": S(type=T.STRING, nullable=True),
                "rol": S(type=T.STRING, nullable=True), "certificacion_sican": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia()}, required=["nombre_completo"])),
        "motivos_adjudicacion": S(type=T.ARRAY,
            description="Para cada ganador, el motivo documentado en el acta/reporte de buena pro.",
            items=S(type=T.OBJECT, properties={
                "ganador_razon_social": S(type=T.STRING), "ganador_ruc": S(type=T.STRING, nullable=True),
                "item_adjudicado": S(type=T.STRING, nullable=True), "criterio_decisivo": S(type=T.STRING, nullable=True),
                "posicion_ranking": S(type=T.INTEGER, nullable=True),
                "observaciones_evaluacion": S(type=T.STRING, nullable=True),
                "competidores_descalificados": S(type=T.ARRAY, items=S(type=T.STRING)),
                "evidencia": _schema_evidencia()}, required=["ganador_razon_social"])),
        "lugar_fecha_acta": S(type=T.OBJECT, nullable=True, properties={
            "lugar": S(type=T.STRING, nullable=True), "fecha": S(type=T.STRING, nullable=True),
            "hora": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)}),
        "fundamento_legal": S(type=T.ARRAY, items=S(type=T.STRING),
            description="Normas/artículos citados LITERALMENTE por el documento."),
        "estudio_mercado": S(type=T.OBJECT, nullable=True,
            description="SOLO si el documento es un Resumen Ejecutivo / Informe que sustenta la contratación: estudio de mercado y causal. Si no, null.",
            properties={
                "resumen": S(type=T.STRING, nullable=True),
                "valor_referencial": S(type=T.NUMBER, nullable=True),
                "moneda": S(type=T.STRING, nullable=True),
                "comparacion_precio_historico": S(type=T.STRING, nullable=True),
                "causal_articulo": S(type=T.STRING, nullable=True),
                "causal_texto": S(type=T.STRING, nullable=True),
                "proveedores_evaluados": S(type=T.ARRAY, items=S(type=T.STRING)),
                "descalificaciones": S(type=T.ARRAY, items=S(type=T.STRING)),
                "evidencia": _schema_evidencia(),
            }),
        "contrato_final": S(type=T.OBJECT, nullable=True,
            description="SOLO si el documento es la ORDEN DE COMPRA/SERVICIO o el CONTRATO firmado: condiciones finales. Si no, null.",
            properties={
                "precio_final_total": S(type=T.NUMBER, nullable=True),
                "moneda": S(type=T.STRING, nullable=True),
                "cronograma_entregas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "descripcion": S(type=T.STRING, nullable=True), "cantidad": S(type=T.NUMBER, nullable=True),
                    "plazo_dias": S(type=T.INTEGER, nullable=True), "monto": S(type=T.NUMBER, nullable=True)})),
                "penalidades": S(type=T.ARRAY, items=S(type=T.STRING)),
                "forma_pago": S(type=T.STRING, nullable=True),
                "proveedor_ruc": S(type=T.STRING, nullable=True),
                "plazo_ejecucion_dias": S(type=T.INTEGER, nullable=True),
                "fecha_suscripcion": S(type=T.STRING, nullable=True),
                "evidencia": _schema_evidencia(),
            }),
        "procedimiento_seleccion": S(type=T.OBJECT, nullable=True,
            description=("Reglas y resultado de la EVALUACIÓN: factores de evaluación con puntaje máximo (bases/integradas), "
                         "puntajes por postor y factor (acta/cuadro), consultas y observaciones absueltas (pliego) y "
                         "modificaciones introducidas al integrar las bases (bases integradas / pliego). Null si el documento no trae nada de esto."),
            properties={
                "factores_evaluacion": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "factor": S(type=T.STRING), "puntaje_max": S(type=T.NUMBER, nullable=True),
                    "criterio": S(type=T.STRING, nullable=True, description="Cómo se asigna el puntaje, literal (≤ 300 chars)."),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["factor"])),
                "puntajes_por_postor": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "ruc": S(type=T.STRING, nullable=True), "razon_social": S(type=T.STRING, nullable=True),
                    "factor": S(type=T.STRING, description="Nombre del factor, o 'total' / 'tecnico' / 'economico'."),
                    "puntaje": S(type=T.NUMBER, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)},
                    required=["factor"])),
                "consultas_observaciones": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "postor": S(type=T.STRING, nullable=True, description="Participante que consulta/observa."),
                    "tema": S(type=T.STRING, nullable=True, description="Qué pide, literal resumido (≤ 300 chars)."),
                    "absuelta": S(type=T.STRING, nullable=True, description="se_acoge | se_acoge_parcialmente | no_se_acoge | sin_dato"),
                    "cambio_en_bases": S(type=T.STRING, nullable=True, description="Qué cambió en las bases a raíz de esta consulta, literal (≤ 300 chars); null si nada."),
                    "pagina": S(type=T.INTEGER, nullable=True)})),
                "modificaciones_integracion": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "texto_original": S(type=T.STRING, nullable=True), "texto_integrado": S(type=T.STRING, nullable=True),
                    "a_pedido_de": S(type=T.STRING, nullable=True, description="Participante cuya consulta originó el cambio, si consta."),
                    "pagina": S(type=T.INTEGER, nullable=True)})),
                "evidencia": _schema_evidencia(),
            }),
        "ejecucion_contractual": S(type=T.OBJECT, nullable=True,
            description=("SOLO en documentos de EJECUCIÓN del contrato (adendas, resoluciones sobre ampliación de plazo, "
                         "penalidades, actas de entrega/conformidad, cartas): lo que pasó DESPUÉS de firmar. Null en bases/actas de buena pro/OC."),
            properties={
                "ampliaciones_plazo": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "dias_solicitados": S(type=T.INTEGER, nullable=True),
                    "solicitada_por": S(type=T.STRING, nullable=True), "fecha_solicitud": S(type=T.STRING, nullable=True),
                    "resolucion": S(type=T.STRING, nullable=True, description="Número/fecha del acto que resuelve."),
                    "resultado": S(type=T.STRING, nullable=True, description="procedente | improcedente | parcial | sin_dato"),
                    "motivo": S(type=T.STRING, nullable=True, description="Fundamento literal (≤ 300 chars)."),
                    "pagina": S(type=T.INTEGER, nullable=True)})),
                "penalidades_aplicadas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "tipo": S(type=T.STRING, description="mora | otra"), "monto": S(type=T.NUMBER, nullable=True),
                    "motivo": S(type=T.STRING, nullable=True), "documento": S(type=T.STRING, nullable=True),
                    "pagina": S(type=T.INTEGER, nullable=True)}, required=["tipo"])),
                "adendas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "tipo": S(type=T.STRING, nullable=True, description="ampliacion_plazo | adicional | reduccion | cambio_condiciones | otra"),
                    "objeto": S(type=T.STRING, nullable=True), "monto": S(type=T.NUMBER, nullable=True),
                    "fecha": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)})),
                "entregas": S(type=T.ARRAY, items=S(type=T.OBJECT, properties={
                    "n": S(type=T.INTEGER, nullable=True), "fecha_prevista": S(type=T.STRING, nullable=True),
                    "fecha_real": S(type=T.STRING, nullable=True), "cantidad": S(type=T.NUMBER, nullable=True),
                    "observacion": S(type=T.STRING, nullable=True), "pagina": S(type=T.INTEGER, nullable=True)})),
                "resolucion_contrato": S(type=T.STRING, nullable=True, description="Si el contrato se resolvió: causal y fecha, literal."),
                "evidencia": _schema_evidencia(),
            }),
        "resumen": S(type=T.STRING, nullable=True, description="3-4 líneas describiendo el documento REAL."),
    }
    if bloque:
        props[bloque] = _schema_bloque(bloque)
    if secciones is not None:
        for k in _SECCIONES_OPCIONALES:
            if k not in secciones:
                props.pop(k, None)
    # Presupuesto de tamaño (medido 2026-09-15: Gemini 3.6 acepta ≈ 20 k chars de schema y rechaza
    # ≈ 23 k con 400 INVALID_ARGUMENT). Se descartan bloques opcionales del menos al más valioso.
    import json as _json
    orden_descarte = ["estudio_mercado", "contrato_final", "ejecucion_contractual", "procedimiento_seleccion"]
    if bloque:
        orden_descarte.append(bloque)
    descartados: list[str] = []
    while len(_json.dumps(S(type=T.OBJECT, properties=props).model_dump(exclude_none=True))) > PARSER_SCHEMA_MAX_CHARS and orden_descarte:
        k = orden_descarte.pop(0)
        if k in props:
            props.pop(k)
            descartados.append(k)
    if descartados:
        print(f"[lote] schema recortado por tamaño: sin {descartados} (se piden en una 2.ª llamada)", flush=True)
    _ULTIMOS_DESCARTES[:] = descartados
    return S(type=T.OBJECT, properties=props)


# Bloques que no cupieron en la última construcción del schema (los recupera _llamar_extractor
# con una segunda llamada solo con ellos).
_ULTIMOS_DESCARTES: list[str] = []


def _schema_solo(bloques: list[str], bloque_perfil: str | None) -> "gtypes.Schema":
    """Schema mínimo con solo `bloques` (para la 2.ª pasada)."""
    from google.genai import types as gtypes
    S, T = gtypes.Schema, gtypes.Type
    full = _parser_schema(bloque_perfil, set(_SECCIONES_OPCIONALES) | {bloque_perfil} if bloque_perfil else set(_SECCIONES_OPCIONALES))
    # `full` puede haber recortado; reconstruimos cada bloque pedido desde las funciones fuente.
    props = {}
    for k in bloques:
        if k == bloque_perfil:
            props[k] = _schema_bloque(k)
        elif k in full.properties:
            props[k] = full.properties[k]
        else:
            props[k] = _parser_schema(None, {k}).properties.get(k)
    props = {k: v for k, v in props.items() if v is not None}
    return S(type=T.OBJECT, properties=props)
