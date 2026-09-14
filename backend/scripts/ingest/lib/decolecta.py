"""
Cliente decolecta · proxy de SUNAT.

Token: configurar via env var `DECOLECTA_TOKEN` o leer de
`.decolecta-token` en raíz del proyecto.

Endpoints usados:
  GET /v1/sunat/ruc?numero=X        → básico (razón social, estado, dirección)
  GET /v1/sunat/ruc/full?numero=X   → completo (+ locales anexos, actividad,
                                                trabajadores, comercio exterior)
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent  # raíz del repo
TOKEN_FILE = ROOT / ".decolecta-token"

BASE = "https://api.decolecta.com/v1"


def _token() -> str:
    tok = os.getenv("DECOLECTA_TOKEN")
    if not tok and TOKEN_FILE.exists():
        tok = TOKEN_FILE.read_text(encoding="utf-8").strip()
    if not tok:
        raise SystemExit(
            "✗ Falta DECOLECTA_TOKEN. Setea env var o creá .decolecta-token "
            "con tu token sk_*"
        )
    return tok


def consultar_ruc(ruc: str, full: bool = True) -> dict | None:
    """Devuelve datos SUNAT del RUC, o None si no existe / falla.

    Si `full=True` incluye locales anexos, actividad económica, número de
    trabajadores, comercio exterior. Si `full=False`, sólo lo básico.
    """
    if not ruc or len(ruc) != 11:
        return None

    path = "sunat/ruc/full" if full else "sunat/ruc"
    url = f"{BASE}/{path}?numero={ruc}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {_token()}",
        "User-Agent": "vigia-peru/0.1",
    })
    for attempt in range(2):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                data = json.loads(r.read().decode("utf-8"))
                # Decolecta a veces devuelve 404 JSON: {"message": "no encontrado"}
                if "message" in data and "razon_social" not in data:
                    return None
                return data
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt == 0:
                time.sleep(1.5)
                continue
            if e.code in (404, 400):
                return None
            print(f"  ⚠ decolecta HTTP {e.code} para {ruc}")
            return None
        except Exception as e:
            print(f"  ⚠ decolecta {type(e).__name__} para {ruc}: {e}")
            return None
    return None
