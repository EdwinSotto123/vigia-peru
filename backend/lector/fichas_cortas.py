"""Las fichas de los documentos cortos que nunca se leían: la garantía, la modificación del contrato (adicional, reducción,
ampliación de plazo), la resolución o nulidad y el informe de desierto. Un extractor a medida por tipo, con modelo.

Son documentos de una a quince páginas, casi siempre escaneados: primero se transcriben (lector/transcribir.py) y después
se leen como texto (lector/por_pieza.py), así cada cita se puede comprobar contra lo transcrito. Lo que se saca de cada uno
salió de leer documentos reales (docs/DOCUMENTOS_SEACE.md):

  garantia       quién la emite, por cuánto, qué garantiza, a favor de quién, por cuenta de quién y hasta cuándo
  modificacion   qué se aprueba o se deniega (el verbo decide el dato), por cuánto o por cuántos días, y la causal
  resolucion     quién resuelve el contrato (o anula el procedimiento), por qué causal y con qué requerimiento previo
  desierto       por qué quedó desierto y cuántos participaron y ofertaron

Nombres de personas: estos documentos traen firmas de funcionarios y representantes. Los esquemas NO piden nombres de
personas naturales; sólo el cargo de quien firma y la razón social del contratista o del emisor.
"""
from __future__ import annotations

_NULO = ["string", "null"]
_NUM = ["number", "null"]
_ENT = ["integer", "null"]
_BOOL = ["boolean", "null"]
_CITA = {"pagina": {"type": _ENT}, "cita": {"type": "string"}}


def _objeto(requeridos: list[str], propiedades: dict) -> dict:
    return {"type": "object", "additionalProperties": False, "required": requeridos, "properties": propiedades}


def _monto() -> dict:
    return _objeto(["valor", "moneda", "pagina", "cita"], {
        "valor": {"type": _NUM}, "moneda": {"type": ["string", "null"], "enum": ["PEN", "USD", "EUR", None]}, **_CITA})


def _citado(tipo) -> dict:
    return _objeto(["valor", "pagina", "cita"], {"valor": {"type": tipo}, **_CITA})


_REGLAS = """Eres un lector de documentos de contratación pública del Perú. Extraes lo que dice UN documento y lo devuelves
con el esquema pedido. Reglas que no se rompen:
- Sólo lo que el documento dice. Lo que no figura va null. No completes con lo que sería normal.
- El texto trae marcas ⟦p.N⟧: lo que sigue a una marca está en la página N. El texto puede venir de una transcripción de
  un escaneo: tolera erratas, pero no adivines un número que no se lee.
- Los montos van como número sin separadores («S/ 32,491.68» es 32491.68). Las fechas, como AAAA-MM-DD.
- Una «cita» es una frase copiada del documento palabra por palabra (hasta 200 caracteres), con el número como está escrito.
- No devuelvas nombres de personas (funcionarios, representantes, gerentes): sólo cargos. Las empresas, las entidades y
  los consorcios sí van con su nombre.
- Si el documento NO es del tipo que se pide (por ejemplo, un informe de otro asunto archivado en ese casillero), dilo en
  `es_del_tipo` = false, resume en una frase qué es y deja lo demás en null."""

