"""Tools del dominio: personas.

Paquete dividido por FUENTE de datos (ver cada submódulo para el detalle):
  · rnp           — RNP (empresas por persona, socios/representantes por RUC).
  · electoral     — autoridades electas, aportes ONPE, candidaturas JNE, PEPs.
  · visitas       — Registro Único de Visitas (Ley 28024).
  · patrones      — detección de patrones (puerta giratoria, aporte al partido
                     del alcalde) combinando `electoral`.
  · red_network    — ensamblaje del contexto completo para person_network_agent
                     (cruza rnp + electoral + visitas).
  · batch         — lookup paralelo de N personas (cruza rnp + electoral + visitas).

Este __init__ re-exporta TODO (funciones públicas + los 12 _tool) para mantener
equivalencia total con el monolito previo: cualquier `from tools.personas import X`
o `tools.personas.X` que funcionaba antes sigue funcionando.
"""

from tools._core import *  # noqa: F401,F403

from tools.personas.rnp import (
    query_rnp_persona, query_rnp_persona_tool,
    query_rnp_empresa, query_rnp_empresa_tool,
)
from tools.personas.electoral import (
    query_autoridades_entidad, query_autoridades_entidad_tool,
    query_onpe_aportantes, query_onpe_aportantes_tool,
    query_jne_candidaturas, query_jne_candidaturas_tool,
    query_pep, query_pep_tool,
)
from tools.personas.visitas import (
    query_visitas_de_persona, query_visitas_de_persona_tool,
)
from tools.personas.patrones import (
    detect_puerta_giratoria, detect_puerta_giratoria_tool,
    scrape_jne_hoja_vida, scrape_jne_hoja_vida_tool,
    detect_aporte_a_partido_del_alcalde, detect_aporte_a_partido_del_alcalde_tool,
)
from tools.personas.red_network import (
    read_person_network_context, read_person_network_context_tool,
)
from tools.personas.batch import (
    batch_person_lookup, batch_person_lookup_tool,
)
