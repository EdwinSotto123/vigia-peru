"""Lector del otorgamiento de la buena pro (acta, cuadro comparativo, actas de admisión y evaluación).

Probado con el set de 100 actas de backend/evals/actas_buena_pro (informe.md): el modelo extrae HECHOS y las banderas
salen de reglas fijas (banderas_de).
"""
from __future__ import annotations

CLASE = "buena_pro"
TIPOS_DOC = ["awardNotice", "evaluationReports"]      # en ese orden: el acta primero

VERSION = "v2"

# v2 (2026-11-03): el modelo extrae HECHOS del acta (cada postor, si fue admitido y calificado, por qué quedó fuera y de
# qué tipo fue el motivo) y Vigía calcula las banderas con reglas fijas (banderas_de), como el resto de su sistema de
# banderas. En v1 el modelo elegía las «señales» él mismo: 85 % de las actas salían con alguna, «otra» en 66 de 100 y a
# veces con un nombre o el encabezado de una lista como «cita».
SISTEMA = """Lees documentos de contrataciones públicas del Perú (SEACE). Te llegan los PDF del «otorgamiento de la buena pro»
de un procedimiento: el acta y, a veces, el cuadro comparativo o las actas de admisión, evaluación y calificación.

Extrae SOLO lo que dicen los documentos. Si algo no aparece, usa null. No inventes RUC, puntajes ni montos.

Postores: quienes presentaron oferta, aunque luego no fueran admitidos (no los que sólo se registraron como
participantes). Un consorcio es UN postor: su nombre («CONSORCIO …») y, en integrantes_ruc, los RUC de sus integrantes
si el documento los da. El RUC del postor es el que figura en el documento (11 dígitos); un consorcio no tiene RUC propio
en el acta: deja ruc en null y llena integrantes_ruc.

motivo_tipo, sólo para quien no fue admitido, no fue calificado o quedó descalificado:
  formal   faltó o vino mal un documento o una formalidad (firma, foliado, formato, vigencia, declaración jurada)
  tecnico  no cumple una especificación técnica, un requisito de calificación (experiencia, personal, equipamiento) o
           un factor de evaluación
  precio   su oferta quedó fuera de los límites del valor referencial o del presupuesto
  otro     cualquier otro motivo que el documento da
  null     si el documento no dice por qué

observaciones: SOLO hechos que el documento muestra y que alguien que vigila el gasto querría revisar, de estos tipos:
  requisito_a_la_medida  un requisito o factor que, según el propio documento, sólo cumplió el ganador o que deja fuera
                         a casi todos por algo muy específico (marca, una certificación rara, una experiencia exacta)
  nulidad_o_desierto     el documento dice que el proceso se declaró desierto, nulo o se retrotrajo antes
  fechas_irregulares     fechas, plazos u horas que el documento muestra fuera de lo normal (oferta después del cierre,
                         buena pro el mismo día de la convocatoria, etc.)
  otra_irregularidad     otro hecho irregular concreto que el documento muestra
Cada observación lleva una cita: una frase copiada del documento palabra por palabra, que sostiene la observación por
sí sola. Nunca un nombre, un número suelto o el encabezado de una lista. Lo normal es que no haya ninguna: un acta
común no tiene observaciones; deja la lista vacía.

No extraigas DNI ni datos personales de los miembros del comité: sólo cuántos son."""

PEDIDO = "Extrae del otorgamiento de la buena pro lo que pide el esquema."

TIPOS_OBSERVACION = ["requisito_a_la_medida", "nulidad_o_desierto", "fechas_irregulares", "otra_irregularidad"]
MOTIVOS = ["formal", "tecnico", "precio", "otro"]

