"""Lo que comparten el armador, el ejecutor y el calificador del set de actas de buena pro.

El extractor es el mismo que correría en producción: el prompt, el esquema y la forma de mandar los PDF están aquí y
en ningún otro lado. Las llamadas van por el Worker vigia-llm (ruta /nativo, la API de Anthropic tal cual con la clave
de respaldo) y los documentos se bajan del R2 por vigia-r2-sync: las dos llaves salen de SSM, nunca de un archivo.
"""
from __future__ import annotations

import base64
import os
import re
import subprocess
import unicodedata
from functools import lru_cache
from pathlib import Path

AQUI = Path(__file__).resolve().parent
DATOS = AQUI / "datos"                      # en .gitignore: nombres de personas
CASOS = DATOS / "casos.jsonl"
PDFS = DATOS / "pdfs"

LLM_URL = "https://vigia-llm.vigiaperu.workers.dev/nativo"
R2_URL = "https://vigia-r2-sync.vigiaperu.workers.dev/objeto"
CLIENTE = "vigia-evals/1.0"                 # Cloudflare corta a «Python-urllib» con el error 1010

# USD por millón de tokens (precios de lista, 2026-11). Haiku 5.5 cobra más cuando el prompt pasa de 100 mil tokens.
PRECIOS = {
    "claude-haiku-5-5": {"in": 0.10, "out": 0.50, "in_largo": 0.50, "out_largo": 2.50, "umbral": 100_000},
    "claude-sonnet-5-5": {"in": 2.0, "out": 10.0},
    "claude-opus-5-5": {"in": 4.0, "out": 20.0},
}


def costo_usd(modelo: str, tokens_in: int, tokens_out: int, lote: bool = False) -> float:
    p = next((v for k, v in PRECIOS.items() if modelo.startswith(k)), None)
    if p is None:
        return float("nan")
    largo = "umbral" in p and tokens_in > p["umbral"]
    c = tokens_in * p["in_largo" if largo else "in"] / 1e6 + tokens_out * p["out_largo" if largo else "out"] / 1e6
    return c / 2 if lote else c


@lru_cache(maxsize=None)
def ssm(nombre: str) -> str:
    env = dict(os.environ, AWS_PROFILE="founder.edwin", MSYS_NO_PATHCONV="1")
    return subprocess.run(["aws", "ssm", "get-parameter", "--region", "us-east-2", "--name", nombre, "--with-decryption",
                           "--query", "Parameter.Value", "--output", "text"], capture_output=True, text=True, env=env,
                          check=True).stdout.strip()


def cliente_claude():
    import anthropic
    return anthropic.Anthropic(api_key=ssm("/vigia/llm/token"), base_url=LLM_URL, default_headers={"user-agent": CLIENTE},
                               max_retries=3, timeout=300)


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


def mensajes(pdfs: list[Path]) -> list[dict]:
    bloques = [{"type": "document", "title": p.name[:200],
                "source": {"type": "base64", "media_type": "application/pdf",
                           "data": base64.standard_b64encode(p.read_bytes()).decode()}}
               for p in pdfs]
    return [{"role": "user", "content": bloques + [{"type": "text", "text": PEDIDO}]}]


def solo_digitos(s: str | None) -> str:
    return re.sub(r"\D", "", s or "")


def norma(s: str | None) -> str:
    """Texto comparable: sin tildes, mayúsculas, sólo letras y números, espacios simples."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).upper()
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", s).split())
