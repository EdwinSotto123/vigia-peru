#!/usr/bin/env python3
"""Procesa TODO lo de uno o más proveedores: sus procesos ganados, los documentos, la lectura por pieza, los precios de
mercado de cada renglón (laboratorio de precios) y el reanálisis con los agentes.

Pedido del usuario (2026-11-17), con AGROINDUSTRIA LA PERLA DEL HUASCARAN («siempre gana la licitación sola»): «procesa
todo… EXTRAE los ítems e intenta extraer los precios, sea mediante CUBSO, compras, internet».

Pasos (cada uno se puede correr solo con --pasos; por defecto, todos en orden):

  procesos    los procesos que ganó cada RUC (convocatorias.proveedor_ruc y, si existe, como integrante de un consorcio),
              desde --desde. Quedan en <salida>/ocids.txt para los demás pasos.
  descargar   pide los documentos que faltan (pedidos_descarga, motivo «proveedor»; el Worker de scrapers los baja por el
              relay de Lima, porque el SEACE no responde fuera del Perú) y dispara una corrida de «documentos». Si quedan
              pedidos sin atender, los demás pasos trabajan con lo que ya hay: se vuelve a correr después.
  texto       PDF y ZIP → texto por página (lector/texto.py).
  piezas      cada PDF con su tipo (lector/piezas.py).
  escaneos    transcribe con visión los contratos, actas y cuadros escaneados, y las bases que esperan visión
              (lector/transcribir.py); después vuelve a registrar las piezas (cambió su texto).
  leer        los lectores por pieza: bases, contrato, evaluación, garantía, modificación, resolución, desierto.
  precios     pone los procesos en la cola del laboratorio de precios (migración 338): el cron de 10 min de la API
              investiga cada renglón en tiendas, con las referencias del Estado por CUBSO y por texto.
  analizar    reanaliza los procesos con los agentes (scripts/reanalizar_contratos.py, libro del masivo).

  python -X utf8 backend/scripts/procesar_proveedor.py prod --ruc 20530880746 20610478329 --motivo "La Perla y Marysa"
  python -X utf8 backend/scripts/procesar_proveedor.py prod --ruc 20530880746 --pasos texto piezas escaneos leer precios
  python -X utf8 backend/scripts/procesar_proveedor.py prod --ruc 20530880746 --pasos estado

Desde la PC (túnel a RDS; perfil founder.edwin). Los topes de gasto de cada paso son los de su herramienta.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "infrastructure" / "aws"))

PASOS = ("procesos", "descargar", "texto", "piezas", "escaneos", "leer", "precios", "analizar")
LECTORES = ("bases", "contrato", "evaluacion", "garantia", "modificacion", "resolucion", "desierto")
SCRAPERS = "https://vigia-scrapers.vigiaperu.workers.dev/correr"
ENTORNO = {**os.environ, "PYTHONUTF8": "1", "MSYS_NO_PATHCONV": "1", "AWS_PROFILE": os.environ.get("AWS_PROFILE", "founder.edwin")}

GANADOS = """
SELECT DISTINCT c.ocid FROM convocatorias c
 WHERE c.proveedor_ruc = ANY (%(rucs)s) AND COALESCE(c.fecha_convocatoria, DATE '2000-01-01') >= %(desde)s::date
"""
# Como integrante de un consorcio ganador (migración 53): el consorcio gana con su propio código.
EN_CONSORCIO = """
SELECT DISTINCT c.ocid FROM conosce_consorcios k JOIN convocatorias c ON c.proveedor_ruc = k.ruc_consorcio
 WHERE k.ruc_miembro = ANY (%(rucs)s) AND COALESCE(c.fecha_convocatoria, DATE '2000-01-01') >= %(desde)s::date
"""
SIN_DOCUMENTOS = """
SELECT x FROM unnest(%(ocids)s::text[]) x
 WHERE NOT EXISTS (SELECT 1 FROM documentos_gcs g WHERE ocid_corto(g.ocid) = ocid_corto(x) AND g.borrado_at IS NULL)
   AND NOT EXISTS (SELECT 1 FROM pedidos_descarga d WHERE d.ocid = x AND d.estado IN ('pendiente', 'descargando'))
"""
ENCOLAR_PRECIOS = """
INSERT INTO precios_lab_cola (ocid, prioridad, autor, motivo)
SELECT DISTINCT ocid_corto(x), %s, 'procesar_proveedor.py', %s FROM unnest(%s::text[]) x
 WHERE EXISTS (SELECT 1 FROM documento_pieza p JOIN pieza_lectura l ON l.pieza_id = p.id
                WHERE ocid_corto(p.ocid) = ocid_corto(x) AND l.lector IN ('contrato', 'bases') AND l.estado IN ('ok', 'parcial'))
    OR EXISTS (SELECT 1 FROM convocatoria_items ci WHERE ci.ocid = ocid_corto(x))
