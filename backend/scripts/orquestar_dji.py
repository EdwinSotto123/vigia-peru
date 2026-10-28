#!/usr/bin/env python3
"""Rondas de descarga de las DJI en GitLab CI hasta vaciar los pendientes del ledger (`dji_descargas`, prod).

El universo es `targets_dji.csv` (32,172 declarantes CON nombres): sin el nombre, el portal devuelve a todos los que
comparten esos apellidos en la entidad y el parser atribuiría los familiares de varias personas a una sola. Al empezar,
los del CSV que no están en el ledger se registran como pendientes (antes 9,478 nunca se habrían marcado). Los del
ledger viejo sin fila en el CSV (sin nombre) no se bajan: el log dice cuántos son.

Por ronda:
  1. Arma los pendientes desde `dji_descargas`: estado 'pendiente', o 'error' con menos de 3 intentos que no sea «sin
     resultados» (esa persona no tiene declaración: reintentar no cambia nada). Los deja en la rama `dji` con un commit
     del CSV, en un worktree aparte (la copia de trabajo no se toca). El push dispara el pipeline de esa rama: sólo
     `scrape:dji`, en 10 nodos con tope de 150 min para que los artefactos alcancen a subir.
  2. Espera el pipeline.
  3. Baja los artefactos (`bajar_artefactos_dji.py`) y los procesa (`procesar_dji.py --r2`: vínculos, ledger, R2) EN
     PARALELO con la descarga de la ronda siguiente: procesar 6,500 PDFs tardaba más que bajarlos y el CI esperaba.
     Lo bajado y aún sin procesar sigue «pendiente» en el ledger: se saca de la ronda siguiente por sus logs.
  4. Al terminar cada procesamiento, refresca las señales de la DJI (`PASOS_SENAL`: nepotismo, mismo gobierno, familia).
Para cuando no quedan pendientes, se acaban las rondas, o una ronda no deja PDFs (el portal o el CI fallan: hay que mirar).

  python backend/scripts/orquestar_dji.py [--rondas 8] [--desde-ronda 1] [--procesar-primero <carpeta>]
                                          [--worktree C:/Users/usuario/Desktop/PROYECTOS/vigia-dji]
El avance queda en dataset/declaracion_jurada/orquestar_dji.log (y en la salida).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "infrastructure" / "aws"))
from tunel_rds import conexion  # noqa: E402

GLAB = r"C:\Users\usuario\AppData\Local\Programs\glab\glab.exe"
PROJ = "simplia-group%2Fvigia-peru"
CSV_REL = Path("backend/scrapers-worker/dji_targets/targets_pendientes.csv")
# El CSV original (con nombres): el ledger sólo guarda ruc + apellidos, y el PDF se nombra con los tres.
TODOS = ROOT / "backend/scrapers-worker/dji_targets/targets_dji.csv"
DATOS = ROOT / "dataset" / "declaracion_jurada"
LOG = DATOS / "orquestar_dji.log"

PENDIENTES_SQL = """
  SELECT ruc, apellidos FROM dji_descargas
   WHERE estado = 'pendiente'
      OR (estado = 'error' AND intentos < 3 AND coalesce(error, '') NOT ILIKE '%%sin resultados%%')
