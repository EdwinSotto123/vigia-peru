"""Descargador nocturno por lotes: releases → records → documentos (desde IP peruana).

  python -m backend.batch.descargar releases   --desde 2016-01-01 --hasta 2026-09-15 --ventana 7d
  python -m backend.batch.descargar records    --lote <releases-…> [--max-por-noche 20000] [--paralelo 4]
  python -m backend.batch.descargar records    --ocids ocids.txt
  python -m backend.batch.descargar documentos --lote <records-…> --politica clave|todo [--max-gb-por-noche 20]
  python -m backend.batch.descargar pedidos   [--max 200]                     # financiados sin docs en GCS (migración 15)
  python -m backend.batch.descargar <tipo> --lote <id-del-mismo-tipo>        # reanudar

Layout local (gitignored, `dataset/_batch/`):
  releases/<desde>_<hasta>/page-0001.json.gz     una página cruda de /releasesAfter por archivo
  records/<aa>/<ocid>.json.gz                     aa = 2 últimos dígitos del ocid corto
  documentos/<aa>/<ocid>/<sha8>.<ext>
  logs/<fecha>.log · estado.sqlite

Reanudable: los ítems `completed` se saltan; una ventana de releases guarda el cursor
(`links.next`) por página, así que `Ctrl+C` a mitad de ventana retoma en la página siguiente.
Dedup: hash del contenido (no se reescribe un archivo idéntico) y, en documentos, por URL y
por sha256 (un mismo PDF publicado en dos procesos se baja una vez).

El lote creado se imprime en la ÚLTIMA línea de stdout (los logs van a stderr + archivo), para
que `batch-nocturno.sh` lo capture con `$(...)`.
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import io
import json
import logging
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from pathlib import Path
from typing import Callable

import requests

from ..scrapers._core import http
from ..scrapers.oece_ocds.pipeline import BASE, OCID_PREFIX, PAGE, short_ocid
from . import BATCH_DIR
from .estado import Estado

log = logging.getLogger("batch.descargar")

RETRY_SLEEPS = (2, 5, 10, 20, 40)
DOC_TIPOS_CLAVE = ("biddingDocuments", "awardNotice", "contractSigned")
EXT_RE = re.compile(r"^[a-z0-9]{1,6}$")
MAX_403_SEGUIDOS = 25       # cortacircuito: el WAF del SEACE bloquea la IP → no insistir esa noche
# El 403 del SEACE es por ráfaga, no permanente (verificado: la misma URL vuelve a dar 200 minutos
# después). Documentos: un hilo, pausa entre archivos y espera creciente ante cada 403.
PAUSA_DOCS = 1.5
ESPERA_403 = (60, 180, 420)
_stop = threading.Event()


# ── utilidades ──────────────────────────────────────────────────────────
def configurar_logs(verbose: bool = False) -> Path:
    """Logs a stderr + dataset/_batch/logs/<fecha>.log (rotación natural por día)."""
    logdir = BATCH_DIR / "logs"
    logdir.mkdir(parents=True, exist_ok=True)
    archivo = logdir / f"{dt.date.today().isoformat()}.log"
    fmt = logging.Formatter("%(asctime)s %(levelname).1s %(name)s · %(message)s", datefmt="%H:%M:%S")
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if verbose else logging.INFO)
    for h in list(root.handlers):
        root.removeHandler(h)
    for h in (logging.StreamHandler(sys.stderr), logging.FileHandler(archivo, encoding="utf-8")):
        h.setFormatter(fmt)
        root.addHandler(h)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    return archivo


def _get_json(url: str, params: dict | None = None) -> tuple[int, dict | None]:
    """GET con reintentos ante 429/5xx/timeouts. Devuelve (status, json|None)."""
    for i, pausa in enumerate((*RETRY_SLEEPS, None)):
        if _stop.is_set():
            raise KeyboardInterrupt
        try:
            r = http.session().get(url, params=params, timeout=(15, 90))
        except requests.RequestException as e:
            if pausa is None:
                raise
            log.warning("   %s → %s; reintento %d en %ds", url[-60:], e.__class__.__name__, i + 1, pausa)
            time.sleep(pausa)
            continue
        if r.status_code == 200:
            try:
                return 200, r.json()
            except ValueError as e:
                if pausa is None:
                    raise RuntimeError(f"JSON inválido en {url}") from e
                time.sleep(pausa)
                continue
        if r.status_code == 429 or r.status_code >= 500:
            if pausa is None:
                raise RuntimeError(f"HTTP {r.status_code} persistente en {url}")
            log.warning("   HTTP %d; reintento %d en %ds", r.status_code, i + 1, pausa)
            time.sleep(pausa)
            continue
        return r.status_code, None
    return 0, None


def escribir_gz(path: Path, data: bytes) -> tuple[str, int, bool]:
    """Escribe `data` gzip-determinista (mtime=0) en `path`. Devuelve (sha256 del .gz, bytes, escrito).
    Si ya existe un archivo idéntico (mismo sha) no lo reescribe (escrito=False)."""
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb", mtime=0, compresslevel=6) as gz:
        gz.write(data)
    blob = buf.getvalue()
    sha = hashlib.sha256(blob).hexdigest()
    if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == sha:
        return sha, len(blob), False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_bytes(blob)
    tmp.replace(path)
    return sha, len(blob), True


def leer_gz(path: Path) -> dict:
    with gzip.open(path, "rb") as f:
        return json.load(f)


def ruta_record(corto: str) -> Path:
    aa = corto[-2:].rjust(2, "0")
    return BATCH_DIR / "records" / aa / f"{corto}.json.gz"


def _relativa(p: Path) -> str:
    return p.relative_to(BATCH_DIR).as_posix()


def _ventanas(desde: str, hasta: str, dias: int) -> list[tuple[str, str]]:
    d0, d1 = dt.date.fromisoformat(desde), dt.date.fromisoformat(hasta)
    if d1 < d0:
        raise SystemExit(f"--hasta ({hasta}) es anterior a --desde ({desde})")
    out = []
    a = d0
    while a <= d1:
        b = min(a + dt.timedelta(days=dias - 1), d1)
        out.append((a.isoformat(), b.isoformat()))
        a = b + dt.timedelta(days=1)
    return out


def _parse_ventana(s: str) -> int:
    m = re.fullmatch(r"(\d+)([dD]?)", s.strip())
    if not m:
        raise SystemExit(f"--ventana inválida: {s!r} (ej. 7d)")
    return max(1, int(m.group(1)))


def _lote_de_tipo(est: Estado, lote_id: str | None, tipo: str) -> dict | None:
    if not lote_id:
        return None
    lote = est.lote(lote_id)
    if not lote:
        raise SystemExit(f"lote {lote_id} no existe en {est.path}")
    return lote if lote["tipo"] == tipo else None


def _imprimir_lote(lote_id: str) -> None:
    (BATCH_DIR / "ultimo_lote").write_text(lote_id + "\n", encoding="utf-8")
    print(lote_id, flush=True)


def _resumen_final(est: Estado, lote_id: str, t0: float, titulo: str) -> None:
    r = est.resumen(lote_id)
    seg = max(1e-6, time.time() - t0)
    log.info("━━ %s · lote %s · ok %d · fallidos %d (agotados %d) · pendientes %d · %.1f MB · %.1f ítems/s · %.0fs",
             titulo, lote_id, r["completed"], r["failed"], r["agotados"], r["pending"] + r["processing"],
             r["bytes"] / 1e6, r["completed"] / seg, seg)


def _correr_paralelo(est: Estado, lote_id: str, paralelo: int, fn: Callable[[dict], None],
                     presupuesto: Callable[[], bool] | None = None, cada: int = 50) -> None:
    """Reclama ítems de a `paralelo*2`, los procesa en hilos y reporta progreso. `fn(item)` debe
    llamar a `est.marcar`. `presupuesto()` → False corta el reclamo (p. ej. GB por noche)."""
    hechos = 0
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=paralelo) as ex:
        futs: set = set()
        try:
            while not _stop.is_set():
                if presupuesto and not presupuesto():
                    log.info("   presupuesto agotado; dejo el resto pendiente")
                    break
                faltan = paralelo * 2 - len(futs)
                if faltan > 0:
                    claves = est.reclamar(lote_id, faltan)
                    for c in claves:
                        item = est.item(lote_id, c)
                        futs.add(ex.submit(fn, item))
                if not futs:
                    break
                done, futs = wait(futs, timeout=1, return_when=FIRST_COMPLETED)
                for f in done:
                    exc = f.exception()
                    if exc and not isinstance(exc, KeyboardInterrupt):
                        log.error("   error no controlado: %s", exc)
                    hechos += 1
                    if hechos % cada == 0:
                        r = est.resumen(lote_id)
                        log.info("   %d/%d · ok %d · fallidos %d · %.1f MB · %.1f ítems/s",
                                 r["completed"] + r["agotados"], r["total"], r["completed"], r["failed"],
                                 r["bytes"] / 1e6, hechos / max(1e-6, time.time() - t0))
        except KeyboardInterrupt:
            _stop.set()
            log.warning("   Ctrl+C: dejo el lote %s en processing; reanudá con el mismo comando --lote %s", lote_id, lote_id)
            ex.shutdown(wait=False, cancel_futures=True)
            raise


# ── releases ────────────────────────────────────────────────────────────
def _bajar_ventana(est: Estado, lote_id: str, item: dict) -> None:
    clave = item["clave"]
    meta = item.get("meta") or {}
    desde, hasta = meta.get("desde"), meta.get("hasta")
    if not desde or not hasta:
        desde, hasta = clave.split("_", 1)
    url: str | None = meta.get("siguiente") or f"{BASE}/releasesAfter"
    params: dict | None = None if meta.get("siguiente") else {"size": PAGE, "startDate": desde, "endDate": hasta}
    n = int(meta.get("paginas") or 0)
    n_rels = int(meta.get("releases") or 0)
    shas: list[str] = [] if not n else list(meta.get("shas") or [])
    total_bytes = int(meta.get("bytes") or 0)
    ocids: set[str] = set()
    ocids_previos = int(meta.get("ocids") or 0)          # aproximado si se reanuda a mitad de ventana
    carpeta = BATCH_DIR / "releases" / clave
    try:
        while url:
            if _stop.is_set():
                raise KeyboardInterrupt
            status, data = _get_json(url, params)
            params = None
            if data is None:
                raise RuntimeError(f"HTTP {status} en la ventana {clave}")
            rels = data.get("releases") or []
            if not rels:
                break
            n += 1
            n_rels += len(rels)
            for rel in rels:
                oc = short_ocid(rel.get("ocid") or "")
                if oc:
                    ocids.add(oc)
            sha, nb, _ = escribir_gz(carpeta / f"page-{n:04d}.json.gz", json.dumps(data, ensure_ascii=False).encode("utf-8"))
            shas.append(sha)
            total_bytes += nb
            url = (data.get("links") or {}).get("next") or None
            # checkpoint por página: Ctrl+C retoma desde `siguiente`
            est.marcar(lote_id, clave, "processing", meta={
                "desde": desde, "hasta": hasta, "siguiente": url, "paginas": n, "releases": n_rels,
                "ocids": ocids_previos + len(ocids), "bytes": total_bytes, "shas": shas})
        sha_total = hashlib.sha256("".join(shas).encode()).hexdigest()
        est.marcar(lote_id, clave, "completed", sha256=sha_total, bytes=total_bytes, ruta=_relativa(carpeta),
                   meta={"desde": desde, "hasta": hasta, "siguiente": None, "paginas": n, "releases": n_rels,
                         "ocids": ocids_previos + len(ocids), "bytes": total_bytes, "shas": shas})
        log.info("   %s · %d pág · %d releases · %d ocids · %.1f MB", clave, n, n_rels, ocids_previos + len(ocids), total_bytes / 1e6)
    except KeyboardInterrupt:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("   %s falló: %s", clave, e)
        est.marcar(lote_id, clave, "failed", error=str(e)[:500])


def cmd_releases(args: argparse.Namespace) -> None:
    est = Estado()
    t0 = time.time()
    lote = _lote_de_tipo(est, args.lote, "releases")
    if lote:
        lote_id = lote["id"]
        if args.reponer:
            est.reponer_procesando(lote_id)
        log.info("━━ releases · reanudo lote %s (%s → %s)", lote_id, lote["desde"], lote["hasta"])
    else:
        if args.lote:
            raise SystemExit(f"--lote {args.lote} no es un lote de releases")
        if not args.desde:
            raise SystemExit("falta --desde (o --lote para reanudar)")
        hasta = args.hasta or dt.date.today().isoformat()
        dias = _parse_ventana(args.ventana)
        ventanas = _ventanas(args.desde, hasta, dias)
        lote_id = est.nuevo_lote("releases", args.desde, hasta, nota=f"ventana {dias}d · {len(ventanas)} ventanas")
        est.agregar_items(lote_id, {f"{a}_{b}": {"desde": a, "hasta": b} for a, b in ventanas})
        log.info("━━ releases · lote %s · %s → %s · %d ventanas de %dd", lote_id, args.desde, hasta, len(ventanas), dias)
    try:
        _correr_paralelo(est, lote_id, args.paralelo, lambda it: _bajar_ventana(est, lote_id, it), cada=5)
    finally:
        _resumen_final(est, lote_id, t0, "releases")
        est.close()
    _imprimir_lote(lote_id)


def ocids_de_lote_releases(est: Estado, lote_id: str) -> dict[str, str]:
    """{ocid corto: ocid completo} de todas las páginas completadas del lote de releases."""
    out: dict[str, str] = {}
    for it in est.items(lote_id, "completed"):
        carpeta = BATCH_DIR / it["ruta"]
        for pagina in sorted(carpeta.glob("page-*.json.gz")):
            for rel in leer_gz(pagina).get("releases") or []:
                full = rel.get("ocid") or ""
                corto = short_ocid(full)
                if corto:
                    out[corto] = full
    return out


# ── records ─────────────────────────────────────────────────────────────
def _ocid_completo(corto: str, meta: dict | None) -> str:
    full = (meta or {}).get("ocid")
    if full:
        return full
    return corto if corto.startswith("ocds-") else OCID_PREFIX + corto


def _bajar_record(est: Estado, lote_id: str, item: dict) -> None:
    corto = item["clave"]
    full = _ocid_completo(corto, item.get("meta"))
    try:
        status, data = _get_json(f"{BASE}/record/{full}")
        recs = (data or {}).get("records") or []
        if data is None or not recs:
            est.marcar(lote_id, corto, "failed", error=f"HTTP {status}" if data is None else "sin records", meta={"ocid": full})
            return
        rec = recs[0]
        comp = rec.get("compiledRelease") or {}
        path = ruta_record(corto)
        sha, nb, escrito = escribir_gz(path, json.dumps(rec, ensure_ascii=False).encode("utf-8"))
        tender = comp.get("tender") or {}
        n_docs = len(tender.get("documents") or []) + sum(len(a.get("documents") or []) for a in comp.get("awards") or []) \
            + sum(len(c.get("documents") or []) for c in comp.get("contracts") or [])
        est.marcar(lote_id, corto, "completed", sha256=sha, bytes=nb, ruta=_relativa(path), meta={
            "ocid": full, "tag": comp.get("tag"), "date": comp.get("date"), "documentos": n_docs,
            "releases": len(rec.get("releases") or []), "sin_cambios": not escrito})
    except KeyboardInterrupt:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("   %s falló: %s", corto, e)
        est.marcar(lote_id, corto, "failed", error=str(e)[:500], meta={"ocid": full})


def cmd_records(args: argparse.Namespace) -> None:
    est = Estado()
    t0 = time.time()
    lote = _lote_de_tipo(est, args.lote, "records")
    if lote:
        lote_id = lote["id"]
        if args.reponer:
            est.reponer_procesando(lote_id)
        log.info("━━ records · reanudo lote %s · %s", lote_id, lote["nota"] or "")
    else:
        candidatos: dict[str, str] = {}
        origen = ""
        if args.lote:
            rel = est.lote(args.lote)
            if rel["tipo"] != "releases":
                raise SystemExit(f"--lote {args.lote} debe ser de releases (o de records para reanudar)")
            candidatos = ocids_de_lote_releases(est, args.lote)
            origen = f"releases {args.lote}"
        if args.ocids:
            for linea in Path(args.ocids).read_text(encoding="utf-8").splitlines():
                s = linea.strip()
                if s and not s.startswith("#"):
                    candidatos[short_ocid(s)] = s if s.startswith("ocds-") else OCID_PREFIX + s
            origen = (origen + " + " if origen else "") + f"archivo {args.ocids}"
        if not candidatos:
            raise SystemExit("nada que bajar: pasá --lote <releases-…> o --ocids archivo.txt")
        ya = set() if args.incluir_existentes else est.claves_completadas("records")
        nuevos = sorted(c for c in candidatos if c not in ya)
        recortado = len(nuevos) > args.max_por_noche
        nuevos = nuevos[: args.max_por_noche]
        log.info("━━ records · %d ocids en %s · %d ya descargados · %d nuevos%s", len(candidatos), origen,
                 len(candidatos) - len(set(candidatos) - ya), len(nuevos), " (recortado por --max-por-noche)" if recortado else "")
        if not nuevos:
            log.info("   nada nuevo que bajar")
            est.close()
            return
        lote_id = est.nuevo_lote("records", nota=f"desde {origen} · {len(nuevos)} ocids")
        est.agregar_items(lote_id, {c: {"ocid": candidatos[c]} for c in nuevos})
        log.info("   lote %s · %d ítems", lote_id, len(nuevos))
    try:
        _correr_paralelo(est, lote_id, args.paralelo, lambda it: _bajar_record(est, lote_id, it))
    finally:
        _resumen_final(est, lote_id, t0, "records")
        est.close()
    _imprimir_lote(lote_id)


# ── documentos ──────────────────────────────────────────────────────────
_gcs_cliente = None


def leer_record_item(it: dict) -> dict | None:
    """Record de un ítem de lote: del archivo local o, si `subir --limpiar` ya lo borró, del bucket
    (`meta.archivos[0].gs`). None si no está en ningún lado."""
    global _gcs_cliente
    path = BATCH_DIR / it["ruta"] if it.get("ruta") else None
    if path and path.exists():
        return leer_gz(path)
    gs = ((it.get("meta") or {}).get("archivos") or [{}])[0].get("gs")
    if not gs:
        return None
    try:
        from google.cloud import storage
        if _gcs_cliente is None:
            _gcs_cliente = storage.Client()
        bucket, _, name = gs[5:].partition("/")
        raw = _gcs_cliente.bucket(bucket).blob(name).download_as_bytes()
        return json.loads(gzip.decompress(raw).decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        log.warning("   no pude leer %s desde GCS: %s", it.get("clave"), str(e)[:120])
        return None


def documentos_de_record(rec: dict) -> list[dict]:
    """Documentos de tender + awards + contracts del compiledRelease, con `seccion`."""
    comp = rec.get("compiledRelease") or rec
    out: list[dict] = []
    for d in (comp.get("tender") or {}).get("documents") or []:
        out.append({**d, "seccion": "tender"})
    for a in comp.get("awards") or []:
        for d in a.get("documents") or []:
            out.append({**d, "seccion": "award"})
    for c in comp.get("contracts") or []:
        for d in c.get("documents") or []:
            out.append({**d, "seccion": "contract"})
    return [d for d in out if d.get("url")]


def extension_de(meta: dict) -> str:
    """format OCDS (mime o extensión) → extensión corta: application/pdf → pdf."""
    fmt = str(meta.get("format") or "").lower().strip().lstrip(".")
    fmt = {"application/pdf": "pdf", "application/zip": "zip"}.get(fmt, fmt)
    return fmt if EXT_RE.match(fmt) else "bin"


def _bajar_documento(est: Estado, lote_id: str, item: dict, contador: dict, lock: threading.Lock) -> None:
    clave = item["clave"]
    meta = item.get("meta") or {}
    url = meta.get("url")
    corto = meta.get("ocid_corto") or clave.split("/", 1)[0]
    try:
        # dedup por URL: el mismo archivo publicado en otro lote/proceso
        previo = est.completado_por_meta("documentos", "url", url)
        if previo and previo["ruta"] and (BATCH_DIR / previo["ruta"]).exists() and previo["clave"] != clave:
            est.marcar(lote_id, clave, "completed", sha256=previo["sha256"], bytes=0, ruta=previo["ruta"],
                       meta={**meta, "dedup_de": previo["clave"], "bytes_reales": previo["bytes"]})
            return
        aa = corto[-2:].rjust(2, "0")
        carpeta = BATCH_DIR / "documentos" / aa / corto
        tmp = carpeta / f"{clave.rsplit('/', 1)[-1]}.descargando"
        for k, espera in enumerate((*ESPERA_403, None)):
            try:
                _, sha, nb = http.download(url, tmp)
                break
            except requests.HTTPError as e:
                if e.response is None or e.response.status_code != 403 or espera is None or _stop.is_set():
                    raise
                log.warning("   %s HTTP 403 (WAF por ráfaga); espero %ds y reintento %d/%d", clave, espera, k + 1, len(ESPERA_403))
                time.sleep(espera)
        time.sleep(contador.get("pausa", PAUSA_DOCS))
        final = carpeta / f"{sha[:8]}.{extension_de(meta)}"
        if final.exists():
            tmp.unlink(missing_ok=True)
        else:
            tmp.replace(final)
        ruta = _relativa(final)
        otro = est.sha_presente(sha)
        if otro and otro["ruta"] and otro["ruta"] != ruta and (BATCH_DIR / otro["ruta"]).exists():
            final.unlink(missing_ok=True)          # mismo PDF ya guardado bajo otro ocid
            ruta = otro["ruta"]
            meta = {**meta, "dedup_de": otro["clave"]}
        with lock:
            contador["bytes"] += nb
            contador["403_seguidos"] = 0
        est.marcar(lote_id, clave, "completed", sha256=sha, bytes=nb, ruta=ruta, meta={**meta, "bytes_reales": nb})
    except KeyboardInterrupt:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("   %s falló: %s", clave, str(e)[:160])
        est.marcar(lote_id, clave, "failed", error=str(e)[:500])
        if isinstance(e, requests.HTTPError) and e.response is not None and e.response.status_code == 403:
            with lock:
                contador["403_seguidos"] += 1
                if contador["403_seguidos"] >= MAX_403_SEGUIDOS and not _stop.is_set():
                    log.error("   %d HTTP 403 seguidos: el SEACE está bloqueando esta IP; corto la noche. "
                              "Reanudá otro día con: descargar documentos --lote %s", MAX_403_SEGUIDOS, lote_id)
                    _stop.set()


def cmd_documentos(args: argparse.Namespace) -> None:
    est = Estado()
    t0 = time.time()
    lote = _lote_de_tipo(est, args.lote, "documentos")
    if lote:
        lote_id = lote["id"]
        if args.reponer:
            est.reponer_procesando(lote_id)
        log.info("━━ documentos · reanudo lote %s · %s", lote_id, lote["nota"] or "")
    else:
        rec_lote = est.lote(args.lote) if args.lote else None
        if not rec_lote or rec_lote["tipo"] != "records":
            raise SystemExit("--lote debe ser un lote de records (o de documentos para reanudar)")
        ya = set() if getattr(args, "incluir_existentes", False) else est.claves_completadas("documentos")
        nuevos: dict[str, dict] = {}
        n_docs = n_records = 0
        for it in est.items(args.lote, "completed"):
            rec = leer_record_item(it)
            if rec is None:
                continue
            n_records += 1
            for d in documentos_de_record(rec):
                n_docs += 1
                if args.politica == "clave" and d.get("documentType") not in DOC_TIPOS_CLAVE:
                    continue
                clave = f"{it['clave']}/{d.get('id') or hashlib.sha1(d['url'].encode()).hexdigest()[:12]}"
                if clave in ya:
                    continue
                nuevos[clave] = {"url": d["url"], "documentType": d.get("documentType"), "format": d.get("format"),
                                 "title": (d.get("title") or "")[:200], "seccion": d["seccion"], "ocid_corto": it["clave"],
                                 "datePublished": d.get("datePublished")}
        log.info("━━ documentos · %d records · %d documentos · política %s · %d nuevos", n_records, n_docs, args.politica, len(nuevos))
        if not nuevos:
            log.info("   nada nuevo que bajar")
            est.close()
            return
        lote_id = est.nuevo_lote("documentos", nota=f"desde records {args.lote} · política {args.politica} · {len(nuevos)} docs")
        est.agregar_items(lote_id, nuevos)
        log.info("   lote %s · %d ítems", lote_id, len(nuevos))
    contador = {"bytes": 0, "403_seguidos": 0, "pausa": args.pausa}
    lock = threading.Lock()
    tope = int(args.max_gb_por_noche * 1e9)
    try:
        _correr_paralelo(est, lote_id, args.paralelo,
                         lambda it: _bajar_documento(est, lote_id, it, contador, lock),
                         presupuesto=lambda: contador["bytes"] < tope, cada=20)
    finally:
        _resumen_final(est, lote_id, t0, "documentos")
        est.close()
    _imprimir_lote(lote_id)


# ── pedidos de descarga (migración 15) ──────────────────────────────────
def _pg():
    import psycopg
    from backend.scrapers._core.pipeline import pg_dsn
    return psycopg.connect(pg_dsn())


def cmd_pedidos(args: argparse.Namespace) -> None:
    """Contratos que alguien financió y cuyos documentos no están (o expiraron) en GCS.
    Toma los `pedidos_descarga` pendientes de Cloud SQL, baja record + TODOS sus documentos y
    deja dos lotes (records, documentos) para `subir` + `vigia-ingest`, que cierra los pedidos
    (`cerrar_pedidos_atendidos()`) y re-encola los procesamientos. Imprime los ids de lote
    (uno por línea) como últimas líneas de stdout."""
    with _pg() as conn, conn.cursor() as cur:
        # 3 noches sin lograrlo → fallido, y el procesamiento queda en error (visible en /admin).
        cur.execute("""UPDATE pedidos_descarga SET estado = 'fallido', error = COALESCE(error, 'sin documentos tras 3 noches')
                       WHERE estado = 'descargando' AND intentos >= 3 AND tomado_at < now() - interval '20 hours'
                       RETURNING ocid""")
        fallidos = [r[0] for r in cur.fetchall()]
        if fallidos:
            cur.execute("""UPDATE procesamientos SET estado = 'error', error = 'documentos no descargables tras 3 noches'
                           WHERE estado = 'esperando_documentos' AND ocid = ANY(%s)""", (fallidos,))
            log.warning("   %d pedidos fallidos tras 3 noches: %s", len(fallidos), ", ".join(fallidos[:10]))
        cur.execute("""UPDATE pedidos_descarga p SET estado = 'descargando', tomado_at = now(), intentos = intentos + 1
                       FROM (SELECT id FROM pedidos_descarga
                              WHERE estado = 'pendiente' OR (estado = 'descargando' AND tomado_at < now() - interval '20 hours')
                              ORDER BY solicitado_at LIMIT %s FOR UPDATE SKIP LOCKED) t
                       WHERE p.id = t.id
                       RETURNING p.id, p.ocid,
                         (SELECT c.ocds_payload->>'ocid' FROM convocatorias c WHERE ocid_corto(c.ocid) = ocid_corto(p.ocid) LIMIT 1)""",
                    (args.max,))
        pedidos = cur.fetchall()
        conn.commit()
    log.info("━━ pedidos · %d contratos financiados esperan documentos", len(pedidos))
    if not pedidos:
        return
    carpeta = BATCH_DIR / "pedidos"
    carpeta.mkdir(parents=True, exist_ok=True)
    archivo = carpeta / f"{time.strftime('%Y%m%d-%H%M%S')}.txt"
    lineas = []
    for _id, corto, full in pedidos:
        full = full if (full or "").startswith("ocds-") else (corto if corto.startswith("ocds-") else OCID_PREFIX + corto)
        lineas.append(full)
    archivo.write_text("\n".join(lineas) + "\n", encoding="utf-8")

    # record siempre de nuevo (puede haber cambiado: adjudicación, contrato) y todos los documentos.
    cmd_records(argparse.Namespace(lote=None, ocids=str(archivo), max_por_noche=len(lineas), paralelo=args.paralelo,
                                   incluir_existentes=True, reponer=False))
    lote_rec = (BATCH_DIR / "ultimo_lote").read_text(encoding="utf-8").strip()
    cmd_documentos(argparse.Namespace(lote=lote_rec, politica="todo", paralelo=1, pausa=args.pausa,
                                      max_gb_por_noche=args.max_gb_por_noche, reponer=False, incluir_existentes=True))
    lote_doc = (BATCH_DIR / "ultimo_lote").read_text(encoding="utf-8").strip()
    with _pg() as conn, conn.cursor() as cur:
        cur.execute("UPDATE pedidos_descarga SET lote_id = %s WHERE id = ANY(%s)",
                    (lote_rec, [p[0] for p in pedidos]))
        conn.commit()
    print(lote_rec, flush=True)
    if lote_doc != lote_rec:
        print(lote_doc, flush=True)


# ── CLI ─────────────────────────────────────────────────────────────────
def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-v", "--verbose", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("releases", help="páginas crudas de /releasesAfter por ventanas de fecha")
    r.add_argument("--desde", help="YYYY-MM-DD (fecha de convocatoria mínima)")
    r.add_argument("--hasta", help="YYYY-MM-DD (default hoy)")
    r.add_argument("--ventana", default="7d", help="tamaño de ventana, ej. 7d (default)")
    r.add_argument("--lote", help="reanudar un lote de releases existente")
    r.add_argument("--paralelo", type=int, default=2, help="ventanas en paralelo (default 2)")
    r.add_argument("--reponer", action="store_true", help="devolver a pending los ítems en processing (proceso muerto)")
    r.set_defaults(fn=cmd_releases)

    c = sub.add_parser("records", help="/record/<ocid> de los ocids nuevos de un lote de releases")
    c.add_argument("--lote", help="lote de releases (fuente de ocids) o de records (reanudar)")
    c.add_argument("--ocids", help="archivo con un ocid por línea (corto o completo)")
    c.add_argument("--paralelo", type=int, default=4)
    c.add_argument("--max-por-noche", type=int, default=20000)
    c.add_argument("--incluir-existentes", action="store_true", help="re-bajar también ocids ya descargados (refresco)")
    c.add_argument("--reponer", action="store_true")
    c.set_defaults(fn=cmd_records)

    d = sub.add_parser("documentos", help="archivos (PDF/ZIP) de records ya descargados")
    d.add_argument("--lote", required=True, help="lote de records (fuente) o de documentos (reanudar)")
    d.add_argument("--politica", choices=("clave", "todo"), default="clave",
                   help="clave = biddingDocuments/awardNotice/contractSigned (default) · todo = todos")
    d.add_argument("--paralelo", type=int, default=1, help="hilos (default 1: el WAF del SEACE bloquea ráfagas)")
    d.add_argument("--pausa", type=float, default=PAUSA_DOCS, help="segundos entre documentos (default 1.5)")
    d.add_argument("--max-gb-por-noche", type=float, default=20.0)
    d.add_argument("--reponer", action="store_true")
    d.add_argument("--incluir-existentes", action="store_true", help="re-bajar también documentos ya descargados (tras expirar en GCS)")
    d.set_defaults(fn=cmd_documentos)

    q = sub.add_parser("pedidos", help="contratos financiados sin documentos en GCS (pedidos_descarga): record + todos los docs")
    q.add_argument("--max", type=int, default=200, help="pedidos por noche (default 200)")
    q.add_argument("--paralelo", type=int, default=4, help="hilos para los records")
    q.add_argument("--pausa", type=float, default=PAUSA_DOCS)
    q.add_argument("--max-gb-por-noche", type=float, default=20.0)
    q.set_defaults(fn=cmd_pedidos)

    args = ap.parse_args(argv)
    archivo = configurar_logs(args.verbose)
    log.info("log: %s", archivo)
    try:
        args.fn(args)
    except KeyboardInterrupt:
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
