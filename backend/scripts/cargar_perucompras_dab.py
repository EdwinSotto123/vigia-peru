#!/usr/bin/env python3
"""Baja y carga el índice mensual de órdenes de los Catálogos que Perú Compras publica en la PNDA (migración 239).

Fuente: https://www.datosabiertos.gob.pe/sites/default/files/ReportePC{Bienes,Servicios}<AAAAMM>.csv (desde 2022-01; el
dataset «Órdenes de compra realizadas a través de los Catálogos Electrónicos – Central de Compras»). `;`, Latin-1. Sin
ítems; lo que suma al reporte detallado (cargar_perucompras.py, migración 236):
  · el enlace a la orden electrónica que genera la plataforma, con su ID_OrdenCompra (bienes);
  · las órdenes de SERVICIOS (boletos aéreos), que el reporte detallado devuelve vacías: entran a perucompras_orden sin
    ítems y con acuerdo_id = -1.
Un archivo es la foto del mes al procesarlo (FECHA_PROCESO): si una orden aparece en dos, vale la del más reciente.

  bajar   Los meses de --desde a --hasta (por defecto, 2022-01 al mes pasado) a dataset/perucompras/dab/. Uno ya bajado no
          se vuelve a pedir, salvo los dos últimos meses (Perú Compras los rehace). Un mes que todavía no está, se salta.
  cargar  Reemplaza perucompras_dab y las órdenes de servicios de perucompras_orden en una transacción.

Uso (desde la raíz del repo; en Git Bash, con MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin PATH="/c/Users/usuario/bin:$PATH"):
  python -I -X utf8 backend/scripts/cargar_perucompras_dab.py bajar
  python -I -X utf8 backend/scripts/cargar_perucompras_dab.py cargar --seco
  python -I -X utf8 backend/scripts/cargar_perucompras_dab.py cargar --entorno dev
"""

from __future__ import annotations

import argparse
import csv
import io
import re
import site
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

if sys.flags.isolated:
    sys.path.append(site.getusersitepackages())
sys.path.insert(0, str(Path(__file__).resolve().parent))

from cargar_perucompras import RAIZ, UA, Latido, a_csv, numero, ruc, texto, version_de  # noqa: E402

DAB = RAIZ / "dataset" / "perucompras" / "dab"
URL = "https://www.datosabiertos.gob.pe/sites/default/files/ReportePC{tipo}{mes}.csv"
TIPOS = {"Bienes": "BIENES", "Servicios": "SERVICIOS"}

CAMPOS = ["orden", "version", "tipo", "id_orden_compra", "url_orden", "url_digitalizada", "entidad_ruc", "entidad",
          "proveedor_ruc", "proveedor", "procedimiento", "estado", "descripcion_estado", "fecha_formalizacion",
          "fecha_ultimo_estado", "subtotal", "igv", "total", "acuerdo", "fecha_proceso", "archivo"]


def meses(desde: str, hasta: str) -> list[str]:
    a, m = int(desde[:4]), int(desde[5:7])
    fin = (int(hasta[:4]), int(hasta[5:7]))
    out = []
    while (a, m) <= fin:
        out.append(f"{a}{m:02d}")
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    return out


def cmd_bajar(a) -> int:
    hoy = date.today()
    pasado = f"{hoy.year - (hoy.month == 1)}-{(hoy.month - 2) % 12 + 1:02d}"
    lista = meses(a.desde, a.hasta or pasado)
    recientes = set(lista[-2:])
    DAB.mkdir(parents=True, exist_ok=True)
    bajados = saltados = 0
    for mes in lista:
        for t in TIPOS:
            destino = DAB / f"ReportePC{t}{mes}.csv"
            if destino.exists() and mes not in recientes:
                continue
            req = urllib.request.Request(URL.format(tipo=t, mes=mes), headers={"User-Agent": UA})
            try:
                with urllib.request.urlopen(req, timeout=120) as r:
                    datos = r.read()
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    saltados += 1
                    print(f"  {t} {mes}: todavía no está", flush=True)
                    continue
                raise
            tmp = destino.with_suffix(".tmp")
            tmp.write_bytes(datos)
            tmp.replace(destino)
            bajados += 1
            print(f"  {t} {mes}: {len(datos) // 1024} KB", flush=True)
            time.sleep(0.3)
    print(f"listo: {bajados} archivos bajados, {saltados} meses sin publicar", flush=True)
    return 0


