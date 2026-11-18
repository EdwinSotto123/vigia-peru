#!/usr/bin/env python3
"""Carga en rnp_exsocio (migración 365) a quienes dejaron de figurar en un proveedor del RNP antes de nuestra primera carga.

Entrada: el `rnp_bajas.csv` que deja backend/scripts/rnp_historia.py (un vínculo que ya no figura por fila, con el corte
en que salió). Ese archivo trae documentos de personas: vive fuera del repo.

Qué carga y qué no:
  · sólo las salidas desde --desde-baja (por defecto 2022-12-01): el corte de noviembre de 2022 «da de baja» a 219 mil
    vínculos por un cambio de formato del archivo, no por salidas reales;
  · no carga un vínculo (proveedor, documento, rol) que hoy está en rnp_conformacion_juridica, figure o no (si salió
    después de mayo de 2026 ya tiene ahí su `baja_corte`; si volvió a entrar, no es un ex socio);
  · no carga tampoco a quien hoy figura en la misma empresa con el mismo nombre y rol pero otro documento (el RNP
    corrigió el documento: no salió nadie);
  · una persona con varias salidas del mismo rol en la misma empresa queda con cada una (la llave incluye el corte).
Idempotente: reemplaza la tabla entera con lo que da el archivo. Anota la carga en datasets_cargas (fuente `rnp_exsocio`).

Uso (desde la raíz del repo):
  python -I -X utf8 backend/scripts/cargar_rnp_exsocios.py --archivo <rnp_bajas.csv> --entorno prod --seco
  python -I -X utf8 backend/scripts/cargar_rnp_exsocios.py --archivo <rnp_bajas.csv> --entorno prod
Requiere psycopg2, la CLI de AWS y session-manager-plugin (túnel de infrastructure/aws/tunel_rds.py).
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import site
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
# Con `python -I` no se ven los paquetes del usuario (psycopg2) ni la carpeta del túnel.
if site.getusersitepackages() not in sys.path:
    sys.path.append(site.getusersitepackages())
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))

COLS = ["ruc_empresa", "tipo_documento", "numero_documento", "nombre", "nombre_original", "tipo_rol", "fecha_inicio_vigencia",
        "forma_societaria", "primer_corte", "ultimo_corte", "baja_corte"]
ROLES = {"SOCIO_ACCIONISTA_TITULAR", "REPRESENTANTE_LEGAL", "ORGANO_ADMINISTRACION"}


def leer(archivo: Path, desde_baja: str) -> tuple[io.StringIO, int, dict[str, int]]:
    """El CSV de bajas → un CSV en memoria con las columnas de la tabla. Devuelve también cuántas filas y por qué se dejó cada una."""
    salida = io.StringIO()
    w = csv.writer(salida)
    fuera = {"antes_del_corte_fiable": 0, "sin_documento": 0, "ruc_raro": 0, "rol_raro": 0, "repetida": 0}
    vistos: set[tuple[str, str, str, str]] = set()
    n = 0
    with archivo.open(encoding="utf-8-sig", newline="") as f:
        for fila in csv.DictReader(f):
            baja = (fila.get("baja_corte") or "").strip()
            if not baja or baja < desde_baja:
                fuera["antes_del_corte_fiable"] += 1
                continue
            doc = (fila.get("numero_documento") or "").strip()
            ruc = (fila.get("ruc_empresa") or "").strip()
            rol = (fila.get("tipo_rol") or "").strip()
            if not doc:
                fuera["sin_documento"] += 1
                continue
            if len(ruc) != 11 or not ruc.isdigit():
                fuera["ruc_raro"] += 1
                continue
            if rol not in ROLES:
                fuera["rol_raro"] += 1
                continue
            llave = (ruc, doc, rol, baja)
            if llave in vistos:
                fuera["repetida"] += 1
                continue
            vistos.add(llave)
            w.writerow([ruc, (fila.get("tipo_documento") or "").strip(), doc, (fila.get("nombre") or "").strip(),
                        (fila.get("nombre_original") or "").strip(), rol, (fila.get("fecha_inicio_vigencia") or "").strip(),
                        (fila.get("forma_societaria") or "").strip(), (fila.get("primer_corte") or "").strip(),
                        (fila.get("fecha_corte") or "").strip(), baja])
            n += 1
    salida.seek(0)
    return salida, n, fuera


def sha256(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for trozo in iter(lambda: f.read(1 << 20), b""):
            h.update(trozo)
    return h.hexdigest()


def cargar(entorno: str, datos: io.StringIO, filas: int, seco: bool, archivo: Path) -> None:
    from tunel_rds import conexion  # noqa: PLC0415

    with conexion(entorno) as cn:
        cur = cn.cursor()
        cur.execute("SET statement_timeout = '900s'")
        cur.execute("""CREATE TEMP TABLE _ex (ruc_empresa text, tipo_documento text, numero_documento text, nombre text, nombre_original text,
                                              tipo_rol text, fecha_inicio_vigencia date, forma_societaria text, primer_corte date,
                                              ultimo_corte date, baja_corte date) ON COMMIT DROP""")
        cur.copy_expert(f"COPY _ex ({', '.join(COLS)}) FROM STDIN WITH (FORMAT csv, NULL '')", datos)
        cur.execute("CREATE INDEX ON _ex (ruc_empresa, numero_documento, tipo_rol)")
        cur.execute("ANALYZE _ex")
        # Lo que hoy está en la tabla principal, figure o no: no es un ex socio «de antes».
        cur.execute("""DELETE FROM _ex e USING rnp_conformacion_juridica r
                        WHERE r.ruc_empresa = e.ruc_empresa::char(11) AND r.numero_documento = e.numero_documento AND r.tipo_rol = e.tipo_rol""")
        ya_en_tabla = cur.rowcount
        # El mismo nombre y rol en la misma empresa con otro documento: el RNP corrigió el documento.
        cur.execute("""DELETE FROM _ex e USING rnp_conformacion_juridica r
                        WHERE r.ruc_empresa = e.ruc_empresa::char(11) AND r.tipo_rol = e.tipo_rol AND r.baja_corte IS NULL
                          AND r.nombre = e.nombre AND COALESCE(e.nombre, '') <> ''""")
        documento_corregido = cur.rowcount
        cur.execute("SELECT count(*), count(DISTINCT ruc_empresa), count(DISTINCT numero_documento), min(baja_corte), max(baja_corte) FROM _ex")
        quedan, empresas, personas, primera, ultima = cur.fetchone()
        cur.execute("SELECT tipo_rol, count(*) FROM _ex GROUP BY 1 ORDER BY 2 DESC")
        por_rol = cur.fetchall()
        cur.execute("SELECT to_char(baja_corte, 'YYYY'), count(*) FROM _ex GROUP BY 1 ORDER BY 1")
        por_anio = cur.fetchall()
        print(f"  del archivo: {filas:,}  ya en la tabla principal: {ya_en_tabla:,}  documento corregido: {documento_corregido:,}")
        print(f"  ex socios por cargar: {quedan:,} vínculos de {personas:,} documentos en {empresas:,} empresas ({primera} a {ultima})")
        print("  por rol:", por_rol)
        print("  por año de salida:", por_anio)
        if seco:
            cn.rollback()
            print("  en seco: no se escribió nada")
            return
        cur.execute("DELETE FROM rnp_exsocio")
        cur.execute(f"INSERT INTO rnp_exsocio ({', '.join(COLS)}) SELECT {', '.join(COLS)} FROM _ex")
        print(f"  cargados: {cur.rowcount:,}")
        cur.execute("""INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, sha256, bytes, filas, fuente_url, descargado_at, cargado_at, estado)
                       VALUES ('rnp_exsocio', %s, 'rnp_exsocio', 'rnp_bajas.csv (rnp_historia.py)', %s, %s, %s,
                               'https://osce-gob-pe.atlassian.net/wiki/spaces/PNDA/pages/106889267', now(), now(), 'ok')
                       ON CONFLICT (fuente, clave) DO UPDATE SET archivo = EXCLUDED.archivo, sha256 = EXCLUDED.sha256, bytes = EXCLUDED.bytes,
                             filas = EXCLUDED.filas, descargado_at = EXCLUDED.descargado_at, cargado_at = now(), estado = 'ok', error = NULL""",
                    (f"historia-hasta-{ultima}", sha256(archivo), archivo.stat().st_size, quedan))
        cn.commit()
        cur.execute("ANALYZE rnp_exsocio")
        cn.commit()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--archivo", required=True, help="el rnp_bajas.csv de rnp_historia.py")
    ap.add_argument("--entorno", choices=["dev", "prod"], required=True)
    ap.add_argument("--desde-baja", default="2022-12-01", help="primer corte de salida que se toma por fiable (AAAA-MM-DD)")
    ap.add_argument("--seco", action="store_true", help="cuenta lo que cargaría; no escribe")
    a = ap.parse_args()
    datos, filas, fuera = leer(Path(a.archivo), a.desde_baja)
    print(f"archivo: {filas:,} salidas desde {a.desde_baja}; fuera: {fuera}")
    cargar(a.entorno, datos, filas, a.seco, Path(a.archivo))
    return 0


if __name__ == "__main__":
    sys.exit(main())
