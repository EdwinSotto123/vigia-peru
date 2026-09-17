"""Cliente de la Plataforma Nacional de Datos Abiertos (datosabiertos.gob.pe).

La PNDA corre sobre DKAN (Drupal). Su API CKAN (`/api/3/action/...`) y `data.json`
NO responden (verificado 2026-09-14), así que se parsea el HTML de la página del
dataset, que es estable:

  - recursos:  <a href="https://www.datosabiertos.gob.pe/sites/default/files/<archivo>">
  - modificado: <div class="field-name-field-modified-date">YYYY-MM-DD</div>
  - búsqueda:  /search/type/dataset?query=<texto>&page=N  →  href="/dataset/<slug>"

De acá salen: OECE (ofertantes, proveedores y consorcios, sancionados, SICAN,
pronunciamientos, cuadernos de obra), Registro de Visitas en Línea (mensual),
Declaraciones Juradas de Intereses (Contraloría) y más.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from urllib.parse import unquote

from . import http

BASE = "https://www.datosabiertos.gob.pe"
DATA_EXT = (".csv", ".xlsx", ".xls", ".json", ".zip", ".txt", ".rar")
# Archivos que acompañan al dataset pero no son datos.
SKIP_PATTERNS = ("diccionario", "metadato", "metadata", "formato_", ".docx", ".pdf", ".css")

_RES_RE = re.compile(r'href="(https?://www\.datosabiertos\.gob\.pe/sites/default/files/[^"]+)"')
_MOD_RE = re.compile(r'field-name-field-modified-date">\s*(\d{4}-\d{2}-\d{2})')
_TITLE_RE = re.compile(r"<title>([^|<]+)")
_SLUG_RE = re.compile(r'href="/dataset/([^"/]+)"')


@dataclass(frozen=True)
class Resource:
    url: str
    filename: str
    ext: str


@dataclass
class Dataset:
    slug: str
    title: str
    modified: str | None  # YYYY-MM-DD según la PNDA
    resources: list[Resource]

    @property
    def url(self) -> str:
        return f"{BASE}/dataset/{self.slug}"

    def data_resources(self, exts: tuple[str, ...] = DATA_EXT) -> list[Resource]:
        out = []
        for r in self.resources:
            low = r.filename.lower()
            if any(p in low for p in SKIP_PATTERNS):
                continue
            if r.ext in exts:
                out.append(r)
        return out


def fetch_dataset(slug: str) -> Dataset:
    page = http.get_text(f"{BASE}/dataset/{slug}")
    title_m = _TITLE_RE.search(page)
    title = html.unescape(title_m.group(1)).strip() if title_m else slug
    # Si la PNDA no encuentra el dataset redirige al buscador: el título lo delata.
    if title.startswith("Plataforma Nacional de Datos Abiertos"):
        raise LookupError(f"dataset '{slug}' no existe en la PNDA (redirigió al buscador)")
    mod_m = _MOD_RE.search(page)
    seen: set[str] = set()
    res: list[Resource] = []
    for raw in _RES_RE.findall(page):
        url = html.unescape(raw)
        if url in seen:
            continue
        seen.add(url)
        fname = unquote(url.rsplit("/", 1)[-1])
        ext = ("." + fname.rsplit(".", 1)[-1].lower()) if "." in fname else ""
        res.append(Resource(url=url, filename=fname, ext=ext))
    return Dataset(slug=slug, title=title, modified=mod_m.group(1) if mod_m else None, resources=res)


def search(query: str, max_pages: int = 3) -> list[str]:
    """Slugs de datasets que matchean `query` (búsqueda full-text de la PNDA)."""
    slugs: list[str] = []
    for page in range(max_pages):
        url = f"{BASE}/search/type/dataset?query={query}&page={page}"
        body = http.get_text(url)
        found = _SLUG_RE.findall(body)
        if not found:
            break
        for s in found:
            s = unquote(s)
            if s not in slugs:
                slugs.append(s)
    return slugs


def resource_url(dataset: Dataset, filename_contains: str) -> str | None:
    for r in dataset.resources:
        if filename_contains.lower() in r.filename.lower():
            return r.url
    return None
