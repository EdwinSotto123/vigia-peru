"""Registro de Visitas en Línea (PCM/SEGDI) vía PNDA → tabla `visitas_entidades`.

Fuente verificada 2026-09-14:
  https://www.datosabiertos.gob.pe/dataset/reporte-de-registro-de-visitas-en-linea-<mes>-<año>
  (un dataset por mes, XLSX ~2 MB, columnas: Fecha de Registro, Fecha de Visita,
   Entidad visitada, Visitante, Documento del visitante, Entidad del visitante,
   Funcionario visitado, Hora Ingreso, Hora Salida, Motivo)

Es exactamente el formato de dataset/VISITANTES_ENTIDADES/visita_a_entidades.xlsx
(descargado a mano en mayo 2026), así que reutiliza `load_visitas_entidades.py`.

El portal en vivo (visitas.servicios.gob.pe/consultas) tiene Turnstile de
Cloudflare → no se scrapea; la PNDA publica el consolidado mensual.
"""

from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path

from .._core import pnda
from .._core.pipeline import Pipeline, run_loader

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "setiembre", "octubre", "noviembre", "diciembre"]


def slug_for(year: int, month: int) -> str:
    return f"reporte-de-registro-de-visitas-en-linea-{MESES[month - 1]}-{year}"


def months_between(start: dt.date, end: dt.date) -> list[tuple[int, int]]:
    out = []
    cur = start.replace(day=1)
    while cur <= end.replace(day=1):
        out.append((cur.year, cur.month))
        cur = (cur.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    return out


class VisitasPipeline(Pipeline):
    name = "pnda_visitas"
    description = "Registro de Visitas en Línea (mensual, PNDA) → visitas_entidades"
    schedule = "mensual (día 15: el mes anterior ya suele estar publicado)"

    def __init__(self, **kw):
        super().__init__(**kw)
        today = dt.date.today()
        m, y = today.month - 3, today.year
        while m < 1:
            m, y = m + 12, y - 1
        self.months = months_between(dt.date(y, m, 1), today)

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--since", default=None, help="YYYY-MM desde el que bajar (default: últimos 3 meses)")

    def configure(self, args: argparse.Namespace) -> None:
        if args.since:
            y, m = map(int, args.since.split("-"))
            self.months = months_between(dt.date(y, m, 1), dt.date.today())

    def fetch(self) -> list[Path]:
        paths = []
        for y, m in self.months:
            try:
                ds = pnda.fetch_dataset(slug_for(y, m))
            except LookupError:
                continue  # ese mes todavía no está publicado
            for r in ds.data_resources((".xlsx", ".xls", ".csv")):
                paths.append(self.store.fetch(r.url, r.filename, ds.modified, force=self.force))
        return paths

    def load(self, paths: list[Path]) -> None:
        for p in paths:
            if p.suffix.lower() in (".xlsx", ".xls"):
                run_loader("load_visitas_entidades.py", "--xlsx", str(p), dry_run=self.dry_run)


if __name__ == "__main__":
    VisitasPipeline.cli()
