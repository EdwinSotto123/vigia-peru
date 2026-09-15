"""Muestreo reproducible del volumen real del SEACE (API OCDS de la OECE).

Mide, no estima a ojo:
  (a) conteos de releases y ocids únicos en 3 meses por año (cursor completo de
      `/releasesAfter`) → extrapolación a año e histórico;
  (b) tamaño en bytes del record completo (`/record/<ocid>`) para N ocids
      tomados al azar de `convocatorias`, estratificados por `categoria`
      (goods / services / works);
  (c) `HEAD` a los documentos del record (máx `--docs-por-record`) para leer
      `Content-Length` por `documentType` y `format`;
  (d) percentiles (p50, p90, media, máx) por tipo de contrato y tipo de documento.

Solo funciona desde IP peruana (la API OCDS bloquea GCP). Salida incremental:
el JSON se reescribe tras cada mes contado y cada lote de records, así que
`--reanudar` retoma sin repetir lo ya medido.

  python -m backend.batch.muestreo --records 300 --docs-por-record 6 \
      --anios 2019,2022,2025 --salida docs/design/volumen_muestra.json --reanudar
  python -m backend.batch.muestreo --sin-conteos --records 50        # solo records + HEAD
  python -m backend.batch.muestreo --sin-records --anios 2016         # solo conteos

Conexión a Postgres: `pg_dsn()` (PG* env + `.cloudsql-password`); contra Cloud SQL
por IP pública exportar `PGHOST=<ip> PGSSLMODE=require`.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import random
import re
import threading
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

log = logging.getLogger("batch.muestreo")

BASE = "https://contratacionesabiertas.oece.gob.pe/api/v1"
OCID_PREFIX = "ocds-dgv273-seacev3-"
PAGE = 100
MESES_DEFAULT = (1, 5, 9)                       # ene, may, sep: reparte el año sin sesgo estacional único
CATEGORIAS = ("goods", "services", "works")
DOC_TIPOS_CLAVE = ("biddingDocuments", "awardNotice", "contractSigned")
OCID_CORTO_RE = re.compile(r"^(\d+|\d{4}-\d+-\d+)$")
HEAD_TIMEOUT = (15, 60)
PAUSA_ENTRE_PAGINAS = 0.15                      # segundos; la API OCDS no publica cuota, esto evita 429
PAUSA_ENTRE_DOCS = 1.2                          # SEACE (prod1) devuelve 403 a ~50 requests en ráfaga (medido 2026-09-15)
COOLDOWN_403 = (60, 120, 240)                   # segundos de espera tras un 403 antes de reintentar el mismo doc
MAX_STREAM_BYTES = 64 << 20                     # prod4 (contratos) responde chunked sin Content-Length → se cuenta el cuerpo
ESTADOS_OK = ("head", "get", "stream", "stream_cap", "no_medido")


# ───────────────────────────── funciones puras (testeadas) ─────────────────────────────

def percentiles(valores: Iterable[float]) -> dict[str, float | int | None]:
    """p50/p90 con interpolación lineal (misma definición que numpy por defecto), media, máx, mín, suma.

    Devuelve `n=0` y el resto en None si no hay valores.
    """
    xs = sorted(float(v) for v in valores if v is not None)
    n = len(xs)
    if n == 0:
        return {"n": 0, "p50": None, "p90": None, "media": None, "max": None, "min": None, "suma": 0}

    def q(p: float) -> float:
        pos = (n - 1) * p
        lo = int(pos)
        hi = min(lo + 1, n - 1)
        return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)

    return {
        "n": n,
        "p50": q(0.50),
        "p90": q(0.90),
        "media": sum(xs) / n,
        "max": xs[-1],
        "min": xs[0],
        "suma": sum(xs),
    }


def extrapolar(conteos_mes: dict[str, dict[str, int]], meses_anio: int = 12) -> dict[str, Any]:
    """De {"2019-01": {"releases": r, "ocids": o}, …} (los meses medidos de UN año) a la proyección anual.

    - Promedia los meses medidos (incluidos los que dieron 0: se reportan aparte en `meses_vacios`
      para que el doc lo diga; no se inventa un valor para ellos).
    - `ratio_releases_ocid` = releases / ocids sobre lo medido (cuántas versiones tiene un proceso
      dentro del mes; una cota inferior del ratio histórico, porque las versiones posteriores caen
      en otros meses).
    """
    meses = sorted(conteos_mes)
    if not meses:
        return {"meses_medidos": 0, "meses_vacios": [], "releases_anio": 0, "ocids_anio": 0,
                "releases_mes_prom": 0.0, "ocids_mes_prom": 0.0, "ratio_releases_ocid": None}
    rel = [int(conteos_mes[m].get("releases", 0)) for m in meses]
    oc = [int(conteos_mes[m].get("ocids", 0)) for m in meses]
    vacios = [m for m, r in zip(meses, rel) if r == 0]
    rel_prom = sum(rel) / len(meses)
    oc_prom = sum(oc) / len(meses)
    return {
        "meses_medidos": len(meses),
        "meses_vacios": vacios,
        "releases_mes_prom": rel_prom,
        "ocids_mes_prom": oc_prom,
        "releases_anio": int(round(rel_prom * meses_anio)),
        "ocids_anio": int(round(oc_prom * meses_anio)),
        "ratio_releases_ocid": (sum(rel) / sum(oc)) if sum(oc) else None,
    }


def resumir(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Percentiles del tamaño de record, nº de docs y tamaño de doc por categoría / documentType / format."""
    por_cat: dict[str, list[float]] = defaultdict(list)
    docs_por_record: dict[str, list[float]] = defaultdict(list)
    doc_bytes_tipo: dict[str, list[float]] = defaultdict(list)
    doc_bytes_fmt: dict[str, list[float]] = defaultdict(list)
    doc_bytes_cat: dict[str, list[float]] = defaultdict(list)
    docs_tipo_n: Counter[str] = Counter()          # docs listados en el record (incluye los no medidos)
    docs_fmt_n: Counter[str] = Counter()
    docs_tipo_clave_por_record: list[float] = []
    head_estados: Counter[str] = Counter()
    releases_por_record: list[float] = []
    tags: Counter[str] = Counter()
    todos_doc_bytes: list[float] = []
    todos_record_bytes: list[float] = []

    for r in records:
        cat = r.get("categoria") or "desconocida"
        b = r.get("bytes")
        if b is not None:
            por_cat[cat].append(b)
            todos_record_bytes.append(b)
        docs = r.get("docs") or []
        docs_por_record[cat].append(len(docs))
        docs_tipo_clave_por_record.append(sum(1 for d in docs if d.get("documentType") in DOC_TIPOS_CLAVE))
        if r.get("n_releases") is not None:
            releases_por_record.append(r["n_releases"])
        for t in r.get("tags") or []:
            tags[t] += 1
        for d in docs:
            tipo = d.get("documentType") or "sin_tipo"
            fmt = (d.get("format") or "sin_formato").lower()
            docs_tipo_n[tipo] += 1
            docs_fmt_n[fmt] += 1
            if "status" in d:
                head_estados[str(d["status"])] += 1
            db = d.get("bytes")
            if db is not None:
                doc_bytes_tipo[tipo].append(db)
                doc_bytes_fmt[fmt].append(db)
                doc_bytes_cat[cat].append(db)
                todos_doc_bytes.append(db)

    return {
        "records_medidos": len(records),
        "record_bytes": {"total": percentiles(todos_record_bytes),
                         "por_categoria": {c: percentiles(v) for c, v in sorted(por_cat.items())}},
        "docs_por_record": {"total": percentiles([x for v in docs_por_record.values() for x in v]),
                            "por_categoria": {c: percentiles(v) for c, v in sorted(docs_por_record.items())},
                            "solo_tipos_clave": percentiles(docs_tipo_clave_por_record)},
        "docs_listados": {"por_tipo": dict(docs_tipo_n.most_common()), "por_formato": dict(docs_fmt_n.most_common())},
        "head_estados": dict(head_estados.most_common()),
        "doc_bytes": {"total": percentiles(todos_doc_bytes),
                      "por_tipo": {t: percentiles(v) for t, v in sorted(doc_bytes_tipo.items(), key=lambda kv: -len(kv[1]))},
                      "por_formato": {f: percentiles(v) for f, v in sorted(doc_bytes_fmt.items(), key=lambda kv: -len(kv[1]))},
                      "por_categoria": {c: percentiles(v) for c, v in sorted(doc_bytes_cat.items())}},
        "releases_por_record": percentiles(releases_por_record),
        "tags": dict(tags.most_common()),
    }


