import { Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Ejemplo, Puntaje } from "./Maquetas";

/**
 * El héroe de la portada de Gobserva Licitaciones (2026-11-07): el radar de la marca encuentra lo que calza con una
 * empresa. El barrido da dos vueltas al cargar (sólo con movimiento permitido) y cada eco que toca se enciende; los que
 * calzan se vuelven tarjetas con su puntaje de afinidad, como en «Para ti». Sin movimiento, todo está a la vista desde
 * el principio. Es un EJEMPLO y lo dice. Server-safe: sólo CSS.
 *
 * Los ecos van por rumbo (grados desde el norte, en el sentido del reloj, el mismo del barrido) y distancia al centro
 * (0 a 1 del radio): así cada uno se enciende justo cuando lo toca el borde del barrido.
 */
const VUELTA_MS = 3400;
const RADIO = 46; // % del cuadro: el círculo exterior de la retícula

type Eco = { rumbo: number; distancia: number; calza: boolean };

const ECOS: Eco[] = [
  { rumbo: 40, distancia: 0.6, calza: true },
  { rumbo: 95, distancia: 0.85, calza: false },
  { rumbo: 140, distancia: 0.62, calza: true },
  { rumbo: 200, distancia: 0.3, calza: false },
  { rumbo: 255, distancia: 0.55, calza: true },
  { rumbo: 320, distancia: 0.78, calza: false },
];

/** Las tarjetas de los ecos que calzan, en orden de rumbo; desde sm, cada una junto a su eco. */
const TARJETAS = [
  { n: 92, titulo: "Útiles de oficina para el año escolar", quien: "Una UGEL de Cusco", cuando: "Cierra en 2 días", rumbo: 40, lugar: "sm:left-[49%] sm:top-[3%]" },
  { n: 88, titulo: "Tóner y cartuchos para impresoras", quien: "Una municipalidad de Puno", cuando: "Consultas hasta el viernes", rumbo: 140, lugar: "sm:left-[38%] sm:top-[77%]" },
  { n: 81, titulo: "Papel bond A4 para la sede central", quien: "Un hospital de Cusco", cuando: "Cierra mañana", rumbo: 255, lugar: "sm:left-0 sm:top-[29%]" },
];

const retraso = (rumbo: number) => Math.round((rumbo / 360) * VUELTA_MS);

function posicion({ rumbo, distancia }: { rumbo: number; distancia: number }) {
  const a = (rumbo * Math.PI) / 180;
  return { left: `${50 + distancia * RADIO * Math.sin(a)}%`, top: `${50 - distancia * RADIO * Math.cos(a)}%` };
}

export function RadarOportunidades({ className }: { className?: string }) {
  return (
    <figure className={cn("relative mx-auto w-full max-w-[34rem]", className)}>
      <div className="relative sm:aspect-square">
        {/* El instrumento: retícula, barrido y ecos. */}
        <div aria-hidden className="relative mx-auto aspect-square w-full max-w-[17rem] sm:absolute sm:inset-0 sm:max-w-none">
          <div className="absolute inset-[4%] rounded-full bg-paper/[0.035]" />
          <div
            className="absolute inset-[4%] rounded-full motion-safe:animate-spin"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg 280deg, rgb(var(--maiz) / 0.04) 280deg, rgb(var(--maiz) / 0.2) 352deg, rgb(var(--maiz) / 0.65) 359.4deg, transparent 360deg)",
              animationDuration: `${VUELTA_MS}ms`,
              animationIterationCount: 2,
            }}
          />
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-maiz">
            {[46, 34.5, 23, 11.5].map((r) => (
              <circle key={r} cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity={r === 46 ? 0.35 : 0.16} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            <path d="M50 4V96M4 50H96" stroke="currentColor" strokeOpacity="0.14" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {Array.from({ length: 24 }, (_, i) => {
              const a = (i * 15 * Math.PI) / 180;
              const largo = i % 6 === 0 ? 3 : 1.4;
              return (
                <line
                  key={i}
                  x1={50 + 46 * Math.sin(a)}
                  y1={50 - 46 * Math.cos(a)}
                  x2={50 + (46 - largo) * Math.sin(a)}
                  y2={50 - (46 - largo) * Math.cos(a)}
                  stroke="currentColor"
                  strokeOpacity="0.4"
                  strokeWidth="1"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            <circle cx="50" cy="50" r="1.3" fill="currentColor" />
          </svg>
          {ECOS.map((e) => (
            <span
              key={e.rumbo}
              className={cn(
                "absolute -ml-[6px] -mt-[6px] h-3 w-3 rounded-full motion-safe:animate-fadeIn",
                e.calza ? "bg-maiz ring-4 ring-maiz/25" : "bg-paper/30",
              )}
              style={{ ...posicion(e), animationDelay: `${retraso(e.rumbo)}ms`, animationDuration: "450ms", animationFillMode: "both" }}
            />
          ))}
        </div>

        {/* Lo que calza: en el celular, debajo del radar; desde sm, junto a su eco. */}
        <ul className="relative mt-5 space-y-2.5 sm:static sm:mt-0 sm:space-y-0">
          {TARJETAS.map((t) => (
            <li
              key={t.titulo}
              className={cn("sm:absolute sm:w-[15.5rem] motion-safe:animate-fadeInUp", t.lugar)}
              style={{ animationDelay: `${retraso(t.rumbo) + 250}ms` }}
            >
              <div className="flex items-start gap-3 rounded-xl bg-paper p-3 text-ink shadow-pop">
                <Puntaje n={t.n} />
                <div className="min-w-0">
                  <p className="text-dato font-semibold leading-snug text-ink">{t.titulo}</p>
                  <p className="mt-0.5 text-rotulo text-inkSoft">{t.quien}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-rotulo font-semibold text-granate">
                    <Clock3 size={12} aria-hidden /> {t.cuando}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="mt-4 flex items-start gap-2 text-meta leading-snug text-paper/70 sm:mt-2 sm:justify-center sm:text-center">
        <Ejemplo oscuro className="mt-px shrink-0" />
        <span>Lo que calza con una empresa que vende útiles de oficina y tóner, con su puntaje de afinidad.</span>
      </figcaption>
    </figure>
  );
}
