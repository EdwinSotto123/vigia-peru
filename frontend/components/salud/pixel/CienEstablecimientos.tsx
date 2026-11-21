import { cn } from "@/lib/utils";

/** Una clínica de 5 x 5 píxeles: techo, ventanas y puerta. */
const GLIFO = [".###.", "#####", "#.#.#", "#####", "##.##"];

/** El trazo de una clínica en (x, y), en celdas: cada tramo del mismo carácter, un rectángulo. */
function glifo(ox: number, oy: number): string {
  let d = "";
  GLIFO.forEach((fila, y) => {
    let x = 0;
    while (x < fila.length) {
      if (fila[x] !== "#") {
        x++;
        continue;
      }
      let n = 1;
      while (fila[x + n] === "#") n++;
      d += `M${ox + x} ${oy + y}h${n}v1h-${n}z`;
      x += n;
    }
  });
  return d;
}

/**
 * Cien clínicas de píxeles, diez por fila; las primeras `marcadas` en el color de la sanción firme. Hace legible una
 * proporción («de cada 100, unas 2») sin un porcentaje suelto. Decorativa: la frase de al lado dice el número.
 * Server-safe.
 */
export function CienEstablecimientos({ marcadas, className }: { marcadas: number; className?: string }) {
  const n = Math.max(0, Math.min(100, Math.round(marcadas)));
  let tenues = "";
  let encendidas = "";
  for (let i = 0; i < 100; i++) {
    const d = glifo((i % 10) * 7, Math.floor(i / 10) * 7);
    // Las marcadas, al final de la grilla (abajo a la derecha), donde el ojo termina de leer.
    if (i >= 100 - n) encendidas += d;
    else tenues += d;
  }
  return (
    <svg viewBox="0 0 68 68" width={170} height={170} shapeRendering="crispEdges" aria-hidden focusable="false" className={cn("shrink-0", className)}>
      <path d={tenues} style={{ fill: "rgb(var(--px-linea) / 0.28)" }} />
      <path d={encendidas} style={{ fill: "rgb(var(--rust))" }} />
    </svg>
  );
}
