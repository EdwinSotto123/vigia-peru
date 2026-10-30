#!/usr/bin/env python3
"""Genera las imágenes SVG del README (docs/img/): el banner con el ojo de puntos y cuatro gráficos
con datos REALES de la API pública (nada se escribe a mano).

    python backend/scripts/generar_graficos_readme.py

Salida: docs/img/banner.svg, escala.svg, partidos.svg, regiones.svg, flujo-datos.svg
Los SVG usan el tema oscuro de la identidad Píxel (carbón y lima) y fuentes del sistema, así que se
ven bien en GitHub tanto en modo claro como oscuro (llevan su propio fondo).
"""

from __future__ import annotations

import json
import math
import os
import urllib.request
from html import escape
from pathlib import Path

# Por la web (/v1): la API sólo atiende a nuestros Workers desde el 2026-10-30.
API = os.getenv("VIGIA_API", "https://vigia.gobserva.cloud/v1")
SALIDA = Path(__file__).resolve().parents[2] / "docs" / "img"

BG = "#0B0F0F"
PANEL = "#121818"
LINEA = "#263232"
TINTA = "#E9F0EC"
SUAVE = "#B5C2BC"
MUDO = "#7F918A"
LIMA = "#D4FF3F"
LIMA_OSC = "#6E8F1A"
GRIS = "#33423F"
ROJO = "#FF6B5E"
AZUL = "#6CB6FF"
FUENTE = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"


def get(ruta: str):
    req = urllib.request.Request(API + ruta, headers={"User-Agent": "vigia-readme/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def num(n: float) -> str:
    return f"{int(round(n)):,}"


def svg(ancho: int, alto: int, cuerpo: str, titulo: str, desc: str = "") -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ancho} {alto}" width="{ancho}" height="{alto}" '
        f'role="img" aria-labelledby="t d"><title id="t">{escape(titulo)}</title><desc id="d">{escape(desc)}</desc>'
        f'<rect width="{ancho}" height="{alto}" rx="18" fill="{BG}"/>{cuerpo}</svg>'
    )


def texto(x, y, s, tam=14, color=TINTA, peso=400, ancla="start", extra="") -> str:
    return (f'<text x="{x}" y="{y}" font-family="{FUENTE}" font-size="{tam}" font-weight="{peso}" '
            f'fill="{color}" text-anchor="{ancla}" {extra}>{escape(str(s))}</text>')


