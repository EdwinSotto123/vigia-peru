"""El color de cada producto de Gobserva (2026-11-21: el dueño eligió «un color por producto»; antes todos eran lima).

Una sola fuente para los cuatro colores. Este script:
  1. comprueba el contraste de cada par que se lee (texto y botones, de noche, de día y en las bandas);
  2. deriva la escala de cada color (los tintes `granate-50…900` de tailwind.config.ts) y escribe el bloque de CSS que pisa
     los tokens de la marca dentro de `[data-producto="…"]`, entre las marcas de app/globals.css;
  3. escribe lib/colores-producto.ts (para lo que no tiene CSS: la imagen para compartir de cada producto);
  4. escribe el bloque de las puertas de gobserva.cloud (infrastructure/deploy/cloudflare/gobserva-redirect/worker.js).

`data-producto` lo pone lib/modoScript.ts en <html> antes de pintar (por el subdominio o, en DEV, por la ruta) y, sin
JavaScript, el marco del producto (MarcoProducto, MarcoApp). La base (carbón de noche, gris claro de día) y los colores
de estado (rojo de la sanción, ámbar de la denuncia, verde menta de lo verificado) no cambian: el lima queda para
Gobserva (gobserva.cloud) y Vigía.

Uso (desde frontend/): python scripts/colores/colores_producto.py
"""
import pathlib
import sys

FRONT = pathlib.Path(__file__).resolve().parents[2]
RAIZ = FRONT.parent
CSS = FRONT / "app" / "globals.css"
TS = FRONT / "lib" / "colores-producto.ts"
WORKER = RAIZ / "infrastructure" / "deploy" / "cloudflare" / "gobserva-redirect" / "worker.js"

# noche: el acento sobre el carbón (botón con texto carbón); dia: la acción (botón con texto blanco); banda: el fondo de
# las bandas de día (el héroe, el pie, el cierre); banda_acento: lo que resalta sobre ella (el título, el botón).
PRODUCTOS = {
    "salud": dict(nombre="turquesa", noche="#3EE6C9", dia="#0A7266", banda="#073B36", banda_acento="#8AF3E1"),
    "empleo": dict(nombre="violeta", noche="#B9A0FF", dia="#5B35C9", banda="#24154D", banda_acento="#D6C9FF"),
    "licitaciones": dict(nombre="azul", noche="#6DB4FF", dia="#1D5DB8", banda="#0B2748", banda_acento="#A8D1FF"),
    "obras": dict(nombre="naranja", noche="#FF9A55", dia="#A9480C", banda="#3B1C09", banda_acento="#FFC08F"),
}

# La base que no cambia (globals.css): el carbón de noche, sus bandas, el papel y el fondo de día, las placas claras.
CARBON = "#0B0F0F"
CARBON_BANDA = "#040707"
TINTA_NOCHE = "#E7F0EE"
BLANCO = "#FFFFFF"
NEGRO = "#000000"
FONDO_DIA = "#F2F4F3"
PLACA = "#E7F0EE"  # una placa clara dentro de una banda (la burbuja de la escena)


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def hexa(c):
    return "#" + "".join(f"{round(x):02X}" for x in c)


def mezcla(a, b, t):
    """`t` de `a` y el resto de `b`."""
    ca, cb = rgb(a), rgb(b)
    return hexa(tuple(x * t + y * (1 - t) for x, y in zip(ca, cb)))


def tri(h):
    return " ".join(str(x) for x in rgb(h))


