#!/usr/bin/env python3
"""Carga las secciones 1 a 6 de las DJI ya bajadas (dji_intereses, dji_secciones; migración 170) y rehace la bandera.

Lee los mismos PDF que procesar_dji.py (familiares) con parse_dji_intereses.intereses_pdf; la clave de cada declarante
sale de los _log*.csv de cada ronda, como allí. Idempotente: por declarante borra lo suyo y lo vuelve a insertar.
Al final corre refrescar_cruce_interes_dji(), dedup_cruces_proveedor() y refrescar_casos_cruce_base() (la bandera
llega a la lista de contratos y a su ficha).

Tarda: medido el 2026-10-27, 500 PDF en 440 s con 6 procesos (unas 4 h para 16,5 mil). Correrlo DESACOPLADO
(Start-Process) y anotar su PID en dataset/declaracion_jurada/procesos.json:
  python -u backend/scripts/procesar_dji_intereses.py --entorno prod --pdfs dataset/declaracion_jurada/pdfs_ci
Después de cada ronda nueva de descargas, `--solo-nuevos` lee sólo los declarantes que todavía no están cargados.
"""
from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from tunel_rds import conexion                       # noqa: E402
from parse_dji_intereses import declarante, es_el_mismo, intereses_pdf  # noqa: E402
from procesar_dji import claves_de_logs              # noqa: E402
from psycopg2.extras import execute_values           # noqa: E402

_norm = lambda s: " ".join((s or "").split()).upper()


def leer(pdf: str) -> dict | None:
    try:
        return intereses_pdf(pdf)
    except Exception:  # noqa: BLE001 — un PDF roto no detiene la carga
        return None


