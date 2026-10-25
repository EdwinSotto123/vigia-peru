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
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from datetime import date, datetime, timezone
from pathlib import Path
from queue import Empty, Queue

NPX = shutil.which("npx") or shutil.which("npx.cmd") or "npx"  # en Windows es npx.cmd; el subprocess no lo halla solo

RAIZ = Path(__file__).resolve().parents[2]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
PROD4_QUERY = "https://prod4.seace.gob.pe:9000/api/bus/contrato/query/{anio}"
PROD6 = "https://prod6.seace.gob.pe/v1/s8uit-services"
HDRS6 = ["-A", UA, "-H", "Referer: https://prod6.seace.gob.pe/buscador-publico/contrataciones",
         "-H", "Origin: https://prod6.seace.gob.pe", "-H", "Accept: application/json, text/plain, */*"]
FUENTE = "seace_menores"
# --relay: enruta prod6 por el relay de Cloudflare en Zúrich (pasa el WAF que bloquea datacenter y la IP de la PC si se
# baneó). Token en SSM /vigia/relay/token; lo setea main(). El relay aguanta mucha más concurrencia que la PC directa.
RELAY = "https://vigia-relay.vigiaperu.workers.dev"
RELAY_TOK: str | None = None

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
        if RELAY_TOK and "prod6.seace.gob.pe" in url:
            # por el relay: POST /fetch {url} → {ok,status,body(str JSON)}
            r = subprocess.run(["curl", "-s", "--max-time", "90", "-X", "POST", f"{RELAY}/fetch",
                                "-H", f"Authorization: Bearer {RELAY_TOK}", "-H", "Content-Type: application/json",
                                "-d", json.dumps({"url": url})], capture_output=True)
            try:
                env = json.loads(r.stdout.decode("utf-8", "replace"))
                if env.get("status") == 200 and env.get("body"):
                    return json.loads(env["body"])
            except Exception:
                pass
            time.sleep(pausa * (i + 1)); continue
        r = subprocess.run(["curl", "-s", "--max-time", "90", url, *headers], capture_output=True)
        try:
            j = json.loads(r.stdout.decode("utf-8", "replace"))
            if isinstance(j, dict) and j.get("code") == "403":
                time.sleep(pausa * (i + 1)); continue
            return j
        except Exception:
            time.sleep(pausa * (i + 1))
    return None


def descargar_pdf(url: str, outfile: str) -> None:
    """Baja un PDF de prod6 a `outfile`: por el relay (/raw) si hay token, si no directo."""
    if RELAY_TOK and "prod6.seace.gob.pe" in url:
        subprocess.run(["curl", "-s", "--max-time", "120", "-X", "POST", f"{RELAY}/raw",
                        "-H", f"Authorization: Bearer {RELAY_TOK}", "-H", "Content-Type: application/json",
                        "-d", json.dumps({"url": url}), "-o", outfile], capture_output=True)
    else:
        subprocess.run(["curl", "-s", "--max-time", "120", url, *HDRS6, "-o", outfile], capture_output=True)


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


def espejar(con, entorno: str, limite: int, pausa: float) -> int:
    """Baja de prod6 los requerimientos aún sin espejar (desde la PC, que sí pasa el WAF) y los sube a R2 con wrangler
    (OAuth del usuario). La API los sirve desde R2 (su Worker no puede bajar de prod6). Marca req_r2=true."""
    bucket = "vigia-peru-batch-dev" if entorno == "dev" else "vigia-peru-batch"
    with con.cursor() as cur:
        cur.execute("""SELECT id_contrato, id_requerimiento FROM seace_menores
                       WHERE id_requerimiento IS NOT NULL AND req_r2 = false
                       ORDER BY fecha_suscripcion DESC NULLS LAST LIMIT %s""", (limite,))
        rows = cur.fetchall()
    print(f"Espejando {len(rows)} requerimientos a R2 ({bucket})…")
    api_dir = str(RAIZ / "backend" / "api")
    hechos = 0
    for idc, rid in rows:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
            tmp = f.name
        descargar_pdf(f"{PROD6}/archivo/archivos-publico/descargar-archivo-contrato/{rid}", tmp)
        time.sleep(pausa)
        with open(tmp, "rb") as fh:
            if fh.read(5) != b"%PDF-":
                print(f"  ! {idc}: prod6 no devolvió PDF (WAF/sin archivo), salto")
                continue
        key = f"seace/menores/req/{idc}.pdf"
        up = subprocess.run([NPX, "wrangler", "r2", "object", "put", f"{bucket}/{key}",
                             "--file", tmp, "--content-type", "application/pdf", "--remote"],
                            capture_output=True, cwd=api_dir)  # sin text=True: la salida de wrangler trae emojis/cajas no-cp1252
        if up.returncode != 0:
            err = (up.stderr or up.stdout or b"").decode("utf-8", "replace")
            print(f"  ! wrangler falló para {idc}: {err[-200:]}")
            continue
        with con.cursor() as cur:
            cur.execute("UPDATE seace_menores SET req_r2 = true WHERE id_contrato = %s", (idc,))
        hechos += 1
    print(f"  {hechos} requerimientos en R2")
    return hechos


