#!/usr/bin/env python3
"""Carga `entidad_siaf` (migración 150): el registro «Entidades contratantes» de la OECE, con el CODIGO_SIAF de cada RUC.

El MEF publica el presupuesto por unidad ejecutora (sec_ejec) y sin RUC; la OECE publica, para cada entidad que contrata,
su RUC y su CODIGO_SIAF (el sec_ejec escrito con ceros: "0117" = 117). Con eso refrescar_mef_presupuesto() (migración
151) cruza cada ficha con SU unidad ejecutora sin adivinar por el nombre.

  RUC|NOMBRE_DE_ENTIDAD|DEPARTAMENTO|PROVINCIA|DISTRITO|CODIGO_SIAF|CODCONSUCODE|ESTADO|ULTIMAACTUALIZACION

Qué hace, en una transacción:
  1. Baja el CSV (User-Agent de navegador: Atlassian rechaza el de Python). Si no se puede, usa la última copia bajada
     (.tmp/oece_entidades/, fuera de git) o la que se pase con --archivo.
  2. CODIGO_SIAF vacío o 930xxx → fuera_siaf (empresas de FONAFE, EsSalud, EPS, institutos viales, beneficencias…).
     Un código que no es una unidad ejecutora del MEF pero sí el número de un pliego cuyo nombre se parece al de la
     entidad → es_pliego, y sec_ejec pasa a ser la sede de ese pliego (su UE de menor código).
  3. Upsert por RUC: sólo reescribe (y fecha) las filas que cambiaron. Las que ya no vienen en el archivo se quedan.
  4. corregir_ubigeo_municipal(): el ubigeo de cada municipalidad pasa a ser el de su unidad ejecutora (los distritos
     nuevos traían el del distrito del que se separaron); cada cambio queda en entidad_ubigeo_correccion.
  5. Registra la carga en datasets_cargas y, salvo --sin-refresco, corre refrescar_mef_presupuesto().
Idempotente: corrida dos veces con el mismo archivo, la segunda no cambia nada.

Uso:
  python backend/scripts/cargar_entidades_oece.py --seco                    # sólo baja y cuenta
  python backend/scripts/cargar_entidades_oece.py --entorno dev
  python backend/scripts/cargar_entidades_oece.py --entorno prod
  python backend/scripts/cargar_entidades_oece.py --entorno dev --archivo ruta/entidades_contratantes.csv
Requiere psycopg2, la CLI de AWS y session-manager-plugin (túnel de infrastructure/aws/tunel_rds.py).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
import time
import urllib.request
from collections import Counter
from datetime import date, datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
URL = "https://osce-gob-pe.atlassian.net/wiki/download/attachments/106889265/entidades_contratantes.csv"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
COPIA = RAIZ / ".tmp" / "oece_entidades" / "entidades_contratantes.csv"
COLUMNAS = ["RUC", "NOMBRE_DE_ENTIDAD", "DEPARTAMENTO", "PROVINCIA", "DISTRITO", "CODIGO_SIAF", "CODCONSUCODE", "ESTADO",
            "ULTIMAACTUALIZACION"]
FUENTE = "oece_entidades"
CAMPOS = ["ruc", "sec_ejec", "es_pliego", "fuera_siaf", "codigo_siaf", "nombre", "departamento", "provincia", "distrito",
          "codconsucode", "estado", "actualizado"]
ACTUALIZABLES = [c for c in CAMPOS if c != "ruc"]


def bajar() -> tuple[bytes, str, datetime]:
    """El CSV de la OECE: (contenido, de dónde salió, cuándo se bajó). Reintenta y, si no hay red, usa la copia."""
    error = None
    for intento in range(3):
        try:
            req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept": "text/csv,*/*"})
            with urllib.request.urlopen(req, timeout=90) as r:
                datos = r.read()
            if b"RUC|" not in datos[:200]:
                raise RuntimeError(f"no parece el CSV de la OECE (empieza con {datos[:60]!r})")
            COPIA.parent.mkdir(parents=True, exist_ok=True)
            COPIA.write_bytes(datos)
            return datos, URL, datetime.now(timezone.utc)
        except Exception as e:  # noqa: BLE001 — red, 4xx/5xx o un HTML de error: reintentar y caer a la copia
            error = e
            time.sleep(3 * (intento + 1))
    if COPIA.exists():
        print(f"! no se pudo bajar ({error}); uso la última copia: {COPIA}", file=sys.stderr)
        return COPIA.read_bytes(), str(COPIA), datetime.fromtimestamp(COPIA.stat().st_mtime, timezone.utc)
    raise SystemExit(f"no se pudo bajar {URL} ({error}) y no hay copia local: pasa una con --archivo")


def texto(v: str | None) -> str | None:
    t = " ".join((v or "").replace('\\"', '"').split())
    return t or None


def fecha(v: str | None) -> str | None:
    """ULTIMAACTUALIZACION viene como dd/mm/aa."""
    try:
        return datetime.strptime((v or "").strip(), "%d/%m/%y").date().isoformat()
    except ValueError:
        return None


def leer(datos: bytes) -> tuple[list[dict], Counter]:
    """Filas del CSV → filas de entidad_siaf (sin es_pliego, que se decide en la base). Cuenta lo descartado."""
    try:
        contenido = datos.decode("utf-8-sig")
    except UnicodeDecodeError:
        contenido = datos.decode("cp1252")          # la OECE lo publica en Windows-1252
    lector = csv.reader(io.StringIO(contenido.replace("\r\n", "\n").replace("\r", "\n")), delimiter="|",
                        quoting=csv.QUOTE_NONE)
    cabecera = [c.strip().upper() for c in next(lector)]
    if cabecera[:len(COLUMNAS)] != COLUMNAS:
        raise SystemExit(f"cabecera inesperada: {cabecera}")
    filas: dict[str, dict] = {}
    cuenta: Counter = Counter()
    for partes in lector:
        if not any(p.strip() for p in partes):
            continue
        cuenta["leidas"] += 1
        if len(partes) != len(COLUMNAS):
            cuenta["descartadas: columnas"] += 1
            continue
        f = dict(zip(COLUMNAS, partes))
        ruc = f["RUC"].strip()
        if not re.fullmatch(r"\d{11}", ruc):
            cuenta["descartadas: RUC"] += 1
            continue
        cod = (f["CODIGO_SIAF"] or "").strip()
        if cod and not cod.isdigit():
            cuenta["descartadas: código"] += 1
            continue
        n = int(cod) if cod else None
        fuera = n is None or 930000 <= n <= 930999        # vacío o 930xxx: no está en el SIAF
        if ruc in filas:
            cuenta["RUC repetidos (queda el último)"] += 1
        filas[ruc] = {
            "ruc": ruc, "sec_ejec": None if fuera else n, "es_pliego": False, "fuera_siaf": fuera, "codigo_siaf": cod or None,
            "nombre": texto(f["NOMBRE_DE_ENTIDAD"]) or ruc, "departamento": texto(f["DEPARTAMENTO"]),
            "provincia": texto(f["PROVINCIA"]), "distrito": texto(f["DISTRITO"]), "codconsucode": texto(f["CODCONSUCODE"]),
            "estado": texto(f["ESTADO"]), "actualizado": fecha(f["ULTIMAACTUALIZACION"]),
        }
        cuenta["vacío" if n is None else "930xxx" if fuera else "con código"] += 1
    return list(filas.values()), cuenta


# Un código que no es una UE del MEF pero sí el número de UN pliego que se llama como la entidad (parecido ≥ 0,6 y 0,1
# por encima del siguiente pliego con ese número: el 006 es INDECI y es el MINJUS) → es de pliego, y sec_ejec pasa a la
# sede del pliego (su UE de menor código en el último año). En el archivo de 2026-08-27 no hay ninguno: está por los
# programas y las fuentes que dan el pliego en vez de la UE.
SQL_PLIEGOS = r"""
  WITH ult AS (SELECT * FROM mef_ejecutora_anual WHERE anio = (SELECT max(anio) FROM mef_ejecutora_anual)),
  pl AS (SELECT DISTINCT ON (nivel_gobierno, sector, pliego) nivel_gobierno, sector, pliego,
                regexp_replace(regexp_replace(mef_norm(pliego_nombre), '^M ', 'MINISTERIO '), '^U N ', 'UNIVERSIDAD NACIONAL ') AS pn,
                sec_ejec::int AS sede
           FROM ult WHERE pliego ~ '^\s*\d+\s*$'
          ORDER BY nivel_gobierno, sector, pliego, ejecutora, sec_ejec::int),
  cand AS (
    SELECT o.ruc, p.sede, similarity(mef_norm(o.nombre), p.pn) AS s
      FROM _oece o JOIN pl p ON btrim(p.pliego)::int = o.sec_ejec
     WHERE o.sec_ejec IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM mef_ejecutora_anual m WHERE m.sec_ejec = o.sec_ejec::text)),
  r AS (SELECT c.*, row_number() OVER w AS puesto, lead(c.s) OVER w AS s2 FROM cand c
         WINDOW w AS (PARTITION BY c.ruc ORDER BY c.s DESC))
  UPDATE _oece o SET es_pliego = true, sec_ejec = r.sede
    FROM r WHERE r.ruc = o.ruc AND r.puesto = 1 AND r.s >= 0.6 AND r.s - coalesce(r.s2, 0) >= 0.1
  RETURNING o.ruc, o.nombre, o.codigo_siaf, r.sede"""

SQL_UPSERT = f"""
  INSERT INTO entidad_siaf AS t ({", ".join(CAMPOS)}, cargado)
  SELECT {", ".join(CAMPOS)}, now() FROM _oece
  ON CONFLICT (ruc) DO UPDATE SET {", ".join(f"{c} = EXCLUDED.{c}" for c in ACTUALIZABLES)}, cargado = now()
  WHERE ({", ".join(f"t.{c}" for c in ACTUALIZABLES)}) IS DISTINCT FROM ({", ".join(f"EXCLUDED.{c}" for c in ACTUALIZABLES)})
  RETURNING (xmax = 0) AS nueva"""

SQL_RESUMEN = """
  SELECT count(*) FILTER (WHERE s.ruc IS NOT NULL) AS en_oece,
         count(*) FILTER (WHERE s.sec_ejec IS NOT NULL) AS con_codigo,
         count(*) FILTER (WHERE s.fuera_siaf) AS fuera_siaf,
         count(*) FILTER (WHERE s.es_pliego) AS de_pliego,
         count(*) FILTER (WHERE s.sec_ejec IS NOT NULL
                          AND EXISTS (SELECT 1 FROM mef_ejecutora_anual m WHERE m.sec_ejec = s.sec_ejec::text)) AS en_mef,
         count(*) AS entidades
    FROM entidades e LEFT JOIN entidad_siaf s ON s.ruc = e.ruc"""


def main() -> int:
    ap = argparse.ArgumentParser(description="Carga el registro de entidades contratantes de la OECE (RUC → CODIGO_SIAF).")
    ap.add_argument("--entorno", choices=["dev", "prod"], help="dev = vigia-db-dev, prod = vigia-db")
    ap.add_argument("--seco", action="store_true", help="sólo baja y cuenta, no escribe")
    ap.add_argument("--archivo", help="usar este CSV en vez de bajarlo")
    ap.add_argument("--sin-refresco", action="store_true", help="no correr refrescar_mef_presupuesto() al final")
    a = ap.parse_args()
    if not a.seco and not a.entorno:
        ap.error("falta --entorno (o --seco)")
    sys.stdout.reconfigure(encoding="utf-8")

    if a.archivo:
        p = Path(a.archivo)
        datos, origen, bajado = p.read_bytes(), str(p), datetime.fromtimestamp(p.stat().st_mtime, timezone.utc)
    else:
        datos, origen, bajado = bajar()
    filas, cuenta = leer(datos)
    sha = hashlib.sha256(datos).hexdigest()
    print(f"OECE: {origen} ({len(datos):,} bytes, sha256 {sha[:12]}…)")
    print(f"  {cuenta['leidas']} filas · {len(filas)} RUC · con código {cuenta['con código']} · vacío {cuenta['vacío']}"
          f" · 930xxx {cuenta['930xxx']}" + "".join(f" · {k} {v}" for k, v in cuenta.items() if k.startswith(("descartadas", "RUC rep"))))
    if a.seco:
        return 0

    sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
    from psycopg2.extras import execute_values
    from tunel_rds import BASES, conexion
    with conexion(a.entorno) as con:
        with con, con.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout = '10s'")
            cur.execute("CREATE TEMP TABLE _oece (LIKE entidad_siaf INCLUDING DEFAULTS) ON COMMIT DROP")
            execute_values(cur, f"INSERT INTO _oece ({', '.join(CAMPOS)}) VALUES %s",
                           [tuple(f[c] for c in CAMPOS) for f in filas], page_size=1000)
            cur.execute(SQL_PLIEGOS)
            pliegos = cur.fetchall()
            cur.execute(SQL_UPSERT)
            escritas = [n for (n,) in cur.fetchall()]
            cur.execute("SELECT count(*) FROM entidad_siaf s WHERE NOT EXISTS (SELECT 1 FROM _oece o WHERE o.ruc = s.ruc)")
            (ausentes,) = cur.fetchone()
            cur.execute("SELECT * FROM corregir_ubigeo_municipal()")
            ubigeos = cur.fetchall()
            cur.execute("ANALYZE entidad_siaf")
            cur.execute(SQL_RESUMEN)
            en_oece, con_codigo, fuera, de_pliego, en_mef, total = cur.fetchone()
            cur.execute(
                """INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, sha256, bytes, filas, fuente_url, descargado_at,
                                                cargado_at, estado)
                   VALUES (%s, 'entidades_contratantes', 'entidad_siaf', %s, %s, %s, %s, %s, %s, now(), 'ok')
                   ON CONFLICT (fuente, clave) DO UPDATE SET archivo = EXCLUDED.archivo, sha256 = EXCLUDED.sha256,
                     bytes = EXCLUDED.bytes, filas = EXCLUDED.filas, fuente_url = EXCLUDED.fuente_url,
                     descargado_at = EXCLUDED.descargado_at, cargado_at = now(), estado = 'ok', error = NULL""",
                (FUENTE, Path(origen).name, sha, len(datos), len(filas), URL, bajado))
        print(f"✓ {BASES[a.entorno]}: entidad_siaf {sum(escritas)} nuevas, {len(escritas) - sum(escritas)} cambiadas,"
              f" {len(filas) - len(escritas)} iguales; {ausentes} ya no vienen en el archivo (se quedan)")
        for ruc, nombre, cod, sede in pliegos:
            print(f"  código de pliego: {ruc} {nombre[:60]} ({cod} → sede {sede})")
        print(f"  entidades de Vigía: {total}; en la OECE {en_oece}; con código SIAF {con_codigo} (en el MEF cargado {en_mef},"
              f" de pliego {de_pliego}); fuera del SIAF {fuera}; sin fila en la OECE {total - en_oece}")
        print(f"  ubigeos de municipalidades corregidos: {len(ubigeos)}")
        for ruc, nombre, antes, nuevo, distrito in ubigeos:
            print(f"    {ruc} {nombre[:55]}: {antes or '—'} → {nuevo} ({distrito})")
        if not a.sin_refresco:
            t0 = time.time()
            with con, con.cursor() as cur:
                cur.execute("SET LOCAL statement_timeout = 0")
                cur.execute("SELECT * FROM refrescar_mef_presupuesto()")
                regiones, entidades = cur.fetchone()
                cur.execute("SELECT 1 FROM information_schema.columns WHERE table_name = 'mef_entity_budget' AND column_name = 'fuente'")
                con_fuente = cur.fetchone() is not None
                cur.execute("SELECT fuente, count(*) FROM mef_entity_budget GROUP BY 1 ORDER BY 2 DESC" if con_fuente
                            else "SELECT 'sin la migración 151', count(*) FROM mef_entity_budget")
                por_fuente = cur.fetchall()
            print(f"  refrescar_mef_presupuesto(): {regiones} departamentos, {entidades} entidades con presupuesto"
                  f" ({time.time() - t0:.0f} s): " + json.dumps(dict(por_fuente), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
