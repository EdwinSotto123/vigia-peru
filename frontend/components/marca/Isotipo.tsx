import { cn } from "@/lib/utils";
import { LLAMITA_PATH } from "./Llamita";

/**
 * El isotipo de Vigía (DESIGN_SYSTEM.md §2.2): la lupa del logo en SVG. Disco
 * granate con la llama blanca, anillo tejido en la paleta textil del isotipo
 * original y mango de lupa. Reemplaza al PNG/WebP en la interfaz: nítido en
 * cualquier tamaño, sin optimizador de imágenes y sin caché fría tras un deploy.
 *
 * Por debajo de 24 px el anillo se vuelve ruido: ahí va `<Llamita />` sola.
 * Sin `titulo` es decorativo; como marca, `titulo="Vigía Perú"`.
 */

// Paleta del anillo: muestreada del tejido del isotipo (tailwind: textil.*).
const TEJIDO = ["#B7462A", "#E2A460", "#843022", "#3E7B4F", "#C47F3E", "#2D3E6F", "#E2A460", "#95612C"] as const;
const CX = 44;
const CY = 44;
const R = 35.5;
const GROSOR = 11;
const CIRC = 2 * Math.PI * R;
const TRAMOS = 16;
const TRAMO = CIRC / TRAMOS;

export function Isotipo({ tamano = 32, className, titulo }: { tamano?: number; className?: string; titulo?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={tamano}
      height={tamano}
      className={cn("shrink-0", className)}
      {...(titulo ? { role: "img", "aria-label": titulo } : { "aria-hidden": true })}
      focusable="false"
    >
      {titulo && <title>{titulo}</title>}
      {/* Mango: debajo del anillo, como en el logo. */}
      <line x1="68" y1="68" x2="91" y2="91" stroke="#C47F3E" strokeWidth="11" strokeLinecap="round" />
      <line x1="78" y1="78" x2="84" y2="84" stroke="#B7462A" strokeWidth="11" />
      {/* Anillo tejido: tramos de color de la manta, sin huecos. */}
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
      {/* Disco granate y la llama blanca, mirando hacia adelante. */}
      <circle cx={CX} cy={CY} r={R - GROSOR / 2 + 0.3} fill="#711C30" />
      <path fillRule="evenodd" fill="#FFFFFF" transform="translate(29.2 21.6) scale(0.41)" d={LLAMITA_PATH} />
    </svg>
  );
}
