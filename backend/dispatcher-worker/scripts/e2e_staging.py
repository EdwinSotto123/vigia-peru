"""Prueba de punta a punta contra una base de STAGING (nunca producción): el mismo contrato pasa por
el dispatcher de Python (backend/dispatcher, como corre en el job) y por el Worker (`wrangler dev`),
ambos contra el orquestador falso (scripts/agente_falso.ts), y se compara la fila de `procesamientos`
que deja cada uno y el pedido que recibió el orquestador.

Requisitos (ver README): orquestador falso en AGENTE, `wrangler dev` en WORKER con .dev.vars de
prueba (DISPATCHER_TOKEN, AGENT_URL_BIENES=AGENTE, AGENT_ID_TOKEN, DISPATCHER_TASK_TIMEOUT_S=301,
DISPATCHER_ANALISIS_MAX_S=0, DISPATCHER_GRACE_MINUTES=0, DISPATCHER_PREFETCH_OCDS=0,
DISPATCHER_TRAMO_S=10) y las variables PG* de la base de staging.

    python scripts/e2e_staging.py --ocid 1225989 --ocid-sin-docs 1212305
    python scripts/e2e_staging.py ... --gracia-min 1 --solo gracia
        (Worker con DISPATCHER_GRACE_MINUTES=1 y DISPATCHER_TASK_TIMEOUT_S=361: la ventana sigue siendo de 1 s)

Con --gracia-min > 0 se agrega "alerta durante la gracia": el stream se corta sin `final` y, ya cortado,
se toca `alertas.analizado_en` del contrato (lo que hace el orquestador que sigue corriendo): los dos
tienen que cerrarlo `procesado` al encontrarla en la espera de gracia.

Cada fila tocada se fotografía antes y se restaura al final (también los pedidos de descarga).
Aborta si hay otros procesamientos `encolado` o `procesando`: no reclama filas ajenas.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import subprocess
import sys
import threading
import time
import urllib.request

import psycopg2
from psycopg2.extras import Json, RealDictCursor

RAIZ = pathlib.Path(__file__).resolve().parents[3]
COLUMNAS = ["estado", "fase_actual", "fase_index", "worker", "intentos", "error", "eventos", "encolado_at",
            "iniciado_at", "latido_at", "finalizado_at", "fases"]
JSONB = {"eventos", "fases"}


def conectar():
    c = psycopg2.connect(host=os.getenv("PGHOST", "localhost"), port=os.getenv("PGPORT", "55432"),
                         dbname=os.getenv("PGDATABASE", "vigia"), user=os.getenv("PGUSER", "postgres"),
                         password=os.environ["PGPASSWORD"])
    c.autocommit = True
    return c


def fila(db, ocid: str) -> dict:
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(f"SELECT {', '.join(COLUMNAS)} FROM procesamientos WHERE ocid = %s", (ocid,))
        return dict(cur.fetchone())


def pedidos_descarga(db, ocid: str) -> list[dict]:
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM pedidos_descarga WHERE ocid_corto(ocid) = ocid_corto(%s) ORDER BY id", (ocid,))
        return [dict(r) for r in cur.fetchall()]


def restaurar(db, ocid: str, foto: dict, pedidos: list[dict]) -> None:
    sets = ", ".join(f"{k} = %s" for k in COLUMNAS)
    vals = [Json(foto[k]) if k in JSONB else foto[k] for k in COLUMNAS]
    with db.cursor() as cur:
        cur.execute(f"UPDATE procesamientos SET {sets} WHERE ocid = %s", (*vals, ocid))
        ids = [p["id"] for p in pedidos]
        cur.execute("DELETE FROM pedidos_descarga WHERE ocid_corto(ocid) = ocid_corto(%s) AND NOT (id = ANY(%s))", (ocid, ids))
        for p in pedidos:
            cols = [k for k in p if k != "id"]
            cur.execute(f"UPDATE pedidos_descarga SET {', '.join(f'{k} = %s' for k in cols)} WHERE id = %s",
                        (*[p[k] for k in cols], p["id"]))


def encolar(db, ocid: str) -> None:
    with db.cursor() as cur:
        cur.execute("UPDATE procesamientos SET estado = 'encolado', intentos = 0, error = NULL, worker = NULL, "
                    "fase_actual = NULL, fase_index = NULL, fases = '{}'::jsonb, eventos = '[]'::jsonb, "
                    "iniciado_at = NULL, latido_at = NULL, finalizado_at = NULL WHERE ocid = %s", (ocid,))


def http(metodo: str, url: str, cuerpo: dict | None = None, token: str | None = None) -> tuple[int, object]:
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(url, data=datos, method=metodo, headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def alerta_de(db, ocid: str) -> dict | None:
    with db.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT id, analizado_en, updated_at FROM alertas WHERE ocid = ANY(ARRAY[%s, ocid_corto(%s)]) LIMIT 1", (ocid, ocid))
        r = cur.fetchone()
        return dict(r) if r else None


def tocar_alerta_al_cortarse(ocid: str, eventos: int, alerta: dict) -> threading.Thread:
    """Cuando el stream cortado ya dejó sus `eventos`, marca la alerta como recién analizada."""
    def correr():
        db = conectar()
        fin = time.time() + 300
        while time.time() < fin:
            f = fila(db, ocid)
            if f["estado"] == "procesando" and len(f["eventos"] or []) >= eventos:
                time.sleep(3)
                with db.cursor() as cur:
                    cur.execute("UPDATE alertas SET analizado_en = now() WHERE id = %s", (alerta["id"],))
                return
            time.sleep(0.5)
    t = threading.Thread(target=correr, daemon=True)
    t.start()
    return t


def restaurar_alerta(db, alerta: dict) -> None:
    with db.cursor() as cur:
        cur.execute("UPDATE alertas SET analizado_en = %s, updated_at = %s WHERE id = %s",
                    (alerta["analizado_en"], alerta["updated_at"], alerta["id"]))


def correr_python(agente: str, entorno_extra: dict) -> float:
    env = {**os.environ, "AGENT_URL": agente, "AGENT_URL_BIENES": agente, "AGENT_ID_TOKEN": "token-de-prueba",
           "DISPATCHER_PARALLEL": "1", "DISPATCHER_MAX_MINUTES": "25", "DISPATCHER_TASK_TIMEOUT_S": "301",  # ventana de reclamo de 1 s: un solo reclamo
           "DISPATCHER_ANALISIS_MAX_S": "0", "DISPATCHER_PREFETCH_OCDS": "0",
           "PGSSLMODE": "disable", **entorno_extra}
    for k in ("AGENT_URL_SERVICIOS", "AGENT_URL_OBRAS", "AGENT_URL_OTROS", "CLOUD_RUN_JOB", "K_SERVICE"):
        env.pop(k, None)
    t = time.time()
    r = subprocess.run([sys.executable, "-m", "backend.dispatcher.main"], cwd=RAIZ, env=env, capture_output=True, text=True,
                       timeout=600, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        raise RuntimeError(f"dispatcher Python salió con {r.returncode}: {r.stderr[-2000:]}")
    return time.time() - t


def correr_worker(worker: str, token: str) -> tuple[float, dict]:
    t = time.time()
    status, r = http("POST", f"{worker}/ejecutar", {}, token)
    if status != 200 or not r.get("instancias"):
        raise RuntimeError(f"/ejecutar respondió {status}: {r}")
    fin = time.time() + 600
    estados = {}
    for inst in r["instancias"]:
        while True:
            _, s = http("GET", f"{worker}/instancias/{inst}", None, token)
            if s.get("status") in ("complete", "errored", "terminated"):
                estados[inst] = s
                break
            if time.time() > fin:
                raise RuntimeError(f"la instancia {inst} no terminó: {s}")
            time.sleep(2)
    return time.time() - t, {"ejecutar": r, "instancias": estados}


def normalizar(f: dict) -> dict:
    """Las horas cambian entre corridas: se comparan presencia y estructura, no el valor."""
    out = {k: f[k] for k in ("estado", "fase_actual", "fase_index", "worker", "intentos", "error")}
    for k in ("iniciado_at", "latido_at", "finalizado_at"):
        out[k] = "presente" if f[k] is not None else None
    out["fases"] = {n: {k: ("T" if k in ("desde", "hasta") and v is not None else v) for k, v in d.items()}
                    for n, d in (f["fases"] or {}).items()}
    out["eventos"] = [{**e, "ts": "T"} for e in (f["eventos"] or [])]
    return out


def pedido_normalizado(p: dict) -> dict:
    return {**p, "cuerpo": json.loads(p["cuerpo"]) if p.get("cuerpo") else None}


def diferencias(a, b, ruta="$") -> list[str]:
    if a == b:
        return []
    if isinstance(a, dict) and isinstance(b, dict):
        return [d for k in sorted(set(a) | set(b)) for d in diferencias(a.get(k), b.get(k), f"{ruta}.{k}")]
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        return [d for i, (x, y) in enumerate(zip(a, b)) for d in diferencias(x, y, f"{ruta}[{i}]")]
    return [f"{ruta}: python={json.dumps(a, default=str, ensure_ascii=False)[:300]} "
            f"worker={json.dumps(b, default=str, ensure_ascii=False)[:300]}"]


ESCENARIOS = [
    # (nombre, escenario del orquestador falso, usa la fila sin documentos)
    ("stream completo con final", "completo", False),
    ("stream cortado sin final y sin alerta nueva", "cortado", False),
    ("error de rama y corte", "error", False),
    ("final abortado por el orquestador", "abortado", False),
    ("409 tipo_no_aceptado", "409", False),
    ("503 sin capacidad", "503", False),
    ("sin documentos en GCS", "completo", True),
]
GRACIA = ("stream cortado y alerta durante la gracia", "cortado", False)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ocid", required=True)
    ap.add_argument("--ocid-sin-docs", required=True)
    ap.add_argument("--worker", default="http://127.0.0.1:8831")
    ap.add_argument("--agente", default="http://127.0.0.1:8840")
    ap.add_argument("--token-archivo", default=str(pathlib.Path(__file__).resolve().parents[1] / ".e2e" / "token"))
    ap.add_argument("--pausa-ms", type=int, default=150)
    ap.add_argument("--solo", help="correr solo el escenario cuyo nombre contenga este texto")
    ap.add_argument("--gracia-min", type=int, default=0, help="DISPATCHER_GRACE_MINUTES de las dos corridas")
    args = ap.parse_args()
    token = pathlib.Path(args.token_archivo).read_text().strip()
    _, sim = http("GET", f"{args.worker}/simular", None, token)
    if sim["config"]["grace_min"] != args.gracia_min:
        print(f"el Worker tiene DISPATCHER_GRACE_MINUTES={sim['config']['grace_min']} y se pidió {args.gracia_min}")
        return 2
    escenarios = ESCENARIOS + ([GRACIA] if args.gracia_min else [])
    db = conectar()
    with db.cursor() as cur:
        cur.execute("SELECT count(*) FROM procesamientos WHERE estado IN ('encolado', 'procesando')")
        if cur.fetchone()[0]:
            print("hay procesamientos encolados o en curso en esta base: no se prueba para no reclamar filas ajenas")
            return 2
    fotos = {o: (fila(db, o), pedidos_descarga(db, o)) for o in (args.ocid, args.ocid_sin_docs)}
    alerta = alerta_de(db, args.ocid)
    total_fallas = 0
    try:
        for nombre, escenario, sin_docs in escenarios:
            if args.solo and args.solo not in nombre:
                continue
            ocid = args.ocid_sin_docs if sin_docs else args.ocid
            resultados = {}
            for motor in ("python", "worker"):
                encolar(db, ocid)
                http("POST", f"{args.agente}/_escenario", {"nombre": escenario, "pausa_ms": args.pausa_ms})
                http("DELETE", f"{args.agente}/_pedidos")
                hilo = tocar_alerta_al_cortarse(ocid, 23, alerta) if nombre == GRACIA[0] else None
                if motor == "python":
                    dur, extra = correr_python(args.agente, {"DISPATCHER_GRACE_MINUTES": str(args.gracia_min),
                                                             "DISPATCHER_TASK_TIMEOUT_S": str(301 + 60 * args.gracia_min)}), None
                else:
                    dur, extra = correr_worker(args.worker, token)
                if hilo:
                    hilo.join(5)
                    restaurar_alerta(db, alerta)
                _, pedidos = http("GET", f"{args.agente}/_pedidos")
                resultados[motor] = {"fila": normalizar(fila(db, ocid)), "pedidos": [pedido_normalizado(p) for p in pedidos],
                                     "pedidos_descarga": len(pedidos_descarga(db, ocid)) - len(fotos[ocid][1]),
                                     "segundos": round(dur, 1), "extra": extra}
                restaurar(db, ocid, *fotos[ocid])
            dif = diferencias({k: v for k, v in resultados["python"].items() if k not in ("segundos", "extra")},
                              {k: v for k, v in resultados["worker"].items() if k not in ("segundos", "extra")})
            f = resultados["worker"]["fila"]
            resumen = (f"estado={f['estado']} intentos={f['intentos']} fase_actual={f['fase_actual']} fase_index={f['fase_index']} "
                       f"eventos={len(f['eventos'])} fases={len(f['fases'])} pedidos_al_orquestador={len(resultados['worker']['pedidos'])} "
                       f"pedidos_de_descarga_nuevos={resultados['worker']['pedidos_descarga']} error={(f['error'] or '')[:70]!r} "
                       f"(python {resultados['python']['segundos']} s · worker {resultados['worker']['segundos']} s)")
            if dif:
                total_fallas += 1
                print(f"✗ {nombre}: {resumen}")
                for d in dif[:15]:
                    print(f"    {d}")
                inst = resultados["worker"]["extra"]["instancias"] if resultados["worker"]["extra"] else {}
                print(f"    instancias: {json.dumps(inst, default=str)[:1500]}")
            else:
                print(f"✓ {nombre}: {resumen}")
    finally:
        for o, (foto, pedidos) in fotos.items():
            restaurar(db, o, foto, pedidos)
        if alerta:
            restaurar_alerta(db, alerta)
        restauradas = all(fila(db, o) == foto for o, (foto, _) in fotos.items())
        print(f"filas restauradas: {'sí' if restauradas else 'NO'}")
    return 1 if total_fallas else 0


if __name__ == "__main__":
    raise SystemExit(main())
