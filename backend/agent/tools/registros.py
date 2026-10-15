"""Registros públicos del proceso ya cruzados en la base: una consulta en vez de buscar en la web.

Los scrapers (backend/scrapers-worker) mantienen al día ONPE (aportes, candidaturas, gastos de campaña), JNE
(autoridades), el registro de visitas, las sanciones del Tribunal, las penalidades, el RNP y CONOSCE
(adjudicaciones, postores, contratos, consorcios, órdenes de compra), y `refrescar_cruces()` los cruza con
cada ganador. `registros_proceso(ocid)` (migración 54) devuelve todo eso para un proceso.

El orquestador lo llama ANTES de las búsquedas externas: lo que esté aquí no se vuelve a buscar en la web ni en
los portales (perfil OECE, hoja de vida JNE, ONPE Claridad, historial del proveedor).
"""

import json

from tools._core import *  # noqa: F401,F403

# Tipo de cruce → (regla de la bandera, norma o fundamento). La severidad es la del cruce.
_REGLAS = {
    "sancion_vigente": ("proveedor_inhabilitado_gano", "Ley 32069: impedimento por inhabilitación vigente del Tribunal de Contrataciones"),
    "sancion": ("proveedor_con_sancion_previa", "Registro de sancionados del Tribunal de Contrataciones (OECE)"),
    "partido_gobernante": ("financio_partido_gobernante", "Conflicto de interés: financió o atendió la campaña del partido que gobierna la entidad (ONPE / JNE)"),
    "socio_comun": ("postores_con_socio_comun", "Posible concertación de ofertas: postores del mismo proceso con socio o representante común (RNP)"),
    "visita_previa": ("visita_previa_a_buena_pro", "Ley 28024 (registro de visitas): reunión con la entidad antes de la buena pro"),
    "fraccionamiento": ("fraccionamiento_ordenes_8uit", "Prohibición de fraccionar: órdenes de hasta 8 UIT del mismo día que juntas pasan el tope (CONOSCE)"),
    "adicional": ("adicionales_cerca_del_tope", "Topes legales de adicionales: 25 % bienes y servicios, 15 % obras"),
    "aporte": ("socio_aportante_politico", "Aportes a organizaciones políticas (ONPE Claridad)"),
    "aporte_empresa": ("empresa_aportante_politica", "Aportes a organizaciones políticas (ONPE Claridad)"),
    "candidato": ("socio_candidato", "Candidaturas (JNE / ONPE)"),
    "autoridad": ("socio_autoridad_electa", "Impedimentos de autoridades electas para contratar con el Estado"),
}


def _evidencia(c: dict) -> str:
    d = c.get("detalle") or {}
    partes = [c.get("tipo", "")]
    if c.get("persona"):
        partes.append(f"persona: {c['persona']} ({c.get('rol') or 'vinculado'})")
    for k in ("partido", "organizacion", "organizacion_gobernante", "entidad_visitada", "funcionario", "dias_antes",
              "infraccion", "desde", "hasta", "otros_postores", "porcentaje", "dias", "ordenes"):
        if d.get(k) not in (None, "", []):
            partes.append(f"{k}: {d[k]}")
    if c.get("monto") is not None:
        partes.append(f"monto: S/ {c['monto']}")
    if c.get("fuente_url"):
        partes.append(f"fuente: {c['fuente_url']}")
    return "; ".join(str(p) for p in partes)[:900]


def query_registros_proceso(ocid: str, tool_context: ToolContext) -> dict:
    """Todo lo que la base ya sabe del ganador de este proceso, en una consulta.

    Llámala ANTES de cualquier búsqueda web o en portales. Trae, ya cruzado y al día:
    ganadores (un consorcio, abierto en sus integrantes), cruces con ONPE / JNE / visitas /
    sanciones / penalidades / RNP / CONOSCE, socios del RNP, postores, historial del ganador
    con la entidad, contrato y adicionales, órdenes del mismo día sobre 8 UIT, y la fecha de
    la última carga de cada fuente. Lo que venga aquí NO se vuelve a buscar.

    Args:
        ocid: el ocid del proceso (con o sin el prefijo ocds-dgv273-seacev3-).

    Returns:
        dict con ganadores[], cruces[], socios_rnp[], postores[], historial[], contratos[],
        ordenes_mismo_dia[], datos_al_dia{} y senales[]: una por cruce de severidad alta o
        media, lista para `add_contextual_flag(regla, severidad, evidencia, norma)`.
    """
    conn = _pg()
    try:
        cur = conn.cursor()
        cur.execute("SELECT to_regprocedure('registros_proceso(text)') IS NOT NULL")
        if not cur.fetchone()[0]:
            return {"found": False, "funcion_no_disponible": True}
        cur.execute("SELECT registros_proceso(%s)", (ocid,))
        fila = cur.fetchone()
        datos = fila[0] if fila else None
        if isinstance(datos, str):
            datos = json.loads(datos)
        if not datos or not datos.get("ocid"):
            return {"found": False, "ocid": ocid}
        senales = []
        for c in datos.get("cruces") or []:
            if c.get("severidad") not in ("alta", "media") or c.get("tipo") not in _REGLAS:
                continue
            regla, norma = _REGLAS[c["tipo"]]
            senales.append({"regla": regla, "severidad": c["severidad"], "evidencia": _evidencia(c), "norma": norma})
        datos["senales"] = senales
        datos["found"] = True
        tool_context.state["registros_proceso"] = datos
        return datos
    except Exception as e:  # noqa: BLE001
        return {"found": False, "error": str(e)[:300]}
    finally:
        conn.close()


query_registros_proceso_tool = FunctionTool(func=query_registros_proceso)
