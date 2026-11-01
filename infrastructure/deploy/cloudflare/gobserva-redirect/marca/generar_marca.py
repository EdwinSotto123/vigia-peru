"""La marca de Gobserva: el logo «gobserva_» (la «o» es una lupa con nodos), el isotipo y sus PNG.

Cuarta versión (2026-11-01, el usuario: «se ve horrible el logo, ni hay»): de la familia de Vigía. Vigía firma «vigía_» en
JetBrains Mono, con el guion bajo lima de un cursor y un ojo de puntos; Gobserva firma «gobserva_» con la misma letra, el
mismo cursor y, en la «o», la lupa lima con tres nodos blancos (como la pupila blanca del ojo de Vigía). Las letras son
las de la fuente (frontend/app/fuentes/jetbrains-mono.woff2, OFL) y la lupa se dibuja con el grosor de sus astas.

Escribe:
  ../marca.js                           el logo para la portada (worker.js), con clases para día y noche
  ../publico/favicon.svg, favicon.ico   el ícono de la pestaña (16, 32 y 48 px)
  ../publico/apple-touch-icon.png       180 px, para la pantalla de inicio del teléfono
  ../publico/logo.png                   512 px, el logo de la organización para los buscadores (datos estructurados)
  ../publico/og.png                     1200 x 630, la imagen al compartir el enlace: el mapa de ../publico/mapa-peru.js en la
                                        pantalla del radar, como la portada (verde fósforo sobre negro verdoso)
  ../publico/marca/                     el logo en SVG y PNG para descargar (oscuro, claro, a una tinta, isotipo)

Requisitos: fontTools, Pillow y Playwright con Chrome (los PNG se dibujan en el navegador, igual que en la página).
Uso: python marca/generar_marca.py   (desde cualquier carpeta); con --og, sólo la imagen al compartir. Las reglas de uso del
logo: marca/README.md.
"""
import base64
import io
import json
import math
import re
import sys
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from PIL import Image
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")

AQUI = Path(__file__).resolve().parent
WORKER = AQUI.parent
PUBLICO = WORKER / "publico"
REPO = WORKER.parents[3]
FUENTE_LOGO = REPO / "frontend/app/fuentes/jetbrains-mono.woff2"
FUENTE_TEXTO = REPO / "frontend/app/fuentes/inter.woff2"

# La paleta de la marca (la misma de Vigía).
CARBON = "#0B0F0F"
TINTA = "#111817"
CLARO = "#E7F0EE"
BLANCO = "#FFFFFF"
LIMA = "#D4FF3F"
VERDE = "#2F6B10"  # el lima de Vigía sobre fondo claro
TENUE_OSCURO = "#8FA3A0"
# La pantalla del radar de la portada (worker.js): la imagen al compartir usa sus colores.
RADAR_FONDO = "#030B07"
FOSFORO = "#3DFF8A"
MENTA = "#A8FFD0"

PALABRA = "gobserva_"
PESO = 800
TRACKING = -60  # el -0.06em de «vigía_» (frontend/components/marca/Marca.tsx)

# La lupa, en unidades de la fuente (1000 por em; monoespaciada: cada letra ocupa 600). La «o» de JetBrains Mono a 800
# ocupa (60, -10)-(540, 560), con astas de 130 (arriba y abajo) a 150 (a los lados).
O_CX, O_CY = 300, 275
R_EXT = 268  # la «o» mide 285 de alto: la lupa es redonda y del mismo tamaño
ARO = 136  # el grosor de las astas
MANGO_LARGO = 125
MANGO_GROSOR = 150
ESPACIO_MANGO = 40  # aire después de la lupa para que el mango no toque la «b»

# Tres nodos unidos dentro de la lupa (una empresa, un contrato y una entidad), en radios del vidrio.
NODOS = [(0.0, -0.46), (-0.46, 0.32), (0.46, 0.32)]
NODO_R = 0.22
ARISTA = 0.1


def num(v):
    """Números cortos para el SVG: enteros sin decimales, el resto con uno."""
    r = round(v, 1)
    return str(int(r)) if r == int(r) else f"{r}"


