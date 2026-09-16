"""JNE — autoridades electas y vigentes por ubigeo → `jne_autoridades` (+ `jne_candidaturas` vía XLSX de Infogob).

Fuente principal (verificada 2026-09-16, descarga directa sin navegador):
  · PNDA /dataset/autoridades-vigentes-jne  →  autoridades_vigentes_<AAAAMMDD>.xls (13 238 filas el 2026-07-30)
      NOMBRES, APELLIDOPATERNO, APELLIDOMATERNO, ORGANIZACIONPOLITICA, POSICION, CARGO, REGION,
      PROVINCIA, DISTRITO, FEINICIOVIGENCIA, FEFINVIGENCIA, AUTORIDADREEMPLAZO, UBIGEO,
      PROCESOELECTORAL, ANIOELECCION, PRONUNCIAMIENTO, …, AMBITO, GENERO, EDAD, PERIODO, TIPOORGPOLITICA
    Cubre gobernadores, vicegobernadores, consejeros, alcaldes y regidores (ERM 2022 + complementarias
    2023/2025 + reemplazos por vacancia) y el Congreso bicameral / Ejecutivo electos en 2026.
  · PNDA /dataset/autoridades-electas-jne    →  autoridades_electas_<AAAAMMDD>.xls (proclamados que aún no
    asumen; hoy: EG 2026, periodo 2026-2031).
  Gotchas:
    - El diccionario lista DOCUMENTOIDENTIDAD pero el archivo publicado NO trae el DNI. Se completa
      después cruzando con `onpe_candidatos` (Claridad publica DNI de cada candidato) por
      nombre normalizado + organización + proceso (ver `enriquecer_dni`).
    - UBIGEO viene en codificación RENIEC/JNE (Cusco=07, Puno=20, Callao=24). El ubigeo INEI
      (`zonas`) se resuelve por nombres con `_core/ubigeo.py` → columna `ubigeo`; el original queda
      en `ubigeo_jne`.
    - Fechas como seriales de Excel (xlrd las convierte).

Fuente secundaria (manual): XLSX de Infogob (Base de datos → proceso → Candidatos/Autoridades) con
la estructura de dataset/ELECCIONES → `--root` (usa load_jne_candidaturas.py, tabla jne_candidaturas).
Infogob está detrás de Incapsula + formulario con captcha de imagen para las descargas → no se
automatiza; la PNDA cubre el caso "autoridades vigentes".

  python -m backend.scrapers.jne_infogob.pipeline --dry-run
  python -m backend.scrapers.jne_infogob.pipeline                      # vigentes + electas → jne_autoridades
  python -m backend.scrapers.jne_infogob.pipeline --region CUSCO --region PUNO --dry-run
  python -m backend.scrapers.jne_infogob.pipeline --root dataset/ELECCIONES   # XLSX Infogob → jne_candidaturas
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import unicodedata
from pathlib import Path

from .._core import pnda
from .._core.pipeline import Pipeline, log, pg_dsn, run_loader
from .._core.registro import Carga, registrar, ya_cargado
from .._core.storage import sha256_of
from .._core.ubigeo import ZonaIndex, resolve_ubigeo

DATASETS = {
    "vigentes": ("autoridades-vigentes-jne", "autoridades_vigentes", True),
    "electas": ("autoridades-electas-jne", "autoridades_electas", False),
}
FUENTE_URL = "https://www.datosabiertos.gob.pe/dataset/{slug}"

# El reporte "electas" usa prefijo TX/NU/FE en las cabeceras; se normalizan a las del reporte "vigentes".
_PREFIX = re.compile(r"^(TX|NU|FE)(?=[A-Z])")


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFD", str(s or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return " ".join(s.upper().split())


def _col(name: str) -> str:
    name = name.strip().upper()
    if name.startswith("FE"):
        return name                          # FEINICIOVIGENCIA / FEFINVIGENCIA se mantienen
    return _PREFIX.sub("", name)


def _proceso_codigo(texto: str, anio: str | float | None) -> str:
    """'ELECCIONES REGIONALES Y MUNICIPALES 2022' → 'ERM2022'; 'ELECCIONES GENERALES 2026' → 'EG2026'."""
    t = norm(texto)
    y = str(int(float(anio))) if anio not in (None, "") else (re.search(r"(20\d\d)", t).group(1) if re.search(r"(20\d\d)", t) else "")
    if "COMPLEMENTARIAS" in t:
        return f"EMC{y}"
    if "REGIONALES" in t and "MUNICIPALES" in t:
        return f"ERM{y}"
    if "SEGUNDA ELECCI" in t and "REGIONAL" in t:
        return f"SER{y}"
    if "GENERALES" in t:
        return f"EG{y}"
    return (t.replace(" ", "")[:12] + y) if t else f"DESCONOCIDO{y}"


def parse_xls(path: Path, vigente: bool) -> list[dict]:
    """XLS del JNE → filas crudas (dict por cabecera normalizada) con fechas ya convertidas."""
    import xlrd

    wb = xlrd.open_workbook(str(path))
    sh = wb.sheet_by_index(0)
    hdr = [_col(str(c)) for c in sh.row_values(0)]
    out: list[dict] = []
    for i in range(1, sh.nrows):
        r = dict(zip(hdr, sh.row_values(i)))
        for k in ("FEINICIOVIGENCIA", "FEFINVIGENCIA"):
            v = r.get(k)
            if isinstance(v, float) and v > 0:
                r[k] = xlrd.xldate_as_datetime(v, wb.datemode).date()
            elif isinstance(v, str) and v.strip():
                try:
                    r[k] = dt.datetime.strptime(v.strip()[:10], "%d/%m/%Y").date()
                except ValueError:
                    r[k] = None
            else:
                r[k] = None
        r["_vigente"] = vigente
        out.append(r)
    return out


def normalize_rows(raw: list[dict], ix: ZonaIndex | None, fuente_url: str) -> list[dict]:
    rows: list[dict] = []
    for r in raw:
        nombres = str(r.get("NOMBRES") or "").strip()
        ap1 = str(r.get("APELLIDOPATERNO") or "").strip()
        ap2 = str(r.get("APELLIDOMATERNO") or "").strip()
        nombre = " ".join(x for x in (ap1, ap2, nombres) if x)
        cargo = norm(r.get("CARGO"))
        if not nombre or not cargo:
            continue
        region, prov, dist = (str(r.get(k) or "").strip() or None for k in ("REGION", "PROVINCIA", "DISTRITO"))
        ubigeo = resolve_ubigeo(ix, region, prov, dist) if ix is not None and region else None
        pos = r.get("POSICION")
        proceso = _proceso_codigo(r.get("PROCESOELECTORAL") or "", r.get("ANIOELECCION"))
        if proceso.startswith("DESCONOCIDO") and "2023 - 2026" in str(r.get("PERIODO") or ""):
            proceso = "ERM2022"     # 2 filas sin proceso pero con periodo municipal 2023-2026
        rows.append({
            "proceso": proceso,
            "ubigeo": ubigeo,
            "ubigeo_jne": (str(r.get("UBIGEO") or "").strip() or None),
            "departamento": region, "provincia": prov, "distrito": dist,
            "cargo": cargo,
            "nombre": nombre,
            "nombre_norm": norm(nombre),
            "dni": None,
            "organizacion_politica": str(r.get("ORGANIZACIONPOLITICA") or "").strip() or None,
            "periodo_inicio": r.get("FEINICIOVIGENCIA"),
            "periodo_fin": r.get("FEFINVIGENCIA"),
            "periodo_texto": str(r.get("PERIODO") or "").strip() or None,
            "posicion": int(float(pos)) if pos not in (None, "") else None,
            "ambito": norm(r.get("AMBITO")) or None,
            "pronunciamiento": str(r.get("PRONUNCIAMIENTO") or "").strip() or None,
            "es_reemplazo": str(r.get("AUTORIDADREEMPLAZO") or "").strip() not in ("", "0", "0.0"),
            "genero": str(r.get("GENERO") or "").strip() or None,
            "vigente": bool(r.get("_vigente")),
            "fuente": "jne_pnda",
            "fuente_url": fuente_url,
        })
    return rows


COLS = ["proceso", "ubigeo", "ubigeo_jne", "departamento", "provincia", "distrito", "cargo", "nombre", "nombre_norm",
        "dni", "organizacion_politica", "periodo_inicio", "periodo_fin", "periodo_texto", "posicion", "ambito",
        "pronunciamiento", "es_reemplazo", "genero", "vigente", "fuente", "fuente_url"]

ENRIQUECER_DNI_SQL = """
WITH cand AS (
  SELECT DISTINCT ON (nombre_norm, organizacion_norm, proceso) nombre_norm, organizacion_norm, proceso, dni
  FROM (SELECT upper(immutable_unaccent(apellidos || ' ' || nombres)) AS nombre_norm,
               upper(immutable_unaccent(organizacion)) AS organizacion_norm, proceso, dni
          FROM onpe_candidatos WHERE dni ~ '^[0-9]{8}$') c
  ORDER BY nombre_norm, organizacion_norm, proceso, dni
)
UPDATE jne_autoridades a
   SET dni = cand.dni
  FROM cand
 WHERE a.dni IS NULL
   AND cand.nombre_norm = a.nombre_norm
   AND cand.organizacion_norm = upper(immutable_unaccent(a.organizacion_politica))
   AND cand.proceso = a.proceso
