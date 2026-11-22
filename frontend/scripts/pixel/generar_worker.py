"""Escribe personajes.js para el Worker de gobserva.cloud (gobserva-redirect) con los sprites que usa su portada."""
import json, pathlib, tempfile

S = json.loads((pathlib.Path(tempfile.gettempdir()) / "pixel-gobserva" / "sprites.json").read_text(encoding="utf-8"))
USADOS = ["vecina", "clinica", "postulante", "tablero", "emprendedora", "camion", "obrero", "grua", "vigia", "auto"]

out = [
    "// Los personajes de píxeles de Gobserva (frontend/components/pixel/sprites.ts), para la portada de gobserva.cloud:",
    "// la misma gente hecha de cuadros que vive en cada producto. Generado por frontend/scripts/pixel/arte.py; no editar a",
    "// mano: cambia el arte ahí y vuelve a generar. personaje() los vuelve SVG nítido, un trazo por color y por capa; los colores son",
    "// variables del CSS de la portada (--px-*), que siguen al modo día o noche, y las capas animadas usan las clases px-*",
    "// (a pasos; con movimiento reducido, quietas).",
    "",
    "const SPRITES = {",
]
for k in USADOS:
    s = S[k]
    out.append(f"  {k}: {{")
    out.append("    base: [" + ", ".join(f'"{r}"' for r in s["base"]) + "],")
    out.append("    capas: [")
    for c in s["capas"]:
        out.append(f'      {{ anim: "{c["anim"]}", filas: [' + ", ".join(f'"{r}"' for r in c["filas"]) + "] },")
    out.append("    ],")
    out.append("  },")
out.append("};")
out.append("""
const COLOR = {
  "#": "fill:var(--px-linea)",
  "=": "fill:var(--px-linea);fill-opacity:.5",
  "+": "fill:var(--px-linea);fill-opacity:.22",
  L: "fill:var(--px-marca)",
  l: "fill:var(--px-marca);fill-opacity:.45",
  w: "fill:var(--px-fondo)",
  S: "fill:var(--px-piel)",
  H: "fill:var(--px-pelo)",
  k: "fill:var(--px-rasgo)",
  C: "fill:var(--px-bata)",
};

function trazos(filas) {
  const porColor = {};
  filas.forEach((fila, y) => {
    let x = 0;
    while (x < fila.length) {
      const c = fila[x];
      if (c === ".") { x++; continue; }
      let n = 1;
      while (x + n < fila.length && fila[x + n] === c) n++;
      (porColor[c] ??= []).push(`M${x} ${y}h${n}v1h-${n}z`);
      x += n;
    }
  });
  return Object.entries(porColor).map(([c, ds]) => (COLOR[c] ? `<path style="${COLOR[c]}" d="${ds.join("")}"/>` : "")).join("");
}

/** Un personaje o lugar como SVG (decorativo): `escala` px por cuadro. */
export function personaje(nombre, escala = 4, clase = "", retardo = 0) {
  const s = SPRITES[nombre];
  const w = s.base[0].length;
  const h = s.base.length;
  const capas = s.capas
    .map((c) => `<g class="px-anim px-${c.anim}"${retardo ? ` style="animation-delay:${retardo}ms"` : ""}>${trazos(c.filas)}</g>`)
    .join("");
  return `<svg class="px-sprite ${clase}" viewBox="0 0 ${w} ${h}" width="${w * escala}" height="${h * escala}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${trazos(s.base)}${capas}</svg>`;
}
""")
p = pathlib.Path(__file__).resolve().parents[3] / "infrastructure" / "deploy" / "cloudflare" / "gobserva-redirect" / "personajes.js"
p.write_text("\n".join(out), encoding="utf-8")
print(p.stat().st_size, "bytes")
