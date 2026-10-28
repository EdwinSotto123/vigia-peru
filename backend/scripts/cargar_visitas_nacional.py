#!/usr/bin/env python3
"""Visitas del Registro de Visitas en Línea (la plataforma nacional de la PCM) → visitas_entidades, fuente
`portal_visitas_nacional`.

No consulta el portal: lee las ventanas que baja el proyecto `funcionarios_publicos` del usuario
(scripts/scraper_visitas_nacional.py: su Chrome con el token que entrega el propio portal, ventanas de 5 días o menos),
`data/visitas_nacional/json/ventana_AAAA-MM-DD_AAAA-MM-DD.json.gz` = {"result": "200", "data": [...]}. Cada registro
trae lo mismo que el botón «Excel» del portal (fec_reg_ext, fecha, razon_social, visitante, documento, rz_empresa,
funcionario, horaIn, horaOut, motivo, no_lugar_r, obs_det), así que se normaliza con el mismo `parse_row` de la
exportación manual (backend/scripts/load_visitas_entidades.py).

  · Salta los marcadores «No se recibieron visitas» (sin visitante ni documento) y los repetidos dentro de la ventana.
  · No duplica lo que ya está por otra fuente: la exportación manual de abril-mayo de 2026 y la PNDA de Loreto salen
    del mismo registro (misma entidad, fecha, documento y hora de ingreso, como en pnda_visitas/pipeline.py).
  · Sólo ventanas «hoja» (si una ventana se partió en otras, cuentan las partes) y con más de `--min-edad` segundos
    (la que el scraper está escribiendo todavía no).
  · Idempotente: cada ventana queda en datasets_cargas con su sha256; una ventana nueva o cambiada reemplaza sus días.

Al final rehace lo que lee las visitas (el mismo orden que aplicar_188.py: RUC de la entidad visitada, visita previa,
familiares, olas, casos, antecedentes, empresas, poder y la pestaña Visitas), salvo con --sin-refrescos.

  python -u backend/scripts/cargar_visitas_nacional.py --entorno dev
  python -u backend/scripts/cargar_visitas_nacional.py --entorno prod [--dir ...] [--min-edad 300] [--sin-refrescos]
"""
from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import importlib.util
import io
import json
import re
import sys
import time
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
sys.path.insert(0, str(ROOT))
from tunel_rds import conexion  # noqa: E402
from backend.scrapers._core.registro import Carga, registrar, ya_cargado  # noqa: E402

FUENTE = "portal_visitas_nacional"
DIR_DEFECTO = Path("C:/Users/usuario/funcionarios_publicos/data/visitas_nacional/json")
URL_FUENTE = "https://visitas.servicios.gob.pe/consultas"

COLS = ["fecha_registro", "fecha_visita", "entidad_visitada", "entidad_visitada_norm", "visitante", "visitante_norm",
        "tipo_documento", "numero_documento", "tipo_entidad_visitante", "entidad_visitante", "funcionario_visitado",
        "funcionario_nombre", "funcionario_area", "funcionario_cargo", "hora_ingreso", "hora_salida", "duracion_min",
        "motivo", "lugar_especifico", "observacion"]
# Lo que va en el COPY: las columnas de cada visita y su mes. La fuente, el sha256 de la ventana y cuándo se bajó son los
# mismos para toda la ventana: van como constantes en el INSERT (por el túnel SSM pasan ~0,7 MB/s: cada byte cuenta).
COPIA = COLS + ["periodo"]

# Lo que rehace aplicar_188.py (más el RUC de cada entidad visitada, primero: sin él las visitas nuevas no cuelgan de nadie).
REFRESCOS = ["refrescar_visita_entidad_ruc", "refrescar_cruce_visita_previa", "refrescar_visita_pariente",
             "refrescar_ola_gestion", "dedup_cruces_proveedor", "refrescar_casos_cruce_base",
             "refrescar_entidad_antecedentes", "refrescar_empresas", "refrescar_poder", "refrescar_visitas_entidad"]


def parser():
    """parse_row de la exportación manual (el mismo formato de columnas)."""
    ruta = ROOT / "backend" / "scripts" / "load_visitas_entidades.py"
    spec = importlib.util.spec_from_file_location("load_visitas_entidades", ruta)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod.parse_row