def espejar_paralelo(entorno: str, anio: int, limite: int, hilos: int, pausa: float) -> int:
    """Enriquece (prod6) + espeja el requerimiento a R2, con N hilos, desde la PC (única IP que pasa el WAF de prod6).
    El WAF corta ráfagas y penaliza con un cooldown: si se acumulan 403, TODOS los hilos esperan y reanudan. Idempotente
    y reanudable (req_r2). OJO: probado hasta 4 hilos sin bloqueo; 8 tumba la IP. No subir mucho `hilos`."""
    import tunel_rds as T  # ya está en sys.path (lo puso main)
    import psycopg2
    clave = T._aws("ssm", "get-parameter", "--name", T.CLAVES["vigia-db"], "--with-decryption", "--query", "Parameter.Value")
    bucket = "vigia-peru-batch-dev" if entorno == "dev" else "vigia-peru-batch"
    api_dir = str(RAIZ / "backend" / "api")
    st = {"ok": 0, "sin_req": 0, "403": 0, "err": 0, "consec403": 0, "enfriar_hasta": 0.0}
    lock = threading.Lock()

    def worker(host, puerto, q):
        con = psycopg2.connect(host=host, port=puerto, dbname="vigia", user="postgres", password=clave, sslmode="require", connect_timeout=20)
        con.autocommit = True
        cur = con.cursor()
        while True:
            try:
                idc, codigo, intentos = q.get_nowait()
            except Empty:
                break
            # respetar cooldown global del WAF
            with lock:
                espera = st["enfriar_hasta"] - time.time()
            if espera > 0:
                time.sleep(espera)
            try:
                def un403():
                    with lock:
                        st["403"] += 1
                        st["consec403"] += 1
                        if st["consec403"] >= hilos * 2:  # ráfaga de 403 → cooldown y reset
                            st["enfriar_hasta"] = time.time() + 150
                            st["consec403"] = 0
                    if intentos < 3:
                        q.put((idc, codigo, intentos + 1))  # reintentar luego

                b = curl_json(f"{PROD6}/buscadorpublico/contrataciones/buscador?anio={anio}&palabra_clave={urllib.parse.quote(codigo)}&page=1&page_size=5", HDRS6, tries=1)
                if b is None:
                    un403(); continue
                rows = (b or {}).get("data") or []
                row = next((r for r in rows if (r.get("desContratacion") or "").strip() == codigo), None)
                if not row:
                    cur.execute("UPDATE seace_menores SET match_prod6='sin_match' WHERE id_contrato=%s", (idc,))
                    with lock: st["sin_req"] += 1; st["consec403"] = 0
                    continue
                idc6 = row.get("idContrato")
                arch = curl_json(f"{PROD6}/archivo/archivos-publico/listar-archivos-contrato/{idc6}/1", HDRS6, tries=1)
                if arch is None:
                    un403(); continue
                lista = arch if isinstance(arch, list) else (arch or {}).get("data") or []
                req = lista[0] if lista else {}
                rid = req.get("idContratoArchivo")
                cur.execute("""UPDATE seace_menores SET id_contrato_prod6=%s, estado_prod6=%s, fec_publica=%s,
                    fec_ini_cotizacion=%s, fec_fin_cotizacion=%s, id_requerimiento=%s, requerimiento_nombre=%s,
                    match_prod6='exacto' WHERE id_contrato=%s""",
                    (idc6, row.get("nomEstadoContrato"), fecha_iso(row.get("fecPublica")), fecha_iso(row.get("fecIniCotizacion")),
                     fecha_iso(row.get("fecFinCotizacion")), str(rid) if rid else None, req.get("nombre"), idc))
                with lock: st["consec403"] = 0
                if not rid:
                    with lock: st["sin_req"] += 1
                    continue
                with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
                    tmp = f.name
                descargar_pdf(f"{PROD6}/archivo/archivos-publico/descargar-archivo-contrato/{rid}", tmp)
                ok_pdf = False
                with open(tmp, "rb") as fh:
                    ok_pdf = fh.read(5) == b"%PDF-"
                if not ok_pdf:
                    os.unlink(tmp); un403(); continue
                up = subprocess.run([NPX, "wrangler", "r2", "object", "put", f"{bucket}/seace/menores/req/{idc}.pdf",
                                     "--file", tmp, "--content-type", "application/pdf", "--remote"], capture_output=True, cwd=api_dir)
                os.unlink(tmp)
                if up.returncode == 0:
                    cur.execute("UPDATE seace_menores SET req_r2=true WHERE id_contrato=%s", (idc,))
                    with lock: st["ok"] += 1
                else:
                    with lock: st["err"] += 1
                time.sleep(pausa)
            except Exception:
                with lock: st["err"] += 1
            finally:
                q.task_done()
        cur.close(); con.close()

    with T.tunel("vigia-db") as (host, puerto):
        c0 = psycopg2.connect(host=host, port=puerto, dbname="vigia", user="postgres", password=clave, sslmode="require", connect_timeout=20)
        c0.autocommit = True
        cur0 = c0.cursor()
        cur0.execute("""SELECT id_contrato, codigo FROM seace_menores
                        WHERE codigo IS NOT NULL AND match_prod6='pendiente' AND (anio=%s OR %s=0)
                        ORDER BY fecha_suscripcion DESC NULLS LAST LIMIT %s""", (anio, anio, limite))
        items = cur0.fetchall()
        c0.close()
        q: Queue = Queue()
        for idc, codigo in items:
            q.put((idc, codigo, 0))
        print(f"Procesando {len(items)} CM con {hilos} hilos (prod6 + R2, pausa {pausa}s)…")
        t0 = time.time()
        hs = [threading.Thread(target=worker, args=(host, puerto, q), daemon=True) for _ in range(hilos)]
        for h in hs: h.start()
        for h in hs: h.join()
        dt = time.time() - t0
        print(f"  {st['ok']} en R2 · {st['sin_req']} sin requerimiento · {st['403']} bloqueos · {st['err']} errores · {dt:.0f}s")
    return st["ok"]