def clave(nombre: str) -> str:
    """ORDEN_ELECTRÓNICA → ORDEN_ELECTRONICA (los encabezados traen tildes y varían entre bienes y servicios)."""
    return unicodedata.normalize("NFD", nombre).encode("ascii", "ignore").decode().strip().upper()


def fecha_hora(v: str | None) -> str | None:
    v = (v or "").strip()
    return v[:19] if re.match(r"\d{4}-\d{2}-\d{2}", v) else None


def leer() -> dict[str, dict]:
    """Todas las órdenes de los archivos bajados; de una orden en varios archivos, la del más reciente."""
    ordenes: dict[str, dict] = {}
    for p in sorted(DAB.glob("ReportePC*.csv"), key=lambda p: (p.stem[-6:], p.stem)):
        tipo = TIPOS["Bienes" if "Bienes" in p.stem else "Servicios"]
        filas = csv.DictReader(io.StringIO(p.read_bytes().decode("latin-1")), delimiter=";")
        filas.fieldnames = [clave(f) for f in (filas.fieldnames or [])]
        for r in filas:
            g = lambda k: r.get(k) or ""  # noqa: E731
            ocam = g("ORDEN_ELECTRONICA").strip()
            if not ocam:
                continue
            base, v = version_de(ocam)
            generada = g("ORDEN_ELECTRONICA_GENERADA").strip()
            m = re.search(r"ID_OrdenCompra=(\d+)", generada)
            estado = next((r[k] for k in r if k and k.startswith("ESTADO_ORDEN")), None)
            fila = {
                "orden": base, "version": v, "tipo": tipo, "id_orden_compra": int(m.group(1)) if m else None,
                "url_orden": generada if generada.startswith("http") else None,
                "url_digitalizada": next((x for x in (g("ORDEN_DIGITALIZADA").strip(), g("ORDEN_PUBLICADA").strip()) if x.startswith("http")), None),
                "entidad_ruc": ruc(g("RUC_ENTIDAD")), "entidad": texto(g("ENTIDAD")),
                "proveedor_ruc": ruc(g("RUC_PROVEEDOR")), "proveedor": texto(g("PROVEEDOR")),
                "procedimiento": texto(g("TIPO_PROCEDIMIENTO")), "estado": texto(estado or ""),
                "descripcion_estado": texto(g("DESCRIPCION_ESTADO")),
                "fecha_formalizacion": fecha_hora(g("FECHA_FORMALIZACION")), "fecha_ultimo_estado": fecha_hora(g("FECHA_ULTIMO_ESTADO")),
                "subtotal": numero(g("SUB_TOTAL")), "igv": numero(g("IGV")), "total": numero(g("TOTAL")),
                "acuerdo": texto(g("ACUERDO_MARCO")), "fecha_proceso": fecha_hora(g("FECHA_PROCESO")), "archivo": p.name,
                "_mes": p.stem[-6:],
            }
            previa = ordenes.get(base)
            if previa is None or (fila["fecha_proceso"] or "", fila["version"]) >= (previa["fecha_proceso"] or "", previa["version"]):
                ordenes[base] = fila
    return ordenes


