import { cn } from "@/lib/utils";

/**
 * La franja de puntos (identidad Píxel): una hilera de puntos lima y blancos, como la
 * trama del ojo. Mantiene el nombre `FranjaTextil` y su API (la cabecera, el pie y
 * varias portadas ya la importaban). Es un patrón SVG repetible, no una imagen.
 *
 * Reglas: 4 px en la cabecera (la firma del sitio); una franja más por pantalla como
 * mucho; nunca detrás de texto, en tablas, formularios ni informes. Decorativa.
 */

// Baldosa de 28 x 12: un punto lima grande y uno blanco pequeño debajo, sobre carbón.
const BALDOSA = `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='12' viewBox='0 0 28 12'>
<rect width='28' height='12' fill='#0B0F0F'/>
<circle cx='7' cy='4.5' r='2.6' fill='#D4FF3F'/><circle cx='21' cy='7.5' r='1.4' fill='#E7F0EE'/>
</svg>`;

const FONDO = `url("data:image/svg+xml,${encodeURIComponent(BALDOSA.replace(/\n/g, ""))}")`;

const ALTOS = { 4: "h-1", 8: "h-2", 12: "h-3", 16: "h-4" } as const;

export function FranjaTextil({ alto = 8, className }: { alto?: keyof typeof ALTOS; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("w-full bg-repeat-x", ALTOS[alto], className)}
      style={{ backgroundImage: FONDO, backgroundSize: "auto 100%" }}
    />
  );
}

/**
 * La bandera, en una línea: rojo-blanco-rojo (DESIGN_SYSTEM.md §3.5). Sólo en el
 * pie y en el sello "Hecho en Perú". El rojo Perú no se usa en ningún otro lugar:
 * en este producto el rojo significa riesgo.
 */
export function FranjaBandera({ className }: { className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex h-[3px] w-9 overflow-hidden rounded-full ring-1 ring-line", className)}>
      <span className="flex-1 bg-rojoPeru" />
      <span className="flex-1 bg-paper" />
      <span className="flex-1 bg-rojoPeru" />
    </span>
  );
}