"""


# jne_candidaturas (319 066 filas de Infogob) no trae documento: query_jne_candidaturas(dni) nunca
# acertaba por DNI. Se completa desde onpe_candidatos (nombre + organización + año del proceso).
CANDIDATURAS_DNI_SQL = r"""
WITH cand AS (
  SELECT DISTINCT ON (nombre_norm, org_norm, anio) nombre_norm, upper(immutable_unaccent(organizacion)) AS org_norm,
         substring(proceso from '\d{4}')::int AS anio, dni
    FROM onpe_candidatos
   WHERE dni ~ '^[0-9]{8}$' AND proceso ~ '\d{4}'
   ORDER BY nombre_norm, org_norm, anio, dni
)
UPDATE jne_candidaturas c
   SET numero_documento = cand.dni
  FROM cand
 WHERE c.numero_documento IS NULL
   AND cand.nombre_norm = c.nombre
   AND cand.org_norm = upper(immutable_unaccent(c.partido))
   AND cand.anio = c.año
"""


class InfogobPipeline(Pipeline):
    name = "jne_infogob"
    description = "JNE — autoridades vigentes/electas (PNDA) → jne_autoridades · XLSX Infogob → jne_candidaturas"
    schedule = "mensual (el JNE republica el reporte tras cada proclamación/vacancia); Infogob: por proceso electoral"

    def __init__(self, **kw):
        super().__init__(**kw)
        self.root: Path | None = None
        self.partes = ["vigentes", "electas"]
        self.regiones: set[str] = set()
        self.meta: dict[Path, tuple[str, str, bool, str | None]] = {}   # path → (parte, slug, vigente, modified)

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--root", type=Path, default=None, help="cargar XLSX de Infogob (estructura dataset/ELECCIONES) a jne_candidaturas")
        ap.add_argument("--parte", action="append", default=[], help="vigentes | electas (repetible; default ambas)")
        ap.add_argument("--region", action="append", default=[], help="filtrar por región (nombre, p. ej. CUSCO); repetible")
        ap.add_argument("--sin-dni", action="store_true", help="no cruzar con onpe_candidatos para completar el DNI")

    def configure(self, args: argparse.Namespace) -> None:
        self.root = args.root
        if args.parte:
            self.partes = [p.strip().lower() for p in args.parte]
        self.regiones = {norm(r) for r in args.region}
        self.enriquecer = not args.sin_dni

    # ── fetch ────────────────────────────────────────────────────────────────────────
    def fetch(self) -> list[Path]:
        if self.root:
            return [self.root]
        paths: list[Path] = []
        for parte in self.partes:
            slug, prefijo, vigente = DATASETS[parte]
            ds = pnda.fetch_dataset(slug)
            res = [r for r in ds.data_resources((".xls", ".xlsx", ".csv")) if r.filename.lower().startswith(prefijo)]
            if not res:
                log.warning("   %s: no encontré %s*.xls en %s", parte, prefijo, ds.url)
                continue
            # El más reciente por la fecha AAAAMMDD del nombre.
            res.sort(key=lambda r: re.sub(r"\D", "", r.filename), reverse=True)
            r = res[0]
            p = self.store.fetch(r.url, r.filename, ds.modified, force=self.force, subdir=parte)
            self.meta[p] = (parte, slug, vigente, ds.modified)
            paths.append(p)
        return paths

    # ── load ─────────────────────────────────────────────────────────────────────────
    def load(self, paths: list[Path]) -> None:
        if self.root:
            run_loader("load_jne_candidaturas.py", "--root", str(self.root), dry_run=self.dry_run)
            return
        import psycopg2
        from psycopg2.extras import execute_values

        conn = None if self.dry_run else psycopg2.connect(pg_dsn())
        ix = self._zona_index(conn)
        try:
            for p in paths:
                parte, slug, vigente, _mod = self.meta.get(p, ("vigentes", "autoridades-vigentes-jne", True, None))
                raw = parse_xls(p, vigente)
                rows = normalize_rows(raw, ix, FUENTE_URL.format(slug=slug))
                if self.regiones:
                    rows = [r for r in rows if norm(r["departamento"]) in self.regiones]
                con_ubigeo = sum(1 for r in rows if r["ubigeo"])
                distrital = [r for r in rows if r["ambito"] == "DISTRITAL"]
                a6 = sum(1 for r in distrital if r["ubigeo"] and len(r["ubigeo"]) == 6)
                log.info("   %s → %d autoridades · %d con ubigeo INEI (%d/%d distritales a 6 dígitos) · procesos %s",
                         p.name, len(rows), con_ubigeo, a6, len(distrital), sorted({r["proceso"] for r in rows}))
                if conn is None:
                    for r in rows[:3]:
                        log.info("   [dry-run] %s", {k: r[k] for k in ("proceso", "ubigeo", "ubigeo_jne", "cargo", "nombre", "organizacion_politica", "periodo_inicio", "periodo_fin")})
                    continue
                sha, nbytes = sha256_of(p)
                entry = self.store.latest_by_file(p)
                with conn.cursor() as cur:
                    if not self.force and ya_cargado(cur, self.name, parte, sha):
                        log.info("   %s ya cargado con el mismo sha256", parte)
                        continue
                    # "vigentes" es la foto completa → reemplaza todo lo de la fuente; "electas" solo
                    # agrega/actualiza (proclamados que todavía no asumen) sobre esa foto.
                    borradas = 0
                    if parte == "vigentes":
                        cur.execute("DELETE FROM jne_autoridades WHERE fuente = 'jne_pnda'")
                        borradas = cur.rowcount
                    execute_values(
                        cur,
                        f"INSERT INTO jne_autoridades ({', '.join(COLS)}, sha256, descargado_at) VALUES %s "
                        "ON CONFLICT (proceso, cargo, nombre_norm, COALESCE(ubigeo, '')) DO UPDATE SET "
                        "organizacion_politica = EXCLUDED.organizacion_politica, periodo_inicio = EXCLUDED.periodo_inicio, "
                        "periodo_fin = EXCLUDED.periodo_fin, es_reemplazo = EXCLUDED.es_reemplazo, vigente = jne_autoridades.vigente OR EXCLUDED.vigente, "
                        "ubigeo_jne = EXCLUDED.ubigeo_jne, sha256 = EXCLUDED.sha256, descargado_at = EXCLUDED.descargado_at",
                        [tuple(r[c] for c in COLS) + (sha, dt.datetime.fromisoformat(entry.downloaded_at).astimezone() if entry else None) for r in rows],
                        page_size=2000,
                    )
                    registrar(cur, Carga(
                        fuente=self.name, clave=parte, tabla="jne_autoridades", archivo=p.name, gcs_uri=self.store.gcs_uri(p),
                        sha256=sha, bytes=nbytes, filas=len(rows), fuente_url=FUENTE_URL.format(slug=slug),
                        descargado_at=dt.datetime.fromisoformat(entry.downloaded_at).astimezone() if entry else None,
                    ))
                conn.commit()
                log.info("   → jne_autoridades (%s): -%d +%d", parte, borradas, len(rows))
            if conn is not None and getattr(self, "enriquecer", True):
                self._enriquecer_dni(conn)
        finally:
            if conn is not None:
                conn.close()

    def _zona_index(self, conn) -> ZonaIndex | None:
        if conn is None:
            import psycopg2
            try:
                conn = psycopg2.connect(pg_dsn())
            except Exception as e:  # noqa: BLE001 — en dry-run sin DB seguimos sin ubigeo
                log.warning("   sin conexión a zonas (%s): ubigeo INEI quedará vacío", e)
                return None
            try:
                return self._zona_index(conn)
            finally:
                conn.close()
        with conn.cursor() as cur:
            cur.execute("SELECT ubigeo, nivel, nombre, padre_ubigeo FROM zonas")
            return ZonaIndex.from_rows(cur.fetchall())

    def _enriquecer_dni(self, conn) -> None:
        with conn.cursor() as cur:
            cur.execute("SELECT to_regclass('onpe_candidatos')")
            if cur.fetchone()[0] is None:
                log.info("   onpe_candidatos no existe todavía: DNI sin completar (correr onpe_claridad --candidatos)")
                return
            cur.execute(ENRIQUECER_DNI_SQL)
            n = cur.rowcount
            cur.execute("SELECT count(*), count(dni) FROM jne_autoridades")
            tot, con = cur.fetchone()
            cur.execute("SELECT to_regclass('jne_candidaturas')")
            m = tot2 = con2 = 0
            if cur.fetchone()[0] is not None:
                cur.execute(CANDIDATURAS_DNI_SQL)
                m = cur.rowcount
                cur.execute("SELECT count(*), count(numero_documento) FROM jne_candidaturas")
                tot2, con2 = cur.fetchone()
        conn.commit()
        log.info("   DNI completado desde onpe_candidatos: jne_autoridades +%d (%d/%d con DNI) · jne_candidaturas +%d (%d/%d con DNI)",
                 n, con, tot, m, con2, tot2)


if __name__ == "__main__":
    InfogobPipeline.cli()
