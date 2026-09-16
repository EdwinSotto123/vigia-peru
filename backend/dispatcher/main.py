"""Dispatcher: toma contratos encolados (asignados a aportes pagados), los manda al
orquestador por streaming y persiste cada fase en `procesamientos` para el tablero público.

Corre como Cloud Run Job (Cloud Scheduler cada 5 min). Cada ejecución reclama hasta
DISPATCHER_PARALLEL contratos con `reclamar_procesamientos()` (SKIP LOCKED: varias
ejecuciones pueden solaparse sin pisarse) y termina al vaciar la cola o al llegar a
DISPATCHER_MAX_MINUTES (deja de reclamar; los análisis en curso se terminan igual).

Antes de llamar al orquestador consulta la clasificación tipo × etapa de la convocatoria
(migración 13, `backend/core/clasificacion.py`): si `procesable = false` el contrato pasa a
`pendiente_de_procesamiento` (con el motivo en `error`) sin gastar orquestador; si es
procesable, el body lleva `clasificacion` {tipo, etapa, agentes, validaciones_pendientes} y el
orquestador corre solo los agentes que aplican. Sin clasificación (NULL) → todo corre como antes.

Enrutado por tipo de contratación: hay un servicio de agentes por perfil (mismo código,
`PIPELINE_PROFILE` distinto): AGENT_URL_BIENES, AGENT_URL_SERVICIOS, AGENT_URL_OBRAS y
AGENT_URL_OTROS (consultoría, convenio, directa, otro). `AGENT_URL` (histórico) es el fallback
SOLO para bienes y para contratos sin clasificación. Si el servicio del tipo no está configurado,
el contrato queda `pendiente_de_procesamiento` (no se manda servicios/obras al de bienes).

Env: AGENT_URL / AGENT_URL_<TIPO> (ver arriba), PGHOST/PGPORT/PGUSER/PGDATABASE/PGPASSWORD/PGSSLMODE,
DISPATCHER_PARALLEL (default 2), DISPATCHER_MAX_MINUTES (default 55),
DISPATCHER_STREAM_TIMEOUT (segundos sin datos del stream, default 1200),
DISPATCHER_GRACE_MINUTES (si el stream corta sin `final`, minutos que se espera a que la alerta
aparezca en DB antes de re-encolar: el orquestador sigue corriendo aunque el cliente se desconecte),
DISPATCHER_PREFETCH_OCDS (1 = intenta bajar el OCDS desde esta IP y pasarlo precargado; útil
fuera de GCP porque el OECE bloquea datacenter; default 1, inocuo si falla).
"""
from __future__ import annotations

import concurrent.futures as cf
import datetime as dt
import json
import logging
import os
import socket
import time
from typing import Any

import psycopg2
import requests
from psycopg2.extras import Json

from .events import VISIBLES, canonico, reduce_event

log = logging.getLogger("dispatcher")

AGENT_URL = os.environ.get("AGENT_URL", "").rstrip("/")
# Tipo de clasificación (backend/core/clasificacion.py) → perfil del servicio de agentes.
PERFIL_DE_TIPO: dict[str, str] = {
    "bienes": "bienes", "servicios": "servicios", "obras": "obras",
    "consultoria": "otros", "convenio": "otros", "directa": "otros", "otro": "otros",
}
PERFILES = ("bienes", "servicios", "obras", "otros")
PARALLEL = int(os.getenv("DISPATCHER_PARALLEL", "2"))
MAX_MIN = int(os.getenv("DISPATCHER_MAX_MINUTES", "55"))
STREAM_TIMEOUT = int(os.getenv("DISPATCHER_STREAM_TIMEOUT", "1200"))
GRACE_MIN = int(os.getenv("DISPATCHER_GRACE_MINUTES", "20"))
PREFETCH_OCDS = os.getenv("DISPATCHER_PREFETCH_OCDS", "1") == "1"
# Migración 15: si el contrato no tiene documentos vigentes en GCS, no se procesa: se abre un
# pedido de descarga (lo atiende el batch nocturno desde IP peruana) y queda esperando_documentos.
# Con 0 (corrida manual desde una laptop en Perú con relay/downloader vivo) se procesa igual.
REQUIERE_DOCS_GCS = os.getenv("DISPATCHER_REQUIERE_DOCS_GCS", "1") == "1"
OECE_BASE = "https://contratacionesabiertas.oece.gob.pe/api/v1"
BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "es-PE,es;q=0.9",
}
WORKER = f"{socket.gethostname()}-{os.getpid()}"
MAX_INTENTOS = 3