def ocid_corto(ocid: str) -> str:
    s = str(ocid or "")
    return s[len(OCID_PREFIX):] if s.startswith(OCID_PREFIX) else s


def meses_de(anio: int, meses: Iterable[int]) -> list[tuple[str, str, str]]:
    """[(clave 'YYYY-MM', startDate, endDate)] con endDate = último día del mes."""
    out = []
    for m in meses:
        ini = dt.date(anio, m, 1)
        fin = (dt.date(anio + 1, 1, 1) if m == 12 else dt.date(anio, m + 1, 1)) - dt.timedelta(days=1)
        out.append((f"{anio}-{m:02d}", ini.isoformat(), fin.isoformat()))
    return out


# ───────────────────────────── HTTP ─────────────────────────────

def _get(url: str, params: dict | None = None, timeout=(15, 90)):
    """GET con reintentos progresivos (además del Retry de la sesión) ante 429/5xx/timeouts."""
    import requests
    from backend.scrapers._core import http

    for i, pausa in enumerate((2, 5, 10, 20, 40, None)):
        try:
            r = http.session().get(url, params=params, timeout=timeout)
        except requests.RequestException as e:
            if pausa is None:
                raise
            log.warning("   %s → %s; reintento %d en %ds", url.rsplit("/", 1)[-1][:60], e.__class__.__name__, i + 1, pausa)
            time.sleep(pausa)
            continue
        if r.status_code == 429 or r.status_code >= 500:
            if pausa is None:
                raise RuntimeError(f"HTTP {r.status_code} persistente en {url}")
            log.warning("   HTTP %d; reintento %d en %ds", r.status_code, i + 1, pausa)
            time.sleep(pausa)
            continue
        return r
    raise RuntimeError("inalcanzable")


