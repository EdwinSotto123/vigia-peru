"""OECE Contrataciones Abiertas (API OCDS) → cola de auditoría real.

Verificado 2026-09-14 desde IP peruana (403 desde GCP → correr desde laptop/VPS):

  GET https://contratacionesabiertas.oece.gob.pe/api/v1/releasesAfter?size=100&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
    · `startDate`/`endDate` filtran por `tender.tenderPeriod.startDate` (fecha de convocatoria), inclusivos.
    · Pagina con cursor: se sigue `links.next` hasta que venga vacío. Sin tope de resultados.
    · `/releases` (paginación clásica) devuelve SIEMPRE 20 por página (ignora `limit`/`size`)
      y corta en 10 000 resultados ("haz sobrepasado el límite numérico") → no sirve para backfill.
    · Un mismo proceso aparece en varios releases (planning, tender, award…): se deduplica por
      ocid quedándose con el release más reciente (`date`).
  Cada release trae parties[buyer].address = {department, region (=provincia), locality (=distrito)}
  → ubigeo INEI exacto vía `_core.ubigeo.resolve_ubigeo`.

Ingesta LIVIANA: no llama a SUNAT ni baja documentos; solo registra la convocatoria y la
entidad para que existan en la cola. El análisis completo lo hace el orquestador cuando
un aporte la financia (dispatcher).

`convocatorias.ocid` guarda el sufijo corto del OCID ('1249710' o '2026-10404-12'), igual
que el orquestador (`tools/_core._short_ocid`): así la alerta que persiste el pipeline
cierra la asignación por FK.

  python -m backend.scrapers.oece_ocds.pipeline --since 2026-06-15                # backfill 90 días
  python -m backend.scrapers.oece_ocds.pipeline                                   # diario: últimos 7 días
  python -m backend.scrapers.oece_ocds.pipeline --since 2026-09-13 --max-pages 2 --dry-run
"""

from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import time
from pathlib import Path

import requests

from .._core import http
from .._core.pipeline import Pipeline, log, pg_dsn
from .._core.ubigeo import ZonaIndex, resolve_ubigeo

BASE = "https://contratacionesabiertas.oece.gob.pe/api/v1"
PAGE = 100                      # máximo que acepta `size` en /releasesAfter
OCID_PREFIX = "ocds-dgv273-seacev3-"
DEFAULT_WINDOW_DAYS = 7         # el release de una convocatoria sale días después del inicio del tenderPeriod
RETRY_SLEEPS = (2, 5, 10, 20, 40)   # segundos entre reintentos ante 429/5xx/timeout
UMBRAL_UBIGEO = 0.85            # bajo esto, se listan los tríos sin match para ajustar `norm`


def short_ocid(ocid: str) -> str:
    """'ocds-dgv273-seacev3-1212353' → '1212353' · 'ocds-dgv273-seacev3-2026-10404-12' → '2026-10404-12'."""
    s = str(ocid or "")
    if s.startswith(OCID_PREFIX):
        return s[len(OCID_PREFIX):]
    if s.startswith("ocds-"):
        return s.rsplit("-", 1)[-1]
    return s


def slug_region(name: str | None) -> str | None:
    """'SAN IGNACIO' → 'San Ignacio' (misma convención que backend/scripts/ingest)."""
    if not name:
        return None
    name = " ".join(str(name).split()).title()
    return name.replace("Ancash", "Áncash").replace("Junin", "Junín")


def _buyer_party(rel: dict) -> dict:
    for p in rel.get("parties") or []:
        roles = p.get("roles") or []
        if "buyer" in roles or "procuringEntity" in roles:
            return p
    return {}


def _buyer_ruc(party: dict) -> str | None:
    for ai in party.get("additionalIdentifiers") or []:
        if ai.get("scheme") == "PE-RUC" and len(str(ai.get("id", ""))) == 11:
            return str(ai["id"])
    ident = party.get("identifier") or {}
    if ident.get("scheme") == "PE-RUC" and len(str(ident.get("id", ""))) == 11:
        return str(ident["id"])
    return None


def normalize_release(rel: dict, ix: ZonaIndex) -> dict | None:
    """Release OCDS → fila de convocatorias (+ entidad). None si no hay ocid o buyer RUC."""
    ocid = short_ocid(rel.get("ocid") or "")
    party = _buyer_party(rel)
    ruc = _buyer_ruc(party)
    if not ocid or not ruc:
        return None
    addr = party.get("address") or {}
    tender = rel.get("tender") or {}
    value = tender.get("value") or {}
    periodo = tender.get("tenderPeriod") or {}
    fecha = (periodo.get("startDate") or tender.get("datePublished") or rel.get("date") or "")[:10] or None
    departamento, provincia, distrito = addr.get("department"), addr.get("region"), addr.get("locality")
    return {
        "ocid": ocid,
        "codigo": str(tender.get("id") or ocid),
        "date": rel.get("date") or "",
        "entidad_ruc": ruc,
        "entidad_nombre": (rel.get("buyer") or {}).get("name") or party.get("name"),
        "objeto": (tender.get("description") or tender.get("title") or "")[:600],
        "cuantia": value.get("amount_PEN") or value.get("amount"),
        "fecha": fecha,
        "region": slug_region(provincia or departamento),
        "departamento": departamento, "provincia": provincia, "distrito": distrito,
        "ubigeo": resolve_ubigeo(ix, departamento, provincia, distrito),
        "categoria": tender.get("mainProcurementCategory"),
        "estado_tender": tender.get("status"),
        "payload": {k: rel.get(k) for k in ("ocid", "id", "date", "tag", "buyer", "tender") if k in rel},
    }


