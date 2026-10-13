import { cn } from "@/lib/utils";

/**
 * El ojo de Vigía (identidad Píxel): un ojo hecho de puntos, como una trama de datos.
 * Once columnas por cinco filas; los puntos del párpado son la marca (lima) y la
 * pupila, en cruz, es blanca y late.
 *
 * Es la fuente única del dibujo: `Isotipo` (estático, para cabecera, pie y favicon) y
 * la portada (animado, entra desde el centro) usan este mismo componente.
 *
 * `animado` sólo usa transform y CSS: el servidor siempre pinta el ojo completo y, si
 * el CSS de la animación no corre, queda a la vista igual (nada nace con opacity 0).
 */

const FILAS = [
  "...XXXXX...",
  ".XXX.A.XXX.",
  "XX..AAA..XX",
  ".XXX.A.XXX.",
  "...XXXXX...",
] as const;

const COLS = 11;
const ALTO = FILAS.length;

type Punto = { x: number; y: number; pupila: boolean; retardo: number };

/** Los puntos con su retardo de entrada: crece desde el centro hacia afuera. */
export const PUNTOS_OJO: Punto[] = FILAS.flatMap((fila, j) =>
  [...fila].flatMap((c, i) => {
    if (c === ".") return [];
    const d = Math.hypot(i - (COLS - 1) / 2, (j - (ALTO - 1) / 2) * 1.6);
    return [{ x: i + 0.5, y: j + 0.5, pupila: c === "A", retardo: Math.round(d * 70) }];
  }),
);

export function OjoPixel({
  tamano = 44,
  className,
  titulo,
  animado = false,
  tono = "oscuro",
}: {
  /** Ancho en px; el alto sigue la proporción 11 : 5. */
  tamano?: number;
  className?: string;
  titulo?: string;
  /** Entrada desde el centro y pupila que late. */
  animado?: boolean;
  /** `oscuro`: para fondos oscuros (lima y blanco). `claro`: para placas claras (carbón y lima oscuro).
   *  `actual`: todo en `currentColor` (la pupila más tenue), para estados vacíos y de carga. */
  tono?: "oscuro" | "claro" | "actual";
}) {
  const marca = tono === "actual" ? "currentColor" : tono === "oscuro" ? "#D4FF3F" : "#0B0F0F";
  const pupila = tono === "actual" ? "currentColor" : tono === "oscuro" ? "#FFFFFF" : "#3E5C08";
  return (
    <svg
      viewBox={`0 0 ${COLS} ${ALTO}`}
      width={tamano}
      height={(tamano * ALTO) / COLS}
      className={cn("shrink-0 overflow-visible", className)}
      {...(titulo ? { role: "img", "aria-label": titulo } : { "aria-hidden": true })}
      focusable="false"
    >
      {titulo && <title>{titulo}</title>}
      {PUNTOS_OJO.map((p, k) => (
        <circle
          key={k}
          cx={p.x}
          cy={p.y}
          r={0.42}
          fill={p.pupila ? pupila : marca}
          fillOpacity={tono === "actual" && p.pupila ? 0.55 : undefined}
          style={
            animado
              ? {
                  transformBox: "fill-box",
                  transformOrigin: "center",
                  animation: p.pupila
                    ? `puntoEntra 480ms cubic-bezier(0.22,1,0.36,1) ${p.retardo}ms backwards, pupilaLatido 2.4s ease-in-out ${p.retardo + 1400}ms infinite`
                    : `puntoEntra 480ms cubic-bezier(0.22,1,0.36,1) ${p.retardo}ms backwards`,
                }
              : undefined
          }
        />
      ))}
    </svg>
  );
}