def contar_mes(start: str, end: str) -> dict[str, Any]:
    """Sigue el cursor completo de un mes y cuenta releases, ocids únicos, páginas y tags."""
    url: str | None = f"{BASE}/releasesAfter"
    params: dict | None = {"size": PAGE, "startDate": start, "endDate": end}
    releases = paginas = 0
    ocids: set[str] = set()
    tags: Counter[str] = Counter()
    t0 = time.time()
    while url:
        r = _get(url, params)
        params = None
        if r.status_code != 200:
            log.warning("   HTTP %d en %s → corto el mes", r.status_code, url[:120])
            break
        data = r.json()
        rels = data.get("releases") or []
        if not rels:
            break
        paginas += 1
        releases += len(rels)
        for rel in rels:
            ocids.add(rel.get("ocid") or "")
            for t in rel.get("tag") or []:
                tags[t] += 1
        url = (data.get("links") or {}).get("next")
        if paginas % 20 == 0:
            log.info("      … %d páginas · %d releases · %d ocids · %.0fs", paginas, releases, len(ocids), time.time() - t0)
        time.sleep(PAUSA_ENTRE_PAGINAS)
    return {"releases": releases, "ocids": len(ocids), "paginas": paginas,
            "segundos": round(time.time() - t0, 1), "tags": dict(tags.most_common())}


def primer_mes_con_datos(desde: int = 2000, hasta: int | None = None) -> str | None:
    """Sondea año a año (1 request por año) y luego mes a mes el primer año con releases."""
    hasta = hasta or dt.date.today().year
    primer_anio = None
    for y in range(desde, hasta + 1):
        r = _get(f"{BASE}/releasesAfter", {"size": 1, "startDate": f"{y}-01-01", "endDate": f"{y}-12-31"})
        if r.status_code == 200 and (r.json().get("releases") or []):
            primer_anio = y
            break
    if primer_anio is None:
        return None
    for clave, ini, fin in meses_de(primer_anio, range(1, 13)):
        r = _get(f"{BASE}/releasesAfter", {"size": 1, "startDate": ini, "endDate": fin})
        if r.status_code == 200 and (r.json().get("releases") or []):
            return clave
    return f"{primer_anio}-01"