def ventanas(directorio: Path, min_edad: int, desde: date | None, hasta: date | None) -> list[tuple[date, date, Path]]:
    """Las ventanas con datos, sólo las hojas, ya cerradas (más viejas que min_edad), dentro de desde/hasta."""
    todas = []
    ahora = time.time()
    for p in directorio.glob("ventana_*.json.gz"):
        m = re.fullmatch(r"ventana_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.json\.gz", p.name)
        if not m or p.stat().st_size == 0 or ahora - p.stat().st_mtime < min_edad:
            continue
        a, b = date.fromisoformat(m.group(1)), date.fromisoformat(m.group(2))
        if (desde and b < desde) or (hasta and a > hasta):
            continue
        todas.append((a, b, p))
    return sorted(
        (v for v in todas if not any(o is not v and o[0] >= v[0] and o[1] <= v[1] for o in todas)),
        key=lambda v: v[0],
    )


def filas_de(path: Path, parse_row) -> tuple[list[tuple], int, int]:
    """Las filas de una ventana, en el orden de COPIA; y cuántos marcadores y repetidos se saltaron."""
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        datos = json.load(fh).get("data") or []
    out, vistos, marcadores, repetidos = [], set(), 0, 0
    for x in datos if isinstance(datos, list) else []:
        r = parse_row((x.get("fec_reg_ext"), x.get("fecha"), x.get("razon_social"), x.get("visitante"), x.get("documento"),
                       x.get("rz_empresa"), x.get("funcionario"), x.get("horaIn"), x.get("horaOut"), x.get("motivo"),
                       x.get("no_lugar_r"), x.get("obs_det")))
        if r is None or not r["fecha_visita"]:
            marcadores += 1
            continue
        clave = (r["entidad_visitada_norm"], r["fecha_visita"], r["numero_documento"] or r["visitante_norm"],
                 str(r["hora_ingreso"]), r["funcionario_visitado"])
        if clave in vistos:
            repetidos += 1
            continue
        vistos.add(clave)
        out.append(tuple(r[c] for c in COLS) + (r["fecha_visita"].strftime("%Y-%m"),))
    return out, marcadores, repetidos


def a_csv(filas: list[tuple]) -> io.StringIO:
    buf = io.StringIO()
    w = csv.writer(buf)
    for f in filas:
        w.writerow(["" if v is None else (v.isoformat() if hasattr(v, "isoformat") else v) for v in f])
    buf.seek(0)
    return buf


