"""La marca de Gobserva: el logo (la «o» es una lupa con nodos), el isotipo, la ilustración de la portada y sus PNG.

Todo sale del contorno de Space Grotesk Bold (OFL, la tipografía de títulos de Vigía, en frontend/app/fuentes): las
letras son las de la fuente y la lupa se dibuja con su mismo grosor. Escribe:

  ../marca.js                           el logo y la ilustración para la portada (worker.js), con clases para día y noche
  ../publico/favicon.svg, favicon.ico   el ícono de la pestaña (16, 32 y 48 px)
  ../publico/apple-touch-icon.png       180 px, para la pantalla de inicio del teléfono
  ../publico/logo.png                   512 px, el logo de la organización para los buscadores (datos estructurados)
  ../publico/og.png                     1200 x 630, la imagen al compartir el enlace (con el mapa de ../publico/mapa-peru.js)
  ../publico/marca/                     el logo en SVG y PNG para descargar (claro, oscuro, a una tinta, isotipo)

Requisitos: fontTools, Pillow y Playwright con Chrome (los PNG se dibujan en el navegador, igual que en la página).
Uso: python marca/generar_marca.py   (desde cualquier carpeta). Las reglas de uso del logo: marca/README.md.
"""
import base64
import io
import json
import math
import re
import sys
import tempfile
from pathlib import Path

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
FUENTE_TITULOS = REPO / "frontend/app/fuentes/space-grotesk.woff2"
FUENTE_TEXTO = REPO / "frontend/app/fuentes/inter.woff2"

# La paleta de la marca (la misma de Vigía).
CARBON = "#0B0F0F"
TINTA = "#111817"
CLARO = "#E7F0EE"
LIMA = "#D4FF3F"
TENUE_OSCURO = "#8FA3A0"

PALABRA = "Gobserva"
LENTE_EN = 1  # la «o»
PESO = 700
TRACKING = -12  # unidades de la fuente entre letras: a tamaño de logo, un poco más juntas que en un texto

# La lupa, en unidades de la fuente (1000 por em). La «o» de Space Grotesk Bold ocupa (46, -14)-(566, 510): su centro
# es (306, 248) y sus astas miden de 112 (arriba y abajo) a 126 (a los lados).
O_CX, O_CY = 306, 248
R_EXT = 283  # la «o» mide 262 de radio: la lupa es un 8 % más grande, para que se lea como lupa y quepan los nodos
ARO = 118  # el grosor del aro: el de las astas
MANGO_LARGO = 150  # cuánto sale el mango del aro
MANGO_GROSOR = 130  # un poco más grueso que el aro, como el mango de una lupa
ANGULO = 45  # el mango, hacia abajo y a la derecha; corte recto, como los remates de la fuente
ESPACIO_MANGO = 60  # aire extra después de la lupa para que el mango no toque la «b»

# Los nodos dentro del vidrio: tres puntos unidos (una empresa, un contrato y una entidad). En radios del vidrio.
NODOS = [(-0.44, 0.26, 0.22), (0.02, -0.44, 0.19), (0.46, 0.22, 0.20)]
ARISTAS = [(0, 1), (1, 2), (0, 2)]
ARISTA = 0.08  # grosor de las aristas, en radios del vidrio


def num(v):
    """Números cortos para el SVG: enteros sin decimales, el resto con uno."""
    r = round(v, 1)
    return str(int(r)) if r == int(r) else f"{r}"


def instancia():
    return instantiateVariableFont(TTFont(FUENTE_TITULOS), {"wght": PESO}, inplace=False)


def kerning(fuente):
    """Pares de kerning (GPOS, PairPos de formato 1 y 2): lo que la fuente ajusta entre dos letras."""
    pares = {}
    for lk in fuente["GPOS"].table.LookupList.Lookup:
        for st in lk.SubTable:
            tipo = lk.LookupType
            if tipo == 9:
                st, tipo = st.ExtSubTable, st.ExtSubTable.LookupType
            if tipo != 2:
                continue
            cobertura = st.Coverage.glyphs
            if st.Format == 1:
                for i, izq in enumerate(cobertura):
                    for rec in st.PairSet[i].PairValueRecord:
                        v = getattr(rec.Value1, "XAdvance", 0) if rec.Value1 else 0
                        if v:
                            pares.setdefault((izq, rec.SecondGlyph), v)
            else:
                c1, c2 = st.ClassDef1.classDefs, st.ClassDef2.classDefs
                for izq in cobertura:
                    fila = st.Class1Record[c1.get(izq, 0)].Class2Record
                    for der in fuente.getGlyphOrder():
                        rec = fila[c2.get(der, 0)]
                        v = getattr(rec.Value1, "XAdvance", 0) if rec.Value1 else 0
                        if v:
                            pares.setdefault((izq, der), v)
    return pares