def bajar_record(ocid_c: str) -> dict[str, Any] | None:
    """`/record/<ocid largo>` → bytes del JSON, docs (tender+awards+contracts), tags, nº de releases."""
    r = _get(f"{BASE}/record/{OCID_PREFIX}{ocid_c}")
    if r.status_code != 200:
        return {"ocid": ocid_c, "error": f"HTTP {r.status_code}"}
    nbytes = len(r.content)
    data = r.json()
    recs = data.get("records") or []
    rec = recs[0] if recs else data
    cr = rec.get("compiledRelease") or {}
    docs: list[dict[str, Any]] = []
    for d in (cr.get("tender") or {}).get("documents") or []:
        docs.append({"seccion": "tender", **_doc(d)})
    for a in cr.get("awards") or []:
        for d in a.get("documents") or []:
            docs.append({"seccion": "award", **_doc(d)})
    for c in cr.get("contracts") or []:
        for d in c.get("documents") or []:
            docs.append({"seccion": "contract", **_doc(d)})
    return {
        "ocid": ocid_c,
        "bytes": nbytes,
        "tags": cr.get("tag") or [],
        "n_releases": len(rec.get("releases") or []) or None,
        "n_awards": len(cr.get("awards") or []),
        "n_contracts": len(cr.get("contracts") or []),
        "n_docs": len(docs),
        "docs": docs,
    }


def _fmt(f: str | None) -> str | None:
    """'pdf' · 'application/pdf' → 'pdf'; 'application/x-zip-compressed' → 'zip'."""
    f = (f or "").lower().strip()
    if not f:
        return None
    f = f.rsplit("/", 1)[-1]
    return {"x-zip-compressed": "zip", "x-rar-compressed": "rar", "vnd.ms-excel": "xls", "msword": "doc",
            "vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
            "vnd.openxmlformats-officedocument.wordprocessingml.document": "docx"}.get(f, f)


def _doc(d: dict) -> dict[str, Any]:
    return {"documentType": d.get("documentType"), "format": _fmt(d.get("format")),
            "url": d.get("url"), "titulo": (d.get("title") or "")[:80]}


def medir_doc(doc: dict[str, Any]) -> dict[str, Any]:
    """Mide un documento sin bajarlo entero si se puede. Muta y devuelve `doc` sin la url.

    1. HEAD → Content-Length (prod1.seace.gob.pe lo da).
    2. GET stream → Content-Length; si viene chunked (prod4 `/api/con/documentos/descargar`),
       se lee el cuerpo contando bytes hasta MAX_STREAM_BYTES (`stream` / `stream_cap`).
    3. 403 = bloqueo por ráfaga: se espera COOLDOWN_403 y se reintenta; si persiste queda `http_403`.
    Serial y con pausa: SEACE corta a ~50 requests seguidas.
    """
    import requests
    from backend.scrapers._core import http

    url = doc.pop("url", None)
    if not url:
        doc.update({"bytes": None, "status": "sin_url"})
        return doc
    for intento, espera in enumerate((*COOLDOWN_403, None)):
        try:
            r = http.session().head(url, timeout=HEAD_TIMEOUT, allow_redirects=True)
            cl = r.headers.get("Content-Length")
            if r.status_code == 200 and cl and cl.isdigit():
                doc.update({"bytes": int(cl), "status": "head"})
                break
            if r.status_code == 403:
                raise _Bloqueo()
            with http.session().get(url, stream=True, timeout=HEAD_TIMEOUT, allow_redirects=True) as g:
                if g.status_code == 403:
                    raise _Bloqueo()
                cl = g.headers.get("Content-Length")
                if g.status_code == 200 and cl and cl.isdigit():
                    doc.update({"bytes": int(cl), "status": "get"})
                elif g.status_code == 200:
                    n = 0
                    for chunk in g.iter_content(chunk_size=1 << 20):
                        n += len(chunk)
                        if n >= MAX_STREAM_BYTES:
                            break
                    doc.update({"bytes": n, "status": "stream_cap" if n >= MAX_STREAM_BYTES else "stream"})
                else:
                    doc.update({"bytes": None, "status": f"http_{g.status_code}"})
            break
        except _Bloqueo:
            doc.update({"bytes": None, "status": "http_403"})
            if espera is None:
                break
            log.warning("   403 de SEACE (bloqueo por ráfaga); espero %ds y reintento (%d)", espera, intento + 1)
            time.sleep(espera)
        except requests.RequestException as e:
            doc.update({"bytes": None, "status": e.__class__.__name__})
            break
    time.sleep(PAUSA_ENTRE_DOCS)
    return doc