class Lupa:
    """La geometría de una lupa: centro, radio exterior, grosor del aro y mango a 45°, de corte recto."""

    def __init__(self, cx, cy, r_ext, aro, largo, grosor_mango):
        self.cx, self.cy, self.r_ext, self.aro = cx, cy, r_ext, aro
        self.r_aro = r_ext - aro / 2
        self.r_vidrio = r_ext - aro
        u = math.sqrt(0.5)
        self.p0 = (cx + u * self.r_aro, cy + u * self.r_aro)
        self.p1 = (cx + u * (r_ext + largo), cy + u * (r_ext + largo))
        self.grosor_mango = grosor_mango
        g = grosor_mango / 2 * u
        self.esquinas = [(self.p1[0] - g, self.p1[1] + g), (self.p1[0] + g, self.p1[1] - g)]

    def caja(self):
        xs = [self.cx - self.r_ext, self.cx + self.r_ext] + [p[0] for p in self.esquinas]
        ys = [self.cy - self.r_ext, self.cy + self.r_ext] + [p[1] for p in self.esquinas]
        return min(xs), min(ys), max(xs), max(ys)

    def svg(self, aro, nodo):
        """Aro y mango (clase gl-aro) y los nodos con sus aristas (gl-nodo). El vidrio es transparente."""
        k = self.r_vidrio
        pts = [(self.cx + x * k, self.cy + y * k) for x, y in NODOS]
        aristas = "".join(f"M{num(pts[a][0])} {num(pts[a][1])}L{num(pts[b][0])} {num(pts[b][1])}" for a, b in ((0, 1), (1, 2), (0, 2)))
        return (
            f'<path class="gl-aro" d="M{num(self.p0[0])} {num(self.p0[1])}L{num(self.p1[0])} {num(self.p1[1])}" '
            f'stroke="{aro}" stroke-width="{num(self.grosor_mango)}" fill="none"/>'
            f'<circle class="gl-aro" cx="{num(self.cx)}" cy="{num(self.cy)}" r="{num(self.r_aro)}" stroke="{aro}" '
            f'stroke-width="{num(self.aro)}" fill="none"/>'
            f'<path class="gl-nodo gl-arista" d="{aristas}" stroke="{nodo}" stroke-width="{num(k * ARISTA)}" fill="none" stroke-linecap="round"/>'
            + "".join(f'<circle class="gl-nodo" cx="{num(x)}" cy="{num(y)}" r="{num(k * NODO_R)}" fill="{nodo}"/>' for x, y in pts)
        )


def armar_logo():
    """Las letras (un path), el cursor (otro, para que titile) y la lupa en la «o». Devuelve (viewBox, letras, cursor, lupa)."""
    f = instantiateVariableFont(TTFont(FUENTE_LOGO), {"wght": PESO}, inplace=False)
    gs, cmap = f.getGlyphSet(), f.getBestCmap()
    letras, cursor = SVGPathPen(gs, ntos=num), SVGPathPen(gs, ntos=num)
    x, lupa, cajas = 0, None, []
    for ch in PALABRA:
        n = cmap[ord(ch)]
        if ch == "o" and lupa is None:
            lupa = Lupa(x + O_CX, -O_CY, R_EXT, ARO, MANGO_LARGO, MANGO_GROSOR)
            x += f["hmtx"][n][0] + TRACKING + ESPACIO_MANGO
            continue
        gs[n].draw(TransformPen(cursor if ch == "_" else letras, (1, 0, 0, -1, x, 0)))
        bp = BoundsPen(gs)
        gs[n].draw(bp)
        a, b, c, d = bp.bounds
        cajas.append((x + a, -d, x + c, -b))
        x += f["hmtx"][n][0] + TRACKING
    cajas.append(lupa.caja())
    x0, y0 = min(c[0] for c in cajas), min(c[1] for c in cajas)
    x1, y1 = max(c[2] for c in cajas), max(c[3] for c in cajas)
    m = 10
    vb = f"{num(x0 - m)} {num(y0 - m)} {num(x1 - x0 + 2 * m)} {num(y1 - y0 + 2 * m)}"
    return vb, letras.getCommands(), cursor.getCommands(), lupa


def logo_svg(vb, letras, cursor, lupa, letra, aro, nodo, titulo=True):
    interior = (f'<path class="gl-letras" d="{letras}" fill="{letra}"/>' + lupa.svg(aro, nodo)
                + f'<path class="gl-cursor" d="{cursor}" fill="{aro}"/>')
    t = "<title>Gobserva</title>" if titulo else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="Gobserva">{t}{interior}</svg>'


