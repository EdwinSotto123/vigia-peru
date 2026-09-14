"""
Paquete tools/ — reemplaza el tools.py monolítico (6844 líneas).

Cada dominio en su módulo; _core tiene lo compartido (helpers, constantes,
config). El __init__ re-exporta TODO (funciones públicas, helpers _privados,
constantes y los 51 _tool) para mantener equivalencia total con el monolito:
cualquier `from tools import X` que funcionaba antes sigue funcionando
(ej. `from tools import _pg`, `from tools import persist_analysis_outputs`,
`from tools import fetch_ocds_record_tool`).
"""
# _core primero: helpers (_pg, _safe_parse_json, …), constantes, FunctionTool, ToolContext
from tools._core import *  # noqa: F401,F403

# Cada dominio: funciones públicas + sus _tool wrappers
from tools.ocds import *              # noqa: F401,F403
from tools.compliance_rules import *  # noqa: F401,F403
from tools.personas import *          # noqa: F401,F403
from tools.documentos import *        # noqa: F401,F403
from tools.market import *            # noqa: F401,F403
from tools.legal import *             # noqa: F401,F403
from tools.sunat import *             # noqa: F401,F403
from tools.persistence import *       # noqa: F401,F403
from tools.state_loaders import *     # noqa: F401,F403
