"""Carga los CONTRATOS MENORES (≤8 UIT) del SEACE a la tabla `seace_menores` (migración 129).

Dos fuentes del SEACE, unidas por el código CM (`nomenclaturaProceso` de prod4 == `desContratacion` de prod6):
  · prod4 — Buscador de Contratos del Estado (api …:9000/api/bus/contrato/query/{anio}): el contrato ya registrado
    (entidad+RUC, proveedor+RUC, monto, objeto, estado, fechas, id del PDF del contrato). Fuente principal; un dump por año.
  · prod6 — buscador público de procesos: enriquece con el requerimiento/TDR (id del archivo) y la ventana de cotización.

Backfill desde la PC por el túnel (la ingesta continua irá como fuente del Worker vigia-scrapers). prod6 tiene un WAF que
limita ráfagas, así que el enriquecimiento va con pausa de ~1 s. Uso:
  python backend/scripts/cargar_seace_menores.py --seco --anio 2026                      # sólo baja prod4 y cuenta
  python backend/scripts/cargar_seace_menores.py --entorno dev --anio 2026               # carga prod4 (sin requerimiento)
  python backend/scripts/cargar_seace_menores.py --entorno dev --anio 2026 --enriquecer 300  # + requerimiento prod6 de las 300 más recientes

Requiere psycopg2, curl, la CLI de AWS y session-manager-plugin (túnel de infrastructure/aws/tunel_rds.py).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
from datetime import date, datetime, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
PROD4_QUERY = "https://prod4.seace.gob.pe:9000/api/bus/contrato/query/{anio}"
PROD6 = "https://prod6.seace.gob.pe/v1/s8uit-services"
HDRS6 = ["-A", UA, "-H", "Referer: https://prod6.seace.gob.pe/buscador-publico/contrataciones",
         "-H", "Origin: https://prod6.seace.gob.pe", "-H", "Accept: application/json, text/plain, */*"]
FUENTE = "seace_menores"

SQL_UPSERT = """
INSERT INTO seace_menores (id_contrato, codigo, numero_contrato, objeto, descripcion, entidad, entidad_ruc,
  proveedor, proveedor_ruc, monto, moneda, estado, fecha_suscripcion, fecha_inicio, fecha_fin, anio,
  id_documento_contrato, match_prod6) VALUES %s
ON CONFLICT (id_contrato) DO UPDATE SET
  codigo=EXCLUDED.codigo, numero_contrato=EXCLUDED.numero_contrato, objeto=EXCLUDED.objeto,
  descripcion=EXCLUDED.descripcion, entidad=EXCLUDED.entidad, entidad_ruc=EXCLUDED.entidad_ruc,
  proveedor=EXCLUDED.proveedor, proveedor_ruc=EXCLUDED.proveedor_ruc, monto=EXCLUDED.monto, moneda=EXCLUDED.moneda,
  estado=EXCLUDED.estado, fecha_suscripcion=EXCLUDED.fecha_suscripcion, fecha_inicio=EXCLUDED.fecha_inicio,
  fecha_fin=EXCLUDED.fecha_fin, anio=EXCLUDED.anio, id_documento_contrato=EXCLUDED.id_documento_contrato,
  match_prod6=COALESCE(seace_menores.match_prod6, EXCLUDED.match_prod6)
