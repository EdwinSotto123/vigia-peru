#!/usr/bin/env python3
"""Procesa los PDFs de DJI bajados (local o artefactos de CI): actualiza el ledger, sube a R2 y carga vínculos.

Por cada PDF <ruc>_<apellidos>_<nombres>.pdf:
  1. parsea los familiares (parse_dji_pdf, coordenadas) — si 0 y el PDF no tiene texto → parse_estado='parser_fallo' (GLM luego).
  2. upsert en dji_vinculos (atribución por PERSONA: entidad_ruc + declarante_norm), idempotente.
  3. sube el PDF a R2 (vigia-peru-batch/dji/pdfs/<archivo>) con wrangler.
  4. actualiza dji_descargas (estado, parse_estado, n_familiares, pdf_r2).
Además lee los _log.csv (ruc,apellidos,nombres,ok,detalle) para marcar los errores de descarga.

  python backend/scripts/procesar_dji.py --entorno prod --pdfs <dir> [--logs <dir>] [--r2]
"""
from __future__ import annotations

import argparse
import csv
import re
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "infrastructure" / "aws"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from tunel_rds import conexion                 # noqa: E402
from parse_dji_pdf import familiares_pdf        # noqa: E402
import pdfplumber                               # noqa: E402
from psycopg2.extras import execute_values      # noqa: E402

_norm = lambda s: " ".join((s or "").split()).upper()
R2_BUCKET = "vigia-peru-batch"
WR = Path(r"C:\Users\usuario\Desktop\PROYECTOS\vigia-peru\backend\scrapers-worker")


def tiene_texto(pdf: str) -> bool:
    try:
        with pdfplumber.open(pdf) as d:
            return any((p.extract_text() or "").strip() for p in d.pages[:3])
    except Exception:
        return False


def subir_r2(pdf: Path, key: str) -> bool:
    try:
        r = subprocess.run(["npx", "wrangler", "r2", "object", "put", f"{R2_BUCKET}/{key}",
                            "--file", str(pdf), "--remote"], cwd=WR, capture_output=True, encoding="utf-8", errors="replace",
                           timeout=120, shell=True)   # wrangler escribe UTF-8: con la página de Windows reventaba el hilo
        return "Upload complete" in (r.stdout + r.stderr)
    except Exception:
        return False


# La marca de la sección 7 («Relación de personas con la que tiene vínculo de consanguinidad…»): «7 Sí [ ] No [X]».
RE_SIETE = re.compile(r"\b7\s+S[ií]\s*\[\s*(X?)\s*\]\s*No\s*\[\s*(X?)\s*\]", re.I)


def solo_no_en_7(pdf: str) -> bool:
    """Todas las declaraciones del PDF marcan «No» en la sección 7: no declaró familiares (2026-10-27: los 783
    «parser_fallo» de las primeras rondas eran casi todos esto, no una falla del lector)."""
    try:
        with pdfplumber.open(pdf) as d:
            texto = "\n".join((p.extract_text() or "") for p in d.pages)
    except Exception:
        return False
    marcas = [m for m in RE_SIETE.finditer(texto) if "consanguinidad" in texto[max(0, m.start() - 400): m.start()]]
    return bool(marcas) and all(not m.group(1) and m.group(2) for m in marcas)


def parsear(pdf: str) -> tuple[list[dict], str]:
    """Los familiares de un PDF y cómo salió la lectura (en un proceso aparte: pdfplumber es lo lento)."""
    try:
        fams = familiares_pdf(pdf)
    except Exception:
        fams = []
    if fams:
        return fams, "ok"
    if not tiene_texto(pdf):
        return [], "sin_texto"   # escaneado → GLM/OCR luego
    return [], ("sin_familiares" if solo_no_en_7(pdf) else "parser_fallo")


def lecturas_seguras(pdfs: list[Path], procesos: int, tanda: int = 40):
    """(familiares, parse_estado) de cada PDF, en orden, sin que un PDF que tumba su proceso tumbe la corrida.

    El 2026-10-26 un proceso de lectura murió a los 500 PDFs (BrokenProcessPool) y se llevó todo. Ahora se lee por
    tandas con un pool nuevo cada vez (pdfplumber acumula memoria), y si el pool se rompe, esa tanda se repite PDF por
    PDF, cada uno en su propio proceso: el que lo vuelve a romper queda como «parser_fallo».
    """
    for i in range(0, len(pdfs), tanda):
        lote = [str(x) for x in pdfs[i:i + tanda]]
        try:
            with ProcessPoolExecutor(max_workers=procesos) as pool:
                for r in pool.map(parsear, lote):
                    yield r
            continue
        except BrokenProcessPool:
            print(f"  un PDF tumbó la lectura en la tanda {i // tanda + 1}: se repite de a uno", flush=True)
        for pdf in lote:
            try:
                with ProcessPoolExecutor(max_workers=1) as uno:
                    yield uno.submit(parsear, pdf).result(timeout=300)
            except Exception:  # noqa: BLE001 — el proceso murió o se colgó con ESTE PDF
                print(f"  no se pudo leer {Path(pdf).name}", flush=True)
                yield [], "parser_fallo"


