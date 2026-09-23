import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PulseDot } from "@/components/ui/PulseDot";
import { Orquestacion, type CarrilDatos } from "./Orquestacion";
import { PASOS, TOTAL_AGENTES, TOTAL_PASOS, porCarril, type PasoPipeline } from "@/components/agentes/catalogo";

/**
 * El pipeline real, corriendo.
 *
 * Lo más difícil de creer de este producto —que un equipo de agentes leyó el
 * expediente entero— estaba dicho en la landing en once palabras dentro de una
 * tarjeta: "Diez agentes los leen". Un número sin nada detrás se lee como
 * marketing, y en una herramienta que le exige evidencia al Estado eso es
 * exactamente lo que no puede pasar.
 *
 * El contenido sale entero de `components/agentes/catalogo`, que deriva de
 * `lib/auditoria` y esa de `backend/agent/deterministic.py`. Si el backend
 * agrega un agente, aparece acá solo; si lo quita, desaparece. No hay forma de
 * que la landing prometa un agente que no existe.
 *
 * Este archivo se quedó en el servidor a propósito: deriva el grafo y lo pasa
 * como datos planos. El componente interactivo (`Orquestacion`) recibe arrays y
 * strings, nunca funciones — un Server Component que pasa una función a un
 * Client Component compila, pasa `tsc` y revienta sólo en producción, y este
 * repositorio ya se comió ese bug dos veces.
 *
 * Quien pidió menos movimiento en su sistema no ve ninguna de las animaciones:
 * `globals.css` neutraliza los loops y los pasos quedan todos encendidos.
 */

/** Cuántos turnos espera cada carril antes de arrancar: su dependencia real. */
const ARRANQUE: Record<string, number> = { expediente: 0, proveedor: 1, sintesis: 3 };

/** Los pasos de un carril, agrupados por su índice: los que comparten índice corren a la vez. */
function grupos(pasos: PasoPipeline[]): PasoPipeline[][] {
  const porIndice = new Map<number, PasoPipeline[]>();
  for (const p of pasos) porIndice.set(p.paso, [...(porIndice.get(p.paso) ?? []), p]);
  return [...porIndice.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

export function PipelineAgentes() {
  const carriles: CarrilDatos[] = porCarril(PASOS).map((c) => ({
    clave: c.key,
    label: c.label,
    nAgentes: c.pasos.filter((p) => p.tipo === "agente").length,
    arranque: ARRANQUE[c.key] ?? 0,
    grupos: grupos(c.pasos),
  }));

  return (
    <section
      id="agentes"
      aria-labelledby="agentes-titulo"
      className="relative scroll-mt-20 overflow-hidden bg-ink py-16 text-paper sm:py-20"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute left-1/4 top-0 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-heroViolet/30 blur-[130px]" />
        <div className="absolute bottom-0 right-0 h-[22rem] w-[22rem] rounded-full bg-heroGreen/12 blur-[110px]" />
      </div>

      <div className="container-page relative max-w-[1400px]">
        {/* El titular dice qué significa para la persona, no qué tecnología
            corre. "12 pasos y 10 agentes" era un beneficio para desarrolladores;
            para un ciudadano, lo que importa es que nada se salta y que, si hay
            duda, decide una persona. La tecnología queda al pie, como soporte. */}
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
          <div className="min-w-0">
            <h2 id="agentes-titulo" className="max-w-[24ch] text-balance font-serif text-4xl font-bold leading-[1.05] sm:text-5xl">
              Cada contrato pasa por las mismas revisiones.
            </h2>
            <p className="mt-4 max-w-[62ch] text-base leading-relaxed text-paper/70">
              Siempre en el mismo orden: lee el expediente, compara los precios con el mercado, investiga a la
              empresa y a las personas detrás, y escribe un informe citando la ley. Si no está seguro de lo que
              encontró, no lo publica: lo revisa una persona.
            </p>
          </div>
          <Link
            href="/app/auditoria"
            className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-paper/25 px-5 py-3 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-paper/10"
          >
            Verlo trabajar ahora
            <ArrowRight size={15} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>

        {/* El circuito entero —qué entra, quién reparte, qué sale— y el carril que
            se abra. Antes el detalle de los tres carriles vivía acá abajo siempre
            desplegado: repetía el encabezado que el diagrama ya daba y dejaba la
            sección en 1 558 px con dos tercios que nadie lee. */}
        <Orquestacion carriles={carriles} totalPasos={TOTAL_PASOS} totalAgentes={TOTAL_AGENTES} />

        <p className="mt-6 max-w-[84ch] text-[13px] leading-relaxed text-paper/70">
          Por dentro trabajan {TOTAL_AGENTES} agentes de inteligencia artificial, cada uno con una sola tarea, y{" "}
          {TOTAL_PASOS - TOTAL_AGENTES} verificaciones que no opinan: consultan datos o revisan lo que hicieron los
          demás. La última es una autoevaluación que puede frenar la publicación entera.
        </p>
      </div>
    </section>
  );
}