class Lupa:
    """La geometría de una lupa: centro, radio exterior, grosor del aro y mango."""

    def __init__(self, cx, cy, r_ext, aro, largo, grosor_mango, angulo=ANGULO):
        self.cx, self.cy, self.r_ext, self.aro = cx, cy, r_ext, aro
        self.r_aro = r_ext - aro / 2  # la línea media del aro
        self.r_vidrio = r_ext - aro  # lo que se ve del vidrio
        u = (math.cos(math.radians(angulo)), math.sin(math.radians(angulo)))
        self.p0 = (cx + u[0] * self.r_aro, cy + u[1] * self.r_aro)
        self.p1 = (cx + u[0] * (r_ext + largo), cy + u[1] * (r_ext + largo))
        self.grosor_mango = grosor_mango
        # Las esquinas del corte recto del mango (para la caja del dibujo).
        n = (-u[1], u[0])
        g = grosor_mango / 2
        self.esquinas = [(self.p1[0] + n[0] * g, self.p1[1] + n[1] * g), (self.p1[0] - n[0] * g, self.p1[1] - n[1] * g)]

    def caja(self):
        xs = [self.cx - self.r_ext, self.cx + self.r_ext] + [p[0] for p in self.esquinas]
        ys = [self.cy - self.r_ext, self.cy + self.r_ext] + [p[1] for p in self.esquinas]
        return min(xs), min(ys), max(xs), max(ys)

    def nodos(self):
        k = self.r_vidrio * 0.92
        return [(self.cx + x * k, self.cy + y * k, self.r_vidrio * r) for x, y, r in NODOS]

    def svg(self, c, vidrio=True, nodos=True):
        """c: colores {'aro', 'vidrio', 'nodo'} como atributos; cada pieza lleva su clase (gl-*) para el CSS."""
        s = []
        if vidrio:
            # El vidrio llega hasta la mitad del aro: el aro tapa su borde y no queda una rayita entre los dos.
            s.append(f'<circle class="gl-vidrio" cx="{num(self.cx)}" cy="{num(self.cy)}" r="{num(self.r_aro)}" fill="{c["vidrio"]}"/>')
        s.append(
            f'<path class="gl-aro" d="M{num(self.p0[0])} {num(self.p0[1])}L{num(self.p1[0])} {num(self.p1[1])}" '
            f'stroke="{c["aro"]}" stroke-width="{num(self.grosor_mango)}" fill="none"/>'
        )
        s.append(
            f'<circle class="gl-aro" cx="{num(self.cx)}" cy="{num(self.cy)}" r="{num(self.r_aro)}" '
            f'stroke="{c["aro"]}" stroke-width="{num(self.aro)}" fill="none"/>'
        )
        if nodos:
            pts = self.nodos()
            d = "".join(f"M{num(pts[a][0])} {num(pts[a][1])}L{num(pts[b][0])} {num(pts[b][1])}" for a, b in ARISTAS)
            s.append(
                f'<path class="gl-red" d="{d}" stroke="{c["nodo"]}" stroke-width="{num(self.r_vidrio * ARISTA)}" '
                f'stroke-linecap="round" fill="none"/>'
            )
            for x, y, r in pts:
                s.append(f'<circle class="gl-nodo" cx="{num(x)}" cy="{num(y)}" r="{num(r)}" fill="{c["nodo"]}"/>')
        return "".join(s)