ON CONFLICT (ocid) DO UPDATE SET estado = 'pendiente', pedido_at = now(), prioridad = EXCLUDED.prioridad,
  motivo = EXCLUDED.motivo, vueltas = 0
WHERE precios_lab_cola.estado IN ('sin_items', 'error', 'hecho')
"""
ESTADO = """
SELECT count(*) AS procesos,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM documentos_gcs g WHERE ocid_corto(g.ocid) = ocid_corto(x) AND g.borrado_at IS NULL)) AS con_documentos,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pedidos_descarga d WHERE d.ocid = x AND d.estado IN ('pendiente', 'descargando'))) AS bajando,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM documento_pieza p WHERE ocid_corto(p.ocid) = ocid_corto(x))) AS con_piezas,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM documento_pieza p JOIN pieza_lectura l ON l.pieza_id = p.id
                                       WHERE ocid_corto(p.ocid) = ocid_corto(x) AND l.lector = 'contrato' AND l.estado = 'ok')) AS contrato_leido,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM documento_pieza p JOIN pieza_lectura l ON l.pieza_id = p.id
                                       WHERE ocid_corto(p.ocid) = ocid_corto(x) AND l.lector = 'bases' AND l.estado IN ('ok', 'parcial'))) AS bases_leidas,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM precios_lab_cola q WHERE q.ocid = ocid_corto(x) AND q.estado = 'hecho')) AS precios_lanzados,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM alertas a WHERE a.ocid = x AND a.updated_at > now() - interval '7 days')) AS analizados_7d
  FROM unnest(%(ocids)s::text[]) x
