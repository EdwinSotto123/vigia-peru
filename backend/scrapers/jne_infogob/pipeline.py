"""JNE Infogob — candidatos y autoridades electas por proceso → `jne_candidaturas`.

Origen de dataset/ELECCIONES/<TIPO> <AÑO>/<EG|ERM|ECE><AÑO>_(Candidatos|Autoridades)_X.xlsx:
es la nomenclatura exacta de las descargas de **Infogob** (https://infogob.jne.gob.pe →
"Base de datos" → proceso electoral → Candidatos / Autoridades → XLSX).

Estado verificado 2026-09-14:
  · https://infogob.jne.gob.pe/ y /BaseDatos → 200 pero devuelven 212 bytes: es una SPA
    que carga por JS (y el frontend usa reCAPTCHA Enterprise + Turnstile).
  · https://plataformaelectoral.jne.gob.pe/ → 200; su API es
    https://apiplataformaelectoral3.jne.gob.pe (endpoints no documentados; `/api/v1/…`
    responde 404 sin la ruta exacta — hay que capturarla desde DevTools).

Estrategia:
  A) Playwright sobre Infogob (descarga de XLSX por proceso). Los archivos caen en
     dataset/_raw/jne_infogob/<fecha>/<TIPO AÑO>/… con la misma estructura que
     dataset/ELECCIONES, así `load_jne_candidaturas.py --root` los carga sin cambios.
  B) (Futuro) API de la Plataforma Electoral para hojas de vida (formación, sentencias,
     bienes) — mucho más rico que Infogob, alimenta a person_network_agent.

`--root` permite saltar el scraping y cargar una carpeta ya descargada a mano.
"""

from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path

from .._core.pipeline import Pipeline, log, run_loader

INFOGOB_URL = "https://infogob.jne.gob.pe/BaseDatos"

# Procesos que hoy están en dataset/ELECCIONES (para el modo incremental: bajar solo los nuevos).
PROCESOS_CONOCIDOS = {
    "CONGRESAL 2016", "CONGRESAL 2020", "CONGRESAL 2021",
    "CONSEJERO REGIONAL 2018", "CONSEJERO REGIONAL 2022",
    "GOBERNADOR REGIONAL 2018", "GOBERNADOR REGIONAL 2022",
    "ALCALDE PROVINCIAL 2018", "ALCALDE PROVINCIAL 2022",
    "ALCALDE DISTRITAL 2018", "ALCALDE DISTRITAL 2022",
}


class InfogobPipeline(Pipeline):
    name = "jne_infogob"
    description = "JNE Infogob (Playwright) — candidatos/autoridades por proceso → jne_candidaturas"
    schedule = "por proceso electoral (2026: elecciones generales abril; regionales/municipales octubre)"

    def __init__(self, **kw):
        super().__init__(**kw)
        self.root: Path | None = None
        self.procesos: list[str] = []

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--root", type=Path, default=None, help="cargar esta carpeta (estructura dataset/ELECCIONES) sin scrapear")
        ap.add_argument("--proceso", action="append", default=[], help='ej. "CONGRESAL 2026" (repetible)')

    def configure(self, args: argparse.Namespace) -> None:
        self.root = args.root
        self.procesos = args.proceso

    def fetch(self) -> list[Path]:
        if self.root:
            return [self.root]
        try:
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise SystemExit("pip install playwright && playwright install chromium")

        out_root = self.store.dir / dt.date.today().isoformat()
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=False, channel="chrome")
            page = browser.new_context(locale="es-PE", accept_downloads=True).new_page()
            page.goto(INFOGOB_URL, wait_until="networkidle")

            # TODO(selectores): ajustar con PWDEBUG=1. Flujo en Infogob:
            #   Base de datos → [Proceso electoral ▼] → pestaña Candidatos | Autoridades → "Descargar Excel"
            procesos = self.procesos or [
                p for p in page.locator("select#proceso option").all_inner_texts() if p.strip() and p not in PROCESOS_CONOCIDOS
            ]
            for proceso in procesos:
                page.select_option("select#proceso", label=proceso)
                for tab in ("Candidatos", "Autoridades"):
                    page.get_by_role("tab", name=tab).click()
                    with page.expect_download() as dl:
                        page.get_by_role("button", name="Descargar").click()
                    dest = out_root / proceso / f"{proceso.replace(' ', '_')}_{tab}.xlsx"
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dl.value.save_as(dest)
                    log.info("↓ %s", dest.relative_to(out_root))
            browser.close()
        return [out_root]

    def load(self, paths: list[Path]) -> None:
        for root in paths:
            run_loader("load_jne_candidaturas.py", "--root", str(root), dry_run=self.dry_run)


if __name__ == "__main__":
    InfogobPipeline.cli()
