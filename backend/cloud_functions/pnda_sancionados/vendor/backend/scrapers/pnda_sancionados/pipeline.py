"""Proveedores sancionados por el Tribunal de Contrataciones (OECE) vía PNDA → `osce_sancionados`.

Fuentes verificadas 2026-09-14 (todas con CSV/XLSX directo):
  - proveedores-sancionados-2025
      "Relación de proveedores sancionados … con sanción vigente.csv" (0.9 MB, sep ';', CP1252)
      columnas: INH;NRO;RAZON_SOCIAL;RUC;RESOLUCION;PERIODO_INH;DESDE;HASTA;INFRACCION;OTRA_INFRACCION
  - proveedores-sancionados-con-inhabilitación-vigente-organismo-especializado-para-las
  - proveedores-sancionados-con-multa-organismo-especializado-para-las-contrataciones-públicas
  - proveedores-sancionados-con-inhabilitación-organismo-especializado-para-las-contrataciones

El XLSX manual (dataset/SANCIONADOS/reporte_sancionados.xlsx) salía del buscador
apps.osce.gob.pe/perfilprov-ui (Angular + reCAPTCHA) — la PNDA es la vía estable.

Cruce: RUC con sanción vigente como ganador/postor/socio → bandera CRÍTICA (art. 50 TUO Ley 30225).
"""

from __future__ import annotations

import csv
import datetime as dt
from pathlib import Path

from .._core import pnda
from .._core.pipeline import Pipeline, log, pg_dsn

SLUGS = [
    "proveedores-sancionados-2025",
    "proveedores-sancionados-con-inhabilitación-vigente-organismo-especializado-para-las",
    "proveedores-sancionados-con-multa-organismo-especializado-para-las-contrataciones-públicas",
    "proveedores-sancionados-con-inhabilitación-organismo-especializado-para-las-contrataciones",
]

TIPOS = {"definitivo": "definitivo", "temporal": "temporal", "multa": "multa"}


def _date(s: str | None) -> dt.date | None:
    s = (s or "").strip()
    if len(s) == 8 and s.isdigit():          # YYYYMMDD
        return dt.date(int(s[:4]), int(s[4:6]), int(s[6:]))
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def normalize_csv(path: Path) -> list[dict]:
    """CSV del Tribunal → filas listas para osce_sancionados."""
    rows: list[dict] = []
    with path.open(encoding="cp1252", errors="replace", newline="") as f:
        for r in csv.DictReader(f, delimiter=";"):
            ruc = (r.get("RUC") or "").strip()
            if not ruc.isdigit():
                continue
            tipo = TIPOS.get((r.get("INH") or "").strip().lower(), "temporal")
            rs = (r.get("RAZON_SOCIAL") or "").strip()
            rows.append({
                "tipo": tipo,
                "razon_social": rs,
                "razon_social_norm": _norm(rs),
                "ruc": ruc.zfill(11),
                "es_persona_natural": ruc.startswith("10"),
                "resolucion": (r.get("RESOLUCION") or "").strip(),
                "periodo": (r.get("PERIODO_INH") or "").strip() or None,
                "fecha_desde": _date(r.get("DESDE")),
                "fecha_hasta": _date(r.get("HASTA")),
                "infraccion": ((r.get("INFRACCION") or "") + " " + (r.get("OTRA_INFRACCION") or "")).strip() or None,
            })
    return rows


def _norm(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return " ".join(s.upper().split())


class SancionadosPipeline(Pipeline):
    name = "pnda_sancionados"
    description = "Proveedores sancionados OECE (PNDA) → osce_sancionados"
    schedule = "semanal"

    def fetch(self) -> list[Path]:
        paths = []
        for slug in SLUGS:
            try:
                ds = pnda.fetch_dataset(slug)
            except LookupError as e:
                log.warning("%s", e)
                continue
            for r in ds.data_resources((".csv", ".xlsx", ".xls")):
                paths.append(self.store.fetch(r.url, r.filename, ds.modified, force=self.force))
        return paths

    def load(self, paths: list[Path]) -> None:
        rows: list[dict] = []
        for p in paths:
            if p.suffix.lower() == ".csv":
                r = normalize_csv(p)
                log.info("   %s → %d sanciones (%s)", p.name, len(r), ", ".join(sorted({x["tipo"] for x in r})))
                rows += r
            else:
                log.info("   %s: XLSX sin parser todavía (ver load_sancionados_osce.py para el formato de 3 hojas)", p.name)
        if self.dry_run or not rows:
            log.info("   [dry-run] %d filas normalizadas", len(rows))
            return
        import psycopg2
        from psycopg2.extras import execute_values

        cols = ["tipo", "razon_social", "razon_social_norm", "ruc", "es_persona_natural",
                "resolucion", "periodo", "fecha_desde", "fecha_hasta", "infraccion"]
        conn = psycopg2.connect(pg_dsn())
        try:
            with conn.cursor() as cur:
                # Columnas mínimas que garantiza backend/db/schemas/osce_sancionados_schema.sql;
                # el índice único (ruc, resolucion) evita duplicar entre los 4 datasets.
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS osce_sancionados_ruc_res_uq ON osce_sancionados (ruc, resolucion)")
                execute_values(
                    cur,
                    f"INSERT INTO osce_sancionados ({', '.join(cols)}) VALUES %s ON CONFLICT (ruc, resolucion) DO NOTHING",
                    [tuple(r[c] for c in cols) for r in rows],
                    page_size=1000,
                )
                log.info("   → osce_sancionados: %d filas nuevas", cur.rowcount)
            conn.commit()
        finally:
            conn.close()


if __name__ == "__main__":
    SancionadosPipeline.cli()