"""


def correr(cmd: list[str], etiqueta: str) -> int:
    """Una herramienta del lector o de scripts, con su salida en vivo (sólo las últimas líneas importan)."""
    print(f"\n── {etiqueta}: {' '.join(cmd[2:])}", flush=True)
    t = time.time()
    r = subprocess.run([sys.executable, "-X", "utf8", *cmd[1:]] if cmd[0] == "py" else cmd, cwd=RAIZ, env=ENTORNO)
    print(f"   {etiqueta}: salida {r.returncode} en {round(time.time() - t)} s", flush=True)
    return r.returncode


def token_scrapers() -> str | None:
    try:
        r = subprocess.run(["aws", "ssm", "get-parameter", "--name", "/vigia/scrapers/token", "--with-decryption", "--region", "us-east-2",
                            "--query", "Parameter.Value", "--output", "text"], capture_output=True, text=True, env=ENTORNO, timeout=60)
        return r.stdout.strip() or None
    except (OSError, subprocess.TimeoutExpired):
        return None


def disparar_documentos() -> str:
    t = token_scrapers()
    if not t:
        return "sin token del Worker de scrapers (SSM /vigia/scrapers/token)"
    req = urllib.request.Request(SCRAPERS, method="POST", data=json.dumps({"fuente": "documentos"}).encode(),
                                 headers={"Authorization": f"Bearer {t}", "content-type": "application/json", "User-Agent": "vigia-procesar-proveedor"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read().decode("utf-8", "replace")[:200]
    except Exception as e:  # noqa: BLE001
        return f"{type(e).__name__}: {str(e)[:120]}"


def main() -> None:
    from tunel_rds import conexion

    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("entorno", choices=["dev", "prod"])
    ap.add_argument("--ruc", nargs="+", required=True, help="RUC 20 de los proveedores")
    ap.add_argument("--desde", default="2018-01-01", help="procesos convocados desde esta fecha")
    ap.add_argument("--pasos", nargs="+", choices=[*PASOS, "estado"], default=list(PASOS))
    ap.add_argument("--motivo", default="procesar_proveedor", help="queda en la cola de precios y en el libro del reanálisis")
    ap.add_argument("--salida", default=None, help="carpeta de trabajo (por defecto, backend/scripts/ab_out/proveedor_<ruc>)")
    ap.add_argument("--tope-lectura", type=float, default=15.0, help="US$ por lector en esta corrida")
    ap.add_argument("--tope-transcripcion", type=float, default=15.0)
    ap.add_argument("--tope-analisis", type=float, default=40.0, help="US$ del reanálisis con agentes")
    ap.add_argument("--prioridad", type=int, default=5, help="prioridad en la cola de precios")
    a = ap.parse_args()
    rucs = [r for r in a.ruc if len(r) == 11 and r.isdigit()]
    salida = Path(a.salida) if a.salida else RAIZ / "backend" / "scripts" / "ab_out" / f"proveedor_{'_'.join(rucs)}"
    salida.mkdir(parents=True, exist_ok=True)
    archivo = salida / "ocids.txt"

    with conexion(a.entorno) as cn:
        cur = cn.cursor()
        if "procesos" in a.pasos or not archivo.exists():
            cur.execute(GANADOS, {"rucs": rucs, "desde": a.desde})
            ocids = {r[0] for r in cur.fetchall()}
            try:
                cur.execute(EN_CONSORCIO, {"rucs": rucs, "desde": a.desde})
                ocids |= {r[0] for r in cur.fetchall()}
            except Exception:  # noqa: BLE001 — una base sin la tabla de consorcios
                cn.rollback()
            archivo.write_text("\n".join(sorted(ocids)) + "\n", encoding="utf-8")
            print(f"{len(ocids)} procesos ganados por {', '.join(rucs)} desde {a.desde} → {archivo}", flush=True)
        ocids = [x.strip() for x in archivo.read_text(encoding="utf-8").splitlines() if x.strip()]

        if "descargar" in a.pasos:
            cur.execute(SIN_DOCUMENTOS, {"ocids": ocids})
            faltan = [r[0] for r in cur.fetchall()]
            if faltan:
                cur.execute("""INSERT INTO pedidos_descarga (ocid, motivo) SELECT x, 'proveedor' FROM unnest(%s::text[]) x
                               ON CONFLICT DO NOTHING""", (faltan,))
                cn.commit()
            print(f"\n── descargar: {len(faltan)} procesos sin documentos pedidos; corrida de documentos: {disparar_documentos()}", flush=True)

        if "estado" in a.pasos:
            cur.execute(ESTADO, {"ocids": ocids})
            fila = cur.fetchone()
            print(json.dumps(dict(zip([d[0] for d in cur.description], fila)), ensure_ascii=False, indent=1))

    arch = str(archivo)
    if "texto" in a.pasos:
        correr(["py", "backend/lector/texto.py", a.entorno, "--ocids-archivo", arch, "--hilos", "6"], "texto")
    if "piezas" in a.pasos:
        correr(["py", "backend/lector/piezas.py", a.entorno, "--ocids-archivo", arch], "piezas")
    if "escaneos" in a.pasos:
        # Las bases primero se leen (las que traen escaneos quedan «espera_vision»), después se transcriben.
        correr(["py", "backend/lector/por_pieza.py", a.entorno, "--lector", "bases", "--ocids-archivo", arch, "--limite", "5000",
                "--tope-usd", str(a.tope_lectura), "--hilos", "4"], "leer bases (marca las que esperan visión)")
        for cola in ("proceso", "bases", "cortos"):
            correr(["py", "backend/lector/transcribir.py", a.entorno, "--cola", cola, "--ocids-archivo", arch, "--limite", "3000",
                    "--tope-usd", str(a.tope_transcripcion), "--hilos", "4"], f"transcribir {cola}")
        correr(["py", "backend/lector/piezas.py", a.entorno, "--ocids-archivo", arch], "piezas tras la transcripción")
    if "leer" in a.pasos:
        for nombre in LECTORES:
            correr(["py", "backend/lector/por_pieza.py", a.entorno, "--lector", nombre, "--ocids-archivo", arch, "--limite", "5000",
                    "--tope-usd", str(a.tope_lectura), "--hilos", "4"], f"leer {nombre}")
    # Los precios DESPUÉS de leer: con los renglones leídos de las bases y del contrato, el laboratorio investiga cada
    # producto; antes de leerlos sólo tenía el ítem del registro, que a veces es el paquete entero («suministros para el
    # Vaso de Leche», 2026-212-10). Sólo entran los procesos con algún renglón leído o con ítems en el registro.
    if "precios" in a.pasos:
        with conexion(a.entorno) as cn:
            cur = cn.cursor()
            cur.execute(ENCOLAR_PRECIOS, (a.prioridad, a.motivo[:200], ocids))
            cn.commit()
            cur.execute("SELECT estado, count(*) FROM precios_lab_cola WHERE ocid = ANY (ARRAY(SELECT ocid_corto(x) FROM unnest(%s::text[]) x)) GROUP BY 1",
                        (ocids,))
            print(f"\n── precios: cola del laboratorio {dict(cur.fetchall())} (el cron de 10 min de la API la vacía)", flush=True)
    if "analizar" in a.pasos and a.entorno == "prod":
        correr(["py", "backend/scripts/reanalizar_contratos.py", "prod", "--archivo", arch, "--motivo", a.motivo,
                "--tope", str(a.tope_analisis), "--hilos", "3"], "reanalizar con agentes")


if __name__ == "__main__":
    main()
