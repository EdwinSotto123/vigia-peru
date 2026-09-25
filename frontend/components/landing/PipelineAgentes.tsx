import { Building2, Coins, FileSearch, Scale, UserCheck, type LucideIcon } from "lucide-react";
import { EnlaceAccion } from "./EnlaceAccion";
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

/**
 * Lo que se pregunta de cada contrato, en las palabras de quien lo paga. Antes era un
 * párrafo ("Siempre en el mismo orden: lee el expediente, compara…"): el orden no le
 * importa a nadie; lo que importa es QUÉ se revisa y que, si hay duda, no se publica.
 */
const PREGUNTAS: { Icono: LucideIcon; texto: string }[] = [
  { Icono: FileSearch, texto: "¿El expediente sigue las reglas?" },
  { Icono: Coins, texto: "¿Se pagó de más?" },
  { Icono: Building2, texto: "¿Quién está detrás de la empresa?" },
  { Icono: Scale, texto: "¿Qué dice la ley?" },
];

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
      data-tema="oscuro"
      aria-labelledby="agentes-titulo"
      className="sobre-oscuro relative scroll-mt-20 overflow-hidden border-t border-paper/10 bg-ink py-16 text-paper sm:py-20"
    >
      <div className="container-page relative">
        {/* El titular dice qué significa para la persona, no qué tecnología corre: qué se
            revisa (cuatro preguntas) y la garantía (si hay duda, decide una persona). La
            tecnología queda en el diagrama, como soporte. */}
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
          <div className="min-w-0">
            <h2 id="agentes-titulo" className="max-w-[24ch] text-balance font-display text-4xl font-bold leading-[1.05] sm:text-5xl">
              Lo que Vigía revisa en cada contrato
            </h2>
            <p className="mt-4 inline-flex items-center gap-2 rounded-full border border-maiz/30 bg-maiz/10 px-3.5 py-1.5 text-[14px] font-medium text-maiz sm:text-[15px]">
              <UserCheck size={16} className="shrink-0" aria-hidden />
              Si no está seguro, no lo publica: lo revisa una persona.
            </p>
          </div>
          <EnlaceAccion href="/app/auditoria" variante="contornoOscuro" className="shrink-0">
            Verlo trabajar ahora
          </EnlaceAccion>
        </div>

        <ul className="mt-8 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Lo que se revisa">
          {PREGUNTAS.map(({ Icono, texto }) => (
            <li key={texto} className="flex items-center gap-3 rounded-2xl border border-paper/12 bg-paper/[0.04] px-4 py-3.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-maiz/10 text-maiz" aria-hidden>
                <Icono size={18} />
              </span>
              <span className="text-[15px] font-semibold leading-snug text-paper">{texto}</span>
            </li>
          ))}
        </ul>

        {/* El circuito entero —qué entra, quién reparte, qué sale— y el carril que
            se abra. Antes el detalle de los tres carriles vivía acá abajo siempre
            desplegado: repetía el encabezado que el diagrama ya daba y dejaba la
            sección en 1 558 px con dos tercios que nadie lee. */}
        <Orquestacion carriles={carriles} totalPasos={TOTAL_PASOS} totalAgentes={TOTAL_AGENTES} />
      </div>
    </section>
  );
}