GARANTIA = {
    "tipos": ["garantia"],
    "SISTEMA": _REGLAS + """

El documento debería ser una GARANTÍA de un contrato: una carta fianza de un banco, una financiera, una cooperativa o una
aseguradora, o una póliza de caución. Lo que importa:
- El EMISOR es quien responde con su dinero (el banco o la aseguradora), no el contratista ni la entidad.
- El AFIANZADO es el contratista por cuya cuenta se emite («a solicitud de nuestro cliente…»); si es un consorcio, sus
  integrantes. El BENEFICIARIO es la entidad a cuyo favor se emite.
- QUÉ GARANTIZA: el fiel cumplimiento del contrato, un adelanto (directo o de materiales), prestaciones accesorias, la
  seriedad de la oferta u otra cosa.
- La VIGENCIA: desde cuándo y hasta cuándo, como lo dice la garantía.
- Las condiciones que la ley exige: solidaria, irrevocable, incondicional y de realización automática. Cada una va true si
  el texto la dice, false si dice lo contrario o pone condiciones, null si no se lee.""",
    "PEDIDO": "De esta garantía: su tipo, el emisor, el número, el monto, qué garantiza, el beneficiario, el afianzado, las "
              "fechas de emisión y de vigencia, las condiciones, el procedimiento o contrato que cita y un resumen de una frase.",
    "ESQUEMA": _objeto(
        ["es_del_tipo", "tipo", "emisor", "numero", "monto", "garantiza", "beneficiario", "afianzado", "fecha_emision", "vigencia_desde",
         "vigencia_hasta", "condiciones", "procedimiento_citado", "es_renovacion", "resumen"], {
            "es_del_tipo": {"type": "boolean"},
            "tipo": {"type": ["string", "null"], "enum": ["carta_fianza", "poliza_caucion", "fideicomiso", "certificado", "otro", None]},
            "emisor": _objeto(["nombre", "ruc", "clase"], {
                "nombre": {"type": _NULO}, "ruc": {"type": _NULO},
                "clase": {"type": ["string", "null"], "enum": ["banco", "financiera", "caja", "cooperativa", "aseguradora", "afianzadora", "otro", None]}}),
            "numero": {"type": _NULO},
            "monto": _monto(),
            "garantiza": {"type": ["string", "null"], "enum": ["fiel_cumplimiento", "adelanto_directo", "adelanto_materiales",
                                                               "prestaciones_accesorias", "seriedad_oferta", "otro", None]},
            "beneficiario": {"type": _NULO},
            "afianzado": _objeto(["nombre", "ruc", "integrantes"], {
                "nombre": {"type": _NULO}, "ruc": {"type": _NULO}, "integrantes": {"type": "array", "items": {"type": "string"}}}),
            "fecha_emision": {"type": _NULO},
            "vigencia_desde": {"type": _NULO},
            "vigencia_hasta": _citado(_NULO),
            "condiciones": _objeto(["solidaria", "irrevocable", "incondicional", "realizacion_automatica"], {
                "solidaria": {"type": _BOOL}, "irrevocable": {"type": _BOOL}, "incondicional": {"type": _BOOL},
                "realizacion_automatica": {"type": _BOOL}}),
            "procedimiento_citado": {"type": _NULO},
            "es_renovacion": {"type": _BOOL},
            "resumen": {"type": "string"}}),
}

MODIFICACION = {
    "tipos": ["adicional", "reduccion", "ampliacion_plazo", "adenda"],
    "SISTEMA": _REGLAS + """

El documento debería ser el acto que MODIFICA un contrato: una resolución (o una adenda) sobre una prestación adicional,
una reducción de prestaciones (deductivo) o una ampliación de plazo. Lo que importa:
- Lo que decide está en la parte resolutiva («SE RESUELVE», artículo primero). El VERBO decide el dato: «aprobar»,
  «declarar procedente» es que se aprueba; «declarar improcedente», «denegar», «desestimar» es que se deniega; puede
  aprobarse sólo una parte (se piden 30 días y se otorgan 12).
- El NÚMERO de la modificación («Adicional de obra N.º 02», «Ampliación de plazo N.º 03»).
- En un adicional o una reducción: el monto y su incidencia sobre el contrato original en porcentaje (y la acumulada, si
  la dice). En una ampliación: los días solicitados y los otorgados.
- La CAUSAL: por qué se pide (deficiencias del expediente, atrasos no imputables al contratista, lluvias, mayores
  metrados…), en una frase fiel.
- El contrato y el contratista a los que se refiere.""",
    "PEDIDO": "De este documento: qué modificación es y su número, el acto que la decide (tipo, número y fecha), qué se decide, "
              "el monto y su incidencia, los días solicitados y otorgados, la causal, el contrato y el contratista, el cargo de "
              "quien firma y un resumen de una frase.",
    "ESQUEMA": _objeto(
        ["es_del_tipo", "modificacion", "numero_modificacion", "acto", "decision", "monto", "incidencia_pct", "incidencia_acumulada_pct",
         "dias_solicitados", "dias_otorgados", "causal", "contrato_citado", "contratista", "cargo_firmante", "resumen"], {
            "es_del_tipo": {"type": "boolean"},
            "modificacion": {"type": ["string", "null"], "enum": ["adicional", "reduccion", "ampliacion_plazo", "adicional_y_deductivo",
                                                                  "otra", None]},
            "numero_modificacion": {"type": _NULO},
            "acto": _objeto(["tipo", "numero", "fecha"], {"tipo": {"type": _NULO}, "numero": {"type": _NULO}, "fecha": {"type": _NULO}}),
            "decision": _objeto(["sentido", "pagina", "cita"], {
                "sentido": {"type": ["string", "null"], "enum": ["aprueba", "aprueba_en_parte", "deniega", "otro", None]}, **_CITA}),
            "monto": _monto(),
            "incidencia_pct": _citado(_NUM),
            "incidencia_acumulada_pct": {"type": _NUM},
            "dias_solicitados": {"type": _ENT},
            "dias_otorgados": _citado(_ENT),
            "causal": {"type": _NULO},
            "contrato_citado": {"type": _NULO},
            "contratista": {"type": _NULO},
            "cargo_firmante": {"type": _NULO},
            "resumen": {"type": "string"}}),
}

