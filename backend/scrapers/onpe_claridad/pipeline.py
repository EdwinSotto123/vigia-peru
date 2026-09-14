"""ONPE Claridad — aportes a organizaciones políticas → `onpe_aportantes`.

Estado verificado 2026-09-14:
  · https://claridad.onpe.gob.pe/           → 200 pero es el challenge de Cloudflare ("Just a moment…")
  · https://claridadportal.onpe.gob.pe/     → 403 a requests, incluso con User-Agent real
  · https://www.onpe.gob.pe/claridad/       → 403
  · La PNDA NO tiene dataset de aportantes (el slug "aportantes-onpe" redirige al buscador).

Es decir: no hay descarga directa. El CSV que tenemos (dataset/lista_aportantes/
lista-aportantes.csv, cabecera `Razón Social / Apellido Paterno;Apellido Materno;Nombres;
N° de DNI/RUC;…;Efectivo S/;Especie S/;Fecha del Aporte`) es el EXPORT del módulo
"Aportes → Lista de aportantes" de Claridad, bajado a mano desde el navegador.

Estrategia (Playwright, navegador real, IP peruana — desde el relay de Lima):
  1. Abrir claridad.onpe.gob.pe con Chromium headed o `channel="chrome"` (el challenge
     de Cloudflare pasa solo con navegador real; con headless puro suele quedarse).
  2. Navegar: Financiamiento privado → Aportes → seleccionar organización política y
     periodo → botón "Exportar" (CSV/XLSX).
  3. Guardar el archivo por partido/periodo en dataset/_raw/onpe_claridad/<fecha>/.
  4. Cargar con `load_aportantes_onpe.py` (ya maneja el formato).

Los selectores de abajo son un esqueleto: hay que ajustarlos la primera vez con
`PWDEBUG=1` porque Claridad cambia el frontend (rediseño anunciado 2026-07).
"""

from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path

from .._core.pipeline import Pipeline, log, run_loader

CLARIDAD_URL = "https://claridad.onpe.gob.pe/"


class ClaridadPipeline(Pipeline):
    name = "onpe_claridad"
    description = "ONPE Claridad (Playwright) — lista de aportantes → onpe_aportantes"
    schedule = "mensual (los partidos rinden por periodo; en campaña, semanal)"

    def __init__(self, **kw):
        super().__init__(**kw)
        self.partidos: list[str] = []
        self.headed = True
        self.manual_csv: Path | None = None

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--partido", action="append", default=[], help="nombre exacto en Claridad (repetible); vacío = todos")
        ap.add_argument("--headless", action="store_true", help="intentar sin ventana (Cloudflare suele bloquear)")
        ap.add_argument("--csv", type=Path, default=None, help="saltar el scraping y cargar este CSV exportado a mano")

    def configure(self, args: argparse.Namespace) -> None:
        self.partidos = args.partido
        self.headed = not args.headless
        self.manual_csv = args.csv

    def fetch(self) -> list[Path]:
        if self.manual_csv:
            return [self.manual_csv]
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise SystemExit("pip install playwright && playwright install chromium")

        out_dir = self.store.dir / dt.date.today().isoformat()
        out_dir.mkdir(parents=True, exist_ok=True)
        paths: list[Path] = []
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=not self.headed, channel="chrome")
            ctx = browser.new_context(locale="es-PE", accept_downloads=True)
            page = ctx.new_page()
            page.goto(CLARIDAD_URL, wait_until="domcontentloaded")
            # Cloudflare: esperar a que desaparezca el challenge (hasta 60 s).
            page.wait_for_function("!document.title.startsWith('Just a moment')", timeout=60_000)

            # TODO(selectores): ajustar con PWDEBUG=1 la primera vez.
            page.get_by_role("link", name="Financiamiento privado").click()
            page.get_by_role("link", name="Aportes").click()

            partidos = self.partidos or page.locator("select[name='organizacion'] option").all_inner_texts()
            for partido in partidos:
                partido = partido.strip()
                if not partido or partido.lower().startswith("seleccion"):
                    continue
                page.select_option("select[name='organizacion']", label=partido)
                page.get_by_role("button", name="Buscar").click()
                with page.expect_download() as dl:
                    page.get_by_role("button", name="Exportar").click()
                dest = out_dir / f"aportantes__{_slug(partido)}.csv"
                dl.value.save_as(dest)
                log.info("↓ %s", dest.name)
                paths.append(dest)
            browser.close()
        return paths

    def load(self, paths: list[Path]) -> None:
        for p in paths:
            run_loader("load_aportantes_onpe.py", "--csv", str(p), dry_run=self.dry_run)


def _slug(s: str) -> str:
    import re
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


if __name__ == "__main__":
    ClaridadPipeline.cli()
