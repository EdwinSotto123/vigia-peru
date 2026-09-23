import Link from "next/link";
import { ArrowRight, Camera, Search } from "lucide-react";

/**
 * Cómo sumarse, además de financiar (que ya tiene su sección, con su botón).
 *
 * Antes esto eran 805 px: un titular, un párrafo, un botón y tres tarjetas por
 * audiencia ("Periodista: tres meses de investigación, en tres minutos"), con
 * promesas que ninguna cifra sostenía. Ahora son dos caminos, cada uno con un
 * verbo, lo que pasa después y un solo botón.
 *
 * Todo lo que se afirma de la denuncia sale de cómo funciona hoy
 * `/reporte/nuevo`: anónima por defecto, sin DNI ni nombre publicados, y
 * confirmada cuando dos reportes independientes del mismo punto coinciden en
 * 30 días.
 */
export function Participar() {
  return (
    <section id="denunciar" aria-labelledby="participar-titulo" className="scroll-mt-16 bg-paper py-20 sm:py-24">
      <div className="container-page max-w-[1400px]">
        <h2 id="participar-titulo" className="max-w-[22ch] font-serif text-4xl font-bold leading-tight text-ink sm:text-5xl">
          No hace falta ser experto para vigilar.
        </h2>

        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <article className="relative overflow-hidden rounded-3xl bg-heroViolet-deep p-7 text-paper sm:p-10">
            <div aria-hidden className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-heroGreen/20 blur-3xl" />
            <Camera size={26} className="relative text-heroGreen" aria-hidden />
            <h3 className="relative mt-5 max-w-[20ch] font-serif text-3xl font-bold leading-tight sm:text-4xl">
              ¿Ves una obra abandonada? Denúnciala.
            </h3>
            <p className="relative mt-4 max-w-[52ch] text-base leading-relaxed text-paper/80">
              Toma una foto y marca dónde está. Vigía la cruza con los contratos de esa zona y la pone en el mapa.
              Es anónima si quieres: no se publica tu DNI ni tu nombre. Cuando otra persona reporta el mismo lugar
              en 30 días, la denuncia queda confirmada.
            </p>
            <Link
              href="/reporte/nuevo"
              className="group relative mt-7 inline-flex items-center gap-2 rounded-full bg-heroGreen px-6 py-3.5 text-[15px] font-semibold text-ink shadow-card transition-transform duration-rapido hover:-translate-y-0.5 active:translate-y-0"
            >
              Denunciar una obra
              <ArrowRight size={16} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </article>

          <article className="flex flex-col rounded-3xl border border-line bg-paperSoft p-7 sm:p-10">
            <Search size={24} className="text-heroViolet" aria-hidden />
            <h3 className="mt-5 max-w-[20ch] font-serif text-3xl font-bold leading-tight text-ink">
              ¿Investigas? Busca cualquier contrato.
            </h3>
            <p className="mt-4 max-w-[46ch] text-base leading-relaxed text-inkSoft">
              Por lo que se compró, por la entidad que contrató o por región. Si Vigía ya lo leyó, trae sus señales
              con la ley que citan y los documentos oficiales de donde salen, listos para verificar y citar.
            </p>
            <Link
              href="/app/contratos"
              className="group mt-auto inline-flex items-center gap-2 self-start pt-7 text-[15px] font-semibold text-heroViolet underline-offset-4 hover:underline"
            >
              Buscar un contrato
              <ArrowRight size={16} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}
