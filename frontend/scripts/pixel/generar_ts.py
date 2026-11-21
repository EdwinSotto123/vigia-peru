import json, pathlib, tempfile
S = json.loads((pathlib.Path(tempfile.gettempdir()) / "pixel-gobserva" / "sprites.json").read_text(encoding="utf-8"))
def ts(k):
    if k.startswith("icono_"):
        r = k[6:]
        return "icono" + r[0].upper() + r[1:]
    return k
out = ['/**',
' * Los personajes, lugares e íconos de píxeles de Gobserva (Salud, Empleo, Licitaciones, Obras), en el mundo Píxel:',
' * hechos de cuadros, como el ojo de la marca. Cada sprite es una lista de filas; cada carácter, un píxel:',
' *   .  vacío            #  línea (contorno, edificio)     =  línea media     +  línea tenue (relleno)',
' *   L  marca (ropa, casco, acentos)                      l  marca tenue     w  el fondo (ventanas, pantalla)',
' *   S  piel             H  pelo, zapatos, madera, cartón k  rasgos (ojos, boca, celular)   C  bata, papel',
' * Los colores son variables de globals.css (--px-*, --marca-acento): siguen al modo día o noche y a las bandas.',
' * Las capas se dibujan encima de la base y se animan con las clases px-* de globals.css (a pasos: el píxel no se',
' * desliza). Un ícono (`marca: true`) se pinta entero en el color de la marca: «#» fuerte y «+» tenue.',
' * Generado por frontend/scripts/pixel/arte.py, la fuente del arte: no editar a mano; cambia el arte ahí y corre el script.',
' */',
'',
'export type AnimPixel = "parpadeo" | "late" | "alternaA" | "alternaB" | "saludaA" | "saludaB";',
'export interface CapaPixel { nombre: string; anim: AnimPixel; filas: readonly string[] }',
'export interface SpritePixel { base: readonly string[]; capas: readonly CapaPixel[]; marca?: boolean }',
'',
'export const SPRITES = {']
for k, s in S.items():
    out.append(f'  {ts(k)}: {{')
    if s.get("marca"): out.append('    marca: true,')
    out.append('    base: [')
    out += [f'      "{r}",' for r in s["base"]]
    out.append('    ],')
    if s["capas"]:
        out.append('    capas: [')
        for c in s["capas"]:
            out.append(f'      {{ nombre: "{c["nombre"]}", anim: "{c["anim"]}", filas: [')
            out += [f'        "{r}",' for r in c["filas"]]
            out.append('      ] },')
        out.append('    ],')
    else:
        out.append('    capas: [],')
    out.append('  },')
out.append('} satisfies Record<string, SpritePixel>;')
out.append('')
out.append('export type NombreSprite = keyof typeof SPRITES;')
out.append('')
p = pathlib.Path(__file__).resolve().parents[2] / "components" / "pixel" / "sprites.ts"
p.write_text("\n".join(out), encoding="utf-8")
print(len(S), "sprites,", p.stat().st_size, "bytes")