def claves_de_logs(logdir: Path) -> tuple[dict[str, tuple[str, str, str]], list[tuple[str, str, str]]]:
    """Del _log.csv de cada nodo: el PDF de cada declarante (clave EXACTA del ledger) y los que fallaron.

    Antes la clave salía del nombre del archivo, que pasa por un slug con pérdida (puntuación, 40 caracteres): esos no
    empataban con el ledger, quedaban «pendiente» y se volvían a bajar en la ronda siguiente.
    """
    por_pdf: dict[str, tuple[str, str, str]] = {}
    errores: list[tuple[str, str, str]] = []
    for lg in logdir.rglob("_log*.csv"):
        for row in csv.reader(open(lg, encoding="utf-8", errors="replace")):
            if len(row) < 5:
                continue
            if row[3] == "True":
                por_pdf[row[4]] = (row[0], row[1], row[2])
            elif row[3] == "False":
                errores.append((row[0], row[1], row[4][:200]))
    return por_pdf, errores


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entorno", choices=["dev", "prod"], required=True)
    ap.add_argument("--pdfs", required=True)
    ap.add_argument("--logs", help="dir con _log.csv (por defecto = --pdfs)")
    ap.add_argument("--r2", action="store_true", help="subir PDFs a R2")
    ap.add_argument("--hilos-r2", type=int, default=4, help="subidas a R2 en paralelo (cada una es un npx wrangler)")
    ap.add_argument("--procesos", type=int, default=4, help="PDFs leídos en paralelo")
    ap.add_argument("--lote", type=int, default=50, help="PDFs por escritura en la base")
    a = ap.parse_args()
    pdfs = sorted(Path(a.pdfs).rglob("*.pdf"))
    por_pdf, errores = claves_de_logs(Path(a.logs or a.pdfs))
    print(f"{len(pdfs)} PDFs, {len(por_pdf)} con su clave en los logs, {len(errores)} descargas fallidas", flush=True)
    # Las subidas a R2 van en un pool aparte: el ledger dice dónde quedará cada PDF y la base no espera a wrangler.
    subir = ThreadPoolExecutor(max_workers=a.hilos_r2) if a.r2 else None
    subidas = []
    v = ok = fallo_parse = 0
    with conexion(a.entorno) as c:
        cur = c.cursor()
        # 1) errores de descarga desde los logs, de una vez
        if errores:
            execute_values(cur, """UPDATE dji_descargas d SET estado = 'error', intentos = d.intentos + 1, error = v.error,
                                          actualizado = now()
                                     FROM (VALUES %s) AS v(ruc, apellidos, error)
                                    WHERE d.ruc = v.ruc AND d.apellidos = v.apellidos AND d.estado <> 'ok'""", errores)
            c.commit()
        # 2) PDFs: lectura en paralelo; vínculos, ledger y R2 por lotes
        claves = []
        for pdf in pdfs:
            if pdf.name in por_pdf:
                claves.append(por_pdf[pdf.name])
            else:
                partes = pdf.stem.split("_")
                claves.append((partes[0], partes[1].replace("-", " ") if len(partes) > 1 else "",
                               partes[2].replace("-", " ") if len(partes) > 2 else ""))
        lecturas = lecturas_seguras(pdfs, a.procesos)
        lote_borrar, lote_vinc, lote_ledger = [], [], []

        def escribir() -> None:
            if not lote_ledger:
                return
            execute_values(cur, """DELETE FROM dji_vinculos d USING (VALUES %s) AS v(entidad_ruc, declarante_norm)
                                    WHERE d.entidad_ruc = v.entidad_ruc AND d.declarante_norm = v.declarante_norm""", lote_borrar)
            if lote_vinc:
                execute_values(cur, """INSERT INTO dji_vinculos (codigo_ddjj, declarante_norm, entidad_ruc, pariente_doc,
                                                                 pariente_norm, parentesco, grado) VALUES %s""",
                               lote_vinc, template="(NULL, %s, %s, %s, %s, %s, %s)")
            execute_values(cur, """UPDATE dji_descargas d SET estado = 'ok', parse_estado = v.parse_estado,
                                          n_familiares = v.n::int, pdf_r2 = v.pdf_r2, descargado = now(), actualizado = now()
                                     FROM (VALUES %s) AS v(ruc, apellidos, parse_estado, n, pdf_r2)
                                    WHERE d.ruc = v.ruc AND d.apellidos = v.apellidos""", lote_ledger)
            c.commit()
            lote_borrar.clear(); lote_vinc.clear(); lote_ledger.clear()

        for pdf, (ruc, ape, nom), (fams, parse_estado) in zip(pdfs, claves, lecturas):
            if not ruc.isdigit():
                continue
            decl = _norm(f"{ape} {nom}")
            vistos = set()
            for f in fams:
                d = f["doc"]
                if d in vistos:
                    continue
                vistos.add(d)
                lote_vinc.append((decl, ruc, d, _norm(f.get("nombre")), f.get("parentesco"), f.get("grado")))
            lote_borrar.append((ruc, decl))
            key = f"dji/pdfs/{pdf.name}"
            if subir:
                subidas.append(subir.submit(subir_r2, pdf, key))
            lote_ledger.append((ruc, ape, parse_estado, len(vistos), key if a.r2 else None))
            v += len(vistos)
            ok += 1
            fallo_parse += (parse_estado == "parser_fallo")
            if len(lote_ledger) >= a.lote:
                escribir()
            if ok % 500 == 0:
                print(f"  {ok} PDFs, {v} vínculos…", flush=True)
        escribir()
        cur.execute("SELECT count(*), count(DISTINCT entidad_ruc), count(DISTINCT pariente_doc) FROM dji_vinculos")
        tot = cur.fetchone()
    if subir:
        hechas = sum(1 for x in subidas if x.result())
        subir.shutdown()
        print(f"  R2: {hechas} de {len(subidas)} PDFs subidos", flush=True)
    print(f"\n✓ {a.entorno}: {ok} PDFs, {v} vínculos insertados (parser_fallo: {fallo_parse}), {len(errores)} errores de descarga marcados")
    print(f"  dji_vinculos total: {tot[0]} vínculos · {tot[1]} entidades · {tot[2]} parientes")


if __name__ == "__main__":
    main()