def cmd_cargar(a) -> int:
    ordenes = leer()
    servicios = [o for o in ordenes.values() if o["tipo"] == "SERVICIOS"]
    con_id = sum(1 for o in ordenes.values() if o["id_orden_compra"])
    print(f"{len(ordenes):,} órdenes ({len(servicios):,} de servicios), {con_id:,} con el id de la orden electrónica", flush=True)
    if a.seco:
        return 0
    sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
    import psycopg2
    from tunel_rds import BASES, CLAVES, _aws, tunel

    base = BASES[a.entorno]
    clave_db = _aws("ssm", "get-parameter", "--name", CLAVES[base], "--with-decryption", "--query", "Parameter.Value")
    with tunel(base) as (host, puerto):
        conectar = lambda: psycopg2.connect(host=host, port=puerto, dbname="vigia", user="postgres", password=clave_db,  # noqa: E731
                                            sslmode="require", connect_timeout=15, keepalives=1, keepalives_idle=30)
        latido = Latido(conectar)
        latido.start()
        con = conectar()
        with con, con.cursor() as cur:
            cur.execute("DELETE FROM perucompras_dab")
            cur.copy_expert(f"COPY perucompras_dab ({', '.join(CAMPOS)}) FROM STDIN WITH (FORMAT csv)",
                            a_csv([o[k] for k in CAMPOS] for o in ordenes.values()))
            # Los servicios, también como órdenes del catálogo (sin ítems): las de -1 se rehacen enteras. La fecha es la de
            # su último estado o, sin ella, el primer día del mes del archivo. Una orden que el reporte detallado ya trae,
            # se queda como está (ON CONFLICT DO NOTHING).
            cur.execute("DELETE FROM perucompras_orden WHERE acuerdo_id = -1")
            cur.execute("""
                INSERT INTO perucompras_orden (orden, acuerdo_id, acuerdo, tipo, entidad_ruc, entidad, proveedor_ruc, proveedor,
                                               procedimiento, estado, estado_descripcion, fecha_publicacion, fecha_ultimo_estado,
                                               subtotal, igv, total, versiones)
                SELECT d.orden, -1, d.acuerdo, 'SERVICIOS', d.entidad_ruc, d.entidad, d.proveedor_ruc, d.proveedor,
                       d.procedimiento, upper(d.estado), d.descripcion_estado,
                       COALESCE(d.fecha_formalizacion::date, d.fecha_ultimo_estado::date,
                                to_date(substring(d.archivo FROM '([0-9]{6})[.]csv$'), 'YYYYMM')),
                       d.fecha_ultimo_estado, d.subtotal, d.igv, d.total, COALESCE(d.version, 0) + 1
                  FROM perucompras_dab d WHERE d.tipo = 'SERVICIOS'
                ON CONFLICT (orden) DO NOTHING""")
            print(f"  órdenes de servicios en perucompras_orden: {cur.rowcount:,}", flush=True)
            cur.execute("ANALYZE perucompras_dab")
            cur.execute("ANALYZE perucompras_orden")
            cur.execute("""INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, sha256, filas, fuente_url, descargado_at, cargado_at, estado)
                           VALUES ('perucompras', 'datos_abiertos', 'perucompras_dab', 'ReportePC*.csv', md5(%s), %s, %s, now(), now(), 'ok')
                           ON CONFLICT (fuente, clave) DO UPDATE SET sha256 = EXCLUDED.sha256, filas = EXCLUDED.filas,
                             descargado_at = EXCLUDED.descargado_at, cargado_at = now(), estado = 'ok', error = NULL""",
                        (",".join(sorted(o["archivo"] for o in ordenes.values()))[:100000], len(ordenes),
                         "https://www.datosabiertos.gob.pe/dataset/órdenes-de-compra-realizadas-través-de-los-catálogos-electrónicos-central-de-compras"))
        latido.parar.set()
        print(f"✓ {base}: {len(ordenes):,} órdenes en perucompras_dab", flush=True)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("bajar")
    b.add_argument("--desde", default="2022-01")
    b.add_argument("--hasta", help="AAAA-MM (por defecto, el mes pasado)")
    c = sub.add_parser("cargar")
    c.add_argument("--entorno", choices=["dev", "prod"])
    c.add_argument("--seco", action="store_true")
    a = ap.parse_args()
    if a.cmd == "cargar" and not a.seco and not a.entorno:
        ap.error("cargar necesita --entorno dev|prod (o --seco)")
    return cmd_bajar(a) if a.cmd == "bajar" else cmd_cargar(a)


if __name__ == "__main__":
    sys.exit(main())
