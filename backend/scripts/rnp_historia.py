#!/usr/bin/env python3
"""Reconstruye quién dejó de figurar en la conformación jurídica de cada proveedor del RNP, y cuándo.

El OECE reemplaza `conformacion_juridica.csv` cada mes en su wiki de datos abiertos y conserva las versiones anteriores
(`…/download/attachments/106889267/conformacion_juridica.csv?version=N&api=v2`; 65 desde noviembre de 2021). Cada versión
es el registro entero de ese mes. Recorriéndolas en orden se sabe, de cada vínculo (proveedor, persona, rol):
  · el primer corte en que aparece (desde 2021; su inicio oficial es FECHA_INICIO_VIGENCIA);
  · el último corte en que aparece y, si ya no está en la versión más nueva, el corte en que dejó de figurar.

Salida (carpeta --salida, fuera del repo: trae documentos de personas):
  rnp_bajas.csv      un vínculo que ya no figura por fila: las columnas de rnp_conformacion_juridica + baja_corte + primer_corte
  rnp_historia.json  los cortes de cada versión y los conteos (altas y bajas por corte)

No escribe en la base: la carga es otro paso (ver cargar_rnp.py y la migración que use esta salida).
Cada versión se baja a un temporal y se borra. Retomable: guarda el estado cada 5 versiones (--estado).

Uso:  python -I -X utf8 backend/scripts/rnp_historia.py --salida <carpeta> [--desde 1] [--hasta 65]
"""

from __future__ import annotations

import argparse
import csv
import json
import pickle
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cargar_rnp import ARCHIVO, CABECERA, PAGINA, UA, WIKI, fecha, nombre_norm  # noqa: E402


