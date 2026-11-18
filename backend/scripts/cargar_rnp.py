#!/usr/bin/env python3
"""Baja y carga los socios, representantes y órganos de administración de los proveedores del RNP (migración 360).

Fuente: el adjunto `conformacion_juridica.csv` de la wiki de datos abiertos del OECE (lectura anónima, sin captcha; la
PNDA sólo enlaza ahí), que el OECE reemplaza el primer día hábil de cada mes:
  https://osce-gob-pe.atlassian.net/wiki/download/attachments/106889267/conformacion_juridica.csv?api=v2
`|`, CP1252, 9 columnas, ~230 MB. Antes era una foto de mayo de 2026 cargada a mano.

Qué hace con cada corte:
  · agrega los vínculos (proveedor, persona, rol) que no estaban, con `fecha_corte` = el corte del archivo;
  · a los que estaban y ya no figuran les pone `baja_corte` = ese corte (no los borra: un socio que salió sigue contando
    para los contratos de cuando estaba);
  · a los que habían salido y vuelven a figurar les quita la `baja_corte`;
  · los que siguen igual no se tocan.
Un archivo más chico que el 90 % de lo que hay no se carga (un adjunto roto no puede dar de baja a medio registro).
Idempotente: el mismo corte dos veces no cambia nada. Anota la carga en datasets_cargas (fuente `rnp_conformacion_juridica`).

Después de cargar no hace falta correr nada: los refrescos que leen la tabla (cruces, empresas, grupos de proveedores,
mismo dueño, socio de inhabilitada) corren en sus cadenas de siempre (la diaria del OECE y la semanal de órdenes).

Privacidad: el archivo trae el documento de cada persona. Queda en la tabla, como antes (la API nunca lo publica); el
crudo se baja a una carpeta temporal y se borra al terminar, salvo con --guardar.

Uso (desde la raíz del repo):
  python -I -X utf8 backend/scripts/cargar_rnp.py --seco                 # baja, normaliza y cuenta; no escribe
  python -I -X utf8 backend/scripts/cargar_rnp.py --entorno prod
  python -I -X utf8 backend/scripts/cargar_rnp.py --entorno prod --archivo <csv ya bajado>
Requiere psycopg2, la CLI de AWS y session-manager-plugin (túnel de infrastructure/aws/tunel_rds.py).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import site
import sys
import tempfile
import time
import unicodedata
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
# Con `python -I` no se ven los paquetes del usuario (psycopg2) ni la carpeta del túnel.
if site.getusersitepackages() not in sys.path:
    sys.path.append(site.getusersitepackages())
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))

PAGINA = "106889267"
ARCHIVO = "conformacion_juridica.csv"
WIKI = "https://osce-gob-pe.atlassian.net/wiki"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
FUENTE = "rnp_conformacion_juridica"
CABECERA = ["FECHA_CORTE", "TIPO_DOCUMENTO", "NUMERO_DOCUMENTO", "NOMBRE_RAZONODENOMINACIONSOCIAL", "RUC", "TIPO_CONF_JURIDICA",
            "FECHA_INICIO_VIGENCIA", "ID_FORMA_SOCIETARIA", "DE_FORMA_SOCIETARIA"]
COLS = ["fecha_corte", "tipo_documento", "numero_documento", "nombre", "nombre_original", "ruc_empresa", "tipo_rol",
        "fecha_inicio_vigencia", "id_forma_societaria", "forma_societaria"]


def version_en_la_wiki() -> tuple[str, str]:
    """(versión, fecha) del adjunto, de la lista de adjuntos de la página."""
    req = urllib.request.Request(f"{WIKI}/rest/api/content/{PAGINA}/child/attachment?limit=50&expand=version", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    for a in d.get("results", []):
        if a.get("title") == ARCHIVO:
            v = a.get("version") or {}
            return f"v{v.get('number', '?')}", str(v.get("when", ""))[:10]
    raise SystemExit(f"la wiki ya no tiene el adjunto {ARCHIVO} en la página {PAGINA}")


def bajar(destino: Path) -> None:
    req = urllib.request.Request(f"{WIKI}/download/attachments/{PAGINA}/{ARCHIVO}?api=v2", headers={"User-Agent": UA})
    t = time.time()
    with urllib.request.urlopen(req, timeout=600) as r, destino.open("wb") as f:
        while True:
            trozo = r.read(1 << 20)
            if not trozo:
                break
            f.write(trozo)
    print(f"bajado: {destino.stat().st_size / 1e6:.0f} MB en {time.time() - t:.0f} s", flush=True)


def sin_tildes(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))


def nombre_norm(s: str) -> str:
    """MAYÚSCULAS, sin tildes y con un espacio entre palabras: igual que rnp_normalize.py (con lo que se cargó mayo)."""
    return re.sub(r"\s+", " ", sin_tildes(s or "").upper()).strip()


def fecha(s: str) -> str:
    s = (s or "").strip()
    if len(s) != 8 or not s.isdigit():
        return ""
    a, m, d = int(s[:4]), int(s[4:6]), int(s[6:])
    return f"{a:04d}-{m:02d}-{d:02d}" if 1900 <= a <= 2100 and 1 <= m <= 12 and 1 <= d <= 31 else ""


def normalizar(origen: Path) -> tuple[io.StringIO, int, int, str]:
    """El CSV del OECE -> CSV para COPY (las columnas de COLS). Devuelve (csv, filas, descartadas, corte).

    Las MISMAS reglas que rnp_normalize.py, con el que se cargó el corte de mayo: la llave de un vínculo (proveedor,
    documento, rol) tiene que salir escrita igual, o lo que ya está parecería nuevo y lo de antes, dado de baja.
    """
    salida = io.StringIO()
    w = csv.writer(salida, lineterminator="\n")
    filas = descartadas = 0
    cortes: dict[str, int] = {}
    with origen.open("r", encoding="cp1252", errors="replace", newline="") as f:
        lector = csv.reader(f, delimiter="|")
        cab = [c.strip().upper() for c in next(lector)]
        if cab != CABECERA:
            raise SystemExit(f"la cabecera cambió: {cab}")
        for c in lector:
            if len(c) != 9:
                descartadas += 1
                continue
            corte_crudo, tipo_doc, doc_crudo, nombre_crudo, ruc_crudo, rol, inicio, id_forma, forma = c
            doc = doc_crudo.strip().replace("\t", "")
            ruc = ruc_crudo.strip()
            corte = fecha(corte_crudo)
            if not doc or doc.upper() == "NO ESPECIFICADO" or len(doc) < 5 or len(ruc) != 11 or not ruc.isdigit() or not corte:
                descartadas += 1
                continue
            cortes[corte] = cortes.get(corte, 0) + 1
            original = nombre_crudo.strip()
            w.writerow([corte, tipo_doc.strip(), doc, nombre_norm(original), original, ruc, rol.strip(), fecha(inicio), id_forma.strip(), forma.strip()])
            filas += 1
    if not cortes:
        raise SystemExit("el archivo no trae filas válidas")
    corte = max(cortes, key=lambda k: cortes[k])
    salida.seek(0)
    return salida, filas, descartadas, corte


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


def cargar(entorno: str, datos: io.StringIO, filas: int, corte: str, hash_archivo: str, version: str, bytes_archivo: int, forzar: bool) -> None:
    from tunel_rds import conexion  # noqa: PLC0415

    with conexion(entorno) as cn:
        cur = cn.cursor()
        cur.execute("SET statement_timeout = '900s'")
        cur.execute("SELECT count(*) FROM rnp_conformacion_juridica WHERE baja_corte IS NULL")
        vigentes = cur.fetchone()[0]
        if filas < vigentes * 0.9:
            raise SystemExit(f"el archivo trae {filas} filas y la tabla tiene {vigentes} vínculos vigentes: no se carga")
        cur.execute(f"CREATE TEMP TABLE _rnp (LIKE rnp_conformacion_juridica INCLUDING DEFAULTS) ON COMMIT DROP")
        cur.execute("ALTER TABLE _rnp DROP COLUMN id, DROP COLUMN baja_corte")
        t = time.time()
        cur.copy_expert(f"COPY _rnp ({', '.join(COLS)}) FROM STDIN WITH (FORMAT csv, NULL '')", datos)
        cur.execute("CREATE INDEX ON _rnp (ruc_empresa, numero_documento, tipo_rol, tipo_documento)")
        cur.execute("ANALYZE _rnp")
        print(f"   temporal: {filas} filas en {time.time() - t:.0f} s", flush=True)
        LLAVE = "r.ruc_empresa = n.ruc_empresa AND r.numero_documento = n.numero_documento AND r.tipo_rol = n.tipo_rol AND r.tipo_documento = n.tipo_documento"
        # Antes de tocar nada: de un mes a otro cambia poco (nov. 2026 frente a mayo: 0,3 % de bajas y 3,7 % de altas). Si
        # el archivo diera de baja a más de 1 de cada 20 vínculos, lo que cambió es cómo viene escrito, no el registro.
        cur.execute(f"""SELECT count(*) FROM rnp_conformacion_juridica r
                         WHERE r.baja_corte IS NULL AND r.fecha_corte < %s AND NOT EXISTS (SELECT 1 FROM _rnp n WHERE {LLAVE})""", (corte,))
        por_dar_de_baja = cur.fetchone()[0]
        print(f"   se darían de baja {por_dar_de_baja} de {vigentes} vínculos vigentes", flush=True)
        if por_dar_de_baja > vigentes * 0.05 and not forzar:
            raise SystemExit("más del 5 % de los vínculos saldría de una vez: revisa el archivo (o corre con --forzar si es cierto)")
        # 1. Los que estaban y ya no figuran en este corte.
        cur.execute(f"""UPDATE rnp_conformacion_juridica r SET baja_corte = %s
                         WHERE r.baja_corte IS NULL AND r.fecha_corte < %s
                           AND NOT EXISTS (SELECT 1 FROM _rnp n WHERE {LLAVE})""", (corte, corte))
        bajas = cur.rowcount
        # 2. Los que habían salido y vuelven a figurar.
        cur.execute(f"""UPDATE rnp_conformacion_juridica r SET baja_corte = NULL
                         WHERE r.baja_corte IS NOT NULL AND EXISTS (SELECT 1 FROM _rnp n WHERE {LLAVE})""")
        vuelven = cur.rowcount
        # 3. Los nuevos: una vez cada (proveedor, persona, rol), con el corte de hoy.
        cur.execute(f"""INSERT INTO rnp_conformacion_juridica ({', '.join(COLS)})
                        SELECT DISTINCT ON (n.ruc_empresa, n.numero_documento, n.tipo_rol, n.tipo_documento) {', '.join('n.' + c for c in COLS)}
                          FROM _rnp n
                         WHERE NOT EXISTS (SELECT 1 FROM rnp_conformacion_juridica r WHERE {LLAVE})
                         ORDER BY n.ruc_empresa, n.numero_documento, n.tipo_rol, n.tipo_documento, n.fecha_inicio_vigencia DESC NULLS LAST""")
        nuevos = cur.rowcount
        cur.execute("""INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, sha256, bytes, filas, fuente_url, descargado_at, cargado_at, estado)
                       VALUES (%s, %s, 'rnp_conformacion_juridica', %s, %s, %s, %s, %s, now(), now(), 'ok')
                       ON CONFLICT (fuente, clave) DO UPDATE SET archivo = EXCLUDED.archivo, sha256 = EXCLUDED.sha256, bytes = EXCLUDED.bytes,
                             filas = EXCLUDED.filas, descargado_at = EXCLUDED.descargado_at, cargado_at = now(), estado = 'ok', error = NULL""",
                    (FUENTE, f"corte-{corte}", f"{ARCHIVO} {version}", hash_archivo, bytes_archivo, nuevos, f"{WIKI}/spaces/PNDA/pages/{PAGINA}"))
        cn.commit()
        cur.execute("ANALYZE rnp_conformacion_juridica")
        cur.execute("SELECT count(*), count(*) FILTER (WHERE baja_corte IS NULL), count(DISTINCT ruc_empresa), max(fecha_corte) FROM rnp_conformacion_juridica")
        total, vig, provs, ultimo = cur.fetchone()
        cn.commit()
    print(f"corte {corte}: {nuevos} vínculos nuevos, {bajas} que ya no figuran, {vuelven} que volvieron")
    print(f"tabla: {total} vínculos ({vig} vigentes) de {provs} proveedores; último corte {ultimo}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--entorno", choices=["dev", "prod"])
    ap.add_argument("--seco", action="store_true", help="baja, normaliza y cuenta; no escribe en la base")
    ap.add_argument("--archivo", help="un CSV ya bajado (si no, lo baja de la wiki)")
    ap.add_argument("--guardar", help="carpeta donde dejar el CSV bajado (por defecto, temporal y se borra)")
    ap.add_argument("--forzar", action="store_true", help="carga aunque más del 5 %% de los vínculos salga de una vez")
    a = ap.parse_args()
    if not a.seco and not a.entorno:
        ap.error("falta --entorno (o --seco)")
    version, cuando = ("archivo local", "") if a.archivo else version_en_la_wiki()
    print(f"{ARCHIVO}: {version} {cuando}", flush=True)
    with tempfile.TemporaryDirectory() as tmp:
        if a.archivo:
            origen = Path(a.archivo)
        else:
            origen = Path(a.guardar or tmp) / ARCHIVO
            origen.parent.mkdir(parents=True, exist_ok=True)
            bajar(origen)
        t = time.time()
        datos, filas, descartadas, corte = normalizar(origen)
        print(f"normalizado: {filas} filas ({descartadas} descartadas), corte {corte}, en {time.time() - t:.0f} s", flush=True)
        if a.seco:
            return 0
        cargar(a.entorno, datos, filas, corte, sha256(origen), version, origen.stat().st_size, a.forzar)
    return 0


if __name__ == "__main__":
    sys.exit(main())