def _get_json(url: str, params: dict | None = None) -> dict | None:
    """GET con reintentos progresivos ante 429/5xx/timeouts (además del Retry de la sesión).
    Devuelve None si la API responde un error definitivo (4xx distinto de 429)."""
    for i, pausa in enumerate((*RETRY_SLEEPS, None)):
        try:
            r = http.session().get(url, params=params, timeout=(15, 90))
        except requests.RequestException as e:
            if pausa is None:
                raise
            log.warning("   %s → %s; reintento %d en %ds", url.split("?")[0].rsplit("/", 1)[-1], e.__class__.__name__, i + 1, pausa)
            time.sleep(pausa)
            continue
        if r.status_code == 200:
            return r.json()
        if r.status_code == 429 or r.status_code >= 500:
            if pausa is None:
                raise RuntimeError(f"HTTP {r.status_code} persistente en {url}")
            log.warning("   HTTP %d; reintento %d en %ds", r.status_code, i + 1, pausa)
            time.sleep(pausa)
            continue
        log.warning("   HTTP %d → %s", r.status_code, r.text[:160].replace("\n", " "))
        return None
    return None


class OcdsIncrementalPipeline(Pipeline):
    name = "oece_ocds"
    description = "OECE OCDS API — releases por fecha de convocatoria → convocatorias + entidades (cola real)"
    schedule = "diario 06:00 (desde IP peruana)"

    def __init__(self, **kw):
        super().__init__(**kw)
        hoy = dt.date.today()
        self.since = (hoy - dt.timedelta(days=DEFAULT_WINDOW_DAYS)).isoformat()
        self.until = hoy.isoformat()
        self.max_pages = 3000
        self.rows: dict[str, dict] = {}                      # ocid corto → fila (release más reciente)
        self.sin_match: collections.Counter[tuple[str | None, str | None, str | None]] = collections.Counter()

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--since", default=None, help=f"YYYY-MM-DD, fecha de convocatoria mínima (default: hoy - {DEFAULT_WINDOW_DAYS} días)")
        ap.add_argument("--until", default=None, help="YYYY-MM-DD, fecha de convocatoria máxima (default: hoy)")
        ap.add_argument("--max-pages", type=int, default=3000, help=f"tope total de páginas de {PAGE} (3000 = 300 000 releases)")

    def configure(self, args: argparse.Namespace) -> None:
        self.since = args.since or self.since
        self.until = args.until or self.until
        self.max_pages = args.max_pages

    # ── zonas ───────────────────────────────────────────────────────────
    def _zona_index(self) -> ZonaIndex:
        import psycopg2

        conn = psycopg2.connect(pg_dsn())
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT ubigeo, nivel, nombre, padre_ubigeo FROM zonas")
                return ZonaIndex.from_rows(cur.fetchall())
        finally:
            conn.close()

    # ── fetch ───────────────────────────────────────────────────────────
    def _dias(self) -> list[str]:
        d0, d1 = dt.date.fromisoformat(self.since), dt.date.fromisoformat(self.until)
        return [(d0 + dt.timedelta(days=i)).isoformat() for i in range((d1 - d0).days + 1)]

    def _walk_day(self, dia: str, ix: ZonaIndex, budget: int) -> tuple[int, int]:
        """Recorre todas las páginas de un día (cursor `links.next`). Devuelve (páginas, releases)."""
        url: str | None = f"{BASE}/releasesAfter"
        params: dict | None = {"size": PAGE, "startDate": dia, "endDate": dia}
        n_pages = n_rels = 0
        while url and n_pages < budget:
            data = _get_json(url, params)
            params = None                                    # `links.next` ya trae la query completa
            if not data:
                break
            rels = data.get("releases") or []
            if not rels:
                break
            n_pages += 1
            n_rels += len(rels)
            for rel in rels:
                row = normalize_release(rel, ix)
                if not row:
                    continue
                prev = self.rows.get(row["ocid"])
                if prev is None or row["date"] > prev["date"]:
                    self.rows[row["ocid"]] = row
            url = (data.get("links") or {}).get("next")
        return n_pages, n_rels

    def fetch(self) -> list[Path]:
        ix = self._zona_index()
        dias = self._dias()
        log.info("   ventana %s → %s (%d días) · tope %d páginas", self.since, self.until, len(dias), self.max_pages)
        out_dir = self.store.dir / dt.date.today().isoformat()
        out_dir.mkdir(parents=True, exist_ok=True)
        raw = out_dir / f"releases_{self.since}_{self.until}.ndjson"
        total_pages = total_rels = 0
        t0 = time.time()
        for dia in dias:
            budget = self.max_pages - total_pages
            if budget <= 0:
                log.warning("   tope de páginas alcanzado en %s; corto", dia)
                break
            n_pages, n_rels = self._walk_day(dia, ix, budget)
            total_pages += n_pages
            total_rels += n_rels
            if n_rels:
                log.info("   %s · %3d pág · %5d releases · %6d ocids acumulados · %.0fs", dia, n_pages, n_rels, len(self.rows), time.time() - t0)
        for row in self.rows.values():
            if not row["ubigeo"]:
                self.sin_match[(row["departamento"], row["provincia"], row["distrito"])] += 1
        with raw.open("w", encoding="utf-8") as f:
            for row in self.rows.values():
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        n = len(self.rows)
        con_ubigeo = n - sum(self.sin_match.values())
        distrito = sum(1 for r in self.rows.values() if r["ubigeo"] and len(r["ubigeo"]) == 6)
        pct = con_ubigeo / max(1, n)
        log.info("   %d páginas · %d releases · %d convocatorias únicas · %d con ubigeo (%.0f%%) · %d a nivel distrito",
                 total_pages, total_rels, n, con_ubigeo, 100 * pct, distrito)
        if self.sin_match and (pct < UMBRAL_UBIGEO or self.dry_run):
            log.warning("   tríos (department, region, locality) sin match — top %d:", min(25, len(self.sin_match)))
            for trio, k in self.sin_match.most_common(25):
                log.warning("     %4d × %r", k, trio)
        return [raw]

    # ── load ────────────────────────────────────────────────────────────
    def load(self, paths: list[Path]) -> None:
        rows = list(self.rows.values())
        if self.dry_run:
            log.info("   [dry-run] %d filas (no se escribe)", len(rows))
            return
        if not rows:
            log.info("   nada que cargar")
            return
        import psycopg2
        from psycopg2.extras import Json, execute_values

        ents = {r["entidad_ruc"]: r for r in rows}
        conn = psycopg2.connect(pg_dsn())
        try:
            with conn.cursor() as cur:
                # entidades.ubigeo es CHAR(6) = distrito; sólo se guarda cuando se resolvió a ese nivel.
                execute_values(cur, """
                    INSERT INTO entidades (ruc, nombre, region, provincia, distrito, ubigeo)
                    VALUES %s
                    ON CONFLICT (ruc) DO UPDATE SET
                      ubigeo    = COALESCE(NULLIF(entidades.ubigeo, ''), EXCLUDED.ubigeo),
                      region    = COALESCE(entidades.region, EXCLUDED.region),
                      provincia = COALESCE(entidades.provincia, EXCLUDED.provincia),
                      distrito  = COALESCE(entidades.distrito, EXCLUDED.distrito),
                      updated_at = now()""",
                    [(r["entidad_ruc"], (r["entidad_nombre"] or "")[:300],
                      slug_region(r["departamento"]), slug_region(r["provincia"]), slug_region(r["distrito"]),
                      r["ubigeo"] if r["ubigeo"] and len(r["ubigeo"]) == 6 else None)
                     for r in ents.values()],
                    page_size=500)
                # No se pisa lo que ya cargó el orquestador (objeto, cuantía, payload completo).
                execute_values(cur, """
                    INSERT INTO convocatorias (ocid, codigo, entidad_ruc, objeto, cuantia_referencial, fecha_convocatoria,
                                               region, ubigeo, categoria, estado_tender, fuente, ocds_payload)
                    VALUES %s
                    ON CONFLICT (ocid) DO UPDATE SET
                      ubigeo              = COALESCE(convocatorias.ubigeo, EXCLUDED.ubigeo),
                      objeto              = CASE WHEN convocatorias.objeto = '' THEN EXCLUDED.objeto ELSE convocatorias.objeto END,
                      cuantia_referencial = COALESCE(convocatorias.cuantia_referencial, EXCLUDED.cuantia_referencial),
                      fecha_convocatoria  = COALESCE(convocatorias.fecha_convocatoria, EXCLUDED.fecha_convocatoria),
                      region              = COALESCE(convocatorias.region, EXCLUDED.region),
                      categoria           = COALESCE(convocatorias.categoria, EXCLUDED.categoria),
                      estado_tender       = COALESCE(EXCLUDED.estado_tender, convocatorias.estado_tender),
                      updated_at          = now()""",
                    [(r["ocid"], r["codigo"], r["entidad_ruc"], r["objeto"], r["cuantia"], r["fecha"], r["region"],
                      r["ubigeo"], r["categoria"], r["estado_tender"], "ocds_api", Json(r["payload"]))
                     for r in rows],
                    page_size=500)
                conn.commit()
                log.info("   → convocatorias upsert %d · entidades %d", len(rows), len(ents))
                t0 = time.time()
                cur.execute("SELECT refresh_financiamiento()")
                conn.commit()
                log.info("   → refresh_financiamiento() en %.0fs", time.time() - t0)
        finally:
            conn.close()


if __name__ == "__main__":
    OcdsIncrementalPipeline.cli()
