#!/usr/bin/env python3
"""Genera el markup de Moda (XML) de las escenas de los videos TikTok de la campaña, a partir de
datos reales (mapa del Perú, ojo de puntos) y de la maqueta común de capas: foto o fondo, velos de
legibilidad, titular, subtítulo grabado y aviso de historia ilustrativa.

Se usa desde la sesión de producción: imprime el markup de cada página para pasarlo a
canvas_apply_markup. No llama a Moda por sí mismo.

    python markup_tiktok.py T3 e1      (una escena)
    python markup_tiktok.py T3 todas   (todas, una por bloque)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parents[3]
GEO = RAIZ / "frontend" / "public" / "assets" / "mapa" / "portada-departamentos.v1.json"

BG, LIMA, TINTA, SUAVE, ROJO = "#0B0F0F", "#D4FF3F", "#E9F0EC", "#B5C2BC", "#FF6B5E"
W, H = 1080, 1920
SAFE_X, SAFE_W = 120, 720


def puntos_peru(paso: int = 16) -> list[tuple[int, int]]:
    """Rejilla de puntos dentro del Perú (coordenadas del JSON, 520 x 720)."""
    g = json.loads(GEO.read_text(encoding="utf-8"))
    img = Image.new("L", (g["ancho"], g["alto"]), 0)
    d = ImageDraw.Draw(img)
    for z in g["zonas"]:
        for sub in re.split(r"(?=M)", z["d"]):
            pts = [tuple(map(float, p.split(","))) for p in re.findall(r"[-\d.]+,[-\d.]+", sub)]
            if len(pts) >= 3:
                d.polygon(pts, fill=255)
    out = []
    for y in range(paso // 2, g["alto"], paso):
        for x in range(paso // 2, g["ancho"], paso):
            if img.getpixel((x, y)) > 0:
                out.append((x, y))
    return out


def bloque_peru(ox: float, oy: float, escala: float, paso: int, radio: float, nombre: str = "peru", opacidad: float = 0.9) -> str:
    """`<generate>` que dibuja el Perú como puntos lima (sin datos por región: es una silueta)."""
    pts = puntos_peru(paso)
    datos = ",".join(f"{x},{y}" for x, y in pts)
    return (
        f'<group name="{nombre}"><generate>const P=[{datos}];'
        f"for(let i=0;i<P.length;i+=2){{emit('ellipse',{{cx:{ox}+P[i]*{escala},cy:{oy}+P[i+1]*{escala},"
        f"r:{radio},fill:'{LIMA}',opacity:{opacidad}*(0.55+0.45*((i*37)%100)/100)}});}}</generate></group>"
    )


def bloque_ojo(cx: float, cy: float, ancho: float, alto: float, paso: float, nombre: str = "ojo", opacidad: float = 1.0) -> str:
    """`<generate>` con el ojo de puntos de Vigía: contorno en almendra, iris en anillos y pupila blanca."""
    return (
        f'<group name="{nombre}"><generate>'
        f"const A={ancho / 2},B={alto / 2},S={paso};"
        f"for(let x=-A;x<=A;x+=S){{const t=B*Math.pow(1-(x/A)*(x/A),0.8);"
        f"for(let y=-B-S;y<=B+S;y+=S){{if(Math.abs(y)>t+2){{continue;}}"
        f"const r=Math.hypot(x-{paso * 0.5},y);const bord=Math.abs(Math.abs(y)-t);"
        f"let rr={paso * 0.2},c='{LIMA}',o=0.25;"
        f"if(r<B*0.26){{rr={paso * 0.36};c=(r<B*0.12)?'#FFFFFF':'{LIMA}';o=1;}}"
        f"else if(r<B*0.58){{rr={paso * 0.3};o=(r<B*0.38)?0.95:((r<B*0.5)?0.65:0.4);}}"
        f"else if(bord<S*0.9){{rr={paso * 0.28};o=1;}}"
        f"emit('ellipse',{{cx:{cx}+x,cy:{cy}+y,r:rr,fill:c,opacity:o*{opacidad}}});}}}}"
        f"</generate></group>"
    )


def capas_legibilidad(arriba: bool = True, abajo: bool = True) -> str:
    s = ""
    if arriba:
        s += f'<rectangle name="velo_arriba" x="0" y="0" width="{W}" height="900" fill="linear-gradient(180deg, rgba(11,15,15,0.9) 0%, rgba(11,15,15,0) 100%)"/>'
    if abajo:
        s += f'<rectangle name="velo_abajo" x="0" y="900" width="{W}" height="1020" fill="linear-gradient(180deg, rgba(11,15,15,0) 0%, rgba(11,15,15,0.88) 78%)"/>'
    return s


def subtitulo(texto: str, y: int = 1196, alto: int = 168, nombre: str = "subtitulo") -> str:
    return (
        f'<rectangle name="{nombre}_caja" x="{SAFE_X - 40}" y="{y}" width="{SAFE_W + 80}" height="{alto}" corner-radius="30" fill="{BG}" opacity="0.74"/>'
        f'<text name="{nombre}" x="{SAFE_X}" y="{y + 12}" width="{SAFE_W}" height="{alto - 24}" font-family="Inter" font-size="56" font-weight="700" '
        f'color="{TINTA}" text-align="center" vertical-align="middle" line-height="1.12" max-lines="2">{texto}</text>'
    )


def titular(texto: str, y: int, alto: int, tam: int = 96, nombre: str = "titular", color: str = TINTA) -> str:
    return (
        f'<text name="{nombre}" x="{SAFE_X}" y="{y}" width="{SAFE_W}" height="{alto}" font-family="Space Grotesk" font-size="{tam}" font-weight="700" '
        f'color="{color}" text-align="left" vertical-align="top" line-height="1.04" max-lines="4">{texto}</text>'
    )


def aviso(texto: str, y: int = 1384, nombre: str = "aviso") -> str:
    return (
        f'<rectangle name="{nombre}" x="{SAFE_X - 20}" y="{y}" width="{SAFE_W + 40}" height="64" corner-radius="full" fill="{LIMA}" '
        f'text="{texto}" font-family="Inter" font-size="28" font-weight="700" color="{BG}" text-align="center" vertical-align="middle"/>'
    )


def foto(nombre: str = "foto") -> str:
    # Más grande que la página para poder hacer el empuje lento sin bordes.
    return f'<rectangle name="{nombre}" x="-60" y="-107" width="1200" height="2134" fill="#1A2121"/>'


def pagina(*partes: str) -> str:
    return f'<content font-family="Inter"><background fill="{BG}"/>' + "".join(partes) + "</content>"


if __name__ == "__main__":
    print(len(bloque_peru(0, 0, 1, 16, 4)), "bytes de Perú;", len(bloque_ojo(0, 0, 300, 140, 12)), "bytes de ojo")


def filas_peru(ox: float, oy: float, escala: float, paso_fila: float, grosor: float = 14, nombre: str = "fila", color: str = LIMA, opacidad: float = 0.9) -> tuple[str, int]:
    """El Perú como filas de puntos: cada fila es UNA línea punteada (`dash`), no cientos de elipses.
    Devuelve el markup y la cantidad de filas (para animarlas por olas)."""
    g = json.loads(GEO.read_text(encoding="utf-8"))
    img = Image.new("L", (g["ancho"], g["alto"]), 0)
    d = ImageDraw.Draw(img)
    for z in g["zonas"]:
        for sub in re.split(r"(?=M)", z["d"]):
            pts = [tuple(map(float, p.split(","))) for p in re.findall(r"[-\d.]+,[-\d.]+", sub)]
            if len(pts) >= 3:
                d.polygon(pts, fill=255)
    out, n, y = [], 0, 0.0
    paso = paso_fila / escala
    y = paso / 2
    while y < g["alto"]:
        yy = int(y)
        corre, ini = False, 0
        for x in range(g["ancho"] + 1):
            dentro = x < g["ancho"] and img.getpixel((x, yy)) > 0
            if dentro and not corre:
                corre, ini = True, x
            elif not dentro and corre:
                corre = False
                if x - ini > 6:
                    n += 1
                    out.append(
                        f'<line name="{nombre}{n}" x1="{ox + ini * escala:.0f}" y1="{oy + y * escala:.0f}" x2="{ox + x * escala:.0f}" y2="{oy + y * escala:.0f}" '
                        f'stroke="{color}" stroke-width="{grosor}" dash="1 3" stroke-linecap="round" opacity="{opacidad}"/>'
                    )
        y += paso
    return "".join(out), n