def dsn() -> str:
    """DSN libpq con las mismas variables que backend/db y backend/scripts."""
    return (
        f"host={os.getenv('PGHOST', '127.0.0.1')} port={os.getenv('PGPORT', '5432')} "
        f"dbname={os.getenv('PGDATABASE', 'vigia')} user={os.getenv('PGUSER', 'postgres')} "
        f"password={os.environ['PGPASSWORD']} sslmode={os.getenv('PGSSLMODE', 'prefer')} "
        f"connect_timeout=15"
    )


def _query(sql: str, params: tuple[Any, ...]) -> list[tuple[Any, ...]]:
    """Ejecuta y commitea en una conexión nueva (cada llamada es corta; sin pool)."""
    conn = psycopg2.connect(dsn())
    try:
        with conn, conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchall() if cur.description else []
    finally:
        conn.close()


def reclamar(n: int) -> list[str]:
    if n <= 0:
        return []
    return [r[0] for r in _query("SELECT reclamar_procesamientos(%s, %s)", (n, WORKER))]


def latir(ocids: list[str]) -> None:
    """Heartbeat de los contratos en curso (una fase larga, p. ej. OCR, puede callar >20 min)."""
    if ocids:
        _query(
            "UPDATE procesamientos SET latido_at = now() WHERE ocid = ANY(%s) AND estado = 'procesando' AND worker = %s",
            (ocids, WORKER),
        )


def actualizar(ocid: str, cambios: dict, evento: dict | None = None) -> None:
    """Persiste los cambios de estado + latido; opcionalmente anexa un evento visible.
    `fases` (migración 20) se guarda entero: el reductor devuelve el mapa completo cada vez que cambia."""
    sets, vals = ["latido_at = now()"], []
    for k in ("fase_actual", "fase_index", "error"):
        if k in cambios:
            sets.append(f"{k} = %s")
            vals.append(cambios[k])
    if isinstance(cambios.get("fases"), dict):
        sets.append("fases = %s::jsonb")
        vals.append(Json(cambios["fases"]))
    if evento is not None:
        sets.append("eventos = eventos || %s::jsonb")
        vals.append(Json([evento]))
    _query(f"UPDATE procesamientos SET {', '.join(sets)} WHERE ocid = %s", (*vals, ocid))


OK, FAIL, ABORT, PENDIENTE, ESPERA = "ok", "fail", "abort", "pendiente", "espera"


def alerta_persistida(ocid: str, desde: dt.datetime | None = None) -> bool:
    """¿Hay alerta para el contrato (analizada desde `desde`, si se indica)?
    El orquestador guarda la alerta con el OCID corto; ocid_corto() (migración 12) iguala ambas formas."""
    return bool(_query(
        "SELECT 1 FROM alertas WHERE ocid_corto(ocid) = ocid_corto(%s) "
        "AND (%s::timestamptz IS NULL OR COALESCE(analizado_en, updated_at, created_at) >= %s::timestamptz) LIMIT 1",
        (ocid, desde, desde),
    ))


def esperar_alerta(ocid: str, desde: dt.datetime) -> bool:
    """El stream se cortó sin `final` (NAT/proxy/idle) pero el orquestador sigue corriendo en su
    contenedor y persistirá la alerta igual. Espera hasta GRACE_MIN sondeando la DB, con latido."""
    limite = time.time() + GRACE_MIN * 60
    while True:
        if alerta_persistida(ocid, desde):
            return True
        if time.time() >= limite:
            return False
        latir([ocid])
        time.sleep(30)


def terminar(ocid: str, resultado: str, error: str | None) -> None:
    if resultado == OK:
        # Desde la migración 20 el trigger trg_alertas_cerrar_procesamiento NO cierra un procesamiento con
        # worker vivo (la alerta se inserta en el checkpoint, antes del dictamen y la autoevaluación): lo cierra
        # el dispatcher al recibir `final`, con la hora real de término. Si ya estaba cerrado (stream cortado,
        # instancia vieja), se respeta la hora que tenga.
        _query(
            "UPDATE procesamientos SET finalizado_at = CASE WHEN estado = 'procesando' THEN now() ELSE COALESCE(finalizado_at, now()) END, "
            "estado = 'procesado', fase_actual = 'final', fase_index = 10, error = NULL, worker = NULL WHERE ocid = %s",
            (ocid,),
        )
    elif resultado == ABORT:
        # El orquestador no pudo analizar (fuente caída): vuelve a la cola SIN consumir el intento.
        _query(
            "UPDATE procesamientos SET estado = 'encolado', intentos = greatest(intentos - 1, 0), "
            "error = %s, worker = NULL WHERE ocid = %s",
            (error, ocid),
        )
    else:
        _query(
            "UPDATE procesamientos SET estado = CASE WHEN intentos >= %s THEN 'error' ELSE 'encolado' END, "
            "error = %s, worker = NULL WHERE ocid = %s",
            (MAX_INTENTOS, error, ocid),
        )


