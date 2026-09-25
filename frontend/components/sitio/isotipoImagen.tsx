import { LLAMITA_PATH } from "@/components/marca/Llamita";

/**
 * La identidad para las imágenes que genera `next/og`: el favicon, el ícono de
 * Apple y las tarjetas Open Graph. Satori —el motor que las dibuja— no lee
 * Tailwind ni ejecuta componentes dentro de un `<svg>`, así que acá va el mismo
 * dibujo de components/marca/Isotipo.tsx con elementos SVG planos, y los colores
 * en hex (son los valores de los tokens de tailwind.config.ts; en una imagen no
 * hay clases que valgan).
 *
 * `isotipoSvg` se llama como función, no como `<Componente />`: dentro de un
 * `<svg>` Satori sólo serializa etiquetas, y un componente llegaría sin dibujar.
 */

/** Tokens de tailwind.config.ts, en hex, para las imágenes generadas. */
export const COLOR = {
  granate: "#711C30",
  granateDeep: "#4A1020",
  granate900: "#340B16",
  maiz: "#F0B83C",
  paper: "#FFFFFF",
  ink: "#1E191B",
} as const;

// El anillo del isotipo: los mismos tramos y el mismo orden que Isotipo.tsx
// (textil.achiote, maiz, ladrillo, verde, ocre, anil, maiz, tierra).
const TEJIDO = ["#B7462A", "#E2A460", "#843022", "#3E7B4F", "#C47F3E", "#2D3E6F", "#E2A460", "#95612C"] as const;
const CX = 44;
const CY = 44;
const R = 35.5;
const GROSOR = 11;
const CIRC = 2 * Math.PI * R;
const TRAMOS = 16;
const TRAMO = CIRC / TRAMOS;

/** El isotipo (disco granate, llama blanca, anillo tejido y mango de lupa) en un cuadrado de `lado` px. */
export function isotipoSvg(lado: number) {
  return (
    <svg width={lado} height={lado} viewBox="0 0 100 100">
      {/* Mango: debajo del anillo, como en el logo. */}
      <line x1="68" y1="68" x2="91" y2="91" stroke="#C47F3E" strokeWidth="11" strokeLinecap="round" />
      <line x1="78" y1="78" x2="84" y2="84" stroke="#B7462A" strokeWidth="11" />
      {Array.from({ length: TRAMOS }, (_, i) => (
        <circle
          key={i}
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke={TEJIDO[i % TEJIDO.length]}
          strokeWidth={GROSOR}
          strokeDasharray={`${(TRAMO + 0.4).toFixed(2)} ${(CIRC - TRAMO - 0.4).toFixed(2)}`}
          strokeDashoffset={(-i * TRAMO).toFixed(2)}
        />
      ))}
      <circle cx={CX} cy={CY} r={R - GROSOR / 2 + 0.3} fill={COLOR.granate} />
      <path fillRule="evenodd" fill={COLOR.paper} transform="translate(29.2 21.6) scale(0.41)" d={LLAMITA_PATH} />
    </svg>
  );
}

// La baldosa de components/marca/FranjaTextil.tsx (48 × 12): fondo ladrillo, hilo
// añil arriba y achiote abajo, dos rombos escalonados y granos de ocre.
const BALDOSA =
  "<rect width='48' height='12' fill='#843022'/>" +
  "<rect width='48' height='1' fill='#2D3E6F'/><rect y='11' width='48' height='1' fill='#B7462A'/>" +
  "<rect x='10' y='2' width='4' height='8' fill='#E2A460'/><rect x='8' y='4' width='8' height='4' fill='#E2A460'/>" +
  "<rect x='11' y='5' width='2' height='2' fill='#B7462A'/>" +
  "<rect x='34' y='2' width='4' height='8' fill='#3E7B4F'/><rect x='32' y='4' width='8' height='4' fill='#3E7B4F'/>" +
  "<rect x='35' y='5' width='2' height='2' fill='#E2A460'/>" +
  "<rect x='22' y='5' width='4' height='2' fill='#C47F3E'/><rect x='46' y='5' width='2' height='2' fill='#C47F3E'/><rect x='0' y='5' width='2' height='2' fill='#C47F3E'/>";

/**
 * La franja textil como imagen (data URI), para un `<img>` de Satori: el patrón
 * se repite a lo ancho, escalado al alto pedido. Decorativa.
 */
export function franjaTextilUri(ancho: number, alto: number): string {
  const anchoCaja = ((ancho * 12) / alto).toFixed(2);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${ancho}' height='${alto}' viewBox='0 0 ${anchoCaja} 12' shape-rendering='crispEdges'>` +
    `<defs><pattern id='baldosa' width='48' height='12' patternUnits='userSpaceOnUse'>${BALDOSA}</pattern></defs>` +
    `<rect width='${anchoCaja}' height='12' fill='url(#baldosa)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
