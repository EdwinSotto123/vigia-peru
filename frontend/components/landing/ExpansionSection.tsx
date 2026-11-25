import { ArrowUpRight, Globe2 } from "lucide-react";
import { ChileFlag, ColombiaFlag, MexicoFlag, ParaguayFlag } from "./CountryFlags";

const PAISES = [
  { Flag: ColombiaFlag, nombre: "Colombia" },
  { Flag: ChileFlag, nombre: "Chile" },
  { Flag: MexicoFlag, nombre: "México" },
  { Flag: ParaguayFlag, nombre: "Paraguay" },
];

/**
 * "Perú es el primero, no el único": el pipeline lee OCDS (Estándar de Datos de Contrataciones Abiertas), que ya
 * publican gobiernos en toda la región, así que la expansión no es una promesa vacía: es una consecuencia técnica de
 * cómo está construido. Banderas en gris hasta que un país esté realmente en vivo (hover les da color).
 *
 * Desde el 2026-11-13 es una caja de una línea al pie de «Cómo sumarte» (Participar): antes era una banda propia entre
 * esa sección y el cierre. Cuatro países que aún no existen en el producto no pueden pesar lo mismo que lo que sí corre.
 */
export function ExpansionSection() {
  return (
    <aside aria-labelledby="expansion-titulo" className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-2xl border border-line px-4 py-3 sm:px-5">
      <div className="min-w-0 max-w-[54ch]">
        <h2 id="expansion-titulo" className="flex items-center gap-2 font-display text-bloque font-bold leading-tight text-ink">
          <Globe2 size={17} className="shrink-0 text-granate" aria-hidden />
          <span>
            Perú es el primero, <span className="text-granate">no el único</span>.
          </span>
        </h2>
        <p className="mt-0.5 text-meta leading-relaxed text-inkSoft">
          El Perú publica sus contratos en un formato abierto que también usan otros gobiernos de la región. Por eso Vigía
          podría leer los suyos con las mismas revisiones.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <ul className="flex items-center gap-3" aria-label="Próximamente">
          {PAISES.map(({ Flag, nombre }) => (
            <li key={nombre} className="group flex flex-col items-center gap-0.5" title={`${nombre}, próximamente`}>
              <Flag size={22} className="rounded ring-1 ring-ink/10 grayscale transition-[filter] duration-normal group-hover:grayscale-0" />
              <span className="text-micro font-medium text-mute">{nombre}</span>
            </li>
          ))}
        </ul>
        <a
          // TODO(contacto): reemplazar por el correo del equipo cuando exista; vigiaperu.org no resuelve.
          href="https://github.com/Gobserva-Cloud/vigia-peru/issues"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-10 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline"
        >
          ¿Tu país publica contrataciones abiertas?
          <ArrowUpRight size={13} aria-hidden />
          <span className="sr-only">(se abre en una pestaña nueva)</span>
        </a>
      </div>
    </aside>
  );
}
