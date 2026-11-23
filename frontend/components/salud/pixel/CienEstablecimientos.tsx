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
 *
 * Viva (2026-11-22, «portadas vivas»): una franja la recorre de arriba abajo como un escáner, cada fila de clínicas se
 * enciende cuando pasa y, al final, las sancionadas parpadean dos veces (globals.css, `.gs-escaneo`). Para que corra al
 * verla y no al cargar, va dentro de un <AlVer>. Sin animación, se ve completa. Server-safe.
 */
export function CienEstablecimientos({ marcadas, className }: { marcadas: number; className?: string }) {
  const n = Math.max(0, Math.min(100, Math.round(marcadas)));
  const filas = Array.from({ length: 10 }, () => "");
  let encendidas = "";
  for (let i = 0; i < 100; i++) {
    const d = glifo((i % 10) * 7, Math.floor(i / 10) * 7);
    // Las marcadas, al final de la grilla (abajo a la derecha), donde el ojo termina de leer.
    if (i >= 100 - n) encendidas += d;
    else filas[Math.floor(i / 10)] += d;
  }
  return (
    <svg viewBox="0 0 68 68" width={170} height={170} shapeRendering="crispEdges" aria-hidden focusable="false" className={cn("gs-escaneo shrink-0", className)}>
      {filas.map((d, f) =>
        d ? <path key={f} d={d} className="gs-esc-fila" style={{ fill: "rgb(var(--px-linea) / 0.28)", animationDelay: `${f * 110}ms` }} /> : null,
      )}
      <path d={encendidas} className="gs-esc-marca" style={{ fill: "rgb(var(--rust))" }} />
      <rect x="-2" y="-1" width="72" height="6" className="gs-esc-barra" style={{ fill: "rgb(var(--granate) / 0.4)" }} />
    </svg>
  );
}
