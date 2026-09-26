"""Levanta el servidor MCP en Python (backend/mcp/server.py) en local para la prueba de paridad.

Sólo cambia host/puerto (127.0.0.1 y MCP_PY_PORT, 8811 por defecto); la conexión sale de las
variables PG* del entorno, igual que en Cloud Run. Uso:
  PGHOST=localhost PGPORT=55432 PGSSLMODE=disable ... python scripts/mcp_python_local.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "mcp"))
import server  # noqa: E402

server.mcp.settings.host = "127.0.0.1"
server.mcp.settings.port = int(os.getenv("MCP_PY_PORT", "8811"))
server.mcp.run(transport="streamable-http")
