import { ArrowRight, Globe2 } from "lucide-react";
import { BlurFade } from "@/components/magicui/BlurFade";
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
 */
export function ExpansionSection() {
  return (
    <section className="border-y border-line bg-paperSoft py-16">
      <div className="container-page max-w-[1600px]">
        <BlurFade as="div" className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-heroViolet/25 bg-heroViolet/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-heroViolet">
            <Globe2 size={11} /> Próximos países
          </span>
          <h2 className="mt-3 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl lg:text-5xl">
            Perú es el primero, <span className="text-heroViolet">no el único</span>.
          </h2>
          <p className="mt-3 text-mute">
            El Estándar de Datos de Contrataciones Abiertas (OCDS) que hace posible Vigía Perú ya lo publican
            gobiernos en toda la región. El mismo pipeline de agentes puede leer sus contratos también —
            la corrupción no respeta fronteras, la vigilancia tampoco debería.
          </p>
        </BlurFade>

        <div className="mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-4 sm:grid-cols-4">
          {PAISES.map(({ Flag, nombre }, i) => (
            <BlurFade
              key={nombre}
              delayMs={i * 80}
              className="group flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-paper p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-solid hover:shadow-paper"
            >
              <Flag size={40} className="rounded shadow-sm ring-1 ring-black/10 grayscale transition-all duration-300 group-hover:grayscale-0" />
              <span className="text-sm font-semibold text-ink">{nombre}</span>
              <span className="text-[10px] uppercase tracking-wide text-mute">Próximamente</span>
            </BlurFade>
          ))}
        </div>

        <div className="mt-8 text-center">
          <a
            href="mailto:hola@vigiaperu.org?subject=Vig%C3%ADa%20en%20mi%20pa%C3%ADs"
            className="inline-flex items-center gap-2 text-sm font-semibold text-ink underline-offset-2 hover:underline"
          >
            ¿Tu país publica contrataciones abiertas? Escríbenos <ArrowRight size={14} />
          </a>
        </div>
      </div>
    </section>
  );
}
