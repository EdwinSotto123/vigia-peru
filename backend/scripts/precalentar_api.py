#!/usr/bin/env python3
"""
Precalienta la caché del CDN de la API en producción (fase 5 del plan del 2026-10-27): pide las rutas más pesadas de las
fichas más vistas (la línea de tiempo, las visitas y la organización de las entidades con más contratos y de las que
tienen visitas; la línea de tiempo de las empresas que más venden y de los partidos que más gobiernan), para que la
primera persona que abre una no espere 3 a 6 s. Correrlo después de cada despliegue que cambie VERSION_CACHE (cdn.ts),
o cuando se rehagan los cruces.

  python -u backend/scripts/precalentar_api.py [--entidades 300] [--empresas 200] [--partidos 40] [--hilos 4] [--por-minuto 110]

La API limita a 120 lecturas por minuto por IP (backend/api/src/lib/antibots.ts, desde el 2026-10-30): los pedidos salen
repartidos a `--por-minuto` y, si igual llega un 429, se espera lo que diga Retry-After y se reintenta.
"""
from __future__ import annotations

import argparse
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

API = "https://vigia-api.vigiaperu.workers.dev"


class Ritmo:
    """Reparte los pedidos de todos los hilos para no pasar el límite por IP de la API."""

    def __init__(self, por_minuto: int) -> None:
        self.paso = 60 / por_minuto
        self.proximo = time.monotonic()
        self.candado = threading.Lock()

    def esperar(self) -> None:
        with self.candado:
            ahora = time.monotonic()
            turno = max(ahora, self.proximo)
            self.proximo = turno + self.paso
        time.sleep(max(0.0, turno - ahora))


RITMO = Ritmo(110)


def pedir(ruta: str) -> tuple[str, int, float]:
    for _ in range(4):
        RITMO.esperar()
        t0 = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{API}{ruta}", headers={"User-Agent": "VigiaPeru/precalentar"}), timeout=120) as r:
                r.read()
                return ruta, r.status, time.time() - t0
        except urllib.error.HTTPError as e:
            if e.code == 429:   # pasó el límite por IP: se espera lo que pide la API y se reintenta
                time.sleep(int(e.headers.get("Retry-After") or 60))
                continue
            return ruta, e.code, time.time() - t0
        except Exception as e:  # noqa: BLE001 — un corte: se anota y se sigue
            return ruta, getattr(e, "code", 0) or 0, time.time() - t0
    return ruta, 429, 0.0


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entidades", type=int, default=300)
    ap.add_argument("--empresas", type=int, default=200)
    ap.add_argument("--partidos", type=int, default=40)
    ap.add_argument("--hilos", type=int, default=4)
    ap.add_argument("--por-minuto", type=int, default=110, help="pedidos por minuto (la API corta a los 120 por IP)")
    a = ap.parse_args()
    global RITMO
    RITMO = Ritmo(a.por_minuto)
    with conexion("prod") as c:
        cur = c.cursor()
        cur.execute("SELECT ruc::text FROM entidad_stats ORDER BY contratos DESC NULLS LAST LIMIT %s", (a.entidades,))
        entidades = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT entidad_ruc FROM entidad_visita_resumen ORDER BY total DESC")
        con_visitas = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT ruc FROM empresa_resumen WHERE ruc LIKE '20%%' ORDER BY adj_monto DESC NULLS LAST LIMIT %s", (a.empresas,))
        empresas = [r[0] for r in cur.fetchall()]
        cur.execute("SELECT org_clave FROM gobierno_periodo GROUP BY 1 ORDER BY count(*) DESC LIMIT %s", (a.partidos,))
        partidos = [r[0] for r in cur.fetchall()]
    rutas = (
        [f"/historia/entidad/{r}" for r in entidades]
        + [f"/planilla/organigrama?entidad={r}" for r in entidades]
        + [f"/visitas/entidad/{r}" for r in con_visitas]
        + [f"/historia/empresa/{r}" for r in empresas]
        + [f"/historia/partido/{p}" for p in partidos]
        + ["/estado/datos"]
    )
    print(f"{len(rutas)} rutas ({len(entidades)} entidades, {len(con_visitas)} con visitas, {len(empresas)} empresas, {len(partidos)} partidos)", flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=a.hilos) as ex:
        res = list(ex.map(pedir, rutas))
    tiempos = [t for _, s, t in res if s == 200]
    fallas = [(r, s) for r, s, _ in res if s != 200]
    print(f"listo en {time.time() - t0:.0f} s: {len(tiempos)} bien (mediana {statistics.median(tiempos) if tiempos else 0:.1f} s, "
          f"la más lenta {max(tiempos) if tiempos else 0:.1f} s), {len(fallas)} fallas", flush=True)
    for r, s in fallas[:15]:
        print(f"  {s} {r}", flush=True)


if __name__ == "__main__":
    main()