def armar_logo():
    """Las letras (un solo path) y la lupa en el lugar de la «o». Devuelve (viewBox, interior con colores de día)."""
    f = instancia()
    gs, cmap, kern = f.getGlyphSet(), f.getBestCmap(), kerning(f)
    nombres = [cmap[ord(c)] for c in PALABRA]
    pen = SVGPathPen(gs, ntos=num)
    x = 0
    lupa = None
    xs = []
    for i, n in enumerate(nombres):
        avance = f["hmtx"][n][0]
        if i == LENTE_EN:
            lupa = Lupa(x + O_CX, -O_CY, R_EXT, ARO, MANGO_LARGO, MANGO_GROSOR)
            x += avance + ESPACIO_MANGO + TRACKING
            continue
        gs[n].draw(TransformPen(pen, (1, 0, 0, -1, x, 0)))  # la línea de base en y = 0, hacia arriba es negativo
        xs.append((x, n))
        siguiente = nombres[i + 1] if i + 1 < len(nombres) else None
        k = kern.get((n, siguiente), 0) if siguiente and i + 1 != LENTE_EN else 0
        if k:
            print(f"  kerning {n}-{siguiente}: {k}")
        x += avance + k + TRACKING
    letras = pen.getCommands()
    # La caja: de la izquierda de la G a la derecha de la última letra; de la altura de la G al fondo del mango.
    from fontTools.pens.boundsPen import BoundsPen

    xmin, ymin, xmax, ymax = 10**9, 10**9, -(10**9), -(10**9)
    for x0, n in xs:
        bp = BoundsPen(gs)
        gs[n].draw(bp)
        if bp.bounds:
            a, b, c, d = bp.bounds
            xmin, xmax = min(xmin, x0 + a), max(xmax, x0 + c)
            ymin, ymax = min(ymin, -d), max(ymax, -b)
    lx0, ly0, lx1, ly1 = lupa.caja()
    xmin, ymin, xmax, ymax = min(xmin, lx0), min(ymin, ly0), max(xmax, lx1), max(ymax, ly1)
    m = 8
    vb = f"{num(xmin - m)} {num(ymin - m)} {num(xmax - xmin + 2 * m)} {num(ymax - ymin + 2 * m)}"
    return vb, letras, lupa


def logo_svg(vb, letras, lupa, letra, aro, vidrio, nodo, titulo=True):
    interior = f'<path class="gl-letras" d="{letras}" fill="{letra}"/>' + lupa.svg({"aro": aro, "vidrio": vidrio, "nodo": nodo})
    t = "<title>Gobserva</title>" if titulo else ""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="Gobserva">{t}{interior}</svg>'


def isotipo(fondo=LIMA, aro=CARBON, vidrio=LIMA, nodo=CARBON, esquinas=14, lado=64, escala=1.0):
    """La lupa sola en un cuadrado de 64: carbón sobre lima. El dibujo queda centrado por su caja (aro + mango).
    `escala` < 1 deja aire para las máscaras redondas (el ícono del teléfono y el logo de los buscadores)."""
    medidas = [v * escala for v in (19.5, 7.2, 9.5, 8.4)]
    lupa = Lupa(0, 0, *medidas)
    x0, y0, x1, y1 = lupa.caja()
    dx, dy = 32 - (x0 + x1) / 2, 32 - (y0 + y1) / 2
    lupa = Lupa(dx, dy, *medidas)
    rect = f'<rect width="64" height="64" rx="{esquinas}" fill="{fondo}"/>' if fondo else ""
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="{lado}" height="{lado}" role="img" '
        f'aria-label="Gobserva">{rect}{lupa.svg({"aro": aro, "vidrio": vidrio, "nodo": nodo})}</svg>'
    )


# ─── El mapa para la imagen al compartir: el de la portada, con la lupa sobre Lima ─────────────────────────────────
def mapa_og(ancho=390, region="15"):
    """El Perú en puntos (publico/mapa-peru.js, de mapa/generar_mapa.py) con la lupa encima, como SVG."""
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
    lupa = Lupa(cx, cy, ancho * 0.2, ancho * 0.2 * 0.085, ancho * 0.2 * 0.62, ancho * 0.2 * 0.119)
    R, M, base = lupa.r_ext, 1.4, paso * 0.33
    s = []
    for x, y, r in puntos:
        color, rad = ("#58763A" if r == k else "#33443C"), base
        d = math.hypot(x - cx, y - cy)
        if d < R:  # el mismo ojo de pez que publico/portada.js
            u = d / R
            u2 = ((M + 1) * u) / (M * u + 1)
            if d > 0.01:
                x, y = cx + (x - cx) / d * u2 * R, cy + (y - cy) / d * u2 * R
            rad = base * (1 + 1.15 * (1 - u))
            color = LIMA if r == k else "#80A532"
        s.append(f'<circle cx="{num(x)}" cy="{num(y)}" r="{num(rad)}" fill="{color}"/>')
    s.append(f'<circle cx="{num(cx)}" cy="{num(cy)}" r="{num(R)}" fill="{LIMA}" fill-opacity=".07" stroke="{CLARO}" stroke-width="{num(lupa.aro)}"/>')
    s.append(f'<path d="M{num(lupa.p0[0])} {num(lupa.p0[1])}L{num(lupa.p1[0])} {num(lupa.p1[1])}" stroke="{CLARO}" stroke-width="{num(lupa.grosor_mango)}"/>')
    return f'<svg class="mapa" viewBox="0 0 {num(ancho)} {num(alto)}" width="{num(ancho)}" height="{num(alto)}">{"".join(s)}</svg>'