"""


def log(msg: str) -> None:
    linea = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(linea, flush=True)
    DATOS.mkdir(parents=True, exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(linea + "\n")


def sh(args: list[str], cwd: Path | None = None, timeout: int = 600) -> str:
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"{' '.join(args[:3])}… salió con {r.returncode}: {(r.stderr or r.stdout)[-400:]}")
    return r.stdout


def glab_json(path: str):
    return json.loads(sh([GLAB, "api", path], timeout=120))


def universo() -> set[tuple[str, str]]:
    with open(TODOS, encoding="utf-8", newline="") as f:
        return {((r.get("ruc") or "").strip(), (r.get("apellidos") or "").strip()) for r in csv.DictReader(f)
                if (r.get("ruc") or "").strip() and (r.get("apellidos") or "").strip() and (r.get("nombres") or "").strip()}


def registrar(claves: set[tuple[str, str]]) -> int:
    """Los del CSV que faltan en el ledger, como pendientes: si no, procesar_dji no tendría qué fila marcar."""
    with conexion("prod") as c:
        cur = c.cursor()
        filas = sorted(claves)
        nuevos = 0
        for i in range(0, len(filas), 1000):
            lote = filas[i:i + 1000]
            cur.execute(
                "INSERT INTO dji_descargas (ruc, apellidos) SELECT * FROM unnest(%s::text[], %s::text[]) "
                "ON CONFLICT (ruc, apellidos) DO NOTHING",
                ([r for r, _ in lote], [a for _, a in lote]))
            nuevos += cur.rowcount
        c.commit()
        return nuevos


def pendientes() -> set[tuple[str, str]]:
    with conexion("prod") as c:
        cur = c.cursor()
        cur.execute(PENDIENTES_SQL)
        return {(r, a) for r, a in cur.fetchall()}


def escribir_csv(destino: Path, faltan: set[tuple[str, str]]) -> int:
    """Los pendientes con sus nombres, en el orden del CSV original (decisores primero)."""
    n = 0
    destino.parent.mkdir(parents=True, exist_ok=True)
    with open(TODOS, encoding="utf-8", newline="") as f, open(destino, "w", encoding="utf-8", newline="") as g:
        w = csv.writer(g)
        w.writerow(["ruc", "apellidos", "nombres"])
        vistos = set()
        for row in csv.DictReader(f):
            k = ((row.get("ruc") or "").strip(), (row.get("apellidos") or "").strip())
            if k in faltan and k not in vistos:
                vistos.add(k)
                w.writerow([k[0], k[1], (row.get("nombres") or "").strip()])
                n += 1
    return n


def preparar_worktree(wt: Path) -> None:
    if not (wt / ".git").exists():
        sh(["git", "-C", str(ROOT), "fetch", "-q", "gitlab", "main"])
        sh(["git", "-C", str(ROOT), "worktree", "add", "-f", "-B", "dji", str(wt), "gitlab/main"])
    sh(["git", "fetch", "-q", "gitlab", "main"], cwd=wt)
    # Cada ronda parte del main de GitLab (el CI y los scripts al día) más el CSV de esa ronda.
    sh(["git", "reset", "-q", "--hard", "gitlab/main"], cwd=wt)


def publicar_ronda(wt: Path, ronda: int, n: int) -> str:
    sh(["git", "add", str(CSV_REL)], cwd=wt)
    sh(["git", "commit", "-q", "-m", f"dji: ronda {ronda}, {n} declarantes pendientes"], cwd=wt)
    sha = sh(["git", "rev-parse", "HEAD"], cwd=wt).strip()
    sh(["git", "-c", f"credential.helper=!'{GLAB}' auth git-credential", "push", "-q", "-f", "gitlab", "dji"], cwd=wt, timeout=300)
    return sha


def esperar_pipeline(sha: str) -> dict:
    p = None
    for _ in range(40):  # el pipeline aparece unos segundos después del push
        lista = glab_json(f"projects/{PROJ}/pipelines?ref=dji&sha={sha}&per_page=1")
        if lista:
            p = lista[0]
            break
        time.sleep(15)
    if not p:
        raise RuntimeError(f"no apareció el pipeline de {sha[:8]}")
    log(f"pipeline {p['id']} ({p['web_url']})")
    ultimo = ""
    while True:
        p = glab_json(f"projects/{PROJ}/pipelines/{p['id']}")
        jobs = glab_json(f"projects/{PROJ}/pipelines/{p['id']}/jobs?per_page=100")
        estado = ", ".join(f"{k} {v}" for k, v in sorted(_contar(j["status"] for j in jobs).items()))
        if estado != ultimo:
            log(f"  nodos: {estado}")
            ultimo = estado
        if p["status"] in ("success", "failed", "canceled", "skipped"):
            return p
        time.sleep(120)


def _contar(xs) -> dict:
    out: dict = {}
    for x in xs:
        out[x] = out.get(x, 0) + 1
    return out


def py(script: str, *args: str, timeout: int = 6 * 3600) -> str:
    return sh([sys.executable, str(ROOT / "backend" / "scripts" / script), *args], timeout=timeout)


def claves_bajadas(carpeta: Path) -> set[tuple[str, str]]:
    """(ruc, apellidos) de lo que una ronda bajó bien, por los _log*.csv de sus nodos."""
    out: set[tuple[str, str]] = set()
    for lg in carpeta.rglob("_log*.csv"):
        with open(lg, encoding="utf-8", errors="replace", newline="") as f:
            for row in csv.reader(f):
                if len(row) >= 5 and row[3] == "True":
                    out.add((row[0], row[1]))
    return out


class Procesando:
    """El procesamiento de una ronda, en un proceso aparte, mientras la siguiente baja en CI."""

    def __init__(self) -> None:
        self.p: subprocess.Popen | None = None
        self.carpeta: Path | None = None
        self.claves: set[tuple[str, str]] = set()

    def empezar(self, carpeta: Path) -> None:
        self.esperar()
        self.carpeta, self.claves = carpeta, claves_bajadas(carpeta)
        salida = open(carpeta / "_procesar.log", "w", encoding="utf-8")
        self.p = subprocess.Popen([sys.executable, str(ROOT / "backend" / "scripts" / "procesar_dji.py"), "--entorno", "prod",
                                   "--pdfs", str(carpeta), "--r2"], stdout=salida, stderr=subprocess.STDOUT)
        log(f"  procesando {carpeta.name} ({len(self.claves)} declarantes) en paralelo")

    def esperar(self) -> None:
        if not self.p:
            return
        codigo = self.p.wait()
        cola = (self.carpeta / "_procesar.log").read_text(encoding="utf-8", errors="replace").strip().splitlines()[-2:]
        log(f"  {self.carpeta.name} procesada (salida {codigo}): " + " | ".join(x.strip() for x in cola))
        log(f"  señal de nepotismo refrescada: {refrescar_senal()}")
        self.p, self.carpeta, self.claves = None, None, set()


# Las señales que salen de los vínculos de la DJI, en orden: nepotismo en la entidad (137), en el mismo gobierno (179), la
# familia en otras entidades (180) y el pariente en la planilla de su entidad (182); luego el resumen de personas que las
# cuenta. Las que aún no existen se saltan.
# Las visitas de familiares de funcionarios (migración 188) también crecen con cada ronda: se rehacen tras las demás.
PASOS_SENAL = ("refrescar_nepotismo_senal", "refrescar_senales_extra", "refrescar_familia_estado", "refrescar_planilla_extra",
               "refrescar_personas_resumen", "refrescar_visita_pariente")


def refrescar_senal() -> int:
    """Corre PASOS_SENAL y devuelve las señales de nepotismo (lo que el log siempre mostró)."""
    n = 0
    with conexion("prod") as c:
        cur = c.cursor()
        cur.execute("SET statement_timeout = 0")
        for paso in PASOS_SENAL:
            cur.execute("SELECT to_regprocedure(%s) IS NOT NULL", (f"{paso}()",))
            if not cur.fetchone()[0]:
                continue
            cur.execute(f"SELECT {paso}()")
            r = cur.fetchone()[0]
            if paso == "refrescar_nepotismo_senal":
                n = r
            c.commit()
    return n


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rondas", type=int, default=8)
    ap.add_argument("--desde-ronda", type=int, default=1, help="número de la primera ronda (para nombrar las carpetas)")
    ap.add_argument("--procesar-primero", help="carpeta de una ronda ya bajada y sin procesar: se procesa mientras baja la siguiente")
    ap.add_argument("--worktree", default=str(ROOT.parent / "vigia-dji"))
    a = ap.parse_args()
    os.environ.setdefault("AWS_PROFILE", "founder.edwin")
    os.environ["PATH"] = r"C:\Users\usuario\bin" + os.pathsep + os.environ.get("PATH", "")
    wt = Path(a.worktree)
    todos = universo()
    log(f"universo: {len(todos)} declarantes con nombre; registrados ahora en el ledger: {registrar(todos)}")
    proc = Procesando()
    if a.procesar_primero:
        proc.empezar(Path(a.procesar_primero))
    for ronda in range(a.desde_ronda, a.desde_ronda + a.rondas):
        en_ledger = pendientes()
        # Lo que la ronda en proceso ya bajó sigue «pendiente» hasta que se procese: no se vuelve a pedir.
        faltan = (en_ledger & todos) - proc.claves
        if ronda == a.desde_ronda:
            log(f"pendientes del ledger sin nombre (no se bajan): {len(en_ledger - todos)}")
        if not faltan:
            proc.esperar()
            if not ((pendientes() & todos) - proc.claves):
                log("no quedan pendientes: listo")
                return
            continue
        preparar_worktree(wt)
        n = escribir_csv(wt / CSV_REL, faltan)
        log(f"ronda {ronda}: {len(faltan)} pendientes en el ledger, {n} con nombre en el CSV")
        if n == 0:
            log("ningún pendiente tiene fila en targets_dji.csv: nada que bajar")
            proc.esperar()
            return
        sha = publicar_ronda(wt, ronda, n)
        p = esperar_pipeline(sha)
        log(f"pipeline {p['id']} terminó: {p['status']}")
        carpeta = DATOS / "pdfs_ci" / f"ronda_{ronda}_{p['id']}"
        salida = py("bajar_artefactos_dji.py", str(p["id"]), "--out", str(carpeta), timeout=3600)
        log("  " + (salida.strip().splitlines() or ["(sin salida)"])[-1])
        if not any(carpeta.glob("*.pdf")):
            log("la ronda no dejó PDFs: paro para revisar (portal caído, CI sin artefactos o el tope no alcanzó)")
            proc.esperar()
            return
        proc.empezar(carpeta)
    proc.esperar()
    log(f"se acabaron las {a.rondas} rondas; quedan {len(pendientes() & todos)} pendientes")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        log(f"ERROR: {e}")
        raise