RESOLUCION = {
    "tipos": ["resolucion_contrato", "nulidad"],
    "SISTEMA": _REGLAS + """

El documento debería ser el acto que TERMINA un contrato o ANULA un procedimiento: una resolución de contrato (por la
entidad o por el contratista, total o parcial), una nulidad de oficio o una intervención económica. Lo que importa:
- QUIÉN resuelve y POR QUÉ (la causal, en una frase fiel): incumplimiento del contratista, incumplimiento de la entidad
  (falta de pago), acumulación del máximo de penalidad, caso fortuito, un vicio del procedimiento…
- El requerimiento previo: la carta notarial que dio un plazo para cumplir, con su fecha y los días que dio.
- En una nulidad: hasta qué etapa se retrotrae el procedimiento.
- El contrato o el procedimiento y el contratista a los que se refiere.""",
    "PEDIDO": "De este documento: qué acto es, quién resuelve, si es total o parcial, la causal, el acto que lo decide (tipo, "
              "número y fecha), el requerimiento previo, a qué etapa se retrotrae (si es una nulidad), el contrato y el "
              "contratista, el cargo de quien firma y un resumen de una frase.",
    "ESQUEMA": _objeto(
        ["es_del_tipo", "acto_que_es", "quien_resuelve", "alcance", "causal", "causal_tipo", "acto", "requerimiento_previo", "se_retrotrae_a",
         "contrato_citado", "contratista", "cargo_firmante", "resumen"], {
            "es_del_tipo": {"type": "boolean"},
            "acto_que_es": {"type": ["string", "null"], "enum": ["resolucion_contrato", "nulidad_procedimiento", "nulidad_contrato",
                                                                 "intervencion_economica", "otro", None]},
            "quien_resuelve": {"type": ["string", "null"], "enum": ["entidad", "contratista", "mutuo_acuerdo", None]},
            "alcance": {"type": ["string", "null"], "enum": ["total", "parcial", None]},
            "causal": _citado(_NULO),
            "causal_tipo": {"type": ["string", "null"], "enum": ["incumplimiento_contratista", "incumplimiento_entidad", "maximo_penalidad",
                                                                 "caso_fortuito", "vicio_procedimiento", "otro", None]},
            "acto": _objeto(["tipo", "numero", "fecha"], {"tipo": {"type": _NULO}, "numero": {"type": _NULO}, "fecha": {"type": _NULO}}),
            "requerimiento_previo": _objeto(["fecha", "dias_plazo"], {"fecha": {"type": _NULO}, "dias_plazo": {"type": _ENT}}),
            "se_retrotrae_a": {"type": _NULO},
            "contrato_citado": {"type": _NULO},
            "contratista": {"type": _NULO},
            "cargo_firmante": {"type": _NULO},
            "resumen": {"type": "string"}}),
}

DESIERTO = {
    "tipos": ["informe_desierto"],
    "SISTEMA": _REGLAS + """

El documento debería ser el informe (o el acta) que sustenta que un procedimiento quedó DESIERTO. Lo que importa:
- POR QUÉ: nadie se registró, nadie presentó oferta, o ninguna oferta quedó válida (no admitidas, descalificadas o
  rechazadas). La explicación, con su cita.
- Las cuentas que el documento da: participantes registrados, ofertas presentadas, ofertas admitidas.
- Qué propone hacer: volver a convocar, revisar el requerimiento, otra cosa.""",
    "PEDIDO": "De este documento: por qué quedó desierto el procedimiento, cuántos se registraron, cuántos ofertaron y cuántas "
              "ofertas se admitieron, la fecha, qué recomienda y un resumen de una frase.",
    "ESQUEMA": _objeto(
        ["es_del_tipo", "motivo", "explicacion", "participantes_registrados", "ofertas_presentadas", "ofertas_admitidas", "fecha",
         "recomienda", "resumen"], {
            "es_del_tipo": {"type": "boolean"},
            "motivo": {"type": ["string", "null"], "enum": ["sin_participantes", "sin_ofertas", "ninguna_oferta_valida", "otro", None]},
            "explicacion": _citado(_NULO),
            "participantes_registrados": {"type": _ENT},
            "ofertas_presentadas": {"type": _ENT},
            "ofertas_admitidas": {"type": _ENT},
            "fecha": {"type": _NULO},
            "recomienda": {"type": ["string", "null"], "enum": ["nueva_convocatoria", "revisar_requerimiento", "otro", None]},
            "resumen": {"type": "string"}}),
}

LECTORES = {"garantia": GARANTIA, "modificacion": MODIFICACION, "resolucion": RESOLUCION, "desierto": DESIERTO}