class _Bloqueo(Exception):
    pass


# ───────────────────────────── DB ─────────────────────────────

def elegir_ocids(n: int, excluir: set[str], seed: int) -> list[tuple[str, str]]:
    """N ocids (corto, categoria) al azar de `convocatorias`, proporcional a la distribución real por categoría."""
    import psycopg2
    from backend.scrapers._core.pipeline import pg_dsn

    conn = psycopg2.connect(pg_dsn())
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT categoria, count(*) FROM convocatorias WHERE categoria = ANY(%s) GROUP BY 1", (list(CATEGORIAS),))
            dist = dict(cur.fetchall())
            total = sum(dist.values()) or 1
            cuotas = {c: max(1, round(n * dist.get(c, 0) / total)) for c in CATEGORIAS if dist.get(c)}
            out: list[tuple[str, str]] = []
            rnd = random.Random(seed)
            for cat, k in cuotas.items():
                cur.execute("SELECT ocid FROM convocatorias WHERE categoria = %s", (cat,))
                cands = [ocid_corto(r[0]) for r in cur.fetchall()]
                cands = sorted({c for c in cands if OCID_CORTO_RE.match(c) and c not in excluir})
                rnd.shuffle(cands)
                out += [(c, cat) for c in cands[:k]]
            log.info("   DB: %s → cuotas %s → %d ocids nuevos", dist, cuotas, len(out))
            return out
    finally:
        conn.close()


# ───────────────────────────── orquestación ─────────────────────────────

def cargar(salida: Path, reanudar: bool) -> dict[str, Any]:
    if reanudar and salida.exists():
        est = json.loads(salida.read_text(encoding="utf-8"))
        log.info("   reanudo desde %s (%d records, %d meses)", salida, len(est.get("records", [])),
                 sum(len(y.get("meses", {})) for y in est.get("conteos", {}).values()))
        return est
    return {"generado": None, "parametros": {}, "api": {}, "conteos": {}, "records": [], "resumen": {}}


LOCK = threading.RLock()     # conteos y records corren en hilos distintos; `est` se toca bajo el lock


def guardar(salida: Path, est: dict[str, Any]) -> None:
    with LOCK:
        _guardar(salida, est)


