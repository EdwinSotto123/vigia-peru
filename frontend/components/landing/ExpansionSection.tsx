import { ArrowRight, Globe2 } from "lucide-react";
import { ChileFlag, ColombiaFlag, MexicoFlag, ParaguayFlag } from "./CountryFlags";

const PAISES = [
  { Flag: ColombiaFlag, nombre: "Colombia" },
  { Flag: ChileFlag, nombre: "Chile" },
  { Flag: MexicoFlag, nombre: "México" },
  { Flag: ParaguayFlag, nombre: "Paraguay" },
];

/**
 * "Perú es el primero, no el único": el pipeline lee OCDS (Estándar de Datos de
 * Contrataciones Abiertas), que ya publican gobiernos en toda la región — así que la
 * expansión no es una promesa vacía, es una consecuencia técnica de cómo está construido.
 * Banderas en gris hasta que un país esté realmente en vivo (hover les da color).
 *
 * Antes esto ocupaba 555 px —titular gigante, párrafo de tres renglones, cuatro
 * tarjetas con "Próximamente" y un enlace centrado— para decir algo que todavía
 * no pasó. Cuatro países que aún no existen en el producto no pueden pesar lo
 * mismo que los diez agentes que sí corren hoy. Ahora es una franja: una frase,
 * las cuatro banderas en línea y el mismo enlace, sin perder nada de lo que
 * decía.
 */
export function ExpansionSection() {
  return (
    <section className="border-t border-line bg-paper py-8">
      <div className="container-page flex max-w-[1400px] flex-wrap items-center justify-between gap-x-10 gap-y-5">
        <div className="min-w-0 max-w-[58ch]">
          <h2 className="font-serif text-xl font-bold leading-tight text-ink sm:text-2xl">
            <Globe2 size={17} className="mr-2 inline-block -translate-y-0.5 text-heroViolet" aria-hidden />
            Perú es el primero, <span className="text-heroViolet">no el único</span>.
          </h2>
          <p className="mt-1.5 text-[14px] leading-relaxed text-inkSoft">
            El Perú publica sus contratos en un formato abierto (OCDS) que también usan otros gobiernos de la
            región. Por eso Vigía podría leer los suyos con las mismas revisiones.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <ul className="flex items-center gap-4">
            {PAISES.map(({ Flag, nombre }) => (
              <li key={nombre} className="group flex flex-col items-center gap-1" title={`${nombre}, próximamente`}>
                <Flag
                  size={26}
                  className="rounded shadow-sm ring-1 ring-black/10 grayscale transition-all duration-300 group-hover:grayscale-0"
                />
                <span className="text-[10px] font-medium text-mute">{nombre}</span>
              </li>
            ))}
          </ul>
          <a
            // TODO(contacto): reemplazar por el correo del equipo cuando exista; vigiaperu.org no resuelve.
            href="https://github.com/EdwinSotto123/vigia-peru/issues"
            target="_blank"
            rel="noreferrer"
            className="group inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink transition-colors duration-rapido hover:bg-paperDeep"
          >
            ¿Tu país publica contrataciones abiertas?
            <ArrowRight size={14} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
          </a>
        </div>
      </div>
    </section>
  );
}