def fuentes_css():
    sg = base64.b64encode(FUENTE_TITULOS.read_bytes()).decode()
    it = base64.b64encode(FUENTE_TEXTO.read_bytes()).decode()
    return (
        f"@font-face{{font-family:'Space Grotesk';src:url(data:font/woff2;base64,{sg}) format('woff2');font-weight:300 700}}"
        f"@font-face{{font-family:Inter;src:url(data:font/woff2;base64,{it}) format('woff2');font-weight:100 900}}"
    )


def dibujar(pagina, html, ancho, alto, transparente=False):
    pagina.set_viewport_size({"width": ancho, "height": alto})
    pagina.set_content(f'<!doctype html><meta charset="utf-8"><style>html,body{{margin:0;background:transparent}}'
                       f"{fuentes_css()}</style>{html}")
    pagina.evaluate("document.fonts.ready")
    pagina.wait_for_timeout(150)
    return Image.open(io.BytesIO(pagina.screenshot(clip={"x": 0, "y": 0, "width": ancho, "height": alto},
                                                   omit_background=transparente)))


def guardar_png(img, ruta, colores=None):
    if colores:
        img = img.convert("RGB").quantize(colors=colores, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    img.save(ruta, optimize=True)
    print(f"  {ruta.relative_to(WORKER)}  {ruta.stat().st_size // 1024} KB")


def og_html(logo_oscuro):
    return f"""<style>
.og{{position:relative;width:1200px;height:630px;background:{CARBON};overflow:hidden;font-family:Inter,sans-serif}}
.og .mapa{{position:absolute;right:96px;top:36px}}
.texto{{position:absolute;left:80px;top:96px;width:620px}}
.texto svg{{height:100px;display:block}}
.eslogan{{margin:44px 0 0;color:{CLARO};font:500 54px/1.08 'Space Grotesk';letter-spacing:-0.02em}}
.desc{{margin:26px 0 0;color:{TENUE_OSCURO};font:500 25px/1.35 Inter;max-width:470px;text-wrap:balance}}
.dominio{{position:absolute;left:80px;bottom:62px;margin:0;color:{LIMA};font:600 24px Inter;letter-spacing:.01em}}
</style>
<div class="og">
  {mapa_og()}
  <div class="texto">{logo_oscuro}
    <p class="eslogan">Lo de todos,<br>a la vista de todos.</p>
    <p class="desc">Tecnología cívica para vigilar el Estado peruano.</p>
  </div>
  <p class="dominio">gobserva.cloud</p>
</div>"""


def main():
    print("Logo")
    vb, letras, lupa = armar_logo()
    destino_marca = PUBLICO / "marca"
    destino_marca.mkdir(parents=True, exist_ok=True)

    claro = logo_svg(vb, letras, lupa, TINTA, TINTA, LIMA, CARBON)
    oscuro = logo_svg(vb, letras, lupa, CLARO, CLARO, LIMA, CARBON)
    # A una tinta: sin vidrio de color (el fondo se ve a través) y los nodos del mismo color que las letras.
    interior_mono = f'<path d="{letras}" fill="{TINTA}"/>' + lupa.svg({"aro": TINTA, "vidrio": "none", "nodo": TINTA}, vidrio=False)
    mono = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" role="img" aria-label="Gobserva"><title>Gobserva</title>{interior_mono}</svg>'
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

    # Para la portada: el mismo logo con clases (el CSS de la página le pone el color de día o de noche). La ilustración de
    # la lupa sobre la red queda sólo en og.png: la portada tiene el mapa (mapa/generar_mapa.py y publico/portada.js).
    interior_pagina = f'<path class="gl-letras" d="{letras}"/>' + lupa.svg({"aro": "currentColor", "vidrio": LIMA, "nodo": CARBON})
    (WORKER / "marca.js").write_text(
        "// Generado por marca/generar_marca.py: no editar a mano. El logo de Gobserva (la «o» es una lupa con nodos), como\n"
        "// SVG en línea: las clases gl-* toman su color del CSS de la página.\n"
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
        # El logo de la organización y el de la pantalla de inicio: lima a sangre (sin esquinas), la lupa al centro.
        a_sangre = isotipo(esquinas=0, lado=512, escala=0.8)
        guardar_png(dibujar(pagina, a_sangre, 512, 512), PUBLICO / "logo.png", colores=64)
        guardar_png(dibujar(pagina, isotipo(esquinas=0, lado=180, escala=0.8), 180, 180), PUBLICO / "apple-touch-icon.png", colores=64)
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
