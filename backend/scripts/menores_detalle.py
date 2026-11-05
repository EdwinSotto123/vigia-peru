#!/usr/bin/env python3
"""Completa los contratos menores (seace_menores) con lo que prod6 publica y no se había guardado (migración 251):

  python -X utf8 backend/scripts/menores_detalle.py prod --listado            # fechas de publicación y cotización
  python -X utf8 backend/scripts/menores_detalle.py prod --detalle --hilos 8  # área usuaria, etapas e ítems

--listado recorre el buscador entero de prod6 (unas 320 páginas de 300) y pone, por código CM, la fecha de publicación,
la ventana de cotización (con hora) y el estado del proceso. Antes las fechas no se guardaban: llegan como
«06/11/2026 10:20:00» y el cargador sólo entendía «2026-11-06».

--detalle pide `listar-completo` de cada proceso: el área usuaria, el tipo de invitación, las etapas y los ítems (CUBSO,
cantidad, unidad, precio adjudicado). El DNI y el nombre de quien aprobó cada etapa vienen en la respuesta y NO se
guardan. Reanudable: salta los que ya tienen detalle_at.

prod6 tiene un WAF que corta a casi todo; se pasa por el relay de Cloudflare en Zúrich (token en SSM /vigia/relay/token).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

RELAY = "https://vigia-relay.vigiaperu.workers.dev/fetch"
PROD6 = "https://prod6.seace.gob.pe/v1/s8uit-services"
CLIENTE = "vigia-menores/1.0"


def token_relay() -> str:
    env = dict(os.environ, MSYS_NO_PATHCONV="1")
    return subprocess.run(["aws", "ssm", "get-parameter", "--name", "/vigia/relay/token", "--with-decryption",
                           "--query", "Parameter.Value", "--output", "text", "--profile", "founder.edwin",
                           "--region", "us-east-2"], capture_output=True, text=True, check=True, env=env).stdout.strip()


_sesion = threading.local()


def json_prod6(tok: str, url: str, intentos: int = 4):
    """GET a prod6 por el relay: el JSON, o None si el WAF o el SEACE no respondieron tras los intentos."""
    s = getattr(_sesion, "s", None)
    if s is None:
        s = _sesion.s = requests.Session()
    for i in range(intentos):
        estado = None
        try:
            r = s.post(RELAY, json={"url": url}, timeout=90,
                       headers={"Authorization": f"Bearer {tok}", "User-Agent": CLIENTE})
            env = r.json()
            estado = env.get("status")
            if estado == 200 and env.get("body"):
                b = env["body"]
                if PAUSA:
                    time.sleep(PAUSA)
                return json.loads(b) if isinstance(b, str) else b
        except Exception:  # noqa: BLE001 — red, relay o JSON: se reintenta
            pass
        # Un 403 es el WAF cortando la ráfaga (2026-11-05: con 8 hilos, a los ~400 pedidos): esperar de verdad.
        time.sleep(45 * (i + 1) if estado == 403 else 1.5 * (i + 1))
    return None


PAUSA = 0.0  # segundos tras cada respuesta, por hilo (--pausa)


def fecha_hora(s) -> str | None:
    """«06/11/2026 10:20:00» (o sin hora) → «2026-11-06 10:20:00»; también acepta ISO."""
    t = str(s or "").strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?", t)
    if m:
        d, mes, a, h, mi, se = m.groups()
        return f"{a}-{int(mes):02d}-{int(d):02d} {int(h or 0):02d}:{int(mi or 0):02d}:{int(se or 0):02d}"
    m = re.match(r"^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?", t)
    return f"{m.group(1)} {m.group(2) or '00:00:00'}" if m else None


def txt(v) -> str | None:
    return (str(v).strip() or None) if v is not None else None


def num(v) -> float | None:
    try:
        x = float(v)
        return x if x == x else None
    except (TypeError, ValueError):
        return None


def listado(entorno: str, tok: str, tam: int) -> None:
    """Todas las páginas del buscador de prod6 → fechas y estado por código CM."""
    filas: dict[str, tuple] = {}
    for anio in (2026, 2025):
        primera = json_prod6(tok, f"{PROD6}/buscadorpublico/contrataciones/buscador?anio={anio}&page=1&page_size={tam}")
        if not primera:
            sys.exit(f"prod6 no respondió (año {anio})")
        total = int((primera.get("pageable") or {}).get("totalElements") or 0)
        paginas = -(-total // tam)
        print(f"{anio}: {total} procesos en {paginas} páginas", flush=True)

        def pagina(p: int):
            return primera if p == 1 else json_prod6(tok, f"{PROD6}/buscadorpublico/contrataciones/buscador?anio={anio}&page={p}&page_size={tam}")

        fallidas = []
        with ThreadPoolExecutor(6) as ex:
            for p, d in zip(range(1, paginas + 1), ex.map(pagina, range(1, paginas + 1))):
                if not d:
                    fallidas.append(p)
                    continue
                for r in d.get("data") or []:
                    cod = txt(r.get("desContratacion"))
                    if cod:
                        filas[cod] = (int(r["idContrato"]) if r.get("idContrato") else None, txt(r.get("nomEstadoContrato")),
                                      fecha_hora(r.get("fecPublica")), fecha_hora(r.get("fecIniCotizacion")),
                                      fecha_hora(r.get("fecFinCotizacion")))
                if p % 50 == 0:
                    print(f"  página {p}/{paginas}: {len(filas)} códigos", flush=True)
        if fallidas:
            print(f"  {len(fallidas)} páginas sin respuesta: {fallidas[:20]}", flush=True)
        # El buscador no filtra de verdad por año: si la primera pasada ya trajo todo, no hace falta la segunda.
        if anio == 2026 and total > 60_000:
            break
    print(f"{len(filas)} códigos del buscador", flush=True)
    with conexion(entorno) as c:
        cur = c.cursor()
        cur.execute("""CREATE TEMP TABLE _p6 (codigo text PRIMARY KEY, idc6 int, estado text, publica timestamp,
                                               cot_ini timestamp, cot_fin timestamp)""")
        from psycopg2.extras import execute_values
        execute_values(cur, "INSERT INTO _p6 VALUES %s", [(k, *v) for k, v in filas.items()], page_size=2000)
        cur.execute("""UPDATE seace_menores m SET
                          id_contrato_prod6 = COALESCE(m.id_contrato_prod6, p.idc6),
                          estado_prod6 = COALESCE(p.estado, m.estado_prod6),
                          fec_publica = p.publica, fec_ini_cotizacion = p.cot_ini, fec_fin_cotizacion = p.cot_fin,
                          match_prod6 = CASE WHEN m.match_prod6 IN ('pendiente', 'sin_match') THEN 'exacto' ELSE m.match_prod6 END
                         FROM _p6 p WHERE p.codigo = m.codigo""")
        print(f"{cur.rowcount} contratos menores con fechas de prod6", flush=True)
        c.commit()


def guardar_detalle(cur, idc: int, d: dict) -> int:
    cab = d.get("uitContratoCompletoProjection") or {}
    etapas = {str(e.get("nomEtapaContrato") or "").upper(): e for e in d.get("uitContratoEtapaProjectionList") or []}
    consultas = next((e for k, e in etapas.items() if "CONSULTA" in k), {})
    cotiza = next((e for k, e in etapas.items() if "COTIZA" in k), {})
    cur.execute("""UPDATE seace_menores SET area_usuaria = %s, tipo_invitacion = %s, justif_invitacion = %s, ccmn = %s,
                          ccmn_nombre = %s, consultas_desde = %s, consultas_hasta = %s,
                          fec_publica = COALESCE(%s, fec_publica),
                          fec_ini_cotizacion = COALESCE(%s, fec_ini_cotizacion), fec_fin_cotizacion = COALESCE(%s, fec_fin_cotizacion),
                          estado_prod6 = COALESCE(%s, estado_prod6), detalle_at = now()
                    WHERE id_contrato = %s""",
                (txt(cab.get("nomAreaUsuaria")), txt(cab.get("nomTipoInvitacion")), txt(cab.get("desJustifTipInvit")),
                 txt(cab.get("nroCcmn")), txt(cab.get("desCcmn")), fecha_hora(consultas.get("fecIni")),
                 fecha_hora(consultas.get("fecFin")), fecha_hora(cab.get("fecPublica")), fecha_hora(cotiza.get("fecIni")),
                 fecha_hora(cotiza.get("fecFin")), txt(cab.get("nomEstadoContrato")), idc))
    cur.execute("DELETE FROM seace_menor_item WHERE id_contrato = %s", (idc,))
    items = d.get("uitContratoItemProjectionList") or []
    for n, it in enumerate(items, 1):
        cant, total = num(it.get("cantidad")), num(it.get("precioTotal"))
        ruc = txt(it.get("codRuc"))
        cur.execute("""INSERT INTO seace_menor_item (id_contrato, n, cubso, cubso_nombre, descripcion, unidad, cantidad,
                                                     precio_total, precio_unitario, ganador_ruc, estado_cotiza, distrito)
                       VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                    (idc, n, txt(it.get("codCubso")), txt(it.get("nomCubso")), (txt(it.get("descripcionItem")) or "")[:4000] or None,
                     txt(it.get("nomUnidadMedida")), cant, total,
                     round(total / cant, 4) if total is not None and cant else None,
                     ruc if ruc and re.fullmatch(r"\d{11}", ruc) else None, txt(it.get("nomEstadoCotiza")),
                     txt(it.get("nomDistritoExt") or it.get("nomDistrito"))))
    return len(items)