def isotipo(fondo=CARBON, aro=LIMA, nodo=BLANCO, esquinas=14, lado=64, escala=1.0):
    """La lupa sola en un cuadrado de 64: lima y nodos blancos sobre carbón, como el ojo de Vigía. Centrada por su caja.
    `escala` < 1 deja aire para las máscaras redondas (el ícono del teléfono y el logo de los buscadores)."""
    medidas = [v * escala for v in (19.5, 7.2, 9.0, 8.6)]
    lupa = Lupa(0, 0, *medidas)
    x0, y0, x1, y1 = lupa.caja()
    lupa = Lupa(32 - (x0 + x1) / 2, 32 - (y0 + y1) / 2, *medidas)
    rect = f'<rect width="64" height="64" rx="{esquinas}" fill="{fondo}"/>' if fondo else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{lado}" height="{lado}" role="img" '
            f'aria-label="Gobserva">{rect}{lupa.svg(aro, nodo)}</svg>')


# ─── El mapa para la imagen al compartir: el de la portada, en el radar, con la lupa sobre Lima ─────────────────────
def mapa_og(ancho=390, region="15"):
    """El Perú en píxeles (publico/mapa-peru.js, de mapa/generar_mapa.py) con la lupa encima, como SVG, en los verdes
    del radar de la portada."""
    datos = json.loads(re.search(r"= (\{.*\});", (PUBLICO / "mapa-peru.js").read_text(encoding="utf-8")).group(1))
    cols, filas, regiones = datos["cols"], datos["filas"], datos["regiones"]
    celdas = base64.b64decode(datos["celdas"])
    paso = ancho / cols
    alto = paso * filas
    puntos = [((i + 0.5) * paso, (j + 0.5) * paso, celdas[j * cols + i] - 1)
              for j in range(filas) for i in range(cols) if celdas[j * cols + i]]
    k = regiones.index(region)
    mias = [(x, y) for x, y, r in puntos if r == k]
    cx, cy = sum(x for x, _ in mias) / len(mias), sum(y for _, y in mias) / len(mias)
    R, M, base = ancho * 0.2, 1.4, paso * 0.37
    s = []
    for x, y, r in puntos:
        # La vista de la portada al abrir: la región bajo la lupa más encendida que las demás, en la rampa verde del radar.
        color, rad = ("#2BBF6A" if r == k else "#165C38"), base
        d = math.hypot(x - cx, y - cy)
        if d < R:  # el mismo ojo de pez que publico/portada.js
            u = d / R
            u2 = ((M + 1) * u) / (M * u + 1)
            if d > 0.01:
                x, y = cx + (x - cx) / d * u2 * R, cy + (y - cy) / d * u2 * R
            rad = base * (1 + 1.15 * (1 - u))
            color = FOSFORO if r == k else "#27C76B"
        s.append(f'<rect x="{num(x - rad)}" y="{num(y - rad)}" width="{num(rad * 2)}" height="{num(rad * 2)}" fill="{color}"/>')
    aro = R * 0.085
    u = math.sqrt(0.5)
    s.append(f'<circle cx="{num(cx)}" cy="{num(cy)}" r="{num(R)}" fill="{FOSFORO}" fill-opacity=".06" stroke="{MENTA}" stroke-width="{num(aro)}"/>')
    # La retícula de la lupa (publico/portada.js): una cruz fina con el centro libre.
    cruz = "".join(f"M{num(cx + dx * R * .2)} {num(cy + dy * R * .2)}L{num(cx + dx * R * .52)} {num(cy + dy * R * .52)}"
                   for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
    s.append(f'<path d="{cruz}" stroke="{MENTA}" stroke-opacity=".55" stroke-width="1.2"/>')
    s.append(f'<path d="M{num(cx + u * (R + aro * .4))} {num(cy + u * (R + aro * .4))}L{num(cx + u * R * 1.62)} {num(cy + u * R * 1.62)}" '
             f'stroke="{MENTA}" stroke-width="{num(aro * 1.4)}"/>')
    return f'<svg class="mapa" viewBox="0 0 {num(ancho)} {num(alto)}" width="{num(ancho)}" height="{num(alto)}">{"".join(s)}</svg>'


def fuentes_css():
    it = base64.b64encode(FUENTE_TEXTO.read_bytes()).decode()
    return f"@font-face{{font-family:Inter;src:url(data:font/woff2;base64,{it}) format('woff2');font-weight:100 900}}"


def dibujar(pagina, html, ancho, alto, transparente=False):
    pagina.set_viewport_size({"width": ancho, "height": alto})
    pagina.set_content(f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;background:transparent}}'
                       f"{fuentes_css()}</style>{html}")
    pagina.wait_for_load_state("networkidle")
    pagina.evaluate("document.fonts.ready")
    pagina.wait_for_timeout(250)
    return Image.open(io.BytesIO(pagina.screenshot(clip={"x": 0, "y": 0, "width": ancho, "height": alto},
                                                   omit_background=transparente)))


