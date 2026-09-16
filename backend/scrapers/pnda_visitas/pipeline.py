"""Registro de Visitas en Línea (PCM/SEGDI) vía PNDA → tabla `visitas_entidades`.

Fuente verificada 2026-09-16 (probando todos los slugs posibles 2024-01 → 2026-09):
  · 2025-01 … 2025-12  →  /dataset/reporte-de-registro-de-visitas-<mes>            (sin año en el slug)
  · 2026-01, 2026-02   →  /dataset/reporte-de-registro-de-visitas-<mes>-2026
  · 2026-03 … 2026-05  →  /dataset/reporte-de-registro-de-visitas-en-linea-<mes>-2026
  · 2024 y 2026-06+    →  no publicados (la PNDA empezó a publicar el consolidado en 2025;
                          el mes cerrado aparece con ~2-3 meses de retraso)
  Un XLSX por mes (2-5 MB, ~20-40 k filas). Columnas: Fecha de Registro, Fecha de Visita,
  Entidad visitada, Visitante, Documento del visitante, Entidad del visitante,
  Funcionario visitado, Hora Ingreso, Hora Salida, Motivo, Lugar específico, Observación.
  Solo cubre a las entidades que usan la plataforma de la PCM (no todas las entidades).

Es el mismo formato de dataset/VISITANTES_ENTIDADES/visita_a_entidades.xlsx, así que el
parseo lo hace `backend/scripts/load_visitas_entidades.py` (parse_row). La carga es por
**periodo** (AAAA-MM): se borra el periodo y se reinserta con `fuente/periodo/sha256/
descargado_at` (migración 23). `datasets_cargas` guarda el sha256 del XLSX por periodo:
si la PNDA no republicó el archivo, el mes se salta (idempotente para el cron mensual).

  python -m backend.scrapers.pnda_visitas.pipeline --desde 2025-01 --hasta 2026-05   # backfill
  python -m backend.scrapers.pnda_visitas.pipeline                                    # cron: últimos 4 meses
  python -m backend.scrapers.pnda_visitas.pipeline --desde 2026-03 --dry-run          # parsea, no escribe

HALLAZGO 2026-09-16: el dataset mensual de la PNDA lo publica el **Gobierno Regional de
Loreto** (una sola entidad visitada en los 17 meses). El registro de TODAS las entidades vive
en el portal de la PCM `visitas.servicios.gob.pe/consultas` (`POST /api/consultas-busqueda`
con busqueda|ruc, rango ≤ 90 días y token de Turnstile en modo `execute`/interaction-only).
Con Playwright (Chromium y Chrome) Turnstile nunca emite el token → la consulta no se
dispara. Mientras tanto se aceptan exportaciones manuales del botón "Excel" de ese portal:

  python -m backend.scrapers.pnda_visitas.pipeline --xlsx dataset/VISITANTES_ENTIDADES/visita_a_entidades.xlsx

que se cargan con `fuente='portal_visitas_manual'` partidas por mes y deduplicadas contra
las filas de la PNDA (misma entidad, fecha, documento y hora de ingreso).
"""

from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import sys
from pathlib import Path

from .._core import pnda
from .._core.pipeline import SCRIPTS_DIR, Pipeline, log, pg_dsn
from .._core.registro import Carga, registrar, ya_cargado
from .._core.storage import sha256_of

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "setiembre", "octubre", "noviembre", "diciembre"]
# La PNDA alterna "setiembre"/"septiembre" según quien publicó.
ALIAS_MES = {"setiembre": ["setiembre", "septiembre"]}
BASES = ["reporte-de-registro-de-visitas-en-linea", "reporte-de-registro-de-visitas"]


def slug_candidates(year: int, month: int) -> list[str]:
    """Slugs posibles para un mes, del más reciente al más antiguo en convención."""
    names = ALIAS_MES.get(MESES[month - 1], [MESES[month - 1]])
    out: list[str] = []
    for base in BASES:
        for mes in names:
            out.append(f"{base}-{mes}-{year}")
    for base in BASES:
        for mes in names:
            out.append(f"{base}-{mes}")            # 2025: sin año en el slug
    return out


def slug_for(year: int, month: int) -> str:      # compatibilidad con el código previo
    return slug_candidates(year, month)[0]