def detalle(entorno: str, tok: str, hilos: int, limite: int) -> None:
    with conexion(entorno) as c:
        cur = c.cursor()
        cur.execute("""SELECT id_contrato, id_contrato_prod6 FROM seace_menores
                        WHERE id_contrato_prod6 IS NOT NULL AND detalle_at IS NULL
                        ORDER BY fecha_suscripcion DESC NULLS LAST""" + (f" LIMIT {int(limite)}" if limite else ""))
        pendientes = cur.fetchall()
    print(f"{len(pendientes)} contratos menores sin detalle", flush=True)
    candado, hechos, items, fallas, t0 = threading.Lock(), [0], [0], [0], time.time()

    def bajar(par):
        return par, json_prod6(tok, f"{PROD6}/buscadorpublico/contrataciones/listar-completo?id_contrato={par[1]}")

    with conexion(entorno) as c, ThreadPoolExecutor(hilos) as ex:
        cur = c.cursor()
        for (idc, _), d in ex.map(bajar, pendientes):
            if not d or not isinstance(d, dict) or not d.get("uitContratoCompletoProjection"):
                fallas[0] += 1
                continue
            try:
                items[0] += guardar_detalle(cur, idc, d)
                c.commit()
            except Exception as e:  # noqa: BLE001 — un dato raro no frena a los demás
                c.rollback()
                fallas[0] += 1
                print(f"  ! {idc}: {str(e)[:160]}", flush=True)
                continue
            with candado:
                hechos[0] += 1
                if hechos[0] % 250 == 0:
                    print(f"  {hechos[0]}/{len(pendientes)}: {items[0]} ítems, {fallas[0]} sin respuesta, "
                          f"{round(time.time() - t0)} s", flush=True)
    print(f"FIN detalle: {hechos[0]} con detalle, {items[0]} ítems, {fallas[0]} sin respuesta", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--listado", action="store_true")
    ap.add_argument("--detalle", action="store_true")
    ap.add_argument("--hilos", type=int, default=8)
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--tam", type=int, default=300)
    ap.add_argument("--pausa", type=float, default=0.0, help="segundos tras cada respuesta, por hilo (el WAF corta ráfagas)")
    a = ap.parse_args()
    global PAUSA
    PAUSA = a.pausa
    tok = token_relay()
    if a.listado:
        listado(a.entorno, tok, a.tam)
    if a.detalle:
        detalle(a.entorno, tok, a.hilos, a.limite)


if __name__ == "__main__":
    main()