def versiones() -> int:
    req = urllib.request.Request(f"{WIKI}/rest/api/content/{PAGINA}/child/attachment?limit=50&expand=version", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.load(r)
    for a in d.get("results", []):
        if a.get("title") == ARCHIVO:
            return int((a.get("version") or {}).get("number", 0))
    raise SystemExit("la wiki ya no tiene el adjunto")


def bajar(version: int, destino: Path) -> bool:
    req = urllib.request.Request(f"{WIKI}/download/attachments/{PAGINA}/{ARCHIVO}?version={version}&api=v2", headers={"User-Agent": UA})
    for intento in range(3):
        try:
            with urllib.request.urlopen(req, timeout=900) as r, destino.open("wb") as f:
                while True:
                    trozo = r.read(1 << 20)
                    if not trozo:
                        break
                    f.write(trozo)
            return destino.stat().st_size > 1_000_000
        except Exception as e:  # noqa: BLE001
            print(f"   v{version}: intento {intento + 1} falló ({str(e)[:100]})", flush=True)
            time.sleep(10 * (intento + 1))
    return False


def leer(origen: Path):
    """(corte, [(llave, tipo_doc, doc, nombre_original, ruc, rol, inicio, id_forma, forma)…]) con las reglas de cargar_rnp."""
    cortes: dict[str, int] = {}
    with origen.open("r", encoding="cp1252", errors="replace", newline="") as f:
        lector = csv.reader(f, delimiter="|")
        cab = [c.strip().upper() for c in next(lector)]
        if cab != CABECERA:
            raise ValueError(f"otra cabecera: {cab}")
        for c in lector:
            if len(c) != 9:
                continue
            corte_crudo, tipo_doc, doc_crudo, nombre_crudo, ruc_crudo, rol, inicio, id_forma, forma = c
            doc = doc_crudo.strip().replace("\t", "")
            ruc = ruc_crudo.strip()
            corte = fecha(corte_crudo)
            if not doc or doc.upper() == "NO ESPECIFICADO" or len(doc) < 5 or len(ruc) != 11 or not ruc.isdigit() or not corte:
                continue
            cortes[corte] = cortes.get(corte, 0) + 1
            tipo_doc, rol = tipo_doc.strip(), rol.strip()
            yield None, (f"{ruc}|{tipo_doc}|{doc}|{rol}", nombre_crudo.strip(), fecha(inicio), id_forma.strip(), forma.strip())
    yield max(cortes, key=lambda k: cortes[k]) if cortes else None, None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--salida", required=True)
    ap.add_argument("--desde", type=int, default=1)
    ap.add_argument("--hasta", type=int)
    a = ap.parse_args()
    salida = Path(a.salida)
    salida.mkdir(parents=True, exist_ok=True)
    estado_p = salida / "rnp_historia.estado"
    hasta = a.hasta or versiones()
    # llave → [índice de la primera versión, índice de la última, nombre, inicio, id_forma, forma]
    vinculos: dict[str, list] = {}
    cortes: dict[int, str] = {}
    hecho = a.desde - 1
    if estado_p.exists():
        with estado_p.open("rb") as f:
            hecho, cortes, vinculos = pickle.load(f)
        print(f"retomo desde la versión {hecho + 1} ({len(vinculos)} vínculos vistos)", flush=True)
    for v in range(hecho + 1, hasta + 1):
        t = time.time()
        with tempfile.TemporaryDirectory() as tmp:
            crudo = Path(tmp) / "v.csv"
            if not bajar(v, crudo):
                print(f"v{v}: no se pudo bajar; se salta", flush=True)
                continue
            n = 0
            corte = None
            try:
                for corte_v, fila in leer(crudo):
                    if fila is None:
                        corte = corte_v
                        break
                    llave, nombre, inicio, id_forma, forma = fila
                    x = vinculos.get(llave)
                    if x is None:
                        vinculos[llave] = [v, v, nombre, inicio, id_forma, forma]
                    else:
                        x[1] = v
                        x[2], x[3], x[4], x[5] = nombre, inicio, id_forma, forma
                    n += 1
            except ValueError as e:
                print(f"v{v}: {e}; se salta", flush=True)
                continue
        if not corte or n < 100_000:
            print(f"v{v}: sólo {n} filas; se salta", flush=True)
            continue
        cortes[v] = corte
        print(f"v{v}: corte {corte}, {n} filas, {len(vinculos)} vínculos distintos hasta aquí ({time.time() - t:.0f} s)", flush=True)
        if v % 5 == 0 or v == hasta:
            with estado_p.open("wb") as f:
                pickle.dump((v, cortes, vinculos), f)
    # Las versiones válidas, en orden: una baja se fecha con el corte de la versión válida siguiente a la última en que estuvo.
    validas = sorted(cortes)
    if len(validas) < 2:
        raise SystemExit("hacen falta al menos dos versiones")
    siguiente = {v: validas[i + 1] for i, v in enumerate(validas[:-1])}
    ultima = validas[-1]
    bajas_por_corte: dict[str, int] = {}
    altas_por_corte: dict[str, int] = {}
    n_bajas = 0
    with (salida / "rnp_bajas.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.writer(f, lineterminator="\n")
        w.writerow(["fecha_corte", "tipo_documento", "numero_documento", "nombre", "nombre_original", "ruc_empresa", "tipo_rol",
                    "fecha_inicio_vigencia", "id_forma_societaria", "forma_societaria", "baja_corte", "primer_corte"])
        for llave, (v1, v2, nombre, inicio, id_forma, forma) in vinculos.items():
            if v1 in cortes and v1 != validas[0]:
                altas_por_corte[cortes[v1]] = altas_por_corte.get(cortes[v1], 0) + 1
            if v2 >= ultima or v2 not in siguiente:
                continue
            ruc, tipo_doc, doc, rol = llave.split("|", 3)
            baja = cortes[siguiente[v2]]
            bajas_por_corte[baja] = bajas_por_corte.get(baja, 0) + 1
            w.writerow([cortes[v2], tipo_doc, doc, nombre_norm(nombre), nombre, ruc, rol, inicio, id_forma, forma, baja, cortes.get(v1, "")])
            n_bajas += 1
    resumen = {"versiones": {str(v): cortes[v] for v in validas}, "vinculos_distintos": len(vinculos), "bajas": n_bajas,
               "bajas_por_corte": dict(sorted(bajas_por_corte.items())), "altas_por_corte": dict(sorted(altas_por_corte.items()))}
    (salida / "rnp_historia.json").write_text(json.dumps(resumen, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"listo: {len(validas)} versiones ({cortes[validas[0]]} a {cortes[ultima]}), {len(vinculos)} vínculos distintos, {n_bajas} que ya no figuran")
    return 0


if __name__ == "__main__":
    sys.exit(main())