"""  # las columnas de prod6 NO se tocan en la recarga (las pone el enriquecimiento)


def split_ruc(s: str | None) -> tuple[str | None, str | None]:
    """«20146713824-MUNICIPALIDAD…» → (ruc, nombre). Un RUC peruano son 11 dígitos."""
    if not s:
        return (None, None)
    m = re.match(r"^\s*(\d{11})\s*-\s*(.*)$", s)
    if m:
        return (m.group(1), m.group(2).strip() or None)
    return (None, s.strip() or None)


def fecha_dmy(s: str | None) -> str | None:
    """«10/09/2026» → «2026-09-10» (ISO) para insertar como date."""
    if not s:
        return None
    m = re.match(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})", s)
    return f"{m.group(3)}-{int(m.group(2)):02d}-{int(m.group(1)):02d}" if m else None


def fecha_iso(s: str | None) -> str | None:
    """prod6 devuelve fechas ISO (a veces con hora); nos quedamos con la parte de la fecha."""
    if not s:
        return None
    m = re.match(r"^\s*(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else None


def moneda_norm(s: str | None) -> str | None:
    if not s:
        return None
    t = s.strip().upper()
    return "PEN" if t in ("S/.", "S/", "SOLES", "NUEVOS SOLES", "PEN") else s.strip()


def to_float(v) -> float | None:
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def curl_json(url: str, headers: list[str], tries: int = 4, pausa: float = 1.2):
    for i in range(tries):
        r = subprocess.run(["curl", "-s", "--max-time", "90", url, *headers], capture_output=True)
        try:
            j = json.loads(r.stdout.decode("utf-8", "replace"))
            if isinstance(j, dict) and j.get("code") == "403":
                time.sleep(pausa * (i + 1)); continue
            return j
        except Exception:
            time.sleep(pausa * (i + 1))
    return None


def bajar_prod4(anio: int) -> list[dict]:
    """Dump del año (lista completa) → filtra indContratosMenores=1 + monto>0."""
    url = PROD4_QUERY.format(anio=anio)
    print(f"Descargando prod4 {url} …")
    with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f:
        tmp = f.name
    subprocess.run(["curl", "-s", "--max-time", "180", url, "-A", UA, "-H", "Accept: application/json", "-o", tmp],
                   check=True)
    data = json.load(open(tmp, encoding="utf-8"))
    print(f"  {len(data):,} contratos en {anio}")
    filas = []
    for raw in data:
        if str(raw.get("indContratosMenores")) != "1":
            continue
        monto = to_float(raw.get("monto"))
        if not monto or monto <= 0:
            continue
        ent_ruc, ent_nom = split_ruc(raw.get("entidad"))
        prov_ruc, prov_nom = split_ruc(raw.get("rucContratista"))
        idc = raw.get("idContrato")
        if idc is None:
            continue
        filas.append((
            int(idc), (raw.get("nomenclaturaProceso") or "").strip() or None, raw.get("numeroContrato"),
            raw.get("desObjeto"), raw.get("desContrato"), ent_nom, ent_ruc, prov_nom, prov_ruc, monto,
            moneda_norm(raw.get("moneda")), raw.get("estado"), fecha_dmy(raw.get("fechaSuscriContrato")),
            fecha_dmy(raw.get("fechaIniContrato")), fecha_dmy(raw.get("fechaFinContrato")),
            int(raw.get("anioContrato") or anio), str(raw.get("idDocumentoContrato") or "") or None, "pendiente",
        ))
    print(f"  {len(filas):,} con indContratosMenores=1 y monto>0")
    return filas


def enriquecer(cur, anio: int, limite: int, pausa: float) -> int:
    """Para las CM más recientes aún sin requerimiento, busca en prod6 por código y guarda el id del requerimiento."""
    cur.execute("""SELECT codigo FROM seace_menores WHERE codigo IS NOT NULL AND match_prod6='pendiente'
                   ORDER BY fecha_suscripcion DESC NULLS LAST LIMIT %s""", (limite,))
    codigos = [r[0] for r in cur.fetchall()]
    print(f"Enriqueciendo {len(codigos)} CM con prod6 (pausa {pausa}s)…")
    hechos = con_req = 0
    for codigo in codigos:
        kw = urllib.parse.quote(codigo)
        buscar = curl_json(f"{PROD6}/buscadorpublico/contrataciones/buscador?anio={anio}&palabra_clave={kw}&page=1&page_size=5", HDRS6, pausa=pausa)
        time.sleep(pausa)
        data = (buscar or {}).get("data") or []
        row = next((r for r in data if (r.get("desContratacion") or "").strip() == codigo), None)
        if not row:
            cur.execute("UPDATE seace_menores SET match_prod6='sin_match' WHERE codigo=%s", (codigo,))
            hechos += 1
            continue
        idc6 = row.get("idContrato")
        arch = curl_json(f"{PROD6}/archivo/archivos-publico/listar-archivos-contrato/{idc6}/1", HDRS6, pausa=pausa)
        time.sleep(pausa)
        lista = arch if isinstance(arch, list) else (arch or {}).get("data") or []
        req = lista[0] if lista else {}
        rid = req.get("idContratoArchivo")
        if rid:
            con_req += 1
        cur.execute("""UPDATE seace_menores SET id_contrato_prod6=%s, estado_prod6=%s, fec_publica=%s,
            fec_ini_cotizacion=%s, fec_fin_cotizacion=%s, id_requerimiento=%s, requerimiento_nombre=%s,
            match_prod6='exacto' WHERE codigo=%s""",
            (idc6, row.get("nomEstadoContrato"), fecha_iso(row.get("fecPublica")),
             fecha_iso(row.get("fecIniCotizacion")), fecha_iso(row.get("fecFinCotizacion")),
             str(rid) if rid else None, req.get("nombre"), codigo))
        hechos += 1
    print(f"  {hechos} procesadas, {con_req} con requerimiento")
    return hechos


def main() -> int:
    ap = argparse.ArgumentParser(description="Carga contratos menores ≤8 UIT del SEACE (prod4 + prod6).")
    ap.add_argument("--entorno", choices=["dev", "prod"], help="dev = vigia-db-dev, prod = vigia-db")
    ap.add_argument("--anio", type=int, default=datetime.now().year)
    ap.add_argument("--seco", action="store_true", help="sólo baja prod4 y cuenta, no escribe")
    ap.add_argument("--enriquecer", type=int, default=0, help="N CM recientes a enriquecer con el requerimiento de prod6")
    ap.add_argument("--pausa", type=float, default=1.1, help="segundos entre llamadas a prod6 (WAF)")
    a = ap.parse_args()
    if not a.seco and not a.entorno:
        ap.error("falta --entorno (o --seco)")
    sys.stdout.reconfigure(encoding="utf-8")

    filas = bajar_prod4(a.anio)
    if a.seco or not filas:
        return 0

    sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
    from tunel_rds import BASES, conexion
    from psycopg2.extras import execute_values

    sha = hashlib.sha256("".join(sorted(f"{f[0]}|{f[9]}" for f in filas)).encode("utf-8")).hexdigest()
    with conexion(a.entorno) as con:
        # 1) carga de prod4 (transacción propia: queda commiteada aunque falle lo de después)
        with con, con.cursor() as cur:
            execute_values(cur, SQL_UPSERT, filas, page_size=1000)
            cur.execute("SELECT count(*) FROM seace_menores WHERE anio=%s", (a.anio,))
            (n,) = cur.fetchone()
        print(f"✓ {BASES[a.entorno]}: {len(filas)} contratos menores {a.anio} cargados (tabla: {n} del año)")
        # 2) enriquecimiento prod6 en autocommit (cada UPDATE se guarda al toque; un reintento retoma los 'pendiente')
        if a.enriquecer:
            con.autocommit = True
            with con.cursor() as cur:
                enriquecer(cur, a.anio, a.enriquecer, a.pausa)
            con.autocommit = False
        # 3) bitácora de la carga
        with con, con.cursor() as cur:
            cur.execute(
                """INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, sha256, filas, fuente_url, descargado_at, cargado_at, estado)
                   VALUES (%s, %s, 'seace_menores', %s, %s, %s, %s, now(), now(), 'ok')
                   ON CONFLICT (fuente, clave) DO UPDATE SET archivo=EXCLUDED.archivo, sha256=EXCLUDED.sha256, filas=EXCLUDED.filas,
                     fuente_url=EXCLUDED.fuente_url, descargado_at=EXCLUDED.descargado_at, cargado_at=now(), estado='ok', error=NULL""",
                (FUENTE, str(a.anio), f"script {date.today().isoformat()}", sha, len(filas), PROD4_QUERY.format(anio=a.anio)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