def perfil_de(tipo: str | None) -> str | None:
    """Perfil que atiende `tipo` (None si el tipo es desconocido)."""
    if not tipo:
        return None
    return PERFIL_DE_TIPO.get(str(tipo).strip().lower())


def url_para(tipo: str | None, env: dict | None = None) -> tuple[str | None, str | None]:
    """(url, perfil) del servicio de agentes para `tipo`.

    · `AGENT_URL_<PERFIL>` si está configurada.
    · Sin tipo (contrato sin clasificar) o tipo bienes → fallback a `AGENT_URL` (histórico).
    · Tipo de otro perfil sin URL configurada → (None, perfil): el caller lo deja pendiente.
    · Tipo desconocido → (None, None)."""
    env = os.environ if env is None else env
    perfil = perfil_de(tipo) if tipo else None
    if tipo and perfil is None:
        return None, None
    if perfil is not None:
        url = (env.get(f"AGENT_URL_{perfil.upper()}") or "").rstrip("/")
        if url:
            return url, perfil
    if perfil in (None, "bienes"):
        base = (env.get("AGENT_URL") or "").rstrip("/")
        if base:
            return base, perfil or "bienes"
    return None, perfil


def clasificacion_de(ocid: str) -> dict | None:
    """Clasificación persistida en `convocatorias` (migración 13). None si no está clasificada
    (columnas NULL) o si la migración aún no se aplicó: en ambos casos se procesa como siempre."""
    try:
        rows = _query(
            "SELECT tipo_contratacion, etapa, procesable, motivo_no_procesable, agentes_aplicables, "
            "validaciones_pendientes FROM convocatorias WHERE ocid = %s",
            (ocid,),
        )
    except psycopg2.Error as e:  # p. ej. columnas inexistentes (migración 13 sin aplicar)
        log.warning("clasificación de %s no disponible: %s", ocid, str(e).splitlines()[0][:120])
        return None
    if not rows or rows[0][0] is None:
        return None
    tipo, etapa, procesable, motivo, agentes, validaciones = rows[0]
    return {
        "tipo": tipo, "etapa": etapa,
        "procesable": procesable is not False,
        "motivo_no_procesable": motivo,
        "agentes": list(agentes or []),
        "validaciones_pendientes": list(validaciones or []),
    }


def dejar_pendiente(ocid: str, motivo: str | None) -> None:
    """No procesable: queda `pendiente_de_procesamiento` sin consumir intento ni orquestador."""
    _query(
        "UPDATE procesamientos SET estado = 'pendiente_de_procesamiento', intentos = greatest(intentos - 1, 0), "
        "error = %s, worker = NULL, fase_actual = NULL, fase_index = NULL WHERE ocid = %s",
        (f"pendiente de procesamiento: {motivo or 'no procesable'}"[:500], ocid),
    )


def documentos_en_gcs(ocid: str) -> dict[str, str] | None:
    """{url_origen: gs://…} de los documentos vigentes del contrato (migración 15). None si la
    migración no está aplicada (se procesa como siempre)."""
    try:
        rows = _query("SELECT url_origen, url_gcs FROM documentos_vigentes(%s)", (ocid,))
    except psycopg2.Error as e:
        log.warning("documentos_vigentes no disponible: %s", str(e).splitlines()[0][:120])
        return None
    return {u: g for u, g in rows if u and g}


def record_en_db(ocid: str) -> dict | None:
    """compiledRelease completo guardado por la ingesta de records (tiene `parties`); el release
    recortado de /releasesAfter no sirve para el orquestador."""
    try:
        rows = _query("SELECT ocds_payload FROM convocatorias WHERE ocid = %s", (ocid,))
    except psycopg2.Error:
        return None
    cr = rows[0][0] if rows else None
    return cr if isinstance(cr, dict) and cr.get("parties") and cr.get("ocid") else None


def esperar_documentos(ocid: str) -> None:
    """Sin documentos en GCS: pedido de descarga + procesamiento en `esperando_documentos`."""
    _query("SELECT esperar_documentos(%s)", (ocid,))


