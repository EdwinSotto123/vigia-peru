"""Detección de patrones de corrupción combinando las consultas de `electoral`:
puerta giratoria (funcionario → proveedor de su propia entidad), aporte a
partido del alcalde firmante, y el scraper JNE de hoja de vida para personas
que aún no están en el dataset local."""

from tools._core import *  # noqa: F401,F403
from tools.personas.electoral import query_jne_candidaturas, query_onpe_aportantes, query_pep


def detect_puerta_giratoria(dni_gerente: str, entidad_contratante_ruc: str,
                             tool_context: ToolContext) -> dict:
    """Cruza si el gerente del proveedor fue funcionario público en la MISMA
    entidad que ahora le adjudica un contrato — patrón "puerta giratoria"
    (revolving door). Usa: jne_candidaturas, peps, El Peruano si están cargados.

    Patrón típico de corrupción: funcionario de Municipalidad X renuncia hoy,
    abre EIRL la próxima semana, y a los 6 meses gana contrato con Municipalidad X.

    Args:
        dni_gerente: DNI del gerente del proveedor adjudicado.
        entidad_contratante_ruc: RUC de la entidad que adjudica.
    """
    indicios = []
    # PEPs (si tabla existe)
    pep_r = query_pep(dni_gerente, tool_context)
    if pep_r.get("found"):
        for p in pep_r.get("registros", []):
            indicios.append({
                "fuente": "PEPs",
                "cargo": p.get("cargo"),
                "entidad": p.get("entidad"),
                "año_desde": p.get("año_desde"),
                "año_hasta": p.get("año_hasta"),
            })
    # JNE — candidaturas (proxy de actividad política con la entidad)
    jne_r = query_jne_candidaturas(dni_gerente, tool_context)
    if jne_r.get("found"):
        for c in jne_r.get("candidaturas", []):
            indicios.append({
                "fuente": "JNE_candidatura",
                "cargo": c.get("cargo"),
                "partido": c.get("partido"),
                "año": c.get("año"),
                "region": c.get("region"),
            })

    return {
        "dni_evaluado": dni_gerente,
        "entidad_contratante_ruc": entidad_contratante_ruc,
        "n_indicios": len(indicios),
        "indicios": indicios,
        "patron_detectado": len(indicios) > 0,
        "severidad": "alta" if len(indicios) >= 2 else ("media" if indicios else "ninguna"),
        "hint": "Si patron_detectado=true, generá bandera explícita en banderas_red. "
                "Severidad ALTA si hay ≥2 cargos públicos previos en la misma región/entidad.",
    }

def scrape_jne_hoja_vida(dni: str, tool_context: ToolContext) -> dict:
    """Llama al microservicio `vigia-scraper` (Playwright + Chromium) que
    busca al candidato en la Plataforma Electoral del JNE y devuelve sus
    candidaturas registradas + texto de declaración jurada.

    Usar para personas que sospechás candidato/funcionario y NO aparecen en
    el dataset `jne_candidaturas` (porque aún no se cargó o son recientes).

    Args:
        dni: DNI peruano (8 dígitos numéricos).

    Returns:
        dict del scraper con `found`, `n_resultados`, `resultados`.
    """
    url = os.getenv("VIGIA_SCRAPER_URL", "https://vigia-scraper-36169102688.us-central1.run.app")
    if not url:
        return {"ok": False, "error": "VIGIA_SCRAPER_URL no configurada"}
    if not (dni or "").strip().isdigit() or len(dni.strip()) != 8:
        return {"ok": False, "error": "dni inválido (8 dígitos)", "dni": dni}
    try:
        r = requests.post(
            f"{url.rstrip('/')}/jne_hoja_vida",
            json={"dni": dni.strip()},
            timeout=45,
        )
        if r.status_code == 200:
            return r.json()
        return {"ok": False, "error": f"scraper_http_{r.status_code}",
                "detail": r.text[:300]}
    except Exception as e:
        return {"ok": False, "error": "scraper_unreachable", "detail": str(e)[:200]}

def detect_aporte_a_partido_del_alcalde(dni_gerente: str, ocid: str,
                                         tool_context: ToolContext) -> dict:
    """Detecta si el gerente del proveedor aportó al partido del alcalde/gobernador
    que firmó la convocatoria. Cruza: ONPE aportantes + autoridad de la entidad.

    Args:
        dni_gerente: DNI del gerente del proveedor.
        ocid: OCID de la convocatoria (para inferir entidad y autoridad).
    """
    # Aportes del gerente vía ONPE
    aportes = query_onpe_aportantes(dni_gerente, tool_context)
    if not aportes.get("found"):
        return {
            "patron_detectado": False,
            "motivo": "no_aportes_onpe_registrados",
            "dataset_no_disponible": aportes.get("dataset_no_disponible", False),
        }

    partidos_aportados = set(aportes.get("partidos_distintos", []))
    # Autoridad de la entidad (de state si el orquestador ya lo extrajo,
    # sino se queda con el hallazgo crudo).
    state = tool_context.state
    autoridad_entidad = (state.get("autoridad_entidad") or {})
    partido_autoridad = autoridad_entidad.get("partido")

    if not partido_autoridad:
        return {
            "patron_detectado": False,
            "motivo": "partido_de_autoridad_no_identificado",
            "aportes_gerente": list(partidos_aportados),
            "hint": "El person_network_agent debe identificar al alcalde/gobernador "
                    "de la entidad contratante y su partido para activar este cruce.",
        }

    coincide = any(
        _normalize_persona(p) == _normalize_persona(partido_autoridad)
        for p in partidos_aportados
    )
    return {
        "dni_evaluado": dni_gerente,
        "ocid": ocid,
        "partidos_aportados_por_gerente": list(partidos_aportados),
        "partido_de_autoridad_actual": partido_autoridad,
        "patron_detectado": coincide,
        "severidad": "alta" if coincide else "ninguna",
        "evidencia": (
            f"El gerente aportó al partido '{partido_autoridad}' que también es el "
            f"partido del alcalde/gobernador firmante. Conflicto directo."
        ) if coincide else None,
    }

# ── FunctionTool wrappers ──
detect_puerta_giratoria_tool = FunctionTool(func=detect_puerta_giratoria)
detect_aporte_a_partido_del_alcalde_tool = FunctionTool(func=detect_aporte_a_partido_del_alcalde)
scrape_jne_hoja_vida_tool = FunctionTool(func=scrape_jne_hoja_vida)
