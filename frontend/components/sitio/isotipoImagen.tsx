import { PUNTOS_OJO } from "@/components/marca/OjoPixel";

/**
 * La identidad para las imágenes que genera `next/og`: el favicon, el ícono de
 * Apple y las tarjetas Open Graph. Satori (el motor que las dibuja) no lee Tailwind
 * ni ejecuta componentes dentro de un `<svg>`, así que acá va el mismo dibujo de
 * components/marca/OjoPixel.tsx con elementos SVG planos, y los colores en hex
 * (valores de las variables de globals.css; en una imagen no hay clases que valgan).
 *
 * `isotipoSvg` se llama como función, no como `<Componente />`: dentro de un
 * `<svg>` Satori sólo serializa etiquetas, y un componente llegaría sin dibujar.
 */

/** Colores de la identidad Píxel, en hex, para las imágenes generadas. Los nombres
 *  son los históricos: `granate*` es el fondo carbón de las tarjetas y `maiz` el lima. */
export const COLOR = {
  granate: "#0B0F0F",
  granateDeep: "#070A0A",
  granate900: "#050808",
  maiz: "#D4FF3F",
  paper: "#FFFFFF",
  ink: "#0B0F0F",
} as const;

/** El ojo de puntos sobre un cuadrado carbón de esquinas redondeadas, en `lado` px. */
export function isotipoSvg(lado: number) {
  return (
    <svg width={lado} height={lado} viewBox="0 0 100 100">
      <rect width="100" height="100" rx="22" fill={COLOR.granate} />
      {PUNTOS_OJO.map((p, k) => (
        <circle
          key={k}
          cx={(p.x * 100) / 11}
          cy={50 + (p.y - 2.5) * (100 / 11)}
          r={(0.42 * 100) / 11}
          fill={p.pupila ? "#FFFFFF" : COLOR.maiz}
        />
      ))}
    </svg>
  );
}

/**
 * La franja de puntos como imagen (data URI), para un `<img>` de Satori: la baldosa se
 * repite a lo ancho, escalada al alto pedido. Decorativa. Conserva el nombre histórico.
 */
export function franjaTextilUri(ancho: number, alto: number): string {
  const anchoCaja = ((ancho * 12) / alto).toFixed(2);
  const baldosa =
    "<rect width='28' height='12' fill='#0B0F0F'/>" +
    "<circle cx='7' cy='4.5' r='2.6' fill='#D4FF3F'/><circle cx='21' cy='7.5' r='1.4' fill='#E7F0EE'/>";
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${ancho}' height='${alto}' viewBox='0 0 ${anchoCaja} 12'>` +
    `<defs><pattern id='baldosa' width='28' height='12' patternUnits='userSpaceOnUse'>${baldosa}</pattern></defs>` +
    `<rect width='${anchoCaja}' height='12' fill='url(#baldosa)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
