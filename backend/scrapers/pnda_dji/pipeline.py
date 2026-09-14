"""Declaraciones Juradas de Intereses (Contraloría) vía PNDA → tablas `dji_*`.

Fuentes verificadas 2026-09-14 (CSV directos, actualizados 2026-08/09):
  - declaraciones-juradas-de-intereses-presentadas-ante-la-contraloría-general-de-la-república
      Reporte1.csv (268 MB): CODIGO_DDJJ, TIPO_DOCUMENTO_FUNCIONARIO, APELLIDO_PATERNO,
      APELLIDO_MATERNO, NOMBRES, ENTIDAD, CARGO, FECHA_ELABORACION_DDJJ, FECHA_PRESENTACION_DDJJ,
      FECHA_INICIO_CARGO, FECHA_CESE_CARGO
  - empleos-declarados-en-las-declaraciones-juradas-de-intereses
      Reporte3.csv (442 MB): CODIGO_DDJJ, RUC_ENTIDAD_LABORO, NOMBRE_ENTIDAD_LABORO,
      CARGO_ENTIDAD_LABORO, FECHA_INICIO_CARGO, FECHA_CESE_CARGO, FECHA_ELABORACION_DDJJ,
      FECHA_PRESENTACION_DDJJ
  - familiares-declarados-en-las-declaraciones-juradas-de-intereses
      Reporte2.csv (723 MB): CODIGO_DDJJ, FECHA, TIPO_DOCUMENTO_FAMILIAR, PARENTESCO
      (sin nombres del familiar → NO alcanza para el cruce C4 por sí solo)

Por qué importa:
  · Reporte1 = funcionarios por entidad y cargo con fechas → cruce C8 (funcionario rota,
    proveedor lo sigue) sin depender de El Peruano.
  · Reporte3 = empleos previos con RUC del empleador → **puerta giratoria**: funcionario
    que firmó/evaluó una adjudicación y antes trabajó en la empresa ganadora (o viceversa).
    Cruce nuevo, no está en el catálogo C1-C8.

Esquema destino: backend/db/schemas/dji_schema.sql (dji_funcionarios, dji_empleos).
Las fechas vienen como DD/MM/YY o DD/MM/YYYY → se cargan como TEXT y se castean en SQL
(`to_date(..., 'DD/MM/YY')`) para no frenar el COPY de 300-700 MB.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from .._core import pnda
from .._core.pipeline import Pipeline, log, pg_dsn

DATASETS = {
    "funcionarios": (
        "declaraciones-juradas-de-intereses-presentadas-ante-la-contraloría-general-de-la-república",
        "Reporte1.csv",
    ),
    "empleos": ("empleos-declarados-en-las-declaraciones-juradas-de-intereses", "Reporte3.csv"),
    "familiares": ("familiares-declarados-en-las-declaraciones-juradas-de-intereses", "Reporte2.csv"),
}

# (tabla destino, columnas en el orden del CSV)
TARGETS = {
    "funcionarios": (
        "dji_funcionarios",
        ["codigo_ddjj", "tipo_documento", "apellido_paterno", "apellido_materno", "nombres",
         "entidad", "cargo", "fecha_elaboracion", "fecha_presentacion", "fecha_inicio_cargo", "fecha_cese_cargo"],
    ),
    "empleos": (
        "dji_empleos",
        ["codigo_ddjj", "ruc_entidad_raw", "nombre_entidad", "cargo", "fecha_inicio", "fecha_cese",
         "fecha_elaboracion", "fecha_presentacion"],
    ),
}


class DjiPipeline(Pipeline):
    name = "pnda_dji"
    description = "Declaraciones Juradas de Intereses (Contraloría, PNDA) → dji_funcionarios / dji_empleos"
    schedule = "mensual"

    def __init__(self, **kw):
        super().__init__(**kw)
        self.parts = ["funcionarios", "empleos"]

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--parts", default="funcionarios,empleos",
                        help="funcionarios,empleos,familiares (familiares pesa 723 MB y no trae nombres)")

    def configure(self, args: argparse.Namespace) -> None:
        self.parts = [p.strip() for p in args.parts.split(",") if p.strip()]

    def fetch(self) -> list[Path]:
        paths = []
        for part in self.parts:
            slug, fname = DATASETS[part]
            ds = pnda.fetch_dataset(slug)
            url = pnda.resource_url(ds, fname)
            if not url:
                log.warning("%s: no encontré %s en %s", part, fname, ds.url)
                continue
            paths.append(self.store.fetch(url, f"dji_{part}.csv", ds.modified, force=self.force))
        return paths

    def load(self, paths: list[Path]) -> None:
        for p in paths:
            part = p.stem.replace("dji_", "")
            if part not in TARGETS:
                log.info("   %s: solo crudo (sin tabla destino)", p.name)
                continue
            table, cols = TARGETS[part]
            if self.dry_run:
                with p.open(encoding="utf-8", errors="replace", newline="") as f:
                    n = sum(1 for _ in csv.reader(f)) - 1
                log.info("   [dry-run] %s → %s: %d filas", p.name, table, n)
                continue
            self._copy(p, table, cols)

    def _copy(self, path: Path, table: str, cols: list[str]) -> None:
        import psycopg2

        conn = psycopg2.connect(pg_dsn())
        try:
            with conn.cursor() as cur, path.open(encoding="utf-8", errors="replace") as f:
                cur.execute(f"TRUNCATE {table}")  # los reportes son fotos completas, no deltas
                cur.copy_expert(
                    f"COPY {table} ({', '.join(cols)}) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')", f
                )
                log.info("   %s → %s: %d filas", path.name, table, cur.rowcount)
                if table == "dji_empleos":
                    # 'RUC:20100211034' → '20100211034'
                    cur.execute("UPDATE dji_empleos SET ruc_entidad = substring(ruc_entidad_raw from '\\d{11}') WHERE ruc_entidad IS NULL")
            conn.commit()
        finally:
            conn.close()


if __name__ == "__main__":
    DjiPipeline.cli()
