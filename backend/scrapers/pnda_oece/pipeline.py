"""Datasets del OECE publicados en la PNDA → `dataset/_raw/pnda_oece/` (crudos versionados).

Es el ORIGEN del snapshot SEACE/OECE que vive en dataset/ (bajado a mano en mayo 2026).
Slugs verificados 2026-09-14:
  - listado-de-ofertantes-–-organismo-especializado-para-las-contrataciones-públicas-eficientes
  - proveedores-y-consorcios-organismo-especializado-para-las-contrataciones-públicas-eficientes
  - profesionales-y-técnicos-certificados-en-el-sican-–-organismo-especializado-para-las
  - pronunciamientos-–-organismo-especializado-para-las-contrataciones-públicas-eficientes-oece
  - cuadernos-de-obra-digital-–-organismo-especializado-para-las-contrataciones-públicas
  - asientos-de-los-cuadernos-de-obra-digital-–-organismo-especializado-para-las-contrataciones
  - valorizaciones-de-obras-registradas-en-el-seace–-organismo-especializado-para-las

Los que NO están en la PNDA (convocatorias, adjudicaciones, contratos, órdenes, PAC, RNP
conformación jurídica) salen de CONOSCE / bi.seace.gob.pe (login, 401 anónimo) → para
convocatorias en vivo usar `oece_ocds` (API OCDS). Este pipeline solo descarga y
versiona; la carga a DB la hacen los scripts existentes (rnp_normalize, load_sanciones,
opiniones_oece_normalize) o DuckDB para análisis exploratorio.

`--discover` lista qué datasets OECE hay hoy en la PNDA y marca los que este archivo
todavía no conoce.
"""

from __future__ import annotations

import argparse
from pathlib import Path

from .._core import pnda
from .._core.pipeline import Pipeline, log

SLUGS = {
    "ofertantes": "listado-de-ofertantes-–-organismo-especializado-para-las-contrataciones-públicas-eficientes",
    "proveedores_consorcios": "proveedores-y-consorcios-organismo-especializado-para-las-contrataciones-públicas-eficientes",
    "sican": "profesionales-y-técnicos-certificados-en-el-sican-–-organismo-especializado-para-las",
    "pronunciamientos": "pronunciamientos-–-organismo-especializado-para-las-contrataciones-públicas-eficientes-oece",
    "cuadernos_obra": "cuadernos-de-obra-digital-–-organismo-especializado-para-las-contrataciones-públicas",
    "cuadernos_obra_asientos": "asientos-de-los-cuadernos-de-obra-digital-–-organismo-especializado-para-las-contrataciones",
    "valorizaciones": "valorizaciones-de-obras-registradas-en-el-seace–-organismo-especializado-para-las",
}


class OeceDatasetsPipeline(Pipeline):
    name = "pnda_oece"
    description = "Datasets OECE en la PNDA (ofertantes, consorcios, SICAN, pronunciamientos, obras) → crudos"
    schedule = "mensual"

    def __init__(self, **kw):
        super().__init__(**kw)
        self.only: list[str] = []

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--only", default="", help="subconjunto: " + ",".join(SLUGS))
        ap.add_argument("--discover", action="store_true", help="listar datasets OECE en la PNDA y salir")

    def configure(self, args: argparse.Namespace) -> None:
        self.only = [s for s in args.only.split(",") if s]
        if args.discover:
            known = set(SLUGS.values())
            for slug in pnda.search("contrataciones públicas eficientes", max_pages=4):
                print(("       " if slug in known else "NUEVO  ") + slug)
            raise SystemExit(0)

    def fetch(self) -> list[Path]:
        paths = []
        for key, slug in SLUGS.items():
            if self.only and key not in self.only:
                continue
            try:
                ds = pnda.fetch_dataset(slug)
            except LookupError as e:
                log.warning("%s", e)
                continue
            res = ds.data_resources()
            log.info("   %s: %d recurso(s), modificado %s", key, len(res), ds.modified)
            for r in res:
                paths.append(self.store.fetch(r.url, f"{key}__{r.filename}", ds.modified, force=self.force))
        return paths

    def load(self, paths: list[Path]) -> None:
        log.info("   %d crudos en %s — cargar con rnp_normalize.py / load_sanciones.py / DuckDB",
                 len(paths), self.store.dir)


if __name__ == "__main__":
    OeceDatasetsPipeline.cli()