def _guardar(salida: Path, est: dict[str, Any]) -> None:
    est["generado"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    est["resumen"] = resumir(est["records"])
    for anio, blk in est["conteos"].items():
        blk["extrapolado"] = extrapolar(blk.get("meses", {}))
    salida.parent.mkdir(parents=True, exist_ok=True)
    tmp = salida.with_suffix(".tmp")
    tmp.write_text(json.dumps(est, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(salida)


def correr_conteos(est: dict[str, Any], anios: list[int], meses: Iterable[int], salida: Path) -> None:
    meses = list(meses)
    hoy = dt.date.today()
    for anio in anios:
        blk = est["conteos"].setdefault(str(anio), {"meses": {}})
        for clave, ini, fin in meses_de(anio, meses):
            if dt.date.fromisoformat(ini) > hoy:
                log.info("   %s en el futuro; salto", clave)
                continue
            if clave in blk["meses"]:
                continue
            log.info("→ contando %s (%s → %s)", clave, ini, fin)
            res = contar_mes(ini, fin)
            if dt.date.fromisoformat(fin) > hoy:
                res["parcial_hasta"] = hoy.isoformat()
            with LOCK:
                blk["meses"][clave] = res
            log.info("   %s · %d releases · %d ocids · %d páginas · %.0fs", clave, res["releases"], res["ocids"], res["paginas"], res["segundos"])
            guardar(salida, est)


def correr_records(est: dict[str, Any], n: int, docs_por_record: int, salida: Path, seed: int) -> None:
    medidos = {r["ocid"] for r in est["records"]}
    faltan = n - len(medidos)
    if faltan <= 0:
        log.info("   ya hay %d records medidos (≥ %d); nada que hacer", len(medidos), n)
        return
    pares = elegir_ocids(faltan, medidos, seed)
    t0 = time.time()
    for i, (ocid_c, cat) in enumerate(pares, 1):
        rec = bajar_record(ocid_c)
        if rec is None:
            continue
        rec["categoria"] = cat
        if "error" not in rec:
            a_medir = rec["docs"][:docs_por_record]
            for d in rec["docs"][docs_por_record:]:
                d.pop("url", None)
                d["status"] = "no_medido"
            for d in a_medir:                   # serial a propósito (ver medir_doc)
                medir_doc(d)
        with LOCK:
            est["records"].append(rec)
        if i % 10 == 0 or i == len(pares):
            el = time.time() - t0
            log.info("   %d/%d records · %.0fs · %.1fs/record", i, len(pares), el, el / i)
            guardar(salida, est)
    guardar(salida, est)


def remedir_docs(est: dict[str, Any], docs_por_record: int, salida: Path) -> None:
    """Re-mide los docs con status fuera de ESTADOS_OK (típicamente http_403 por ráfaga)."""
    pendientes = [r for r in est["records"] if "error" not in r
                  and any(d.get("status") not in ESTADOS_OK for d in r.get("docs") or [])]
    log.info("→ remedir: %d records con docs fallidos", len(pendientes))
    t0 = time.time()
    for i, r in enumerate(pendientes, 1):
        fresco = bajar_record(r["ocid"])
        if not fresco or "error" in fresco or len(fresco["docs"]) != len(r["docs"]):
            log.warning("   %s: record cambió o no se pudo re-bajar; salto", r["ocid"])
            continue
        for k, (d, nd) in enumerate(zip(r["docs"], fresco["docs"])):
            if d.get("status") in ESTADOS_OK:
                continue
            if k >= docs_por_record:
                d["status"] = "no_medido"
                continue
            d["url"] = nd["url"]
            medir_doc(d)
        if i % 5 == 0 or i == len(pendientes):
            el = time.time() - t0
            log.info("   %d/%d records re-medidos · %.0fs", i, len(pendientes), el)
            guardar(salida, est)
    guardar(salida, est)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--records", type=int, default=300)
    ap.add_argument("--docs-por-record", type=int, default=6)
    ap.add_argument("--anios", default="2019,2022,2025")
    ap.add_argument("--meses", default=",".join(map(str, MESES_DEFAULT)), help="meses a contar por año (1-12)")
    ap.add_argument("--salida", type=Path, default=Path("dataset/_batch/muestreo.json"))
    ap.add_argument("--reanudar", action="store_true", help="no repetir meses/ocids ya presentes en --salida")
    ap.add_argument("--sin-conteos", action="store_true")
    ap.add_argument("--sin-records", action="store_true")
    ap.add_argument("--sin-sonda", action="store_true", help="no buscar el primer mes con datos de la API")
    ap.add_argument("--seed", type=int, default=20260915)
    ap.add_argument("--remedir", action="store_true",
                    help="volver a medir los docs que quedaron en 403/error (re-baja el record para recuperar las urls)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname).1s %(name)s · %(message)s", datefmt="%H:%M:%S")
    logging.getLogger("urllib3").setLevel(logging.WARNING)

    anios = [int(a) for a in args.anios.split(",") if a.strip()]
    meses = [int(m) for m in args.meses.split(",") if m.strip()]
    est = cargar(args.salida, args.reanudar)
    est["parametros"] = {"records": args.records, "docs_por_record": args.docs_por_record, "anios": anios,
                         "meses": meses, "seed": args.seed, "base": BASE}
    t0 = time.time()
    if not args.sin_sonda and not est["api"].get("primer_mes_con_datos"):
        log.info("→ sondeando desde qué mes tiene datos la API…")
        est["api"]["primer_mes_con_datos"] = primer_mes_con_datos()
        est["api"]["sondeado"] = dt.date.today().isoformat()
        log.info("   primer mes con releases: %s", est["api"]["primer_mes_con_datos"])
        guardar(args.salida, est)
    hilo = None
    if not args.sin_conteos:
        if args.sin_records:
            correr_conteos(est, anios, meses, args.salida)
        else:                                   # conteos (API OECE) en paralelo con records+HEAD (SEACE)
            hilo = threading.Thread(target=correr_conteos, args=(est, anios, meses, args.salida), daemon=True)
            hilo.start()
    if not args.sin_records:
        correr_records(est, args.records, args.docs_por_record, args.salida, args.seed)
    if args.remedir:
        remedir_docs(est, args.docs_por_record, args.salida)
    if hilo is not None:
        hilo.join()
    guardar(args.salida, est)
    log.info("✓ %s en %.0fs", args.salida, time.time() - t0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