def prefetch_ocds(ocid: str) -> dict | None:
    """compiledRelease del OECE si esta IP puede verlo (laptop/VPS en Perú). Desde GCP el WAF
    responde 403 y el orquestador usa su propia cadena (relay VPS → Worker → directo)."""
    if not PREFETCH_OCDS:
        return None
    full = ocid if ocid.startswith("ocds-") else f"ocds-dgv273-seacev3-{ocid}"
    try:
        r = requests.get(f"{OECE_BASE}/record/{full}", headers=BROWSER_HEADERS, timeout=(10, 45))
        if r.status_code != 200:
            log.info("prefetch OCDS %s → HTTP %s (lo resolverá el orquestador)", ocid, r.status_code)
            return None
        recs = (r.json() or {}).get("records") or []
        cr = recs[0].get("compiledRelease") if recs else None
        return cr if isinstance(cr, dict) and cr.get("ocid") else None
    except Exception as e:  # noqa: BLE001 — el prefetch es opcional
        log.info("prefetch OCDS %s falló: %s", ocid, str(e)[:120])
        return None


def _evento(ev: dict, cambios: dict, ts: str) -> dict:
    return {
        "ts": ts,
        "kind": ev.get("kind"),
        "name": (cambios.get("fase_actual") if ev.get("kind") == "phase" and not str(ev.get("msg") or "").startswith("omitido") else None)
                or canonico(ev.get("name") or ev.get("agent")) or None,
        "msg": str(ev.get("msg") or ev.get("detail") or "")[:200] or None,
    }


