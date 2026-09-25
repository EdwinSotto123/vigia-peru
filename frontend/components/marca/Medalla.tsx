import { cn } from "@/lib/utils";
import { LLAMITA_PATH } from "./Llamita";

/**
 * La medalla del ranking de aliados (DESIGN_SYSTEM.md §2.5 y §14.6): la llamita del
 * logo grabada en un disco de oro, plata o bronce; el primer puesto lleva corona.
 *
 * Es la ÚNICA excepción a "una llamita por pantalla": en el podio la llamita no
 * acompaña un estado, es el trofeo. Nunca se usa fuera del ranking ni junto a una
 * señal, una entidad o una persona señalada.
 *
 * Server-safe (SVG puro). `animada`: la medalla sube y la corona cae cuando el podio
 * entra en pantalla — el disparo lo hace `PodioEscena` (`data-visto` en el grupo
 * `podio`). Hasta entonces, y con movimiento reducido, se ve quieta y completa.
 */

// Clases literales: se activan sólo dentro de un `group/podio` con data-visto=true.
const ANIM_MEDALLA = "motion-safe:group-data-[visto=true]/podio:animate-medallaAparece";
const ANIM_CORONA = "motion-safe:group-data-[visto=true]/podio:animate-coronaCae";
const ANIM_BRILLO = "motion-safe:group-data-[visto=true]/podio:animate-brilloOro";

/**
 * La clase del escalón del podio que sube (ponerla en cada columna). Vive acá y no en
 * `PodioEscena` ("use client"): importada desde un server component, una constante de un
 * módulo cliente llega como referencia, no como texto, y la clase se perdería sin error.
 */
export const COLUMNA_PODIO = "origin-bottom motion-safe:group-data-[visto=true]/podio:animate-podioSube";

type Puesto = 1 | 2 | 3;

const METAL: Record<Puesto, { claro: string; medio: string; oscuro: string; nombre: string }> = {
  1: { claro: "#FFE08A", medio: "#F0B83C", oscuro: "#B8841C", nombre: "oro" },
  2: { claro: "#F1F3F6", medio: "#C9CFD6", oscuro: "#7F8A96", nombre: "plata" },
  3: { claro: "#F2C08C", medio: "#D08C4E", oscuro: "#8A5424", nombre: "bronce" },
};

export function Medalla({
  puesto,
  tamano = 64,
  corona = puesto === 1,
  animada = false,
  retraso = 0,
  className,
}: {
  puesto: Puesto;
  tamano?: number;
  /** Corona sobre la medalla. Por defecto, sólo el primer puesto. */
  corona?: boolean;
  animada?: boolean;
  /** Retraso de la animación en ms (el podio entra 3.º → 2.º → 1.º). */
  retraso?: number;
  className?: string;
}) {
  const m = METAL[puesto];
  const id = `medalla-${m.nombre}`;
  const alto = corona ? tamano * 1.32 : tamano;
  return (
    <span
      role="img"
      aria-label={`Medalla de ${m.nombre}, puesto ${puesto}`}
      className={cn("relative inline-block shrink-0", animada && puesto === 1 && ANIM_BRILLO, className)}
      style={{ width: tamano, height: alto }}
    >
      {corona && (
        <svg
          viewBox="0 0 48 22"
          width={tamano * 0.62}
          className={cn("absolute left-1/2 top-0 -translate-x-1/2", animada && ANIM_CORONA)}
          style={animada ? { animationDelay: `${retraso + 450}ms` } : undefined}
          aria-hidden
        >
          <defs>
            <linearGradient id={`${id}-corona`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={METAL[1].claro} />
              <stop offset="1" stopColor={METAL[1].oscuro} />
            </linearGradient>
          </defs>
          <path d="M3 20 L6 5 L15 13 L24 2 L33 13 L42 5 L45 20 Z" fill={`url(#${id}-corona)`} stroke={METAL[1].oscuro} strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="6" cy="5" r="2.2" fill={METAL[1].claro} />
          <circle cx="24" cy="2.4" r="2.2" fill={METAL[1].claro} />
          <circle cx="42" cy="5" r="2.2" fill={METAL[1].claro} />
        </svg>
      )}
      <svg
        viewBox="0 0 100 100"
        width={tamano}
        height={tamano}
        className={cn("absolute bottom-0 left-0", animada && ANIM_MEDALLA)}
        style={animada ? { animationDelay: `${retraso}ms` } : undefined}
        aria-hidden
      >
        <defs>
          <linearGradient id={`${id}-disco`} x1="0.15" y1="0.1" x2="0.85" y2="0.95">
            <stop offset="0" stopColor={m.claro} />
            <stop offset="0.55" stopColor={m.medio} />
            <stop offset="1" stopColor={m.oscuro} />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r="48" fill={m.oscuro} />
        <circle cx="50" cy="50" r="44" fill={`url(#${id}-disco)`} />
        <circle cx="50" cy="50" r="36" fill="none" stroke={m.oscuro} strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="3 3" />
        {/* La llama del isotipo, grabada: el tono oscuro del mismo metal. */}
        <g transform="translate(29 23) scale(0.57)">
          <path d={LLAMITA_PATH} fill={m.oscuro} fillRule="evenodd" />
        </g>
      </svg>
    </span>
  );
}