# ── Banner: el ojo de puntos y el nombre ──────────────────────────────────────────────────────────
def banner() -> str:
    W, H = 1280, 360
    ox, oy, paso = 250, 196, 11
    pts = []
    ancho_ojo, alto_ojo = 190, 92
    for gx in range(-ancho_ojo // paso, ancho_ojo // paso + 1):
        x = gx * paso
        tope = alto_ojo * (1 - (x / ancho_ojo) ** 2) ** 0.8 if abs(x) < ancho_ojo else 0
        for gy in range(-alto_ojo // paso - 1, alto_ojo // paso + 2):
            y = gy * paso
            d_borde = abs(abs(y) - tope)
            if abs(y) <= tope + 2:
                r_iris = math.hypot(x - 8, y)
                if r_iris < 24:
                    pts.append((x, y, 4.2, "#FFFFFF" if r_iris < 11 else LIMA, 1.0))
                elif r_iris < 52:
                    anillo = int((r_iris - 24) // 9)
                    pts.append((x, y, 3.6, LIMA, [0.95, 0.65, 0.4][min(anillo, 2)]))
                elif d_borde < paso * 0.9:
                    pts.append((x, y, 3.3, LIMA, 1.0))
                else:
                    pts.append((x, y, 1.6, LIMA, 0.25))
    ceja = [(x, -alto_ojo - 18 - (abs(x) / 11) ** 2 * 0.35, 3.0, LIMA, 0.7) for x in range(-160, 161, paso * 2)]
    puntos = "".join(
        f'<circle cx="{ox + x}" cy="{oy + y:.1f}" r="{r}" fill="{c}" opacity="{o}"/>' for x, y, r, c, o in pts + ceja
    )
    cuerpo = (
        '<rect width="1280" height="360" rx="18" fill="url(#g)"/>'
        '<defs><radialGradient id="g" cx="20%" cy="50%" r="80%"><stop offset="0" stop-color="#152020"/>'
        f'<stop offset="1" stop-color="{BG}"/></radialGradient></defs>'
        + puntos
        + texto(520, 160, "vigía_", 92, TINTA, 800)
        + texto(784, 160, "PERÚ", 30, LIMA, 700, extra='letter-spacing="6"')
        + texto(522, 214, "Civic anti-corruption platform.", 30, TINTA, 600)
        + texto(522, 252, "AI agents read Peru's public contracts, cross them with official", 21, SUAVE)
        + texto(522, 280, "records, and flag the ones that deserve a second look.", 21, SUAVE)
        + f'<rect x="522" y="304" width="262" height="32" rx="16" fill="{LIMA}"/>'
        + texto(653, 325, "a signal is never an accusation", 13.5, BG, 700, "middle")
    )
    return svg(W, H, cuerpo, "vigía_ Perú", "Ojo de puntos y el lema de Vigía Perú")


# ── Escala: publicados, leídos, riesgo alto ───────────────────────────────────────────────────────
def escala(resumen: dict) -> str:
    total = resumen["total"]
    r = resumen["porRiesgo"]
    leidos = total - r.get("sin_analizar", 0)
    alto = r.get("alto", 0)
    W, H = 1100, 330
    x0, ancho_max = 300, 700
    filas = [
        ("Published contracts", total, SUAVE, "everything entities uploaded to SEACE"),
        ("Read in depth by Vigía", leidos, LIMA, f"{leidos / total * 100:.1f} % of all"),
        ("High-risk signals", alto, ROJO, f"{alto} of the {leidos} read"),
    ]
    out = [texto(40, 52, "The scale of the problem", 26, TINTA, 700),
           texto(40, 80, f"Each bar is drawn to scale. {num(total - leidos)} contracts are still waiting to be read.", 15, MUDO)]
    y = 126
    for nombre, valor, color, nota in filas:
        w = max(6, ancho_max * valor / total)
        out.append(texto(40, y + 22, nombre, 17, TINTA, 600))
        out.append(f'<rect x="{x0}" y="{y}" width="{ancho_max}" height="34" rx="8" fill="{PANEL}" stroke="{LINEA}"/>')
        out.append(f'<rect x="{x0}" y="{y}" width="{w:.1f}" height="34" rx="8" fill="{color}"/>')
        out.append(texto(x0 + ancho_max + 14, y + 23, num(valor), 20, color, 800))
        out.append(texto(x0, y + 56, nota, 13.5, MUDO))
        y += 84
    return svg(W, H, "".join(out), "Scale of the problem", "Contratos publicados, leídos y con riesgo alto")


# ── Partidos: leídos y esperando por partido ──────────────────────────────────────────────────────
def partidos(rank: dict) -> str:
    filas = rank["data"][:10]
    W = 1100
    top = 118
    alto_fila = 44
    H = top + alto_fila * len(filas) + 72
    x0, ancho_max = 380, 520
    maximo = max(f["contratos"] for f in filas)
    out = [texto(40, 52, f"Contracts by governing party, {rank['desde'][:4]} to {rank['hasta'][:4]} term", 26, TINTA, 700),
           texto(40, 80, "Each contract is linked to the party that governed the entity the month it was called (election winner).", 15, MUDO)]
    for i, f in enumerate(filas):
        y = top + i * alto_fila
        nombre = f["nombre"] if len(f["nombre"]) <= 38 else f["nombre"][:36] + "…"
        total_w = ancho_max * f["contratos"] / maximo
        leidos_w = total_w * f["leidos"] / max(f["contratos"], 1)
        cola_w = total_w * f["enCola"] / max(f["contratos"], 1)
        out.append(texto(40, y + 22, nombre, 15, TINTA, 600))
        out.append(texto(x0 - 12, y + 22, num(f["contratos"]), 14, SUAVE, 700, "end"))
        out.append(f'<rect x="{x0}" y="{y + 6}" width="{total_w:.1f}" height="22" rx="6" fill="{GRIS}"/>')
        out.append(f'<rect x="{x0}" y="{y + 6}" width="{cola_w:.1f}" height="22" rx="6" fill="{LIMA_OSC}"/>')
        out.append(f'<rect x="{x0}" y="{y + 6}" width="{max(leidos_w, 3 if f["leidos"] else 0):.1f}" height="22" rx="6" fill="{LIMA}"/>')
        out.append(texto(x0 + total_w + 10, y + 23, f"{f['leidos']} read", 12.5, MUDO))
    ly = top + alto_fila * len(filas) + 22
    for i, (c, t) in enumerate([(LIMA, "read by Vigía"), (LIMA_OSC, "waiting to be funded"), (GRIS, "other (no documents yet, not awarded)")]):
        lx = 40 + i * 270
        out.append(f'<rect x="{lx}" y="{ly}" width="14" height="14" rx="4" fill="{c}"/>')
        out.append(texto(lx + 22, ly + 12, t, 13.5, SUAVE))
    return svg(W, H, "".join(out), "Contracts by party", "Contratos por partido, leídos y en cola")


# ── Regiones: lectura por región ──────────────────────────────────────────────────────────────────
def regiones(geo: list) -> str:
    filas = sorted(geo, key=lambda z: -z["total"])[:12]
    W = 1100
    top = 118
    alto_fila = 38
    H = top + alto_fila * len(filas) + 60
    x0, ancho_max = 250, 560
    maximo = max(z["total"] for z in filas)
    out = [texto(40, 52, "Where the contracts are, and how much is read", 26, TINTA, 700),
           texto(40, 80, "Top 12 regions by number of contracts. The region is the seat of the contracting entity.", 15, MUDO)]
    for i, z in enumerate(filas):
        y = top + i * alto_fila
        w = ancho_max * z["total"] / maximo
        leido_w = w * z["procesados"] / max(z["total"], 1)
        out.append(texto(40, y + 21, z["nombre"], 15, TINTA, 600))
        out.append(f'<rect x="{x0}" y="{y + 5}" width="{w:.1f}" height="20" rx="6" fill="{GRIS}"/>')
        if z["procesados"]:
            out.append(f'<rect x="{x0}" y="{y + 5}" width="{max(leido_w, 3):.1f}" height="20" rx="6" fill="{LIMA}"/>')
        pct = z["procesados"] / max(z["total"], 1) * 100
        out.append(texto(x0 + w + 10, y + 21, f"{num(z['total'])} contracts, {z['procesados']} read ({pct:.1f} %)", 13, SUAVE))
    return svg(W, H, "".join(out), "Regions", "Contratos por región y cuántos se leyeron")


# ── Frescura de los datos ─────────────────────────────────────────────────────────────────────────
def flujo_datos() -> str:
    W, H = 1100, 290
    fuentes = [
        ("OECE contracts", "daily 06:00", LIMA),
        ("OECE documents", "daily 02:00", LIMA),
        ("OSCE sanctions", "weekly", LIMA),
        ("PNDA visits", "1st and 15th", LIMA),
        ("PNDA interests", "monthly", AZUL),
        ("JNE authorities", "monthly", AZUL),
        ("MEF budget", "monthly", ROJO),
        ("ONPE donations", "manual", "#F2B84B"),
    ]
    out = [texto(40, 52, "How fresh each source is meant to be", 26, TINTA, 700),
           texto(40, 80, "Cloud Run Jobs triggered by Cloud Scheduler, loading into one Postgres database.", 15, MUDO)]
    cw, gap = 118, 10
    for i, (n, c, col) in enumerate(fuentes):
        x = 40 + i * (cw + gap)
        out.append(f'<rect x="{x}" y="120" width="{cw}" height="96" rx="12" fill="{PANEL}" stroke="{LINEA}"/>')
        out.append(f'<rect x="{x}" y="120" width="{cw}" height="5" rx="2.5" fill="{col}"/>')
        out.append(texto(x + cw / 2, 158, n, 13.5, TINTA, 700, "middle"))
        out.append(texto(x + cw / 2, 184, c, 12.5, SUAVE, 400, "middle"))
    out.append(texto(40, 262, "Lime: runs on schedule.  Blue: monthly, source changed names once.  Amber: manual.  Red: source API changed.", 13, MUDO))
    return svg(W, H, "".join(out), "Data cadence", "Cadencia de cada fuente de datos")


def main() -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    resumen = get("/contratos/resumen")
    geo = get("/contratos/geo?nivel=departamento")["data"]
    rank = get("/partidos/ranking?anio=2022")
    archivos = {
        "banner.svg": banner(),
        "escala.svg": escala(resumen),
        "partidos.svg": partidos(rank),
        "regiones.svg": regiones(geo),
        "flujo-datos.svg": flujo_datos(),
    }
    for nombre, contenido in archivos.items():
        (SALIDA / nombre).write_text(contenido, encoding="utf-8")
        print("escrito", SALIDA / nombre, len(contenido), "bytes")


if __name__ == "__main__":
    main()
