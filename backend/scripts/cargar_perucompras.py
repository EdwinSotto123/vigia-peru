#!/usr/bin/env python3
"""Baja y carga las órdenes de los Catálogos Electrónicos de Perú Compras con sus ítems y precios (migración 236).

Fuente: el reporte detallado público de https://catalogos.perucompras.gob.pe/ConsultaOrdenesPub, sin captcha ni cuenta.
El portal pide un acuerdo marco y un rango de fechas: `POST /ConsultaOrdenesPub/consultaOrdenesDetallado` con el cuerpo
`<OCAM>^<acuerdo>^<catálogo>^<entidad>^<proveedor>^<desde AAAA-MM-DD>^<hasta>^<BIENES|SERVICIOS>` (formatoData() de
/Scripts/Reportes/ConsultaOrdenesPub.js). La lista de acuerdos (vigentes y no vigentes) sale de `POST …/obtenerFiltros`.
La respuesta es texto UTF-8: la cabecera y las filas separadas por «¯», las filas por «¬» y los campos por «^». Son 54
columnas por línea de entrega; se leen por posición (los nombres traen saltos de línea en medio) y se verifica que sean
54: si el portal cambia la forma, el script se detiene avisando.

Dos pasos, separados para que la descarga (horas) no tenga una conexión a la base abierta:

  bajar   Por acuerdo y año, de --desde a --hasta. Un año vacío tarda 0,7 s; uno grande, más de un minuto (limpieza 2025:
          32 MB, 31 mil líneas): si falla o pasa el plazo, se parte en meses. Guarda cada tramo en
          dataset/perucompras/crudo/<id>-<TIPO>/<año>[-<mes>].txt.gz, YA SIN los datos personales de abajo. Retomable:
          un tramo ya bajado no se vuelve a pedir, salvo los del año en curso y el anterior (las órdenes cambian de estado
          hasta que se pagan) si tienen más de --refrescar-dias días.
  cargar  Lee los tramos bajados y, por acuerdo (una orden es de un solo acuerdo), reemplaza sus órdenes e ítems en una
          transacción. Sólo los acuerdos cuyos tramos cambiaron (sha256 en perucompras_tramo). Idempotente.

Qué NO se guarda (privacidad, docs/PRIVACIDAD.md), ni siquiera en disco: «Usuario Creación OC» (DNI e IP del funcionario,
columna 27), el ubigeo y la dirección del proveedor (29, 30; ~1 de cada 5 líneas es una persona natural con RUC 10) y la
dirección de entrega (47; queda su ubigeo). En los acuerdos de boletos aéreos, la ficha del ítem puede nombrar al
pasajero: ahí no se guardan descripción, marca, número de parte ni enlace de la ficha.

Uso (desde la raíz del repo; en Git Bash, con MSYS_NO_PATHCONV=1 AWS_PROFILE=founder.edwin PATH="/c/Users/usuario/bin:$PATH"):
  python -I -X utf8 backend/scripts/cargar_perucompras.py bajar                       # todos los acuerdos, 2015 a hoy
  python -I -X utf8 backend/scripts/cargar_perucompras.py bajar --acuerdos 324 --desde 2025
  python -I -X utf8 backend/scripts/cargar_perucompras.py cargar --seco               # lee y cuenta; no escribe
  python -I -X utf8 backend/scripts/cargar_perucompras.py cargar --entorno dev
Requiere psycopg2, la CLI de AWS y session-manager-plugin para `cargar` (túnel de infrastructure/aws/tunel_rds.py).
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import re
import site
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta
from pathlib import Path

# Con `python -I` no entra el site-packages del usuario (ahí está psycopg2) ni la carpeta del script.
if sys.flags.isolated:
    sys.path.append(site.getusersitepackages())

RAIZ = Path(__file__).resolve().parents[2]
CRUDO = RAIZ / "dataset" / "perucompras" / "crudo"
PORTAL = "https://catalogos.perucompras.gob.pe/ConsultaOrdenesPub"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
SEP_PARTE, SEP_FILA, SEP_CAMPO = "¯", "¬", "^"
COLUMNAS = 54
# Columnas que se borran al bajar (ver arriba): usuario que creó la orden, ubigeo y dirección del proveedor, dirección de entrega.
PRIVADAS = (27, 29, 30, 47)
PLAZO_ANIO = 280   # segundos para un año entero; si no alcanza, por meses
PLAZO_MES = 240
REINTENTOS = 3


# ─── El portal ───────────────────────────────────────────────────────────────────────────────────────────────────────

def pedir(metodo: str, cuerpo: str, plazo: int) -> str:
    req = urllib.request.Request(f"{PORTAL}/{metodo}", data=cuerpo.encode("utf-8"), method="POST",
                                 headers={"User-Agent": UA, "Content-Type": "text/plain; charset=UTF-8",
                                          "Referer": PORTAL, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=plazo) as r:
        return r.read().decode("utf-8")


def acuerdos() -> list[tuple[int, str, str]]:
    """(id, BIENES|SERVICIOS, nombre) de los 302 acuerdos del combo, vigentes y no vigentes."""
    partes = pedir("obtenerFiltros", "", 60).split(SEP_PARTE)
    salida = []
    for a in partes[0].split(SEP_FILA):
        if "^" not in a:
            continue
        valor, nombre = a.split("^", 1)
        ident, _, tipo = valor.partition("-")
        if ident.isdigit() and tipo in ("BIENES", "SERVICIOS"):
            salida.append((int(ident), tipo, " ".join(nombre.split())))
    return salida


def limpiar(texto: str) -> tuple[str, int]:
    """La respuesta sin las columnas privadas. Devuelve el texto a guardar y cuántas líneas trae."""
    partes = texto.split(SEP_PARTE)
    cab = partes[0].split(SEP_FILA)[0].split(SEP_CAMPO)
    if len(cab) != COLUMNAS:
        raise ValueError(f"la cabecera trae {len(cab)} columnas, no {COLUMNAS}: el portal cambió de forma")
    filas = [f for f in partes[1].split(SEP_FILA) if f] if len(partes) > 1 else []
    limpias = []
    pedazo = ""  # un texto libre que trae el separador de filas («¬») parte la fila: se vuelve a unir con un espacio
    for f in filas:
        f = f"{pedazo} {f}" if pedazo else f
        c = f.split(SEP_CAMPO)
        if len(c) < COLUMNAS:
            pedazo = f
            continue
        pedazo = ""
        if len(c) != COLUMNAS:
            raise ValueError(f"una fila trae {len(c)} campos, no {COLUMNAS}")
        for i in PRIVADAS:
            c[i] = ""
        limpias.append(SEP_CAMPO.join(c))
    if pedazo:
        raise ValueError(f"la última fila quedó con {len(pedazo.split(SEP_CAMPO))} campos, no {COLUMNAS}")
    return partes[0] + SEP_PARTE + SEP_FILA.join(limpias), len(limpias)


def consultar(ident: int, tipo: str, desde: date, hasta: date, plazo: int) -> tuple[str, int]:
    cuerpo = f"^{ident}^^^^{desde.isoformat()}^{hasta.isoformat()}^{tipo}"
    ultimo: Exception | None = None
    for intento in range(REINTENTOS):
        try:
            return limpiar(pedir("consultaOrdenesDetallado", cuerpo, plazo))
        except ValueError:
            raise
        except Exception as e:  # noqa: BLE001 — red o 5xx: se reintenta
            ultimo = e
            time.sleep(5 * (intento + 1))
    raise RuntimeError(f"{ident}-{tipo} {desde}..{hasta}: {ultimo}")


def guardar(ruta: Path, texto: str) -> None:
    ruta.parent.mkdir(parents=True, exist_ok=True)
    tmp = ruta.with_suffix(".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as g:
        g.write(texto)
    tmp.replace(ruta)


# ─── bajar ───────────────────────────────────────────────────────────────────────────────────────────────────────────

def fin_de_mes(a: int, m: int) -> date:
    return date(a + (m == 12), m % 12 + 1, 1) - timedelta(days=1)


def bajar_anio(ident: int, tipo: str, anio: int, refrescar_dias: float) -> str:
    carpeta = CRUDO / f"{ident}-{tipo}"
    archivo = carpeta / f"{anio}.txt.gz"
    partido = carpeta / f"{anio}.partido"
    hoy = date.today()
    reciente = anio >= hoy.year - 1
    def vigente(p: Path) -> bool:
        return p.exists() and (not reciente or time.time() - p.stat().st_mtime < refrescar_dias * 86400)
    if vigente(archivo) or (partido.exists() and not reciente):
        return "ya"
    hasta = min(date(anio, 12, 31), hoy)
    if not partido.exists():
        try:
            texto, n = consultar(ident, tipo, date(anio, 1, 1), hasta, PLAZO_ANIO)
            guardar(archivo, texto)
            return f"{n} líneas"
        except (RuntimeError, ValueError):
            pass  # demasiado grande para un año (el portal se agota o responde un error de una columna): por meses
    total = 0
    for m in range(1, (hoy.month if anio == hoy.year else 12) + 1):
        mes = carpeta / f"{anio}-{m:02d}.txt.gz"
        if vigente(mes):
            continue
        texto, n = consultar(ident, tipo, date(anio, m, 1), min(fin_de_mes(anio, m), hoy), PLAZO_MES)
        guardar(mes, texto)
        total += n
    partido.parent.mkdir(parents=True, exist_ok=True)
    partido.write_text("por meses\n", encoding="utf-8")
    archivo.unlink(missing_ok=True)
    return f"{total} líneas (por meses)"


def cmd_bajar(a) -> int:
    lista = acuerdos()
    if a.acuerdos:
        pedidos = {int(x) for x in a.acuerdos.split(",")}
        lista = [x for x in lista if x[0] in pedidos]
    hasta = a.hasta or date.today().year
    tareas = [(i, t, n, anio) for i, t, n in lista for anio in range(a.desde, hasta + 1)]
    print(f"{len(lista)} acuerdos, {len(tareas)} tramos de un año ({a.desde}-{hasta}), {a.paralelo} a la vez", flush=True)
    t0, hechos, errores, lineas = time.time(), 0, [], 0
    with ThreadPoolExecutor(a.paralelo) as ex:
        futuros = {ex.submit(bajar_anio, i, t, anio, a.refrescar_dias): (i, t, n, anio) for i, t, n, anio in tareas}
        for f in as_completed(futuros):
            i, t, n, anio = futuros[f]
            hechos += 1
            try:
                r = f.result()
                if r != "ya" and not r.startswith("0 "):
                    lineas += int(r.split()[0])
                    print(f"  [{hechos}/{len(tareas)}] {i}-{t} {anio}: {r}  ({n[:60]})", flush=True)
            except Exception as e:  # noqa: BLE001
                errores.append(f"{i}-{t} {anio}: {e}")
                print(f"  [{hechos}/{len(tareas)}] {i}-{t} {anio}: ERROR {e}", flush=True)
            if hechos % 200 == 0:
                print(f"  … {hechos}/{len(tareas)} tramos, {lineas:,} líneas nuevas, {time.time() - t0:.0f} s", flush=True)
    print(f"listo: {lineas:,} líneas nuevas en {time.time() - t0:.0f} s; {len(errores)} errores", flush=True)
    for e in errores:
        print("  ", e)
    return 1 if errores else 0


# ─── cargar ──────────────────────────────────────────────────────────────────────────────────────────────────────────

def texto(v: str) -> str | None:
    v = " ".join(v.replace("&amp;", "&").split())
    return v or None


def numero(v: str) -> str | None:
    v = v.strip().replace(",", "")
    return v if re.fullmatch(r"-?\d+(\.\d+)?", v) else None


def entero(v: str) -> int | None:
    v = v.strip()
    return int(v) if re.fullmatch(r"-?\d+", v) else None


def fecha(v: str) -> str | None:
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", v.strip())
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def fecha_hora(v: str) -> str | None:
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})(?: (\d{2}:\d{2}:\d{2}))?", v.strip())
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)} {m.group(4) or '00:00:00'}" if m else None


def ruc(v: str) -> str | None:
    v = v.strip()
    return v if re.fullmatch(r"\d{11}", v) else None


def si_no(v: str) -> bool | None:
    v = v.strip().upper()
    return True if v == "SI" else False if v == "NO" else None


def version_de(ocam: str) -> tuple[str, int]:
    """OCAM-2026-88-393-1 → (OCAM-2026-88-393, 1). Una orden sin sufijo de versión es la versión 0."""
    base, _, v = ocam.rpartition("-")
    return (base, int(v)) if base and v.isdigit() and len(v) <= 2 else (ocam, 0)


def tramos(carpeta: Path) -> list[tuple[Path, date, date]]:
    salida = []
    for p in sorted(carpeta.glob("*.txt.gz")):
        nombre = p.name.removesuffix(".txt.gz")
        if re.fullmatch(r"\d{4}", nombre):
            a = int(nombre)
            salida.append((p, date(a, 1, 1), date(a, 12, 31)))
        elif m := re.fullmatch(r"(\d{4})-(\d{2})", nombre):
            a, mm = int(m.group(1)), int(m.group(2))
            salida.append((p, date(a, mm, 1), fin_de_mes(a, mm)))
    return salida


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


CAMPOS_ORDEN = ["orden", "acuerdo_id", "acuerdo_codigo", "acuerdo", "tipo", "entidad_ruc", "entidad", "unidad_ejecutora",
                "proveedor_ruc", "proveedor", "procedimiento", "tipo_compra", "estado", "estado_motivo", "estado_descripcion",
                "nro_orden_fisica", "fecha_publicacion", "fecha_aceptacion", "fecha_ultimo_estado", "subtotal", "igv", "total",
                "pdf_orden", "pdf_sustento", "cesion", "versiones"]
CAMPOS_ITEM = ["orden", "version", "linea", "nro_entrega", "catalogo", "categoria", "descripcion", "marca", "nro_parte",
               "link_ficha", "flete_unitario", "fecha_inicio_entrega", "plazo_entrega", "fecha_fin_entrega", "ubigeo_entrega",
               "cantidad", "afecto_igv", "precio_unitario", "subtotal", "igv", "total"]


def leer_acuerdo(ident: int, tipo: str, archivos: list[tuple[Path, date, date]]):
    """Las órdenes y los ítems de un acuerdo. Una orden puede venir en dos tramos (el filtro de fechas del portal no es
    la fecha de publicación): vale la del tramo más reciente."""
    # Cada fila se guarda como texto y se parte al usarla: partida en 54 campos, el acuerdo más grande (1.6 M de
    # líneas) pasaba de 5 GB de memoria.
    versiones: dict[tuple[str, int], tuple[int, list[str]]] = {}
    por_tramo: list[tuple[int, set[str]]] = []
    for k, (p, _, _) in enumerate(archivos):
        n_lineas, en_tramo = 0, set()
        with gzip.open(p, "rt", encoding="utf-8") as g:
            partes = g.read().split(SEP_PARTE)
        for f in (partes[1].split(SEP_FILA) if len(partes) > 1 else []):
            if not f:
                continue
            clave = version_de(f.split(SEP_CAMPO, 10)[9].strip())
            n_lineas += 1
            en_tramo.add(clave[0])
            previo = versiones.get(clave)
            if previo is None or previo[0] != k:
                versiones[clave] = (k, [f])
            else:
                previo[1].append(f)
        por_tramo.append((n_lineas, en_tramo))
    ordenes: dict[str, dict] = {}
    items: list[list] = []
    for (base, v), (_, filas) in versiones.items():
        filas = [f.split(SEP_CAMPO) for f in filas]
        c = filas[0]
        boletos = "BOLETO" in (c[28] + c[1]).upper()
        for linea, fila in enumerate(filas, 1):
            items.append([base, v, linea, entero(fila[39]), texto(fila[32]), texto(fila[33]),
                          None if boletos else texto(fila[34]), None if boletos else texto(fila[35]),
                          None if boletos else texto(fila[36]), None if boletos else texto(fila[37]),
                          numero(fila[38]), fecha(fila[40]), entero(fila[41]), fecha(fila[42]),
                          texto(fila[43]), numero(fila[48]), si_no(fila[49]), numero(fila[50]), numero(fila[51]),
                          numero(fila[52]), numero(fila[53])])
        codigo = re.match(r"[A-Z]+(?:-[A-Z]+)*-\d{4}-\d+", c[1].strip())
        fila_orden = {
            "orden": base, "acuerdo_id": ident, "acuerdo_codigo": codigo.group(0) if codigo else None,
            "acuerdo": texto(c[28]) or texto(c[1]), "tipo": tipo, "entidad_ruc": ruc(c[4]), "entidad": texto(c[5]),
            "unidad_ejecutora": texto(c[6]), "proveedor_ruc": ruc(c[2]), "proveedor": texto(c[3]),
            "procedimiento": texto(c[7]), "tipo_compra": texto(c[8]), "estado": texto(c[10]), "estado_motivo": texto(c[22]),
            "estado_descripcion": texto(c[23]), "nro_orden_fisica": texto(c[14]), "fecha_publicacion": fecha(c[24]),
            "fecha_aceptacion": fecha(c[25]), "fecha_ultimo_estado": fecha_hora(c[16]), "subtotal": numero(c[17]),
            "igv": numero(c[18]), "total": numero(c[19]), "pdf_orden": texto(c[20]), "pdf_sustento": texto(c[21]),
            "cesion": texto(c[26]), "_v": v,
        }
        o = ordenes.get(base)
        if o is None:
            fila_orden["versiones"] = 1
            ordenes[base] = fila_orden
        else:
            n = o["versiones"] + 1
            # El estado vigente: la versión con el último cambio de estado (a igual fecha, la de número mayor).
            if (fila_orden["fecha_ultimo_estado"] or "", v) > (o["fecha_ultimo_estado"] or "", o["_v"]):
                ordenes[base] = fila_orden
            ordenes[base]["versiones"] = n
    return ordenes, items, por_tramo


def a_csv(filas) -> io.StringIO:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    for f in filas:
        w.writerow(["" if x is None else ("t" if x is True else "f" if x is False else x) for x in f])
    buf.seek(0)
    return buf


class Latido(threading.Thread):
    """Una segunda conexión que hace SELECT 1 cada minuto: el túnel de SSM se corta tras ~20 min sin tráfico."""

    def __init__(self, conectar):
        super().__init__(daemon=True)
        self.con = conectar()
        self.con.autocommit = True
        self.parar = threading.Event()

    def run(self):
        while not self.parar.wait(60):
            try:
                with self.con.cursor() as cur:
                    cur.execute("SELECT 1")
            except Exception:  # noqa: BLE001
                return


def cmd_cargar(a) -> int:
    carpetas = sorted(p for p in CRUDO.glob("*-*") if p.is_dir())
    if a.acuerdos:
        pedidos = set(a.acuerdos.split(","))
        carpetas = [p for p in carpetas if p.name.split("-")[0] in pedidos]
    if a.seco:
        tot_o = tot_i = 0
        for carpeta in carpetas:
            ident, tipo = carpeta.name.split("-", 1)
            o, i, _ = leer_acuerdo(int(ident), tipo, tramos(carpeta))
            if o:
                print(f"  {carpeta.name}: {len(o):,} órdenes, {len(i):,} líneas")
            tot_o, tot_i = tot_o + len(o), tot_i + len(i)
        print(f"total: {tot_o:,} órdenes, {tot_i:,} líneas")
        return 0

    sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))
    import psycopg2
    from tunel_rds import BASES, CLAVES, _aws, tunel

    base = BASES[a.entorno]
    clave = _aws("ssm", "get-parameter", "--name", CLAVES[base], "--with-decryption", "--query", "Parameter.Value")
    with tunel(base) as (host, puerto):
        conectar = lambda: psycopg2.connect(host=host, port=puerto, dbname="vigia", user="postgres", password=clave,  # noqa: E731
                                            sslmode="require", connect_timeout=15, keepalives=1, keepalives_idle=30)
        latido = Latido(conectar)
        latido.start()
        con = conectar()
        with con, con.cursor() as cur:
            cur.execute("SELECT acuerdo_id, tipo, desde, hasta, sha256 FROM perucompras_tramo")
            hechos = {(r[0], r[1], r[2], r[3]): r[4] for r in cur.fetchall()}
        t0, cargados, tot_o, tot_i = time.time(), 0, 0, 0
        for carpeta in carpetas:
            ident_s, tipo = carpeta.name.split("-", 1)
            ident = int(ident_s)
            archivos = tramos(carpeta)
            huellas = [(p, d, h, sha(p)) for p, d, h in archivos]
            if all(hechos.get((ident, tipo, d, h)) == s for _, d, h, s in huellas):
                continue
            ordenes, items, por_tramo = leer_acuerdo(ident, tipo, archivos)
            with con, con.cursor() as cur:
                cur.execute("DELETE FROM perucompras_orden WHERE acuerdo_id = %s AND tipo = %s", (ident, tipo))
                cur.execute("CREATE TEMP TABLE _po (LIKE perucompras_orden INCLUDING DEFAULTS) ON COMMIT DROP")
                cur.copy_expert(f"COPY _po ({', '.join(CAMPOS_ORDEN)}) FROM STDIN WITH (FORMAT csv)",
                                a_csv([o[k] for k in CAMPOS_ORDEN] for o in ordenes.values()))
                cur.execute(f"""INSERT INTO perucompras_orden ({', '.join(CAMPOS_ORDEN)})
                                SELECT {', '.join(CAMPOS_ORDEN)} FROM _po
                                ON CONFLICT (orden) DO UPDATE SET {', '.join(f'{k} = EXCLUDED.{k}' for k in CAMPOS_ORDEN[1:])},
                                  cargado_at = now()""")
                cur.execute("DELETE FROM perucompras_item WHERE orden IN (SELECT orden FROM _po)")
                cur.copy_expert(f"COPY perucompras_item ({', '.join(CAMPOS_ITEM)}) FROM STDIN WITH (FORMAT csv)", a_csv(items))
                cur.execute("DELETE FROM perucompras_tramo WHERE acuerdo_id = %s AND tipo = %s", (ident, tipo))
                for (p, d, h, s), (n_lineas, en_tramo) in zip(huellas, por_tramo):
                    cur.execute("INSERT INTO perucompras_tramo (acuerdo_id, tipo, desde, hasta, sha256, ordenes, lineas) "
                                "VALUES (%s, %s, %s, %s, %s, %s, %s)", (ident, tipo, d, h, s, len(en_tramo), n_lineas))
            cargados += 1
            tot_o, tot_i = tot_o + len(ordenes), tot_i + len(items)
            if ordenes:
                print(f"  {carpeta.name}: {len(ordenes):,} órdenes, {len(items):,} líneas ({time.time() - t0:.0f} s)", flush=True)
        with con, con.cursor() as cur:
            cur.execute("ANALYZE perucompras_orden")
            cur.execute("ANALYZE perucompras_item")
            # El precio de referencia de cada ficha y las compras al doble o más (migración 237), si ya está.
            cur.execute("SELECT to_regprocedure('refrescar_perucompras_precios()') IS NOT NULL")
            if cargados and cur.fetchone()[0]:
                cur.execute("SET LOCAL statement_timeout = 0")
                cur.execute("SELECT refrescar_perucompras_precios()")
                print(f"  precios de referencia: {cur.fetchone()[0]:,} líneas al doble de la mediana o más", flush=True)
            cur.execute("""INSERT INTO datasets_cargas (fuente, clave, tabla, archivo, sha256, bytes, filas, fuente_url,
                                                        descargado_at, cargado_at, estado)
                           SELECT 'perucompras', 'ordenes', 'perucompras_orden', 'consultaOrdenesDetallado',
                                  md5(string_agg(sha256, '' ORDER BY acuerdo_id, tipo, desde)), NULL, (SELECT count(*) FROM perucompras_orden),
                                  %s, max(cargado_at), now(), 'ok' FROM perucompras_tramo
                           ON CONFLICT (fuente, clave) DO UPDATE SET sha256 = EXCLUDED.sha256, filas = EXCLUDED.filas,
                             descargado_at = EXCLUDED.descargado_at, cargado_at = now(), estado = 'ok', error = NULL""", (PORTAL,))
        latido.parar.set()
        print(f"✓ {base}: {cargados} acuerdos recargados, {tot_o:,} órdenes, {tot_i:,} líneas ({time.time() - t0:.0f} s)")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("bajar", help="baja los tramos (acuerdo × año) a dataset/perucompras/crudo")
    b.add_argument("--desde", type=int, default=2015)
    b.add_argument("--hasta", type=int)
    b.add_argument("--acuerdos", help="ids separados por coma (por defecto, todos)")
    b.add_argument("--paralelo", type=int, default=3)
    b.add_argument("--refrescar-dias", type=float, default=6, help="rebaja los tramos del año en curso y el anterior más viejos que esto")
    c = sub.add_parser("cargar", help="carga los tramos bajados en la base")
    c.add_argument("--entorno", choices=["dev", "prod"])
    c.add_argument("--seco", action="store_true", help="lee y cuenta; no escribe")
    c.add_argument("--acuerdos", help="ids separados por coma (por defecto, todos)")
    a = ap.parse_args()
    if a.cmd == "cargar" and not a.seco and not a.entorno:
        ap.error("cargar necesita --entorno dev|prod (o --seco)")
    return cmd_bajar(a) if a.cmd == "bajar" else cmd_cargar(a)


if __name__ == "__main__":
    sys.exit(main())