def main() -> int:
    ap = argparse.ArgumentParser(description="Carga contratos menores ≤8 UIT del SEACE (prod4 + prod6).")
    ap.add_argument("--entorno", choices=["dev", "prod"], help="dev = vigia-db-dev, prod = vigia-db")
    ap.add_argument("--anio", type=int, default=datetime.now().year)
    ap.add_argument("--seco", action="store_true", help="sólo baja prod4 y cuenta, no escribe")
    ap.add_argument("--enriquecer", type=int, default=0, help="N CM recientes a enriquecer con el requerimiento de prod6")
    ap.add_argument("--espejar", type=int, default=0, help="N requerimientos a bajar de prod6 y subir a R2 (wrangler)")
    ap.add_argument("--hilos", type=int, default=1, help="hilos para enriquecer+espejar en paralelo (directo ≤4; por relay 10+)")
    ap.add_argument("--relay", action="store_true", help="enrutar prod6 por el relay de Zúrich (pasa el WAF; permite más hilos)")
    ap.add_argument("--pausa", type=float, default=1.1, help="segundos entre llamadas a prod6 (WAF)")
    a = ap.parse_args()
    if not a.seco and not a.entorno:
        ap.error("falta --entorno (o --seco)")
    sys.stdout.reconfigure(encoding="utf-8")
    if a.relay:
        global RELAY_TOK
        RELAY_TOK = subprocess.run(["aws", "ssm", "get-parameter", "--name", "/vigia/relay/token", "--with-decryption",
                                    "--query", "Parameter.Value", "--output", "text", "--profile", "founder.edwin", "--region", "us-east-2"],
                                   capture_output=True, text=True, env={**os.environ, "MSYS_NO_PATHCONV": "1"}).stdout.strip()
        print(f"relay activado (token {len(RELAY_TOK)} chars)")

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
        # 2) enriquecimiento + espejado SECUENCIAL (1 hilo); el paralelo va abajo (abre su propio túnel)
        if (a.enriquecer or a.espejar) and a.hilos <= 1:
            con.autocommit = True
            if a.enriquecer:
                with con.cursor() as cur:
                    enriquecer(cur, a.anio, a.enriquecer, a.pausa)
            if a.espejar:
                espejar(con, a.entorno, a.espejar, a.pausa)
            con.autocommit = False
        # 3) bitácora de la carga
        with con, con.cursor() as cur:
            cur.execute(
                """INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, sha256, filas, fuente_url, descargado_at, cargado_at, estado)
                   VALUES (%s, %s, 'seace_menores', %s, %s, %s, %s, now(), now(), 'ok')
                   ON CONFLICT (fuente, clave) DO UPDATE SET archivo=EXCLUDED.archivo, sha256=EXCLUDED.sha256, filas=EXCLUDED.filas,
                     fuente_url=EXCLUDED.fuente_url, descargado_at=EXCLUDED.descargado_at, cargado_at=now(), estado='ok', error=NULL""",
                (FUENTE, str(a.anio), f"script {date.today().isoformat()}", sha, len(filas), PROD4_QUERY.format(anio=a.anio)))
    # 4) enriquecimiento + espejado EN PARALELO (fuera del túnel de carga: abre el suyo con N conexiones)
    if (a.enriquecer or a.espejar) and a.hilos > 1:
        espejar_paralelo(a.entorno, a.anio, a.espejar or a.enriquecer, a.hilos, a.pausa)
    return 0


if __name__ == "__main__":
    sys.exit(main())
