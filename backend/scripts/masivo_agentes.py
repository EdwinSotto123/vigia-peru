#!/usr/bin/env python3
"""Análisis masivo de contratos con las Lambdas de agentes de PRODUCCIÓN (ADK + Workers AI). Pedido del usuario el
2026-11-10: «hazlo masivo solo con modelos de Cloudflare», con tope de gasto. Corre en GitLab CI (tarea:masivo-agentes,
cada 3 h) para no depender de la PC.

  python -X utf8 backend/scripts/masivo_agentes.py prod --plan "bienes=2 servicios,consultoria=2 obras=5" --tope 544
  python -X utf8 backend/scripts/masivo_agentes.py prod --estado            # hechos, gasto y faltan por red
  python -X utf8 backend/scripts/masivo_agentes.py prod --anotar 0.75 --motivo "prueba de oro de obras"
  python -X utf8 backend/scripts/masivo_agentes.py prod --plan "obras=1" --tope 544 --seco   # sólo cuenta

Contratos: 2026, procesables y SIN alerta, con «información bastante» (el usuario, 2026-11-12: «sólo quiero procesar en
la cual tengamos información bastante»): el acta de buena pro y las bases ya leídas (documento_lectura ok) y además el
contrato o las consultas. Primero los que tienen las cuatro lecturas, luego lo más riesgoso (riesgo_contrato, cuantía).
Lo que sólo tiene acta y bases espera a que los lectores lean más (cuenta como `sin_info`). Cada grupo de redes tiene
sus hilos, para que ninguna acapare el reparto. Van directo a las Lambdas (la Lambda escribe la alerta con
vigia_agentes); no pasan por `procesamientos`. Cada job anota su tanda en agente_masivo_tanda (migración 274) para el
panel (Procesamientos → Masivo).

El libro es la tabla agente_masivo (migración 272): cada contrato se reserva antes de lanzarlo (dos jobs o dos hilos no
lanzan el mismo), y al terminar queda con su costo medido por el agente. No lanza uno nuevo si lo gastado + lo que está
en vuelo × 0,25 pasa el tope, ni pasados --minutos: lo que está en vuelo termina y el job cierra limpio (el siguiente
sigue). Límite de Workers AI: ≤ 9 análisis a la vez en total (con ~13 salen 429).
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

# El agente manda un latido cada 20 s: con el 2400 por defecto una conexión cortada a media respuesta trababa el hilo.
os.environ.setdefault("AB_MAX_ESPERA_S", "180")
RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
sys.path.insert(0, str(RAIZ / "backend" / "scripts"))
from tunel_rds import EN_CI, conexion  # noqa: E402
import ab_modelos  # noqa: E402

TIPOS = {"bienes": ["bienes"], "servicios": ["servicios"], "obras": ["obras"], "consultoria": ["consultoria"],
         "otros": ["convenio", "directa", "otro"]}
COSTO_SUPUESTO = 0.25    # por contrato en vuelo o sin métrica (medido: ~0,17)
ABANDONO_MIN = 40        # una reserva sin resultado en este tiempo es de un job muerto
ORIGEN = f"gitlab-{os.environ['CI_JOB_ID']}" if os.getenv("CI_JOB_ID") else "pc"
_lock = threading.RLock()
_db: dict = {"cm": None, "cn": None, "entorno": "prod"}


def log(msg: str) -> None:
    with _lock:
        print(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}", flush=True)


# ── base ──
def cursor():
    """Cursor por el túnel; se reabre si el túnel se cayó."""
    if _db["cn"] is not None:
        try:
            cu = _db["cn"].cursor()
            cu.execute("SELECT 1")
            return cu
        except Exception:  # noqa: BLE001
            try:
                _db["cm"].__exit__(None, None, None)
            except Exception:  # noqa: BLE001
                pass
            _db["cn"] = None
    _db["cm"] = conexion(_db["entorno"])
    _db["cn"] = _db["cm"].__enter__()
    _db["cn"].autocommit = True
    return _db["cn"].cursor()


def con_vigilante(fn, segundos: int = 180):
    """Corre fn (que usa la base) con un tope de tiempo. Si el túnel SSM murió, el puerto local sigue abierto y la
    consulta espera para siempre (2026-11-10: los 6 hilos colgados): se abandona esa conexión y se abre otra."""
    caja: dict = {}

    def correr():
        try:
            caja["r"] = fn()
        except Exception as e:  # noqa: BLE001
            caja["e"] = e

    h = threading.Thread(target=correr, daemon=True)
    h.start()
    h.join(segundos)
    if h.is_alive():
        _db["cn"] = None
        _db["cm"] = None
        raise TimeoutError(f"la base no respondió en {segundos} s; se reabre el túnel")
    if "e" in caja:
        raise caja["e"]
    return caja["r"]


def base(fn, segundos: int = 180):
    with _lock:
        return con_vigilante(lambda: fn(cursor()), segundos)


# ── libro (agente_masivo) ──
def gasto(cu) -> tuple[float, int]:
    cu.execute(f"""UPDATE agente_masivo SET estado = 'error', costo = {COSTO_SUPUESTO}, terminado_en = now(),
                          error = 'reserva abandonada (sin resultado en {ABANDONO_MIN} min)'
                    WHERE estado = 'en_vuelo' AND creado_en < now() - interval '{ABANDONO_MIN} minutes'""")
    cu.execute("SELECT COALESCE(sum(costo), 0), count(*) FILTER (WHERE estado = 'en_vuelo') FROM agente_masivo")
    g, n = cu.fetchone()
    return float(g), int(n)


def reservar(cu, ocid: str, red: str) -> int | None:
    cu.execute("""INSERT INTO agente_masivo (ocid, red, origen)
                  SELECT %s, %s, %s
                   WHERE NOT EXISTS (SELECT 1 FROM agente_masivo WHERE ocid = %s AND estado = 'ok')
                     AND NOT EXISTS (SELECT 1 FROM alertas WHERE codigo = 'OECE-' || %s)
                  ON CONFLICT (ocid) WHERE estado = 'en_vuelo' DO NOTHING
                  RETURNING id""", (ocid, red, ORIGEN, ocid, ocid))
    fila = cu.fetchone()
    return fila[0] if fila else None


def cerrar(cu, rid: int, **c) -> None:
    cu.execute("""UPDATE agente_masivo SET estado = %s, costo = %s, costo_medido = %s, segundos = %s, score = %s,
                         error = %s, terminado_en = now() WHERE id = %s""",
               (c["estado"], c["costo"], c["costo_medido"], c["segundos"], c["score"], c["error"], rid))


FILTRO = "acta y bases leídas, más el contrato o las consultas"
# Las lecturas de cada contrato: `docs` = cuántas clases leídas (3 o 4) y `rico` = tiene información bastante.
_LEIDOS = """
        leidos AS (
          -- El comité (lector/comite.py) no es un documento más para el agente: no suma a `docs` ni cambia la prioridad.
          SELECT ocid, count(DISTINCT clase) FILTER (WHERE estado = 'ok' AND clase <> 'comite') AS docs,
                 bool_or(clase = 'contrato' AND estado = 'ok') OR bool_or(clase = 'consultas' AND estado = 'ok') AS rico
            FROM documento_lectura GROUP BY ocid
          HAVING bool_or(clase = 'buena_pro' AND estado = 'ok') AND bool_or(clase = 'bases' AND estado = 'ok')),
        libro AS (
          SELECT ocid, bool_or(estado IN ('ok', 'en_vuelo')) AS tomado, count(*) FILTER (WHERE estado = 'error') AS fallas
            FROM agente_masivo WHERE ocid IS NOT NULL GROUP BY ocid)"""
_PENDIENTE = """
         WHERE cv.procesable AND lower(cv.tipo_contratacion) = ANY(%s)
           AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.codigo = 'OECE-' || cv.ocid)
           AND NOT COALESCE(m.tomado, false) AND COALESCE(m.fallas, 0) < 2"""
# Sólo lo que ya se leyó ENTERO antes (backend/scripts/lectura_previa.py, migración 444): el análisis no hace OCR ni
# extracción con apuro. En 7 días, 4 143 de 4 684 análisis habían perdido parte de sus documentos (2026-11-24).
# MASIVO_SIN_LECTURA_PREVIA=1 lo salta (sólo para pruebas).
if os.getenv("MASIVO_SIN_LECTURA_PREVIA", "0") != "1":
    _PENDIENTE += """
           AND EXISTS (SELECT 1 FROM lectura_previa lp WHERE lp.ocid = cv.ocid AND lp.completo)"""


def candidatos(cu, redes: list[str]) -> list[tuple[str, str]]:
    """Lo pendiente de esas redes con información bastante: primero los de 4 lecturas, luego lo más riesgoso. Fuera: con
    alerta, hecho o en vuelo en el libro, y lo que ya falló dos veces (no se reintenta para siempre)."""
    tipos = [t for r in redes for t in TIPOS[r]]
    red_de = {t: r for r in redes for t in TIPOS[r]}
    cu.execute(f"""
        WITH {_LEIDOS}
        SELECT cv.ocid, lower(cv.tipo_contratacion)
          FROM convocatorias cv JOIN leidos l ON l.ocid = cv.ocid AND l.rico
          LEFT JOIN libro m ON m.ocid = cv.ocid {_PENDIENTE}
         ORDER BY l.docs DESC, riesgo_contrato(cv.ocid) DESC NULLS LAST, cv.cuantia_referencial DESC NULLS LAST""", (tipos,))
    return [(o, red_de[t]) for o, t in cu.fetchall()]


def conteo(cu, redes: list[str]) -> tuple[dict[str, int], dict[str, int]]:
    """Por red: cuántos pendientes tienen información bastante y cuántos esperan más lecturas (sin ordenar: barato)."""
    tipos = [t for r in redes for t in TIPOS[r]]
    red_de = {t: r for r in redes for t in TIPOS[r]}
    cu.execute(f"""
        WITH {_LEIDOS}
        SELECT lower(cv.tipo_contratacion), count(*) FILTER (WHERE l.rico), count(*) FILTER (WHERE NOT l.rico)
          FROM convocatorias cv JOIN leidos l ON l.ocid = cv.ocid
          LEFT JOIN libro m ON m.ocid = cv.ocid {_PENDIENTE}
         GROUP BY 1""", (tipos,))
    ricos: dict[str, int] = {}
    pobres: dict[str, int] = {}
    for t, a, b in cu.fetchall():
        ricos[red_de[t]] = ricos.get(red_de[t], 0) + a
        pobres[red_de[t]] = pobres.get(red_de[t], 0) + b
    return ricos, pobres


# ── Lambdas ──
def urls() -> dict:
    t = (RAIZ / "backend/dispatcher-worker/wrangler.jsonc").read_text(encoding="utf-8")
    return {m.group(1).lower(): m.group(2) for m in re.finditer(r'"AGENT_URL_([A-Z]+)":\s*"([^"]+)"', t)}


def token() -> str:
    perfil = [] if EN_CI else ["--profile", os.getenv("AWS_PROFILE", "founder.edwin")]
    env = dict(os.environ, MSYS_NO_PATHCONV="1")
    return subprocess.run(["aws", "ssm", "get-parameter", "--name", "/vigia/agente/token", "--with-decryption",
                           "--query", "Parameter.Value", "--output", "text", "--region", "us-east-2", *perfil],
                          capture_output=True, text=True, check=True, env=env).stdout.strip()


# Los dictámenes de procesos con OCID con guiones hechos ANTES del arreglo (e267f269, en PROD el 2026-11-16 05:40 de Lima)
# que tenían lecturas que el agente no vio; los ya rehechos (updated_at posterior) no entran. Primero los más riesgosos.
# Los rehace reanalizar_contratos.py --guiones (tarea:reanalisis del CI).
SQL_GUIONES = """
SELECT a.ocid FROM alertas a
 WHERE a.ocid ~ '-' AND a.updated_at < TIMESTAMPTZ '2026-11-16 10:40+00'
   AND EXISTS (SELECT 1 FROM documento_lectura l WHERE l.ocid = a.ocid AND l.estado = 'ok')
 ORDER BY COALESCE(riesgo_contrato(a.ocid), 0) DESC, a.updated_at DESC"""

# Mientras haya reanálisis pendientes, el masivo deja lugar a sus 3 hilos: ≤ 9 análisis a la vez en total (Workers AI).
HILOS_CON_REANALISIS = 6


def repartir(hilos: dict[str, int], pendientes: dict[str, int], total: int) -> dict[str, int]:
    """Los `total` hilos van sólo a las colas con pendientes, en proporción a su peso en el plan, con uno como mínimo y
    nunca más que sus pendientes. Antes, una red sin trabajo se quedaba con los suyos: con obras en 0, el plan de 9
    (2+2+5) corría con 4. Ej.: {bienes: 2, serv: 2, obras: 5}, obras sin pendientes, total 9 → {5, 4, 0}."""
    con = [k for k in hilos if pendientes.get(k, 0) > 0]
    nuevos = {k: 0 for k in hilos}
    if not con or total <= 0:
        return nuevos
    peso = {k: max(1, hilos[k]) for k in con}
    suma = sum(peso.values())
    for k in con:
        nuevos[k] = min(pendientes[k], max(1, peso[k] * total // suma))
    # Lo que sobra por el redondeo, a la cola que más se aleja de su parte y todavía tiene trabajo para otro hilo.
    while sum(nuevos.values()) < total:
        libres = [k for k in con if nuevos[k] < pendientes[k]]
        if not libres:
            break
        nuevos[max(libres, key=lambda k: peso[k] * total / suma - nuevos[k])] += 1
    # Con más colas que hilos (el mínimo de uno), se quita a la que más tiene.
    while sum(nuevos.values()) > total:
        nuevos[max(con, key=lambda k: nuevos[k])] -= 1
    return nuevos


def plan(texto: str) -> list[tuple[list[str], int]]:
    """«bienes=2 servicios,consultoria=2 obras=5» → [(['bienes'], 2), (['servicios', 'consultoria'], 2), (['obras'], 5)]."""
    grupos = []
    for parte in texto.split():
        redes, _, hilos = parte.partition("=")
        lista = [r for r in redes.split(",") if r]
        if not lista or any(r not in TIPOS for r in lista) or not hilos.isdigit():
            raise SystemExit(f"plan inválido: {parte!r} (redes: {', '.join(TIPOS)})")
        grupos.append((lista, int(hilos)))
    return grupos


# ── órdenes ──
def estado() -> None:
    def leer(cu):
        cu.execute("""SELECT red, count(*) FILTER (WHERE estado = 'ok'), sum(costo),
                             avg(costo) FILTER (WHERE estado = 'ok' AND costo_medido),
                             count(*) FILTER (WHERE estado = 'en_vuelo')
                        FROM agente_masivo GROUP BY red ORDER BY red""")
        filas = cu.fetchall()
        faltan, esperan = conteo(cu, list(TIPOS))
        return filas, faltan, esperan, gasto(cu)
    filas, faltan, esperan, (g, n) = base(leer, 900)
    print(f"{'red':12} {'hechos':>7} {'gasto':>8} {'medio':>6} {'en vuelo':>8} {'faltan':>7} {'para terminar':>13} {'esperan':>8}")
    total_f = total_p = total_e = 0.0
    for red, ok, suma, medio, vuelo in filas:
        f, e = faltan.get(red, 0), esperan.get(red, 0)
        p = f * float(medio or 0.2)
        total_f, total_p, total_e = total_f + f, total_p + p, total_e + e
        print(f"{red:12} {ok:7} {float(suma):8.2f} {float(medio or 0):6.3f} {vuelo:8} {f:7} {p:13.2f} {e:8}")
    print(f"TOTAL gastado {g:.2f} (en vuelo {n}); faltan {int(total_f)} con información bastante; terminar ≈ US$ "
          f"{total_p:.0f}; esperan más lecturas {int(total_e)}")


def anotar(usd: float, motivo: str) -> None:
    def ins(cu):
        cu.execute("INSERT INTO agente_masivo (red, estado, costo, motivo, origen, terminado_en) "
                   "VALUES ('externo', 'externo', %s, %s, %s, now())", (usd, motivo, ORIGEN))
        return gasto(cu)
    print("gastado:", base(ins)[0])


def tanda(cu, **c) -> None:
    """Abre (con `tope`) o cierra (con `ok`) la fila de este job en agente_masivo_tanda (migración 274), para el panel."""
    if "tope" in c:
        cu.execute("""INSERT INTO agente_masivo_tanda (origen, tope, plan, filtro, pendientes, sin_info, gastado_al_inicio)
                      VALUES (%s, %s, %s, %s, %s::jsonb, %s::jsonb, %s)
                      ON CONFLICT (origen) DO UPDATE SET inicio = now(), tope = EXCLUDED.tope, plan = EXCLUDED.plan,
                        filtro = EXCLUDED.filtro, pendientes = EXCLUDED.pendientes, sin_info = EXCLUDED.sin_info,
                        gastado_al_inicio = EXCLUDED.gastado_al_inicio""",
                   (ORIGEN, c["tope"], c["plan"], FILTRO, json.dumps(c["pendientes"]), json.dumps(c["sin_info"]), c["gastado"]))
    else:
        cu.execute("UPDATE agente_masivo_tanda SET fin = now(), ok = %s, errores = %s, costo = %s WHERE origen = %s",
                   (c["ok"], c["errores"], c["costo"], ORIGEN))


def anotar_tanda(**c) -> None:
    """La tanda es para mirar: si falla (p. ej. sin la migración 274), el masivo sigue igual."""
    try:
        base(lambda cu: tanda(cu, **c))
    except Exception as e:  # noqa: BLE001
        log(f"[EXC] no pude anotar la tanda: {str(e)[:150]}")


def correr(grupos: list[tuple[list[str], int]], tope: float, minutos: float, maximo: int, seco: bool,
           plan_txt: str = "", total_hilos: int | None = None) -> None:
    t0 = time.time()
    todas = sorted({r for redes, _ in grupos for r in redes})
    lista = base(lambda cu: candidatos(cu, todas), 900)
    colas = {}
    for redes, hilos in grupos:
        cola = [(o, r) for o, r in lista if r in redes]
        if maximo:
            cola = cola[:maximo]
        colas[",".join(redes)] = {"cola": iter(cola), "hilos": hilos, "n": len(cola)}
    reparto = repartir({k: v["hilos"] for k, v in colas.items()}, {k: v["n"] for k, v in colas.items()},
                       total_hilos if total_hilos is not None else sum(h for _, h in grupos))
    for k, h in reparto.items():
        colas[k]["hilos"] = h
    g, n = base(gasto)
    log(f"inicio ({ORIGEN}): " + "; ".join(f"{k} {v['n']} pendientes, {v['hilos']} hilos" for k, v in colas.items())
        + f"; gastado {g:.2f} (en vuelo {n}) de {tope:.2f}; lanza hasta {minutos:.0f} min; filtro: {FILTRO}")
    if seco:
        return
    try:
        ricos, pobres = base(lambda cu: conteo(cu, list(TIPOS)), 600)
    except Exception as e:  # noqa: BLE001
        log(f"[EXC] no pude contar los pendientes: {str(e)[:150]}")
        ricos, pobres = {}, {}
    anotar_tanda(tope=tope, plan=plan_txt, pendientes=ricos, sin_info=pobres, gastado=g)
    por_red, tok = urls(), token()
    parar = threading.Event()
    hechos = {"ok": 0, "error": 0, "costo": 0.0}

    def puede_lanzar() -> bool:
        if parar.is_set():
            return False
        if time.time() - t0 > minutos * 60:
            parar.set()
            log(f"TIEMPO: {minutos:.0f} min; no lanzo más (lo que está en vuelo termina)")
            return False
        g, n = base(gasto)
        if g + (n + 1) * COSTO_SUPUESTO > tope:
            parar.set()
            log(f"TOPE: gastado {g:.2f} + {n} en vuelo de {tope:.2f}; no lanzo más")
            return False
        return True

    def hilo(clave: str) -> None:
        c = colas[clave]
        while True:
            with _lock:
                job = next(c["cola"], None)
            if job is None:
                return
            ocid, red = job
            try:
                if not puede_lanzar():
                    return
                rid = base(lambda cu: reservar(cu, ocid, red))
                if rid is None:
                    continue   # otro job o hilo lo tomó, o ya tiene alerta
                cuerpo = base(lambda cu: ab_modelos.cuerpo(cu, ocid))
            except Exception as e:  # noqa: BLE001
                log(f"[EXC] {ocid} {red} {str(e)[:200]}")
                continue
            try:
                for _ in range(3):
                    r = ab_modelos.correr_uno(por_red[red], tok, cuerpo)
                    # La Lambda a veces corta en 2 ms («lambda_runtime panic … Connection reset by peer», conexión
                    # reusada tras una invocación larga): no llegó al agente ni gastó modelos; se reintenta.
                    if r.get("final") or (r.get("segundos") or 0) >= 15:
                        break
                    time.sleep(5)
                st = (r.get("final") or {}).get("state") or {}
                costo = (st.get("llm_metrics") or {}).get("cost_usd")
                ok = bool(r.get("final")) and not r.get("error")
                if not ok and (r.get("segundos") or 0) < 15:
                    costo = 0.0   # corte inmediato: no corrió ningún modelo
                fila = {"estado": "ok" if ok else "error",
                        "costo": float(costo) if costo is not None else COSTO_SUPUESTO,
                        "costo_medido": costo is not None, "segundos": r.get("segundos"), "score": st.get("score"),
                        "error": str(r.get("error"))[:300] if r.get("error") else None}
            except Exception as e:  # noqa: BLE001
                fila = {"estado": "error", "costo": COSTO_SUPUESTO, "costo_medido": False, "segundos": None,
                        "score": None, "error": f"{type(e).__name__}: {str(e)[:250]}"}
            try:
                base(lambda cu: cerrar(cu, rid, **fila))
            except Exception as e:  # noqa: BLE001
                log(f"[EXC] no pude cerrar {ocid} en el libro: {str(e)[:150]}")
            with _lock:
                hechos["ok" if fila["estado"] == "ok" else "error"] += 1
                hechos["costo"] += fila["costo"]
            log(f"[{'ok ' if fila['estado'] == 'ok' else 'ERR'}] {ocid} {red} {fila['segundos']}s "
                f"USD {fila['costo']:.4f} score {fila['score']} {(fila['error'] or '')[:120]}")

    if not any(v["hilos"] for v in colas.values()):
        log("sin pendientes en ninguna red: no lanzo nada")
        return
    with ThreadPoolExecutor(sum(v["hilos"] for v in colas.values())) as ex:
        for clave, v in colas.items():
            for _ in range(v["hilos"]):
                ex.submit(hilo, clave)
    g, n = base(gasto)
    anotar_tanda(ok=hechos["ok"], errores=hechos["error"], costo=round(hechos["costo"], 4))
    log(f"fin ({ORIGEN}): {hechos['ok']} ok y {hechos['error']} con error en este job, USD {hechos['costo']:.2f}; "
        f"gastado {g:.2f} de {tope:.2f}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--plan", default="bienes=2 servicios,consultoria=2 obras=5")
    ap.add_argument("--tope", type=float, help="US$ acumulados en agente_masivo (obligatorio para lanzar)")
    ap.add_argument("--minutos", type=float, default=155, help="deja de lanzar pasado este tiempo")
    ap.add_argument("--max", type=int, default=0, help="como mucho N contratos por grupo")
    ap.add_argument("--seco", action="store_true", help="sólo cuenta pendientes y gasto")
    ap.add_argument("--estado", action="store_true")
    ap.add_argument("--anotar", type=float, help="suma un gasto externo (p. ej. una prueba de oro) y sale")
    ap.add_argument("--motivo", default="")
    a = ap.parse_args()
    _db["entorno"] = a.entorno
    try:
        if a.estado:
            estado()
        elif a.anotar is not None:
            anotar(a.anotar, a.motivo)
        else:
            if a.tope is None:
                raise SystemExit("falta --tope (US$)")
            grupos = plan(a.plan)
            # Sin la variable MASIVO_PLAN a mano: mientras el reanálisis tenga pendientes, menos hilos; al terminar, todos.
            pendientes = base(lambda cu: (cu.execute(f"SELECT count(*) FROM ({SQL_GUIONES}) x"), cu.fetchone()[0])[1])
            total = sum(h for _, h in grupos)
            if pendientes:
                total = min(total, HILOS_CON_REANALISIS)
                log(f"{pendientes} reanálisis pendientes: el masivo usa a lo más {total} hilos")
            correr(grupos, a.tope, a.minutos, a.max, a.seco, a.plan, total_hilos=total)
    finally:
        if _db["cm"] is not None:
            try:
                _db["cm"].__exit__(None, None, None)
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    main()
