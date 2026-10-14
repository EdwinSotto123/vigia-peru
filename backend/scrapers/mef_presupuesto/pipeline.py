"""MEF — Presupuesto y Ejecución de Gasto → mef_ejecutora_anual + mef_departamento_desglose
→ mef_region_budget / mef_entity_budget (migración 47). En producción corre en Cloudflare
(backend/scrapers-worker/src/fuentes/mef_presupuesto.ts, con la misma agregación).

Por qué cambia (verificado 2026-10-14):
  · `api.datosabiertos.mef.gob.pe/DatosAbiertos/v1/datastore_search_sql` ya no existe (404 "Recurso no
    encontrado") y el recurso comparativo_gastos_2022_2026 (510bae6d…) quedó vacío (`records: null`):
    fetch_mef_budget.py / fetch_mef_entities.py y la consulta en vivo del frontend no tienen de dónde leer.
  · `datastore_search` sigue, pero con filtros tarda 30-110 s (o se cuelga): no sirve en vivo ni para 2 187 entidades.
  · Lo que sí está completo y al día es el archivo del dataset `presupuesto-y-ejecucion-de-gasto`:
    https://fs.datosabiertos.mef.gob.pe/datastorefiles/<año>-Gasto-Diario.zip  (2026: 549 MB zip / 8,2 GB CSV /
    8 953 724 filas, Last-Modified = hoy). MES_EJE = 0 trae PIA y PIM; 1-12, la ejecución del mes: sumar todo
    da el año.

Este pipeline baja el ZIP del año (y del anterior hasta marzo, cuando el MEF cierra diciembre), lo agrega en
streaming por unidad ejecutora (~2 900 filas) y por departamento × sector/pliego/programa/genérica, reemplaza
ese año en la base y llama `refrescar_mef_presupuesto()` (migración 47), que rehace las tablas que ya lee Vigía.

  python -m backend.scrapers.mef_presupuesto.pipeline --dry-run          # baja y agrega, no escribe
  python -m backend.scrapers.mef_presupuesto.pipeline                    # año actual (+ anterior hasta marzo)
  python -m backend.scrapers.mef_presupuesto.pipeline --anio 2025
"""

from __future__ import annotations

import argparse
import collections
import csv
import datetime as dt
import io
import time
import zipfile
from pathlib import Path

import requests

from backend.scrapers._core import http
from backend.scrapers._core.pipeline import Pipeline, log, pg_dsn
from backend.scrapers._core.registro import Carga, registrar, ya_cargado
from backend.scrapers._core.storage import sha256_of

PORTAL = "https://datosabiertos.mef.gob.pe/Rest/"
DATASET = "presupuesto-y-ejecucion-de-gasto"
ZIP_POR_DEFECTO = "https://fs.datosabiertos.mef.gob.pe/datastorefiles/{anio}-Gasto-Diario.zip"

MONTOS = ["MONTO_PIA", "MONTO_PIM", "MONTO_CERTIFICADO", "MONTO_COMPROMETIDO_ANUAL", "MONTO_COMPROMETIDO", "MONTO_DEVENGADO", "MONTO_GIRADO"]
EJECUTORA = ["SEC_EJEC", "EJECUTORA", "EJECUTORA_NOMBRE", "PLIEGO", "PLIEGO_NOMBRE", "SECTOR", "SECTOR_NOMBRE", "NIVEL_GOBIERNO",
             "DEPARTAMENTO_EJECUTORA", "DEPARTAMENTO_EJECUTORA_NOMBRE", "PROVINCIA_EJECUTORA", "PROVINCIA_EJECUTORA_NOMBRE",
             "DISTRITO_EJECUTORA", "DISTRITO_EJECUTORA_NOMBRE"]
COLS_EJEC = ["anio", "sec_ejec", "ejecutora", "ejecutora_nombre", "pliego", "pliego_nombre", "sector", "sector_nombre", "nivel_gobierno",
             "departamento", "departamento_nombre", "provincia", "provincia_nombre", "distrito", "distrito_nombre",
             "pia", "pim", "certificado", "comprometido_anual", "comprometido", "devengado", "girado", "filas", "corte"]


