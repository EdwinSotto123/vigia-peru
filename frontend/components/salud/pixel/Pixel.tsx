import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { SPRITES, type NombreSprite, type SpritePixel } from "./sprites";

/**
 * Un personaje o ícono de píxeles de Gobserva Salud (components/salud/pixel/sprites.ts): un SVG nítido
 * (`crispEdges`), con un trazo por color y por capa (no un nodo por píxel). Las capas animadas (parpadeo, la pantalla
 * que late, los pasos, el saludo) usan las clases px-* de globals.css, sólo opacidad y a pasos; con movimiento reducido
 * queda el primer cuadro, quieto. Server-safe: no usa estado ni efectos.
 *
 * `acento`: «marca» (el lima de la marca, para figuras sobre el fondo o una banda) o «accion» (el verde de las
 * acciones, legible también sobre una placa clara dentro de una banda).
 */

type Acento = "marca" | "accion";

function colorDe(c: string, acento: Acento): string | null {
  const a = acento === "marca" ? "--marca-acento" : "--granate";
  switch (c) {
    case "#": return "rgb(var(--px-linea))";
    case "=": return "rgb(var(--px-linea) / 0.5)";
    case "+": return "rgb(var(--px-linea) / 0.22)";
    case "L": return `rgb(var(${a}))`;
    case "l": return `rgb(var(${a}) / 0.45)`;
    case "w": return "rgb(var(--px-fondo))";
    case "S": return "rgb(var(--px-piel))";
    case "H": return "rgb(var(--px-pelo))";
    case "k": return "rgb(var(--px-rasgo))";
    case "C": return "rgb(var(--px-bata))";
    default: return null;
  }
}

/** Las filas → un trazo por carácter: cada tramo horizontal del mismo color es un rectángulo «M x y h n v 1 h -n z». */
const memoria = new Map<string, [string, string][]>();
function trazos(filas: readonly string[], marca: boolean): [string, string][] {
  const clave = `${marca ? 1 : 0}|${filas.join("|")}`;
  const ya = memoria.get(clave);
  if (ya) return ya;
  const porColor = new Map<string, string[]>();
  filas.forEach((fila, y) => {
    let x = 0;
    while (x < fila.length) {
      let c = fila[x];
      if (c === ".") {
        x++;
        continue;
      }
      let n = 1;
      while (x + n < fila.length && fila[x + n] === c) n++;
      if (marca) c = c === "#" ? "L" : c === "+" ? "l" : c;
      const lista = porColor.get(c) ?? [];
      lista.push(`M${x} ${y}h${n}v1h-${n}z`);
      porColor.set(c, lista);
      x += n;
    }
  });
  const salida = [...porColor.entries()].map(([c, ds]) => [c, ds.join("")] as [string, string]);
  memoria.set(clave, salida);
  return salida;
}

export function Pixel({
  nombre,
  escala = 4,
  className,
  titulo,
  animado = true,
  acento = "marca",
  retardo,
  style,
}: {
  nombre: NombreSprite;
  /** Lado de cada píxel, en px CSS. */
  escala?: number;
  className?: string;
  /** Si el dibujo dice algo que no está en el texto de al lado; si no, es decorativo (aria-hidden). */
  titulo?: string;
  /** Sin animación: el primer cuadro, quieto (las capas que alternan quedan en su cuadro A). */
  animado?: boolean;
  acento?: Acento;
  /** Retardo de las capas animadas, en ms (para que dos personajes no parpadeen a la vez). */
  retardo?: number;
  style?: CSSProperties;
}) {
  const s: SpritePixel = SPRITES[nombre];
  const ancho = s.base[0].length;
  const alto = s.base.length;
  const marca = !!s.marca;
  const pintar = (filas: readonly string[]) =>
    trazos(filas, marca).map(([c, d]) => {
      const fill = colorDe(c, acento);
      return fill ? <path key={c} d={d} style={{ fill }} /> : null;
    });
  return (
    <svg
      viewBox={`0 0 ${ancho} ${alto}`}
      width={ancho * escala}
      height={alto * escala}
      shapeRendering="crispEdges"
      className={cn("shrink-0", className)}
      style={style}
      {...(titulo ? { role: "img", "aria-label": titulo } : { "aria-hidden": true })}
      focusable="false"
    >
      {titulo && <title>{titulo}</title>}
      {pintar(s.base)}
      {s.capas.map((c) => {
        // Quieto: el cuadro B de lo que alterna no se dibuja; lo demás (los ojos, la pantalla) queda encendido.
        if (!animado && (c.anim === "alternaB" || c.anim === "saludaB")) return null;
        return (
          <g
            key={c.nombre}
            className={animado ? cn("px-anim", `px-${c.anim}`) : undefined}
            style={animado && retardo ? { animationDelay: `${retardo}ms` } : undefined}
          >
            {pintar(c.filas)}
          </g>
        );
      })}
    </svg>
  );
}
