import { cn } from "@/lib/utils";

/**
 * La franja textil (DESIGN_SYSTEM.md §6): una banda de rombos escalonados —el
 * tocapu de la manta andina— en la paleta del tejido del isotipo. Es un patrón
 * SVG repetible (no una imagen): pesa cientos de bytes y escala con su alto.
 *
 * Reglas: 4 px en la cabecera (la firma del sitio); una franja más por pantalla
 * como mucho; nunca detrás de texto, en tablas, formularios ni informes (el
 * informe es evidencia, no decoración). Siempre decorativa.
 */

// Baldosa de 48 × 12: fondo ladrillo, hilo añil arriba y achiote abajo, dos rombos
// escalonados que alternan (maíz con corazón de achiote; verde con corazón de maíz)
// y un grano de ocre entre ellos: el ritmo de la manta del isotipo.
const BALDOSA = `<svg xmlns='http://www.w3.org/2000/svg' width='48' height='12' viewBox='0 0 48 12' shape-rendering='crispEdges'>
<rect width='48' height='12' fill='#843022'/>
<rect width='48' height='1' fill='#2D3E6F'/><rect y='11' width='48' height='1' fill='#B7462A'/>
<rect x='10' y='2' width='4' height='8' fill='#E2A460'/><rect x='8' y='4' width='8' height='4' fill='#E2A460'/>
<rect x='11' y='5' width='2' height='2' fill='#B7462A'/>
<rect x='34' y='2' width='4' height='8' fill='#3E7B4F'/><rect x='32' y='4' width='8' height='4' fill='#3E7B4F'/>
<rect x='35' y='5' width='2' height='2' fill='#E2A460'/>
<rect x='22' y='5' width='4' height='2' fill='#C47F3E'/><rect x='46' y='5' width='2' height='2' fill='#C47F3E'/><rect x='0' y='5' width='2' height='2' fill='#C47F3E'/>
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