def zip_del_anio(anio: int) -> str:
    """URL del `<año>-Gasto-Diario.zip` según el portal (lo que lee su SPA); si el portal no responde, la de siempre."""
    try:
        r = requests.post(PORTAL + "PortalWebDatasetDetalle/v1.0/getDatasetDetalle", json={"dataset": DATASET},
                          headers={"Token": "vigia", "User-Agent": http.USER_AGENT}, timeout=60)
        for rec in (r.json().get("resources") or []):
            if rec.get("resource_title", "").lower() == f"{anio}-gasto-diario.csv" and rec.get("resource_download_url_zip"):
                return rec["resource_download_url_zip"]
    except (requests.RequestException, ValueError) as e:
        log.warning("   portal del MEF no respondió (%s); uso la URL conocida", e)
    return ZIP_POR_DEFECTO.format(anio=anio)


def agregar_zip(path: Path) -> tuple[list[dict], list[tuple], dict]:
    """Recorre el CSV del ZIP sin descomprimirlo a disco. Devuelve (ejecutoras, desglose, resumen)."""
    t0 = time.time()
    z = zipfile.ZipFile(path)
    lector = csv.reader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8", newline=""))
    cab = next(lector)
    ix = {c: i for i, c in enumerate(cab)}
    im, ie = [ix[m] for m in MONTOS], [ix[c] for c in EJECUTORA]
    i_anio, i_dep, i_sec, i_pli, i_eje = ix["ANO_EJE"], ix["DEPARTAMENTO_EJECUTORA_NOMBRE"], ix["SECTOR_NOMBRE"], ix["PLIEGO_NOMBRE"], ix["EJECUTORA_NOMBRE"]
    i_prog, i_gen = ix["PROGRAMA_PPTO_NOMBRE"], ix["GENERICA_NOMBRE"]
    ejec: dict[str, dict] = {}
    desg: dict[tuple, list[float]] = collections.defaultdict(lambda: [0.0, 0.0, 0.0])
    anios: collections.Counter = collections.Counter()
    n = 0
    for f in lector:
        n += 1
        v = [float(f[i]) if f[i] else 0.0 for i in im]
        sec = f[ie[0]]
        e = ejec.get(sec)
        if e is None:
            e = ejec[sec] = {"anio": int(f[i_anio]), **{c.lower(): f[i] for c, i in zip(EJECUTORA, ie)}, "m": [0.0] * 7, "filas": 0}
        for k in range(7):
            e["m"][k] += v[k]
        e["filas"] += 1
        dep = f[i_dep]
        pliego = f[i_pli].strip() or f[i_eje]          # gobiernos locales: sin pliego, va la municipalidad
        for tipo, nombre in (("sector", f[i_sec]), ("pliego", pliego), ("programa", f[i_prog]), ("generica", f[i_gen])):
            x = desg[(dep, tipo, nombre.strip())]
            x[0] += v[0]
            x[1] += v[1]
            x[2] += v[5]
        anios[f[i_anio]] += 1
    filas_ejec = []
    for e in ejec.values():
        m = e.pop("m")
        filas_ejec.append({**e, "pia": m[0], "pim": m[1], "certificado": m[2], "comprometido_anual": m[3], "comprometido": m[4],
                           "devengado": m[5], "girado": m[6]})
    anio = int(max(anios, key=anios.get))
    filas_desg = [(anio, dep, tipo, nombre, x[0], x[1], x[2]) for (dep, tipo, nombre), x in desg.items() if nombre]
    resumen = {"filas": n, "anio": anio, "ejecutoras": len(filas_ejec), "desglose": len(filas_desg), "segundos": round(time.time() - t0)}
    return filas_ejec, filas_desg, resumen


