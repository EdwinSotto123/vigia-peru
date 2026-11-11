#!/usr/bin/env python3
"""Análisis masivo de contratos con las Lambdas de agentes de PRODUCCIÓN (ADK + Workers AI). Pedido del usuario el
2026-11-10: «hazlo masivo solo con modelos de Cloudflare», con tope de gasto. Corre en GitLab CI (tarea:masivo-agentes,
cada 3 h) para no depender de la PC.

  python -X utf8 backend/scripts/masivo_agentes.py prod --plan "bienes=2 servicios,consultoria=2 obras=5" --tope 544
  python -X utf8 backend/scripts/masivo_agentes.py prod --estado            # hechos, gasto y faltan por red
  python -X utf8 backend/scripts/masivo_agentes.py prod --anotar 0.75 --motivo "prueba de oro de obras"
  python -X utf8 backend/scripts/masivo_agentes.py prod --plan "obras=1" --tope 544 --seco   # sólo cuenta

Contratos: 2026, con el acta de buena pro y las bases ya leídas (documento_lectura ok), procesables y SIN alerta, lo más
riesgoso primero (riesgo_contrato, luego cuantía). Cada grupo de redes tiene sus hilos, para que ninguna acapare el
reparto. Van directo a las Lambdas (la Lambda escribe la alerta con vigia_agentes); no pasan por `procesamientos`.

El libro es la tabla agente_masivo (migración 272): cada contrato se reserva antes de lanzarlo (dos jobs o dos hilos no
lanzan el mismo), y al terminar queda con su costo medido por el agente. No lanza uno nuevo si lo gastado + lo que está
en vuelo × 0,25 pasa el tope, ni pasados --minutos: lo que está en vuelo termina y el job cierra limpio (el siguiente
sigue). Límite de Workers AI: ≤ 9 análisis a la vez en total (con ~13 salen 429).
"""
from __future__ import annotations

import argparse
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


def candidatos(cu, redes: list[str]) -> list[tuple[str, str]]:
    """Lo pendiente de esas redes, lo más riesgoso primero. Fuera: con alerta, hecho o en vuelo en el libro, y lo que ya
    falló dos veces (no se reintenta para siempre)."""
    tipos = [t for r in redes for t in TIPOS[r]]
    red_de = {t: r for r in redes for t in TIPOS[r]}
    cu.execute("""
        WITH leidos AS (
          SELECT ocid FROM documento_lectura GROUP BY ocid
          HAVING bool_or(clase = 'buena_pro' AND estado = 'ok') AND bool_or(clase = 'bases' AND estado = 'ok')),
        libro AS (
          SELECT ocid, bool_or(estado IN ('ok', 'en_vuelo')) AS tomado, count(*) FILTER (WHERE estado = 'error') AS fallas
            FROM agente_masivo WHERE ocid IS NOT NULL GROUP BY ocid)
        SELECT cv.ocid, lower(cv.tipo_contratacion)
          FROM convocatorias cv JOIN leidos l ON l.ocid = cv.ocid
          LEFT JOIN libro m ON m.ocid = cv.ocid
         WHERE cv.procesable AND lower(cv.tipo_contratacion) = ANY(%s)
           AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.codigo = 'OECE-' || cv.ocid)
           AND NOT COALESCE(m.tomado, false) AND COALESCE(m.fallas, 0) < 2
         ORDER BY riesgo_contrato(cv.ocid) DESC NULLS LAST, cv.cuantia_referencial DESC NULLS LAST""", (tipos,))
    return [(o, red_de[t]) for o, t in cu.fetchall()]


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
        faltan: dict[str, int] = {}
        for _, red in candidatos(cu, list(TIPOS)):
            faltan[red] = faltan.get(red, 0) + 1
        return filas, faltan, gasto(cu)
    filas, faltan, (g, n) = base(leer, 900)
    print(f"{'red':12} {'hechos':>7} {'gasto':>8} {'medio':>6} {'en vuelo':>8} {'faltan':>7} {'para terminar':>13}")
    total_f = total_p = 0.0
    for red, ok, suma, medio, vuelo in filas:
        f = faltan.get(red, 0)
        p = f * float(medio or 0.2)
        total_f, total_p = total_f + f, total_p + p
        print(f"{red:12} {ok:7} {float(suma):8.2f} {float(medio or 0):6.3f} {vuelo:8} {f:7} {p:13.2f}")
    print(f"TOTAL gastado {g:.2f} (en vuelo {n}); faltan {int(total_f)}; terminar todo ≈ US$ {total_p:.0f}")


def anotar(usd: float, motivo: str) -> None:
    def ins(cu):
        cu.execute("INSERT INTO agente_masivo (red, estado, costo, motivo, origen, terminado_en) "
                   "VALUES ('externo', 'externo', %s, %s, %s, now())", (usd, motivo, ORIGEN))
        return gasto(cu)
    print("gastado:", base(ins)[0])


def correr(grupos: list[tuple[list[str], int]], tope: float, minutos: float, maximo: int, seco: bool) -> None:
    t0 = time.time()
    todas = sorted({r for redes, _ in grupos for r in redes})
    lista = base(lambda cu: candidatos(cu, todas), 900)
    colas = {}
    for redes, hilos in grupos:
        cola = [(o, r) for o, r in lista if r in redes]
        colas[",".join(redes)] = {"cola": iter(cola[:maximo] if maximo else cola), "hilos": hilos, "n": len(cola)}
    g, n = base(gasto)
    log(f"inicio ({ORIGEN}): " + "; ".join(f"{k} {v['n']} pendientes, {v['hilos']} hilos" for k, v in colas.items())
        + f"; gastado {g:.2f} (en vuelo {n}) de {tope:.2f}; lanza hasta {minutos:.0f} min")
    if seco:
        return
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

    with ThreadPoolExecutor(sum(v["hilos"] for v in colas.values())) as ex:
        for clave, v in colas.items():
            for _ in range(v["hilos"]):
                ex.submit(hilo, clave)
    g, n = base(gasto)
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
            correr(plan(a.plan), a.tope, a.minutos, a.max, a.seco)
    finally:
        if _db["cm"] is not None:
            try:
                _db["cm"].__exit__(None, None, None)
            except Exception:  # noqa: BLE001
                pass


if __name__ == "__main__":
    main()
