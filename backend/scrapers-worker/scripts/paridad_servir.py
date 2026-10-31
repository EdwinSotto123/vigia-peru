"""Paridad de SERVIR con datos REALES (sólo local, no se sube): corre `leer_todo()` de
backend/scripts/cargar_servir_convocatorias.py (lo mismo que `--seco --paginas N`) desde una IP peruana (SERVIR responde
403 fuera del Perú) y graba cada respuesta de SERVIR y las plazas que sacó Python en .paridad/servir/ (gitignored).
Después `node scripts/paridad_servir.ts` pasa esas mismas respuestas por el port (src/fuentes/servir_convocatorias.ts)
y compara plaza por plaza.

  python backend/scrapers-worker/scripts/paridad_servir.py            # 3 páginas
  python backend/scrapers-worker/scripts/paridad_servir.py 5 0.5      # 5 páginas, 0,5 s entre pedidos

Lo grabado no lleva cookies ni cabeceras de la sesión: sólo el pedido (método, URL, formulario) y la respuesta.
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parents[3]
DIR = Path(__file__).resolve().parents[1] / ".paridad" / "servir"


def cargar_script():
    spec = importlib.util.spec_from_file_location("cargar_servir_convocatorias", RAIZ / "backend" / "scripts" / "cargar_servir_convocatorias.py")
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


def main(paginas: int, pausa: float) -> None:
    DIR.mkdir(parents=True, exist_ok=True)
    grabado: list[dict] = []

    class Grabadora(requests.Session):
        """La sesión de requests del script, que además anota cada pedido y su respuesta."""

        def request(self, method, url, *args, **kwargs):  # noqa: ANN001, ANN201
            r = super().request(method, url, *args, **kwargs)
            grabado.append({
                "metodo": method.upper(), "url": url, "datos": kwargs.get("data") or None,
                "ajax": (kwargs.get("headers") or {}).get("Faces-Request") == "partial/ajax",
                "status": r.status_code, "url_final": r.url, "texto": r.text,
            })
            return r

    modulo = cargar_script()
    modulo.requests.Session = Grabadora
    sys.stdout.reconfigure(encoding="utf-8")
    plazas = modulo.leer_todo(paginas, pausa)
    (DIR / "transcripcion.json").write_text(json.dumps(grabado, ensure_ascii=False), encoding="utf-8")
    (DIR / "esperado.json").write_text(json.dumps(plazas, ensure_ascii=False), encoding="utf-8")
    print(f"✓ {len(grabado)} respuestas y {len(plazas)} plazas → {DIR}")


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 3, float(sys.argv[2]) if len(sys.argv) > 2 else 0.5)