def months_between(start: dt.date, end: dt.date) -> list[tuple[int, int]]:
    out = []
    cur = start.replace(day=1)
    while cur <= end.replace(day=1):
        out.append((cur.year, cur.month))
        cur = (cur.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return out


def periodo_de(path: Path) -> str | None:
    """'REPORTE DE REGISTRO DE VISITAS - ENERO - 2025.xlsx' → '2025-01'."""
    up = path.stem.upper().replace("  ", " ")
    for i, mes in enumerate(MESES, 1):
        for alias in ALIAS_MES.get(mes, [mes]):
            if f"- {alias.upper()} -" in up or up.endswith(alias.upper()):
                for tok in up.replace("-", " ").split():
                    if tok.isdigit() and len(tok) == 4:
                        return f"{tok}-{i:02d}"
    return None


def _loader():
    """Importa backend/scripts/load_visitas_entidades.py (sin paquete) para reutilizar parse_row."""
    spec = importlib.util.spec_from_file_location("load_visitas_entidades", SCRIPTS_DIR / "load_visitas_entidades.py")
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules.setdefault("load_visitas_entidades", mod)
    spec.loader.exec_module(mod)
    return mod


def parse_xlsx(path: Path) -> tuple[list[dict], int]:
    """Filas normalizadas (dicts de parse_row) y cuántas se descartaron."""
    import openpyxl
    mod = _loader()
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows: list[dict] = []
    bad = 0
    header_seen = False
    for row in ws.iter_rows(values_only=True):
        if not header_seen:
            if row and mod.clean(row[0]).lower().startswith("fecha de registro"):
                header_seen = True
            continue
        r = mod.parse_row(row)
        if r is None:
            bad += 1
            continue
        rows.append(r)
    wb.close()
    return rows, bad


COLS = ["fecha_registro", "fecha_visita", "entidad_visitada", "entidad_visitada_norm",
        "visitante", "visitante_norm", "tipo_documento", "numero_documento",
        "tipo_entidad_visitante", "entidad_visitante",
        "funcionario_visitado", "funcionario_nombre", "funcionario_area", "funcionario_cargo",
        "hora_ingreso", "hora_salida", "duracion_min", "motivo", "lugar_especifico", "observacion"]


class VisitasPipeline(Pipeline):
    name = "pnda_visitas"
    description = "Registro de Visitas en Línea (mensual, PNDA) → visitas_entidades"
    schedule = "mensual (día 15: la PNDA publica el mes cerrado con 2-3 meses de retraso)"

    def __init__(self, **kw):
        super().__init__(**kw)
        today = dt.date.today()
        m, y = today.month - 4, today.year
        while m < 1:
            m, y = m + 12, y - 1
        self.months = months_between(dt.date(y, m, 1), today)
        self.periodo_por_archivo: dict[Path, tuple[str, str | None, str]] = {}   # path → (periodo, modified, url)
        self.manual_xlsx: list[Path] = []

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--desde", "--since", dest="desde", default=None, help="AAAA-MM inicial (default: últimos 4 meses)")
        ap.add_argument("--hasta", default=None, help="AAAA-MM final (default: hoy)")
        ap.add_argument("--xlsx", type=Path, action="append", default=[],
                        help="exportación manual del portal visitas.servicios.gob.pe (repetible); se carga con fuente=portal_visitas_manual")

    def configure(self, args: argparse.Namespace) -> None:
        self.manual_xlsx = [Path(x) for x in args.xlsx]
        hasta = dt.date.today()
        if args.hasta:
            y, m = map(int, args.hasta.split("-"))
            hasta = dt.date(y, m, 1)
        if args.desde:
            y, m = map(int, args.desde.split("-"))
            self.months = months_between(dt.date(y, m, 1), hasta)
        elif args.hasta:
            self.months = [(y, m) for (y, m) in self.months if (y, m) <= (hasta.year, hasta.month)]

    # ── fetch ────────────────────────────────────────────────────────────────────────
    def _find_dataset(self, y: int, m: int) -> pnda.Dataset | None:
        for slug in slug_candidates(y, m):
            try:
                ds = pnda.fetch_dataset(slug)
            except LookupError:
                continue
            # El slug sin año (2025) debe traer un archivo del año pedido.
            res = [r for r in ds.data_resources((".xlsx", ".xls", ".csv")) if str(y) in r.filename or str(y) in ds.title]
            if res:
                ds.resources = res
                return ds
        return None

    def fetch(self) -> list[Path]:
        if self.manual_xlsx:
            return list(self.manual_xlsx)
        paths: list[Path] = []
        for y, m in self.months:
            periodo = f"{y}-{m:02d}"
            ds = self._find_dataset(y, m)
            if ds is None:
                log.info("   %s: no publicado en la PNDA todavía", periodo)
                continue
            for r in ds.resources:
                p = self.store.fetch(r.url, r.filename, ds.modified, force=self.force, subdir=periodo)
                self.periodo_por_archivo[p] = (periodo, ds.modified, ds.url)
                paths.append(p)
        return paths

    # ── load ─────────────────────────────────────────────────────────────────────────
    def load(self, paths: list[Path]) -> None:
        import psycopg2
        from psycopg2.extras import execute_values

        if self.manual_xlsx:
            self._load_manual(paths)
            return
        conn = None if self.dry_run else psycopg2.connect(pg_dsn())
        try:
            for p in paths:
                periodo, modified, fuente_url = self.periodo_por_archivo.get(p, (periodo_de(p), None, None))
                if not periodo:
                    log.warning("   %s: no pude deducir el periodo, se omite", p.name)
                    continue
                entry = self.store.latest_by_file(p)
                sha = entry.sha256 if entry else ""
                if conn is not None:
                    with conn.cursor() as cur:
                        if not self.force and sha and ya_cargado(cur, self.name, periodo, sha):
                            log.info("   %s: ya cargado con el mismo sha256, se salta", periodo)
                            continue
                rows, bad = parse_xlsx(p)
                fechas = [r["fecha_visita"] for r in rows if r["fecha_visita"]]
                log.info("   %s → %d filas (%d descartadas) · visitas %s → %s", periodo, len(rows), bad,
                         min(fechas) if fechas else "-", max(fechas) if fechas else "-")
                if conn is None:
                    continue
                with conn.cursor() as cur:
                    # Reemplazo por periodo, solo de esta fuente (las exportaciones manuales del
                    # portal PCM conviven con otra `fuente` y no se tocan).
                    cur.execute("DELETE FROM visitas_entidades WHERE periodo = %s AND fuente = %s", (periodo, self.name))
                    borradas = cur.rowcount
                    execute_values(
                        cur,
                        f"INSERT INTO visitas_entidades ({', '.join(COLS)}, fuente, periodo, sha256, descargado_at) VALUES %s",
                        [tuple(r[c] for c in COLS) + (self.name, periodo, sha or None, entry.downloaded_at if entry else None) for r in rows],
                        page_size=2000,
                    )
                    registrar(cur, Carga(
                        fuente=self.name, clave=periodo, tabla="visitas_entidades", archivo=p.name,
                        gcs_uri=self.store.gcs_uri(p), sha256=sha or "sin-sha", bytes=entry.bytes if entry else None,
                        filas=len(rows), fuente_url=fuente_url,
                        descargado_at=dt.datetime.fromisoformat(entry.downloaded_at).astimezone() if entry else None,
                    ))
                conn.commit()
                log.info("   → visitas_entidades %s: -%d +%d", periodo, borradas, len(rows))
        finally:
            if conn is not None:
                conn.close()

    # ── exportaciones manuales del portal PCM (todas las entidades) ─────────────────
    FUENTE_MANUAL = "portal_visitas_manual"

    def _load_manual(self, paths: list[Path]) -> None:
        import psycopg2
        from psycopg2.extras import execute_values

        conn = None if self.dry_run else psycopg2.connect(pg_dsn())
        try:
            for p in paths:
                rows, bad = parse_xlsx(p)
                sha, nbytes = sha256_of(p)
                por_mes: dict[str, list[dict]] = {}
                for r in rows:
                    f = r["fecha_registro"] or r["fecha_visita"]
                    if f:
                        por_mes.setdefault(f.strftime("%Y-%m"), []).append(r)
                log.info("   %s → %d filas (%d descartadas) en %d meses: %s", p.name, len(rows), bad, len(por_mes),
                         ", ".join(f"{k}={len(v)}" for k, v in sorted(por_mes.items())))
                if conn is None:
                    continue
                with conn.cursor() as cur:
                    for periodo, rs in sorted(por_mes.items()):
                        clave = f"{periodo}/{p.stem}"
                        if not self.force and ya_cargado(cur, self.FUENTE_MANUAL, clave, sha):
                            log.info("   %s ya cargado (mismo sha256)", clave)
                            continue
                        cur.execute("DELETE FROM visitas_entidades WHERE periodo=%s AND fuente=%s AND sha256=%s", (periodo, self.FUENTE_MANUAL, sha))
                        execute_values(
                            cur,
                            f"INSERT INTO visitas_entidades ({', '.join(COLS)}, fuente, periodo, sha256, descargado_at) VALUES %s",
                            [tuple(r[c] for c in COLS) + (self.FUENTE_MANUAL, periodo, sha, dt.datetime.fromtimestamp(p.stat().st_mtime).astimezone()) for r in rs],
                            page_size=2000,
                        )
                        # Dedup contra la PNDA (GORE Loreto publica lo mismo en su dataset mensual).
                        cur.execute(
                            """DELETE FROM visitas_entidades m USING visitas_entidades o
                                WHERE m.fuente = %s AND m.periodo = %s AND o.fuente <> m.fuente
                                  AND o.entidad_visitada_norm = m.entidad_visitada_norm
                                  AND o.fecha_visita = m.fecha_visita
                                  AND COALESCE(o.numero_documento,'') = COALESCE(m.numero_documento,'')
                                  AND COALESCE(o.hora_ingreso, '00:00') = COALESCE(m.hora_ingreso, '00:00')""",
                            (self.FUENTE_MANUAL, periodo),
                        )
                        dup = cur.rowcount
                        registrar(cur, Carga(
                            fuente=self.FUENTE_MANUAL, clave=clave, tabla="visitas_entidades", archivo=p.name, sha256=sha,
                            bytes=nbytes, filas=len(rs) - dup, fuente_url="https://visitas.servicios.gob.pe/consultas",
                            descargado_at=dt.datetime.fromtimestamp(p.stat().st_mtime).astimezone(),
                        ))
                        log.info("   → visitas_entidades %s (%s): +%d (-%d duplicadas con la PNDA)", periodo, self.FUENTE_MANUAL, len(rs), dup)
                conn.commit()
        finally:
            if conn is not None:
                conn.close()


if __name__ == "__main__":
    VisitasPipeline.cli()
