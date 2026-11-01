"""El Perú en una malla de puntos, para el mapa de la portada de Gobserva (la identidad Píxel de Vigía: todo es puntos).

Lee los límites de los 25 departamentos que ya usa Vigía (frontend/public/peru-departments.json) y marca cada celda de una
malla cuadrada con el departamento que contiene su centro. Escribe ../publico/mapa-peru.js:

  window.MAPA_PERU = { cols, filas, regiones: ["01", …, "25"], celdas: "<base64>", geo: { lon0, lat1, paso, kx } }

`celdas` trae un byte por celda, fila por fila: 0 es mar o país vecino; k es el departamento regiones[k - 1]. El navegador
(publico/portada.js) dibuja un punto por celda llena y sabe, para cada punto, de qué región es. `geo` vuelve a grados un
punto de la malla (la esquina noroeste es lon0, lat1; cada celda mide `paso` grados de latitud y paso / kx de longitud): la
portada muestra las coordenadas de la lupa, como el visor de un radar.

Requisitos: shapely. Uso: python mapa/generar_mapa.py
"""
import base64
import json
import math
import sys
from pathlib import Path

from shapely.geometry import Point, shape
from shapely.prepared import prep

sys.stdout.reconfigure(encoding="utf-8")

AQUI = Path(__file__).resolve().parent
WORKER = AQUI.parent
REPO = WORKER.parents[3]
GEOJSON = REPO / "frontend/public/peru-departments.json"
SALIDA = WORKER / "publico/mapa-peru.js"

COLS = 58  # puntos de oeste a este: a 700 px de alto, uno cada ~8 px (la densidad del ojo de Vigía en grande)
MINIMO = 3  # puntos por región como mínimo: el Callao es más chico que una celda y tiene que poder señalarse


def main():
    g = json.loads(GEOJSON.read_text(encoding="utf-8"))
    deps = sorted(((f["properties"]["code"], shape(f["geometry"])) for f in g["features"]), key=lambda d: d[0])
    codigos = [c for c, _ in deps]
    assert codigos == [f"{i:02d}" for i in range(1, 26)], codigos
    lon0, lat0, lon1, lat1 = (
        min(s.bounds[0] for _, s in deps), min(s.bounds[1] for _, s in deps),
        max(s.bounds[2] for _, s in deps), max(s.bounds[3] for _, s in deps),
    )
    # Proyección equirectangular con el coseno de la latitud media: a 9° S casi no deforma.
    kx = math.cos(math.radians((lat0 + lat1) / 2))
    paso = (lon1 - lon0) * kx / COLS
    filas = math.ceil((lat1 - lat0) / paso)
    preparados = [(k, prep(s), s) for k, (_, s) in enumerate(deps)]
    celdas = bytearray(COLS * filas)
    centros = {}
    for j in range(filas):
        lat = lat1 - (j + 0.5) * paso
        for i in range(COLS):
            lon = lon0 + (i + 0.5) * paso / kx
            p = Point(lon, lat)
            centros[(i, j)] = p
            for k, pr, _ in preparados:
                if pr.contains(p):
                    celdas[j * COLS + i] = k + 1
                    break
    # Las regiones chicas (el Callao) se quedan con las celdas más cercanas a su territorio, aunque sean de un vecino.
    for k, _, s in preparados:
        tiene = sum(1 for v in celdas if v == k + 1)
        if tiene >= MINIMO:
            continue
        cercanas = sorted(centros, key=lambda c: s.distance(centros[c]))
        for (i, j) in cercanas[: MINIMO - tiene + 4]:
            if tiene >= MINIMO:
                break
            if celdas[j * COLS + i] != k + 1:
                celdas[j * COLS + i] = k + 1
                tiene += 1
    conteo = {codigos[k]: sum(1 for v in celdas if v == k + 1) for k in range(25)}
    datos = {
        "cols": COLS, "filas": filas, "regiones": codigos, "celdas": base64.b64encode(bytes(celdas)).decode(),
        "geo": {"lon0": round(lon0, 5), "lat1": round(lat1, 5), "paso": round(paso, 7), "kx": round(kx, 7)},
    }
    SALIDA.write_text(
        "// Generado por mapa/generar_mapa.py (no editar a mano): el Perú en una malla de puntos, de los límites de los 25\n"
        "// departamentos de Vigía (frontend/public/peru-departments.json). Un byte por celda: 0 es mar; k, regiones[k - 1].\n"
        f"window.MAPA_PERU = {json.dumps(datos, separators=(',', ':'))};\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"{COLS} x {filas} celdas, {sum(conteo.values())} puntos; por región: {conteo}")
    print(f"{SALIDA.relative_to(WORKER)}  {SALIDA.stat().st_size // 1024 + 1} KB")


if __name__ == "__main__":
    main()