class MefPipeline(Pipeline):
    name = "mef_presupuesto"
    description = "MEF Datos Abiertos — <año>-Gasto-Diario.zip → mef_ejecutora_anual → mef_region_budget / mef_entity_budget"
    schedule = "semanal (el MEF regenera el archivo a diario; 549 MB por año)"

    def __init__(self, **kw):
        super().__init__(**kw)
        hoy = dt.date.today()
        self.anios = [hoy.year - 1, hoy.year] if hoy.month <= 3 else [hoy.year]
        self.cortes: dict[Path, str | None] = {}

    @classmethod
    def add_arguments(cls, ap: argparse.ArgumentParser) -> None:
        ap.add_argument("--anio", type=int, action="append", default=[], help="años a cargar (repetible; default: el actual)")

    def configure(self, args: argparse.Namespace) -> None:
        if args.anio:
            self.anios = args.anio

    def fetch(self) -> list[Path]:
        paths = []
        for anio in self.anios:
            url = zip_del_anio(anio)
            cab = http.head(url)                       # Last-Modified: si no cambió desde la última bajada, no se baja
            modificado = cab.get("last-modified")
            corte = dt.datetime.strptime(modificado, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=dt.timezone.utc).isoformat() if modificado else None
            p = self.store.fetch(url, f"{anio}-Gasto-Diario.zip", corte, force=self.force, subdir=str(anio))
            self.cortes[p] = corte
            paths.append(p)
        return paths

    def load(self, paths: list[Path]) -> None:
        import psycopg2

        conn = None if self.dry_run else psycopg2.connect(pg_dsn())
        try:
            for p in paths:
                sha, nbytes = sha256_of(p)
                clave = p.parent.name                      # el año
                if conn is not None and not self.force:
                    with conn.cursor() as cur:
                        if ya_cargado(cur, self.name, clave, sha):
                            log.info("   %s ya cargado con el mismo sha256", clave)
                            continue
                ejec, desg, res = agregar_zip(p)
                log.info("   %s → %d filas del MEF · %d ejecutoras · %d de desglose · %ds", p.name, res["filas"], res["ejecutoras"],
                         res["desglose"], res["segundos"])
                if conn is None:
                    tot = [sum(e[k] for e in ejec) / 1e6 for k in ("pia", "pim", "devengado")]
                    log.info("   [dry-run] %d: PIA %.2f M · PIM %.2f M · devengado %.2f M", res["anio"], *tot)
                    continue
                corte = self.cortes.get(p)
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM mef_ejecutora_anual WHERE anio = %s", (res["anio"],))
                    buf = io.StringIO()
                    w = csv.writer(buf)
                    for e in ejec:
                        w.writerow([e["anio"], e["sec_ejec"], e["ejecutora"], e["ejecutora_nombre"], e["pliego"], e["pliego_nombre"].strip(),
                                    e["sector"], e["sector_nombre"], e["nivel_gobierno"], e["departamento_ejecutora"],
                                    e["departamento_ejecutora_nombre"], e["provincia_ejecutora"], e["provincia_ejecutora_nombre"],
                                    e["distrito_ejecutora"], e["distrito_ejecutora_nombre"], round(e["pia"], 2), round(e["pim"], 2),
                                    round(e["certificado"], 2), round(e["comprometido_anual"], 2), round(e["comprometido"], 2),
                                    round(e["devengado"], 2), round(e["girado"], 2), e["filas"], corte])
                    buf.seek(0)
                    cur.copy_expert(f"COPY mef_ejecutora_anual ({', '.join(COLS_EJEC)}) FROM STDIN WITH (FORMAT csv)", buf)
                    cur.execute("DELETE FROM mef_departamento_desglose WHERE anio = %s", (res["anio"],))
                    buf = io.StringIO()
                    csv.writer(buf).writerows([(a, d, t, nmb, round(x, 2), round(y, 2), round(z_, 2)) for a, d, t, nmb, x, y, z_ in desg])
                    buf.seek(0)
                    cur.copy_expert("COPY mef_departamento_desglose (anio, departamento_nombre, tipo, nombre, pia, pim, devengado) "
                                    "FROM STDIN WITH (FORMAT csv)", buf)
                    registrar(cur, Carga(fuente=self.name, clave=clave, tabla="mef_ejecutora_anual", archivo=p.name,
                                         gcs_uri=self.store.gcs_uri(p), sha256=sha, bytes=nbytes, filas=res["filas"],
                                         fuente_url=f"https://datosabiertos.mef.gob.pe/dataset/{DATASET}"))
                conn.commit()
            if conn is not None:
                with conn.cursor() as cur:
                    cur.execute("SELECT * FROM refrescar_mef_presupuesto()")
                    regiones, entidades = cur.fetchone()
                conn.commit()
                log.info("   → mef_region_budget %d departamentos · mef_entity_budget %d entidades", regiones, entidades)
        finally:
            if conn is not None:
                conn.close()


if __name__ == "__main__":
    MefPipeline.cli()