class Base:
    """Una sola conexión por el túnel para toda la corrida; si se corta, se reabre (como cargar_visitas_congreso.py)."""

    def __init__(self, entorno: str) -> None:
        self.entorno, self.cm, self.c = entorno, None, None

    def cerrar(self) -> None:
        if self.cm is not None:
            try:
                self.cm.__exit__(None, None, None)
            except Exception:  # noqa: BLE001
                pass
        self.cm = self.c = None

    def hacer(self, fn):
        for intento in range(1, 4):
            try:
                if self.c is None:
                    self.cm = conexion(self.entorno)
                    self.c = self.cm.__enter__()
                r = fn(self.c)
                self.c.commit()
                return r
            except Exception as e:  # noqa: BLE001 — el túnel o la base: se reabre y se repite
                print(f"  la base falló ({intento}): {str(e)[:200]}", flush=True)
                try:
                    self.c.rollback()
                except Exception:  # noqa: BLE001
                    pass
                self.cerrar()
                time.sleep(20)
        raise RuntimeError("la base no respondió tres veces")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entorno", choices=["prod", "dev"], default="dev")
    ap.add_argument("--dir", type=Path, default=DIR_DEFECTO)
    ap.add_argument("--min-edad", type=int, default=300, help="segundos desde que se escribió la ventana (default 300)")
    ap.add_argument("--desde", help="AAAA-MM-DD: sólo ventanas que terminan desde ese día")
    ap.add_argument("--hasta", help="AAAA-MM-DD: sólo ventanas que empiezan hasta ese día")
    ap.add_argument("--sin-refrescos", action="store_true")
    ap.add_argument("--forzar", action="store_true", help="recargar aunque el sha256 ya esté cargado")
    # Varias partes a la vez, cada una con su túnel (el túnel es el cuello: ~0,7 MB/s cada uno). Cada parte toma una de
    # cada N ventanas (así se reparten las grandes de 2025 y las chicas de 2020); los refrescos, una vez al final.
    ap.add_argument("--partes", type=int, default=1)
    ap.add_argument("--parte", type=int, default=0, help="0 .. partes-1")
    ap.add_argument("--solo-refrescos", action="store_true", help="no carga: sólo rehace lo que lee las visitas")
    a = ap.parse_args()
    parse_row = parser()
    vs = ventanas(a.dir, a.min_edad, date.fromisoformat(a.desde) if a.desde else None, date.fromisoformat(a.hasta) if a.hasta else None)
    vs = [] if a.solo_refrescos else [v for i, v in enumerate(vs) if i % a.partes == a.parte]
    print(f"{a.entorno}: {len(vs)} ventanas en {a.dir} (parte {a.parte + 1} de {a.partes})", flush=True)
    base = Base(a.entorno)
    total = saltadas = marcadores = repetidos = duplicadas = 0
    t0 = time.time()

    def avance(i: int, fin: date) -> None:
        if i % 20 == 0 or i == len(vs):
            print(f"  {i}/{len(vs)} ventanas (hasta {fin}): +{total} visitas, {duplicadas} ya estaban por otra fuente, "
                  f"{marcadores} marcadores, {repetidos} repetidas, {saltadas} ya cargadas; {time.time() - t0:.0f} s", flush=True)

    for i, (ini, fin, p) in enumerate(vs, 1):
        sha = hashlib.sha256(p.read_bytes()).hexdigest()
        clave = p.name.removesuffix(".json.gz")

        def ya(c, clave=clave, sha=sha):
            return ya_cargado(c.cursor(), FUENTE, clave, sha)

        if not a.forzar and base.hacer(ya):
            saltadas += 1
            avance(i, fin)
            continue
        filas, m, r = filas_de(p, parse_row)
        marcadores += m
        repetidos += r

        def escribir(c, ini=ini, fin=fin, filas=filas, clave=clave, sha=sha, p=p):
            cur = c.cursor()
            cur.execute("SET statement_timeout = '600s'")
            # Los días de la ventana se reemplazan enteros (una ventana recargada o partida no deja restos).
            cur.execute("DELETE FROM visitas_entidades WHERE fuente = %s AND fecha_visita BETWEEN %s AND %s", (FUENTE, ini, fin))
            # Sólo las columnas que se copian (sin el id: no gasta la secuencia de la tabla de verdad).
            cur.execute(f"""CREATE TEMP TABLE IF NOT EXISTS _vn ON COMMIT DELETE ROWS AS
                              SELECT {', '.join(COPIA)} FROM visitas_entidades WITH NO DATA""")
            cur.copy_expert(f"COPY _vn ({', '.join(COPIA)}) FROM STDIN WITH (FORMAT csv)", a_csv(filas))
            # Lo que ya está por otra fuente del mismo registro (exportación manual, PNDA) no se repite.
            cur.execute(
                f"""INSERT INTO visitas_entidades ({', '.join(COPIA)}, fuente, sha256, descargado_at)
                    SELECT {', '.join('t.' + c for c in COPIA)}, %s, %s, %s FROM _vn t
                     WHERE NOT EXISTS (SELECT 1 FROM visitas_entidades o
                                        WHERE o.fuente <> %s AND o.entidad_visitada_norm = t.entidad_visitada_norm
                                          AND o.fecha_visita = t.fecha_visita
                                          AND COALESCE(o.numero_documento, '') = COALESCE(t.numero_documento, '')
                                          AND COALESCE(o.hora_ingreso, '00:00') = COALESCE(t.hora_ingreso, '00:00'))""",
                (FUENTE, sha, datetime.fromtimestamp(p.stat().st_mtime).astimezone(), FUENTE))
            n = cur.rowcount
            registrar(cur, Carga(fuente=FUENTE, clave=clave, sha256=sha, tabla="visitas_entidades", archivo=p.name,
                                 bytes=p.stat().st_size, filas=n, fuente_url=URL_FUENTE,
                                 descargado_at=datetime.fromtimestamp(p.stat().st_mtime).astimezone()))
            return n

        n = base.hacer(escribir)
        total += n
        duplicadas += len(filas) - n
        avance(i, fin)

    if not a.sin_refrescos and (total or a.solo_refrescos):
        for fn in REFRESCOS:
            def correr(c, fn=fn):
                cur = c.cursor()
                cur.execute("SET statement_timeout = 0")
                cur.execute("SELECT to_regprocedure(%s) IS NOT NULL", (f"{fn}()",))
                if not cur.fetchone()[0]:
                    return None
                t = time.time()
                cur.execute(f"SELECT {fn}()")
                return cur.fetchone()[0], time.time() - t

            r = base.hacer(correr)
            if r:
                print(f"  {fn} → {r[0]} ({r[1]:.0f} s)", flush=True)

    def resumen(c):
        cur = c.cursor()
        cur.execute("""SELECT count(*), min(fecha_visita), max(fecha_visita), count(DISTINCT entidad_visitada_norm)
                         FROM visitas_entidades WHERE fuente = %s""", (FUENTE,))
        return cur.fetchone()

    print(f"{a.entorno}: listo; +{total} visitas en esta corrida; en la base (visitas, desde, hasta, entidades) = {base.hacer(resumen)}", flush=True)
    base.cerrar()


if __name__ == "__main__":
    main()
