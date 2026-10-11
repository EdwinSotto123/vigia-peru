#!/usr/bin/env python3
"""Geometría de puntos para los videos de la campaña: el mapa del Perú hecho de puntos (por departamento) y el
ojo de puntos de Vigía.

Lee frontend/public/assets/mapa/portada-departamentos.v1.json (los recorridos de los 25 departamentos que ya usa la
portada), y muestrea una rejilla: cada punto cae dentro de un departamento. Escribe un JSON con los puntos
agrupados por departamento, ordenados de sur a norte, y otro con los del ojo.

    python mapa_puntos.py --paso 13 --salida ../../../../campanas-vigia/assets/tiktok/T1T2

Salida: peru_puntos.json  {ancho, alto, grupos: [{codigo, nombre, puntos: [[x, y], ...]}]}   (coordenadas del JSON origen: 520 x 720)
        ojo_puntos.json   {ancho, alto, puntos: [[x, y, radio, capa], ...]}                  (capa: contorno, iris, pupila, ceja)
"""

from __future__ import annotations

import argparse
import json
import math
import re
from pathlib import Path

import numpy as np
from matplotlib.path import Path as RutaMpl

RAIZ = Path(__file__).resolve().parents[3]
GEO = RAIZ / "frontend" / "public" / "assets" / "mapa" / "portada-departamentos.v1.json"


def poligonos(d: str) -> list[np.ndarray]:
    """Convierte 'M x,y L x,y ... Z' (varios subrecorridos) en polígonos."""
    out: list[np.ndarray] = []
    for sub in re.split(r"(?=M)", d):
        nums = re.findall(r"-?\d+(?:\.\d+)?", sub)
        if len(nums) >= 6:
            pts = np.array(nums, dtype=float).reshape(-1, 2)
            out.append(pts)
    return out


def mapa(paso: float) -> dict:
    g = json.loads(GEO.read_text(encoding="utf-8"))
    grupos = []
    for z in g["zonas"]:
        rutas = [RutaMpl(p) for p in poligonos(z["d"])]
        if not rutas:
            continue
        xs = np.concatenate([p.vertices[:, 0] for p in rutas])
        ys = np.concatenate([p.vertices[:, 1] for p in rutas])
        gx = np.arange(math.floor(xs.min() / paso) * paso, xs.max() + paso, paso)
        gy = np.arange(math.floor(ys.min() / paso) * paso, ys.max() + paso, paso)
        rej = np.array([(x + (paso / 2 if int(round(y / paso)) % 2 else 0), y) for y in gy for x in gx])
        dentro = np.zeros(len(rej), dtype=bool)
        for r in rutas:
            dentro |= r.contains_points(rej)
        pts = [[round(float(x), 1), round(float(y), 1)] for x, y in rej[dentro]]
        if pts:
            grupos.append({"codigo": z["codigo"], "nombre": z["nombre"], "cy": float(z["cy"]), "puntos": pts})
    grupos.sort(key=lambda a: -a["cy"])  # de sur a norte: el mapa se enciende de abajo hacia arriba
    return {"ancho": g["ancho"], "alto": g["alto"], "grupos": grupos}


def ojo(paso: float = 11.0) -> dict:
    """El ojo de puntos de Vigía (misma idea que el banner del README): contorno en almendra, iris, pupila, ceja."""
    puntos = []
    ancho_ojo, alto_ojo = 190.0, 92.0
    n = int(ancho_ojo // paso)
    for gx in range(-n, n + 1):
        x = gx * paso
        tope = alto_ojo * (1 - (x / ancho_ojo) ** 2) ** 0.8
        for gy in range(-int(alto_ojo // paso) - 1, int(alto_ojo // paso) + 2):
            y = gy * paso
            if abs(y) > tope + 2:
                continue
            r_iris = math.hypot(x - 8, y)
            if r_iris < 24:
                puntos.append([x, y, 4.4, "pupila" if r_iris < 11 else "iris1"])
            elif r_iris < 52:
                puntos.append([x, y, 3.8, "iris2" if r_iris < 38 else "iris3"])
            elif abs(abs(y) - tope) < paso * 0.9:
                puntos.append([x, y, 3.4, "contorno"])
    for x in range(-160, 161, int(paso * 2)):
        puntos.append([x, -alto_ojo - 18 - (abs(x) / 11) ** 2 * 0.35, 3.0, "ceja"])
    return {"ancho": ancho_ojo * 2, "alto": alto_ojo * 2 + 60, "puntos": puntos}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--paso", type=float, default=13.0, help="separación de la rejilla, en px del JSON origen (520 x 720)")
    ap.add_argument("--salida", default=".")
    a = ap.parse_args()
    out = Path(a.salida)
    out.mkdir(parents=True, exist_ok=True)
    m = mapa(a.paso)
    (out / "peru_puntos.json").write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
    e = ojo()
    (out / "ojo_puntos.json").write_text(json.dumps(e, ensure_ascii=False), encoding="utf-8")
    print("departamentos:", len(m["grupos"]), "puntos del mapa:", sum(len(g["puntos"]) for g in m["grupos"]), "puntos del ojo:", len(e["puntos"]))


if __name__ == "__main__":
    main()
