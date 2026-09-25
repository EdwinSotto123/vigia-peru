import { Camera, Search } from "lucide-react";
import { EnlaceAccion } from "./EnlaceAccion";

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
      <div className="container-page">
        <h2 id="participar-titulo" className="max-w-[22ch] text-balance font-display text-4xl font-bold leading-tight text-ink sm:text-5xl">
          No hace falta ser experto para vigilar.
        </h2>

        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <article className="sobre-oscuro relative overflow-hidden rounded-2xl bg-granate-deep p-7 text-paper sm:p-10">
            <Camera size={26} className="text-maiz" aria-hidden />
            <h3 className="mt-5 max-w-[20ch] text-balance font-display text-3xl font-bold leading-tight sm:text-4xl">
              ¿Ves una obra abandonada? Denúnciala.
            </h3>
            <p className="mt-4 max-w-[52ch] text-pretty text-base leading-relaxed text-paper/80">
              Toma una foto y marca dónde está. Vigía la cruza con los contratos de esa zona y la pone en el mapa.
              Es anónima si quieres: no se publica tu DNI ni tu nombre. Cuando otra persona reporta el mismo lugar
              en 30 días, la denuncia queda confirmada.
            </p>
            <EnlaceAccion href="/reporte/nuevo" variante="oscuro" className="mt-7">
              Denunciar una obra
            </EnlaceAccion>
          </article>

          <article className="flex flex-col rounded-2xl border border-line bg-paperSoft p-7 sm:p-10">
            <Search size={24} className="text-granate" aria-hidden />
            <h3 className="mt-5 max-w-[20ch] text-balance font-display text-3xl font-bold leading-tight text-ink">
              ¿Investigas? Busca cualquier contrato.
            </h3>
            <p className="mt-4 max-w-[46ch] text-pretty text-base leading-relaxed text-inkSoft">
              Por lo que se compró, por la entidad que contrató o por región. Si Vigía ya lo leyó, trae sus señales
              con la ley que citan y los documentos oficiales de donde salen, listos para verificar y citar.
            </p>
            <div className="mt-auto pt-7">
              <EnlaceAccion href="/app/contratos" variante="secundario">
                Buscar un contrato
              </EnlaceAccion>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