def lecturas_seguras(pdfs: list[Path], procesos: int, tanda: int = 40):
    """Como en procesar_dji: un pool nuevo por tanda (pdfplumber acumula memoria) y, si un PDF tumba el pool, esa tanda
    se repite de a uno."""
    for i in range(0, len(pdfs), tanda):
        lote = [str(x) for x in pdfs[i:i + tanda]]
        try:
            with ProcessPoolExecutor(max_workers=procesos) as pool:
                yield from pool.map(leer, lote)
            continue
        except BrokenProcessPool:
            print(f"  un PDF tumbó la lectura en la tanda {i // tanda + 1}: se repite de a uno", flush=True)
        for pdf in lote:
            try:
                with ProcessPoolExecutor(max_workers=1) as uno:
                    yield uno.submit(leer, pdf).result(timeout=300)
            except Exception:  # noqa: BLE001
                yield None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entorno", choices=["dev", "prod"], required=True)
    ap.add_argument("--pdfs", required=True, help="carpeta (se recorre entera) con los PDF y sus _log*.csv")
    ap.add_argument("--procesos", type=int, default=6)
    ap.add_argument("--tanda", type=int, default=40, help="PDFs por pool de procesos (cada pool arranca de cero)")
    ap.add_argument("--lote", type=int, default=50)
    ap.add_argument("--sin-refresco", action="store_true", help="no rehacer la bandera al final")
    ap.add_argument("--solo-nuevos", action="store_true", help="saltar los declarantes que ya tienen sus marcas cargadas")
    a = ap.parse_args()
    raiz = Path(a.pdfs)
    pdfs = sorted(raiz.rglob("*.pdf"))
    por_pdf, _ = claves_de_logs(raiz)
    print(f"{len(pdfs)} PDFs, {len(por_pdf)} con su clave en los logs", flush=True)
    claves = []
    for pdf in pdfs:
        if pdf.name in por_pdf:
            claves.append(por_pdf[pdf.name])
        else:
            partes = pdf.stem.split("_")
            claves.append((partes[0], partes[1].replace("-", " ") if len(partes) > 1 else "",
                           partes[2].replace("-", " ") if len(partes) > 2 else ""))
    t0 = time.time()
    n_pdf = n_filas = n_fallos = 0
    with conexion(a.entorno) as c:
        cur = c.cursor()
        if a.solo_nuevos:
            cur.execute("SELECT DISTINCT entidad_ruc, declarante_norm FROM dji_secciones")
            ya = set(cur.fetchall())
            quedan = [(p, k) for p, k in zip(pdfs, claves) if (k[0], _norm(f"{k[1]} {k[2]}")) not in ya]
            print(f"  {len(pdfs) - len(quedan)} ya cargados; quedan {len(quedan)}", flush=True)
            pdfs, claves = [p for p, _ in quedan], [k for _, k in quedan]
        borrar, filas, marcas = [], [], []
        con_otros: list[str] = []

        def escribir() -> None:
            if not borrar:
                return
            execute_values(cur, """DELETE FROM dji_intereses d USING (VALUES %s) AS v(entidad_ruc, declarante_norm)
                                    WHERE d.entidad_ruc = v.entidad_ruc AND d.declarante_norm = v.declarante_norm""", borrar)
            execute_values(cur, """DELETE FROM dji_secciones d USING (VALUES %s) AS v(entidad_ruc, declarante_norm)
                                    WHERE d.entidad_ruc = v.entidad_ruc AND d.declarante_norm = v.declarante_norm""", borrar)
            if filas:
                execute_values(cur, """INSERT INTO dji_intereses (entidad_ruc, declarante_norm, ejercicio, oportunidad, seccion,
                                                                   ruc, nombre, detalle, periodo, desde, hasta, pdf_r2)
                                        VALUES %s""", filas)
            if marcas:
                execute_values(cur, """INSERT INTO dji_secciones (entidad_ruc, declarante_norm, ejercicio, oportunidad, seccion, marca)
                                        VALUES %s ON CONFLICT DO NOTHING""", marcas)
            c.commit()
            borrar.clear(); filas.clear(); marcas.clear()

        for pdf, (ruc, ape, nom), r in zip(pdfs, claves, lecturas_seguras(pdfs, a.procesos, a.tanda)):
            if not ruc.isdigit():
                continue
            n_pdf += 1
            if r is None:
                n_fallos += 1
                continue
            del_archivo = _norm(f"{ape} {nom}")
            # Cada declaración va a nombre de quien la firma (un PDF puede traer a otros funcionarios de la entidad).
            hay_otros = any(d.get("persona") and not es_el_mismo(d["persona"], del_archivo) for d in r["declaraciones"])
            if hay_otros:
                con_otros.append(pdf.name)
            borrar.append((ruc, del_archivo))
            vistos = set()
            for d in r["declaraciones"]:
                decl = declarante(d.get("persona"), del_archivo, hay_otros)
                if decl is None:
                    continue
                if decl != del_archivo:
                    borrar.append((ruc, decl))
                ej, op = d.get("ejercicio"), (d.get("oportunidad") or "")
                for k, m in d["marcas"].items():
                    marcas.append((ruc, decl, ej or 0, op, int(k), m))
                for f in d["filas"]:
                    # la misma fila se repite en cada declaración del PDF: una vez, con el ejercicio más nuevo
                    clave = (decl, f["seccion"], f["ruc"], (f["detalle"] or "")[:80], f["desde"])
                    if clave in vistos:
                        continue
                    vistos.add(clave)
                    filas.append((ruc, decl, ej, op, f["seccion"], f["ruc"], (f["nombre"] or "")[:300] or None,
                                  (f["detalle"] or "")[:300] or None, f["periodo"], f["desde"], f["hasta"], f"dji/pdfs/{pdf.name}"))
                    n_filas += 1
            if len(borrar) >= a.lote:
                escribir()
            if n_pdf % 500 == 0:
                print(f"  {n_pdf} PDFs, {n_filas} filas, {n_fallos} sin leer ({time.time() - t0:.0f} s)", flush=True)
        escribir()
        print(f"✓ {a.entorno}: {n_pdf} PDFs, {n_filas} filas, {n_fallos} sin leer ({time.time() - t0:.0f} s)", flush=True)
        # Los PDF con declaraciones de otras personas: sus familiares (dji_vinculos) se cargaron a nombre del dueño del
        # archivo antes del 2026-10-27; procesar_dji.py --lista <este archivo> los rehace bien.
        salida = Path("dataset/declaracion_jurada/pdfs_con_otras_personas.txt")
        previos = set(salida.read_text(encoding="utf-8").split()) if salida.exists() else set()
        salida.write_text("\n".join(sorted(previos | set(con_otros))) + "\n", encoding="utf-8")
        print(f"  {len(con_otros)} PDF traen declaraciones de otras personas → {salida}", flush=True)
        if a.sin_refresco:
            return
        cur.execute("SET statement_timeout = 0")
        for paso in ("refrescar_cruce_interes_dji", "dedup_cruces_proveedor", "refrescar_casos_cruce_base"):
            t = time.time()
            cur.execute(f"SELECT {paso}()")
            print(f"  {paso}: {cur.fetchone()[0]} ({time.time() - t:.0f} s)", flush=True)
            c.commit()
        cur.execute("""SELECT tipo, severidad, count(*), count(DISTINCT ruc_empresa), count(DISTINCT persona_nombre)
                         FROM cruces_proveedor WHERE tipo IN ('interes_declarado', 'empleo_declarado') GROUP BY 1, 2 ORDER BY 1, 2""")
        for t in cur.fetchall():
            print("  ", t, flush=True)


if __name__ == "__main__":
    main()