def guardar_png(img, ruta, colores=None):
    if colores:
        img = img.convert("RGB").quantize(colors=colores, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    img.save(ruta, optimize=True)
    print(f"  {ruta.relative_to(WORKER)}  {ruta.stat().st_size // 1024} KB")


def anillos_og():
    """La retícula del radar de la portada (worker.js, RETICULA): anillos, cruz y rumbos cada 5° y cada 30°."""
    linea = f'fill="none" stroke="{FOSFORO}" stroke-opacity=".18" stroke-width="1" vector-effect="non-scaling-stroke"'
    anillos = "".join(f'<circle r="{r}" {linea}/>' for r in (26, 52, 78, 104))
    return (f'<svg viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid slice" '
            f'style="position:absolute;inset:0;width:100%;height:100%">{anillos}<path d="M-140 0H140M0-140V140" {linea}/>'
            f'<circle r="91" pathLength="360" stroke-dasharray=".35 4.65" fill="none" stroke="{FOSFORO}" stroke-opacity=".34" stroke-width="2.6"/>'
            f'<circle r="91" pathLength="360" stroke-dasharray=".7 29.3" fill="none" stroke="{FOSFORO}" stroke-opacity=".6" stroke-width="5.5"/></svg>')


def og_html(logo_oscuro):
    return f"""<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Doto:wght@800&family=JetBrains+Mono:wght@600&display=swap">
<style>
.og{{position:relative;width:1200px;height:630px;overflow:hidden;font-family:Inter,sans-serif;
  background:linear-gradient(rgba(61,255,138,.05) 1px,transparent 1px) 0 0/40px 40px,linear-gradient(90deg,rgba(61,255,138,.05) 1px,transparent 1px) 0 0/40px 40px,
  radial-gradient(42% 70% at 79% 50%,rgba(61,255,138,.13),transparent 72%),{RADAR_FONDO}}}
.visor{{position:absolute;right:64px;top:22px;width:440px;height:586px;border:1px solid #12301F}}
.visor .mapa{{position:absolute;inset:0;margin:auto}}
.radar{{position:absolute;inset:0;overflow:hidden;mix-blend-mode:screen}}
.barrido{{position:absolute;left:50%;top:50%;width:190%;aspect-ratio:1;translate:-50% -50%;rotate:128deg;border-radius:50%;
  background:conic-gradient(from 0deg,transparent 0deg 285deg,rgba(61,255,138,.04) 285deg,rgba(61,255,138,.22) 356deg,rgba(168,255,208,.8) 359.5deg,transparent 360deg)}}
.texto{{position:absolute;left:80px;top:100px;width:600px}}
.texto svg{{height:92px;display:block}}
.eslogan{{margin:44px 0 0;color:{MENTA};font:800 48px/1.15 Doto,monospace;text-shadow:0 0 18px rgba(61,255,138,.45)}}
.desc{{margin:24px 0 0;color:#A9CDB8;font:500 25px/1.35 Inter;max-width:470px;text-wrap:balance}}
.dominio{{position:absolute;left:80px;bottom:62px;margin:0;color:{FOSFORO};font:600 24px 'JetBrains Mono',monospace}}
</style>
<div class="og">
  <div class="visor">{mapa_og()}<div class="radar">{anillos_og()}<div class="barrido"></div></div></div>
  <div class="texto">{logo_oscuro}
    <p class="eslogan">Lo de todos,<br>a la vista de todos.</p>
    <p class="desc">Tecnología cívica para vigilar el Estado peruano.</p>
  </div>
  <p class="dominio">gobserva.cloud</p>
</div>"""


def main():
    print("Logo")
    vb, letras, cursor, lupa = armar_logo()
    destino_marca = PUBLICO / "marca"
    destino_marca.mkdir(parents=True, exist_ok=True)

    oscuro = logo_svg(vb, letras, cursor, lupa, CLARO, LIMA, BLANCO)
    if "--og" in sys.argv:
        with sync_playwright() as p:
            nav = p.chromium.launch(channel="chrome")
            guardar_png(dibujar(nav.new_page(device_scale_factor=1), og_html(oscuro), 1200, 630), PUBLICO / "og.png", colores=128)
            nav.close()
        return
    claro = logo_svg(vb, letras, cursor, lupa, TINTA, VERDE, TINTA)
    mono = logo_svg(vb, letras, cursor, lupa, TINTA, TINTA, TINTA)
    iso = isotipo()
    archivos = {
        destino_marca / "gobserva-logo.svg": claro,
        destino_marca / "gobserva-logo-oscuro.svg": oscuro,
        destino_marca / "gobserva-logo-mono.svg": mono,
        destino_marca / "gobserva-isotipo.svg": iso,
        PUBLICO / "favicon.svg": iso,
    }
    for ruta, svg in archivos.items():
        ruta.write_text(svg + "\n", encoding="utf-8", newline="\n")
        print(f"  {ruta.relative_to(WORKER)}  {len(svg.encode()) // 1024 + 1} KB")

    # Para la portada: el mismo logo con clases (el CSS de la página le pone el color de día o de noche y hace titilar el
    # cursor, como el de «vigía_»).
    interior_pagina = (f'<path class="gl-letras" d="{letras}"/>' + lupa.svg("currentColor", BLANCO)
                       + f'<path class="gl-cursor" d="{cursor}"/>')
    (WORKER / "marca.js").write_text(
        "// Generado por marca/generar_marca.py: no editar a mano. El logo de Gobserva, «gobserva_» con la lupa en la «o»,\n"
        "// como SVG en línea: las clases gl-* toman su color del CSS de la página.\n"
        f'export const LOGO_VIEWBOX = "{vb}";\n'
        f"export const LOGO_INTERIOR = '{interior_pagina}';\n",
        encoding="utf-8",
        newline="\n",
    )
    print("  marca.js")

    print("PNG")
    with sync_playwright() as p:
        nav = p.chromium.launch(channel="chrome")
        pagina = nav.new_page(device_scale_factor=1)
        # El logo de la organización y el de la pantalla de inicio: carbón a sangre (sin esquinas), la lupa al centro.
        guardar_png(dibujar(pagina, isotipo(esquinas=0, lado=512, escala=0.78), 512, 512), PUBLICO / "logo.png", colores=64)
        guardar_png(dibujar(pagina, isotipo(esquinas=0, lado=180, escala=0.78), 180, 180), PUBLICO / "apple-touch-icon.png", colores=64)
        # El favicon: cada tamaño dibujado aparte (no reducido de uno grande), con las esquinas redondeadas.
        tam = [16, 32, 48]
        imgs = [dibujar(pagina, isotipo(lado=t), t, t, transparente=True) for t in tam]
        imgs[-1].save(PUBLICO / "favicon.ico", format="ICO", sizes=[(t, t) for t in tam], append_images=imgs[:-1])
        print(f"  publico/favicon.ico  {(PUBLICO / 'favicon.ico').stat().st_size // 1024 + 1} KB")
        # El logo en PNG para descargar: 2000 px de ancho, fondo transparente.
        for nombre, svg in (("gobserva-logo.png", claro), ("gobserva-logo-oscuro.png", oscuro)):
            ancho_vb, alto_vb = (float(v) for v in vb.split()[2:])
            alto = round(2000 * alto_vb / ancho_vb)
            html = svg.replace("<svg ", f'<svg width="2000" height="{alto}" ', 1)
            guardar_png(dibujar(pagina, html, 2000, alto, transparente=True), destino_marca / nombre)
        guardar_png(dibujar(pagina, isotipo(lado=1024), 1024, 1024, transparente=True), destino_marca / "gobserva-isotipo.png", colores=64)
        # La imagen al compartir.
        guardar_png(dibujar(pagina, og_html(oscuro), 1200, 630), PUBLICO / "og.png", colores=128)
        nav.close()


if __name__ == "__main__":
    main()
