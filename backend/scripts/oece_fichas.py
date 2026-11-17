#!/usr/bin/env python3
"""Consulta la ficha del proveedor en el OECE de las empresas sancionadas y la guarda en `oece_ficha_proveedor`
(migración 337): apto y habilitado HOY, y sus sanciones con fecha de fin y si siguen vigentes. Con eso
`ajustar_sanciones_con_ficha()` corrige las señales cuando el Tribunal sustituyó o levantó una inhabilitación (los datos
abiertos de sancionados no lo reflejan).

La ficha es pública (eap.oece.gob.pe; su robots.txt sólo prohíbe los cuadernos de obra), pero el OECE responde 403 fuera
del Perú: se corre desde la PC. Un pedido cada 1,2 s, con un UA que dice quién es. Sólo empresas (RUC 20).

  python -X utf8 backend/scripts/oece_fichas.py prod                 # definitivas y temporales recientes sin consultar en 30 días
  python -X utf8 backend/scripts/oece_fichas.py prod --todos --dias 7
  python -X utf8 backend/scripts/oece_fichas.py prod --ruc 20509193828
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))

UA = "VigiaBot/1.0 (+https://vigia.gobserva.cloud) consulta de antecedentes publicos de proveedores"
BASE = "https://eap.oece.gob.pe"
PAUSA = 1.2
CAMPOS = ("idNumInhab", "descripcion", "nroRes", "fechaResol", "periodo", "fechaIni", "fechaFin", "vigente", "montoTexto")

PENDIENTES = """
SELECT ruc FROM (
  SELECT ruc, bool_or(tipo = 'definitivo') AS defin, max(COALESCE(fecha_hasta, DATE '9999-12-31')) AS hasta
    FROM osce_sancionados WHERE ruc ~ '^20[0-9]{9}$' AND tipo IN ('temporal', 'definitivo') GROUP BY ruc) s
 WHERE (%(todos)s OR s.defin OR s.hasta >= DATE '2025-04-22')
   AND NOT EXISTS (SELECT 1 FROM oece_ficha_proveedor f WHERE f.ruc = s.ruc AND f.consultado_at > now() - make_interval(days => %(dias)s))
 ORDER BY s.defin DESC, s.hasta DESC
 LIMIT %(limite)s
"""
GUARDAR = """
INSERT INTO oece_ficha_proveedor (ruc, consultado_at, apto, habilitado, sanciones, error) VALUES %s
ON CONFLICT (ruc) DO UPDATE SET consultado_at = EXCLUDED.consultado_at, apto = EXCLUDED.apto, habilitado = EXCLUDED.habilitado,
  sanciones = EXCLUDED.sanciones, error = EXCLUDED.error
"""

# La hora de la consulta la pone la base.
PLANTILLA = "(%s, now(), %s, %s, %s::jsonb, %s)"


def get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def ficha(ruc: str, intentos: int = 3) -> tuple:
    """→ (ruc, apto, habilitado, sanciones_json, error). Dos pedidos con su pausa; el OECE a veces responde 500 de pasada:
    se reintenta con más espera."""
    for i in range(intentos):
        r = _ficha_una_vez(ruc)
        if not r[4] or i == intentos - 1:
            return r
        time.sleep(5 * (i + 1))
    return r


def _ficha_una_vez(ruc: str) -> tuple:
    try:
        cns = get(f"{BASE}/ficha-proveedor-cns/1.0/ficha/{ruc}")
        time.sleep(PAUSA)
        bus = get(f"{BASE}/perfilprov-bus/1.0/ficha/{ruc}")
        time.sleep(PAUSA)
    except urllib.error.HTTPError as e:
        time.sleep(PAUSA)
        return ruc, None, None, "[]", f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001
        time.sleep(PAUSA * 3)
        return ruc, None, None, "[]", f"{type(e).__name__}"
    ant = cns.get("antecedentes") or {}
    prov = bus.get("proveedorT01") or {}
    sanciones = [{k: s.get(k) for k in CAMPOS} | {"motivo": (s.get("motivos") or [None])[0]} for s in (ant.get("sanciones") or [])]
    return ruc, prov.get("esAptoContratar"), prov.get("esHabilitado"), json.dumps(sanciones, ensure_ascii=False), None


def main() -> None:
    from psycopg2.extras import execute_values
    from tunel_rds import conexion

    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--todos", action="store_true", help="todas las empresas con inhabilitación, no sólo definitivas y recientes")
    ap.add_argument("--dias", type=int, default=30, help="no reconsultar las consultadas en estos días")
    ap.add_argument("--limite", type=int, default=6000)
    ap.add_argument("--ruc", nargs="*", help="sólo estos RUC")
    a = ap.parse_args()
    t0 = time.time()
    with conexion(a.entorno) as cn:
        cur = cn.cursor()
        if a.ruc:
            rucs = [r for r in a.ruc if len(r) == 11 and r.startswith("20")]
        else:
            cur.execute(PENDIENTES, {"todos": a.todos, "dias": a.dias, "limite": a.limite})
            rucs = [r[0] for r in cur.fetchall()]
            cn.commit()
        print(f"{a.entorno}: {len(rucs)} empresas por consultar", flush=True)
        lote, hechos, cuenta = [], 0, {"ok": 0, "error": 0, "habilitadas": 0, "sin_sanciones": 0}
        for ruc in rucs:
            fila = ficha(ruc)
            lote.append(fila)
            hechos += 1
            if fila[4]:
                cuenta["error"] += 1
            else:
                cuenta["ok"] += 1
                cuenta["habilitadas"] += bool(fila[2])
                cuenta["sin_sanciones"] += fila[3] == "[]"
            if len(lote) >= 50:
                execute_values(cur, GUARDAR, lote, template=PLANTILLA)
                cn.commit()
                lote = []
                print(f"  {hechos} empresas {cuenta} {round(time.time() - t0)} s", flush=True)
        if lote:
            execute_values(cur, GUARDAR, lote, template=PLANTILLA)
            cn.commit()
    print(f"FIN: {hechos} empresas {cuenta} {round(time.time() - t0)} s")


if __name__ == "__main__":
    main()