def procesar(ocid: str) -> str:
    """Un contrato: stream del orquestador → fases en DB. Devuelve OK, FAIL, ABORT o PENDIENTE
    (no procesable según la matriz tipo × etapa: no se llama al orquestador)."""
    log.info("▶ %s", ocid)
    t0 = time.time()
    t0_utc = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=1)  # margen por desfase de relojes
    state: dict = {}
    resultado = FAIL
    err: str | None = None
    clas = clasificacion_de(ocid)
    if clas is not None and not clas["procesable"]:
        dejar_pendiente(ocid, clas["motivo_no_procesable"])
        log.info("⏸ %s pendiente de procesamiento · %s/%s · %s", ocid, clas["tipo"], clas["etapa"], clas["motivo_no_procesable"])
        return PENDIENTE
    tipo = clas["tipo"] if clas is not None else None
    agent_url, perfil = url_para(tipo)
    if not agent_url:
        motivo = (f"servicio de agentes para {tipo} no desplegado (AGENT_URL_{(perfil or '').upper()})"
                  if perfil else f"tipo de contratación desconocido: {tipo!r}")
        dejar_pendiente(ocid, motivo)
        log.info("⏸ %s pendiente de procesamiento · %s", ocid, motivo)
        return PENDIENTE
    docs = documentos_en_gcs(ocid)
    if docs is not None and not docs and REQUIERE_DOCS_GCS:
        esperar_documentos(ocid)
        log.info("⏳ %s esperando documentos · pedido de descarga abierto (lote nocturno)", ocid)
        return ESPERA
    log.info("servicio %s (%s) para %s · %s", perfil, agent_url, ocid, tipo or "sin clasificación")
    try:
        ocds = record_en_db(ocid) or prefetch_ocds(ocid)
        body = {"input": ocid, "ocds": ocds, "docs_b64": {}, "doc_urls": docs or {}}
        if docs:
            log.info("%d documentos desde GCS para %s", len(docs), ocid)
        if clas is not None:
            body["clasificacion"] = {k: clas[k] for k in ("tipo", "etapa", "agentes", "validaciones_pendientes")}
            log.info("clasificación %s: %s/%s · %d agentes%s", ocid, clas["tipo"], clas["etapa"], len(clas["agentes"]),
                     f" · pendientes {clas['validaciones_pendientes']}" if clas["validaciones_pendientes"] else "")
        if ocds:
            log.info("OCDS precargado para %s (%s)", ocid, str((ocds.get("tender") or {}).get("title") or "")[:60])
        with requests.post(f"{agent_url}?stream=1", json=body, stream=True, timeout=(30, STREAM_TIMEOUT)) as r:
            if r.status_code == 409:
                # El servicio rechazó el tipo (perfil ≠ tipo): mala configuración de URLs, no un
                # fallo del contrato → pendiente sin consumir intento.
                dejar_pendiente(ocid, f"el servicio {perfil} rechazó el tipo {tipo!r} (409 tipo_no_aceptado)")
                log.error("⏸ %s 409 tipo_no_aceptado en %s (%s)", ocid, perfil, agent_url)
                return PENDIENTE
            if r.status_code in (429, 500, 502, 503) and "application/x-ndjson" not in (r.headers.get("content-type") or ""):
                # Cloud Run sin instancia disponible (cuota de memoria / max-instances) o servicio
                # saturado: no es culpa del contrato → vuelve a la cola sin consumir intento y esta
                # corrida deja de reclamar (el scheduler reintenta en 5 min).
                err = f"sin capacidad en {perfil}: HTTP {r.status_code}"
                log.warning("⏸ %s %s", ocid, err)
                terminar(ocid, ABORT, err)
                return ABORT
            r.raise_for_status()
            for line in r.iter_lines(decode_unicode=True):
                if not line:
                    continue
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(ev, dict) or ev.get("kind") not in VISIBLES:
                    continue
                ts = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
                cambios = reduce_event(state, ev, ts)
                state.update(cambios)
                actualizar(ocid, cambios, _evento(ev, cambios, ts))
                if cambios.get("terminado"):
                    resultado = ABORT if cambios.get("abortado") else OK
        if resultado == OK and not alerta_persistida(ocid):
            # "final" sin alerta en DB = el pipeline no llegó a persistir → cuenta como fallo (reintenta).
            resultado = FAIL
            err = "el orquestador terminó sin persistir la alerta"
        elif resultado == FAIL:
            if state.get("error"):
                err = state["error"]
            elif esperar_alerta(ocid, t0_utc):
                # El stream cortó (proxy/NAT/idle) pero el análisis SÍ quedó en DB.
                resultado = OK
                log.warning("stream sin 'final' para %s, pero la alerta quedó persistida → procesado", ocid)
            else:
                err = "stream terminó sin evento final y sin alerta persistida"
        elif resultado == ABORT:
            err = state.get("error")
    except Exception as e:  # noqa: BLE001 — cualquier fallo re-encola (hasta 3 intentos)
        err = str(e)[:500]
        log.exception("✗ %s", ocid)
        try:
            if esperar_alerta(ocid, t0_utc):
                resultado, err = OK, None
                log.warning("el stream de %s falló, pero la alerta quedó persistida → procesado", ocid)
        except Exception:  # noqa: BLE001
            pass
    terminar(ocid, resultado, err)
    log.info("%s %s · %.0f s%s", {OK: "✓", ABORT: "↩"}.get(resultado, "✗"), ocid, time.time() - t0, f" · {err}" if err else "")
    return resultado


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname).1s dispatcher · %(message)s")
    urls = {p: (os.getenv(f"AGENT_URL_{p.upper()}") or "").rstrip("/") for p in PERFILES}
    if not AGENT_URL and not any(urls.values()):
        log.error("falta AGENT_URL (o AGENT_URL_BIENES/SERVICIOS/OBRAS/OTROS)")
        return 2
    log.info("worker=%s parallel=%d max=%d min agent=%s · por perfil: %s", WORKER, PARALLEL, MAX_MIN,
             AGENT_URL or "-", ", ".join(f"{p}={u or '-'}" for p, u in urls.items()))
    deadline = time.time() + MAX_MIN * 60
    procesados = fallidos = abortados = pendientes = esperando = 0
    fuente_caida = False  # un aborto del orquestador (OECE inaccesible) frena la corrida; el scheduler reintenta en 5 min
    with cf.ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        en_curso: dict[cf.Future[str], str] = {}
        while True:
            if time.time() < deadline and not fuente_caida:
                for ocid in reclamar(PARALLEL - len(en_curso)):
                    en_curso[pool.submit(procesar, ocid)] = ocid
            if not en_curso:
                log.info("cola vacía")
                break
            done, _ = cf.wait(set(en_curso), timeout=30, return_when=cf.FIRST_COMPLETED)
            for f in done:
                ocid = en_curso.pop(f)
                try:
                    resultado = f.result()
                except Exception:  # noqa: BLE001 — falló hasta el cierre en DB; el timeout de latido lo re-encola
                    log.exception("✗ %s (sin cierre)", ocid)
                    resultado = FAIL
                if resultado == OK:
                    procesados += 1
                elif resultado == ABORT:
                    abortados += 1
                    fuente_caida = True
                elif resultado == PENDIENTE:
                    pendientes += 1
                elif resultado == ESPERA:
                    esperando += 1
                else:
                    fallidos += 1
            try:
                latir(list(en_curso.values()))
            except Exception:  # noqa: BLE001 — un latido perdido no debe tumbar la corrida
                log.warning("latido falló", exc_info=True)
            if (time.time() >= deadline or fuente_caida) and not en_curso:
                log.info("corto la corrida: %s", "fuente OECE inaccesible" if fuente_caida else f"tope de {MAX_MIN} min")
                break
    log.info("fin · procesados=%d fallidos=%d abortados=%d pendientes_de_procesamiento=%d esperando_documentos=%d",
             procesados, fallidos, abortados, pendientes, esperando)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