def lum(h):
    def c(v):
        v /= 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (c(x) for x in rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contraste(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def escala(p):
    """Los tokens de cada modo, derivados de los cuatro colores del producto."""
    n, d, b, ba = p["noche"], p["dia"], p["banda"], p["banda_acento"]
    noche = {
        "granate": n,
        "granate-50": mezcla(n, CARBON, 0.06),
        "granate-soft": mezcla(n, CARBON, 0.12),
        "granate-200": mezcla(n, CARBON, 0.36),
        "granate-300": mezcla(n, CARBON, 0.64),
        "granate-400": mezcla(n, CARBON, 0.82),
        "granate-500": mezcla(n, BLANCO, 0.6),
        "granate-700": mezcla(n, NEGRO, 0.7),
        "granate-deep": mezcla(n, NEGRO, 0.86),
        "granate-900": mezcla(n, CARBON, 0.04),
        "maiz": n,
        "maiz-soft": mezcla(n, CARBON, 0.12),
        "marca-acento": n,
        "acento": n,
        "acento-soft": mezcla(n, CARBON, 0.08),
        "acento-borde": mezcla(n, CARBON, 0.36),
    }
    banda_noche = {
        # Dentro de una banda: el acento de una placa clara (la burbuja) y el casi negro de la banda, teñido.
        "granate": d,
        "granate-soft": mezcla(d, BLANCO, 0.16),
        "granate-50": mezcla(d, BLANCO, 0.07),
        "granate-deep": mezcla(n, CARBON_BANDA, 0.05),
    }
    dia = {
        "granate": d,
        "granate-50": mezcla(d, BLANCO, 0.06),
        "granate-soft": mezcla(d, BLANCO, 0.15),
        "granate-200": mezcla(d, BLANCO, 0.4),
        "granate-300": mezcla(d, BLANCO, 0.62),
        "granate-400": mezcla(d, BLANCO, 0.82),
        "granate-500": mezcla(d, NEGRO, 0.75),
        "granate-700": mezcla(d, NEGRO, 0.82),
        "granate-deep": mezcla(d, NEGRO, 0.78),
        "granate-900": b,
        "maiz": d,
        "maiz-soft": mezcla(d, BLANCO, 0.15),
        "marca-acento": d,
        "marca-pupila": b,
        "acento": d,
        "acento-soft": mezcla(d, BLANCO, 0.08),
        "acento-borde": mezcla(d, BLANCO, 0.45),
    }
    banda_dia = {
        "ink": b,
        "granate-deep": b,
        "granate-900": b,
        "maiz": ba,
        "maiz-soft": mezcla(ba, BLANCO, 0.45),
        "marca-acento": ba,
        "marca-nota": mezcla(b, BLANCO, 0.25),
        "sobre-maiz": b,
        "px-fondo": b,
    }
    return noche, banda_noche, dia, banda_dia


def revisar():
    """Cada par que se lee, a 4,5:1 o más. Devuelve las líneas del informe y si todo pasó."""
    filas, ok = [], True
    for clave, p in PRODUCTOS.items():
        n, d, b, ba = p["noche"], p["dia"], p["banda"], p["banda_acento"]
        pares = [
            ("noche: acento sobre carbón", n, CARBON),
            ("noche: carbón sobre el botón", CARBON, n),
            ("día: blanco sobre el botón", BLANCO, d),
            ("día: enlace sobre el fondo", d, FONDO_DIA),
            ("banda: acento sobre la banda", ba, b),
            ("banda: la banda sobre su botón", b, ba),
            ("banda: blanco sobre la banda", BLANCO, b),
            ("placa: acento sobre la placa", d, PLACA),
        ]
        malos = [(k, contraste(x, y)) for k, x, y in pares if contraste(x, y) < 4.5]
        ok = ok and not malos
        filas.append(f"{clave:13} {p['nombre']:9} " + "  ".join(f"{contraste(x, y):.1f}" for _, x, y in pares) + ("" if not malos else f"   BAJO: {malos}"))
    return filas, ok


def bloque_css():
    l = [
        "/* ── Color por producto: inicio. Generado por scripts/colores/colores_producto.py: no editar a mano. ──────────",
        "   Cada producto de Gobserva con su color (2026-11-21): Salud turquesa, Empleo violeta, Licitaciones azul, Obras",
        "   naranja. `data-producto` va en <html> (lib/modoScript.ts) y en el marco del producto. Sólo cambian los tokens de",
        "   la marca (granate, maiz, marca-acento, acento); la base y los colores de estado son los de arriba. */",
    ]

    def regla(selectores, tokens):
        l.append(",\n".join(selectores) + " {")
        l.extend(f"  --{k}: {tri(v)};" for k, v in tokens.items())
        l.append("}")

    for clave, p in PRODUCTOS.items():
        noche, banda_noche, dia, banda_dia = escala(p)
        a = f'[data-producto="{clave}"]'
        bandas = ":is(.bg-ink, .bg-granate-deep, .sobre-oscuro)"
        regla([a], noche)
        regla([f"{a} .sobre-oscuro"], banda_noche)
        regla([f'html[data-modo="dia"]{a}', f'html[data-modo="dia"] {a}'], dia)
        regla([f'html[data-modo="dia"]{a} {bandas}', f'html[data-modo="dia"] {a} {bandas}'], banda_dia)
    l.append("/* ── Color por producto: fin ── */")
    return "\n".join(l) + "\n"


def bloque_ts():
    filas = "\n".join(
        f'  {k}: {{ noche: "{p["noche"]}", dia: "{p["dia"]}", banda: "{p["banda"]}", bandaAcento: "{p["banda_acento"]}" }},' for k, p in PRODUCTOS.items()
    )
    return f"""// Generado por scripts/colores/colores_producto.py: no editar a mano.
import type {{ Producto }} from "./gobserva";

/**
 * El color de cada producto de Gobserva (2026-11-21), para lo que no lee los tokens de CSS (la imagen para compartir).
 * `noche`: el acento sobre carbón; `dia`: la acción sobre blanco; `banda` y `bandaAcento`: las bandas de día.
 */
export const COLOR_PRODUCTO: Record<Producto, {{ noche: string; dia: string; banda: string; bandaAcento: string }}> = {{
{filas}
}};
"""


def bloque_worker():
    l = ["/* Color por producto (generado por frontend/scripts/colores/colores_producto.py): cada puerta lleva el color de su producto. */"]
    for clave, p in PRODUCTOS.items():
        l.append(f'.puerta[data-producto="{clave}"] {{ --px-marca: {p["noche"]}; --fosforo: {p["noche"]}; }}')
    for clave, p in PRODUCTOS.items():
        l.append(f':root[data-modo="dia"] .puerta[data-producto="{clave}"] {{ --px-marca: {p["dia"]}; --fosforo: {p["dia"]}; }}')
    l.append("/* Color por producto: fin */")
    return "\n".join(l) + "\n"


def entre_marcas(texto, inicio, fin, nuevo, al_final=True):
    if inicio in texto:
        i = texto.index(inicio)
        j = texto.index(fin, i) + len(fin)
        # La línea de la marca de fin entera.
        j = texto.index("\n", j) + 1 if "\n" in texto[j:] else len(texto)
        return texto[:i] + nuevo + texto[j:]
    return texto.rstrip("\n") + "\n\n" + nuevo if al_final else nuevo + texto


def main():
    filas, ok = revisar()
    print("contrastes (noche acento/carbón, carbón/botón, día blanco/botón, enlace/fondo, banda acento, banda/botón, blanco/banda, placa):")
    print("\n".join(filas))
    if not ok:
        sys.exit("Hay pares bajo 4,5:1: no se escribe nada.")
    css = CSS.read_text(encoding="utf-8")
    CSS.write_text(entre_marcas(css, "/* ── Color por producto: inicio", "/* ── Color por producto: fin ── */", bloque_css()), encoding="utf-8")
    TS.write_text(bloque_ts(), encoding="utf-8")
    w = WORKER.read_text(encoding="utf-8")
    marca_css = "* { box-sizing: border-box; }"
    inicio, fin = "/* Color por producto (generado", "/* Color por producto: fin */"
    if inicio in w:
        w = entre_marcas(w, inicio, fin, bloque_worker())
    else:
        assert w.count(marca_css) == 1, "no encuentro dónde poner el bloque en worker.js"
        w = w.replace(marca_css, bloque_worker() + marca_css)
    WORKER.write_text(w, encoding="utf-8")
    print("escritos:", CSS.relative_to(RAIZ), TS.relative_to(RAIZ), WORKER.relative_to(RAIZ))


if __name__ == "__main__":
    main()