_STR = {"type": ["string", "null"]}
_NUM = {"type": ["number", "null"]}
_BOOL = {"type": ["boolean", "null"]}
ESQUEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["es_buena_pro", "procedimiento", "objeto", "valor_referencial", "postores", "n_miembros_comite",
                 "observaciones", "confianza"],
    "properties": {
        "es_buena_pro": {"type": "boolean", "description": "Si los documentos son del otorgamiento de la buena pro"},
        "procedimiento": _STR,
        "objeto": _STR,
        "valor_referencial": {**_NUM, "description": "En soles, sin separadores"},
        "postores": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "required": ["nombre", "ruc", "es_consorcio", "integrantes_ruc", "admitida", "calificada", "puntaje",
                             "monto_ofertado", "ganador", "motivo_fuera", "motivo_tipo"],
                "properties": {
                    "nombre": {"type": "string"}, "ruc": _STR, "es_consorcio": {"type": "boolean"},
                    "integrantes_ruc": {"type": "array", "items": {"type": "string"}},
                    "admitida": _BOOL, "calificada": _BOOL, "puntaje": _NUM,
                    "monto_ofertado": {**_NUM, "description": "En soles, sin separadores"},
                    "ganador": {"type": "boolean"},
                    "motivo_fuera": {**_STR, "description": "Por qué no fue admitida, calificada o quedó descalificada"},
                    "motivo_tipo": {"anyOf": [{"type": "string", "enum": MOTIVOS}, {"type": "null"}]},
                },
            },
        },
        "n_miembros_comite": {"type": ["integer", "null"]},
        "observaciones": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False, "required": ["tipo", "explicacion", "cita"],
                "properties": {
                    "tipo": {"type": "string", "enum": TIPOS_OBSERVACION},
                    "explicacion": {"type": "string"},
                    "cita": {"type": "string", "description": "Frase copiada del documento, palabra por palabra"},
                },
            },
        },
        "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
    },
}

# Las banderas de Vigía, calculadas de los hechos extraídos (no las elige el modelo).
BANDERAS = ["postor_unico", "solo_queda_el_ganador", "descalificados_por_formalidad", "oferta_mas_baja_descartada",
            *TIPOS_OBSERVACION]

# Las que se publican (refrescar_cruce_acta): la segunda lectura (leer.py --segunda --solo-con-banderas) sólo
# vuelve a leer las actas que tienen alguna de éstas.
BANDERAS_A_CONFIRMAR = ["solo_queda_el_ganador", "descalificados_por_formalidad", "oferta_mas_baja_descartada"]


def normalizar(salida: dict) -> dict:
    """Un consorcio no tiene RUC propio en el acta: si el modelo le puso uno (GLM lo hace a veces), pasa a sus
    integrantes. Lo llama el motor de Workers AI (motor_workers.py) antes de calcular las banderas."""
    for p in salida.get("postores") or []:
        consorcio = p.get("es_consorcio") or str(p.get("nombre") or "").strip().upper().startswith("CONSORCIO")
        if consorcio and p.get("ruc"):
            integrantes = list(p.get("integrantes_ruc") or [])
            if p["ruc"] not in integrantes:
                integrantes.append(p["ruc"])
            p["integrantes_ruc"], p["ruc"], p["es_consorcio"] = integrantes, None, True
    return salida


def fuera(p: dict) -> bool:
    return not p.get("ganador") and (p.get("admitida") is False or p.get("calificada") is False)


def banderas_de(salida: dict) -> list[str]:
    post = salida.get("postores") or []
    gan = [p for p in post if p.get("ganador")]
    otros = [p for p in post if not p.get("ganador")]
    out = set()
    if len(post) == 1:
        out.add("postor_unico")
    if len(post) >= 2 and len(gan) == 1 and otros and all(fuera(p) for p in otros):
        out.add("solo_queda_el_ganador")
    if any(fuera(p) and p.get("motivo_tipo") == "formal" for p in otros):
        out.add("descalificados_por_formalidad")
    con_monto = [p for p in post if isinstance(p.get("monto_ofertado"), (int, float)) and p["monto_ofertado"] > 0]
    if len(gan) == 1 and len(con_monto) >= 2:
        menor = min(con_monto, key=lambda p: p["monto_ofertado"])
        g = gan[0].get("monto_ofertado")
        if not menor.get("ganador") and fuera(menor) and isinstance(g, (int, float)) and g >= menor["monto_ofertado"] * 1.05:
            out.add("oferta_mas_baja_descartada")
    out.update(o["tipo"] for o in salida.get("observaciones") or [] if o.get("tipo") in TIPOS_OBSERVACION)
    return sorted(out)
