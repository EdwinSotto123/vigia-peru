import { Building2, Coins, FileSearch, Scale, type LucideIcon } from "lucide-react";
import { Orquestacion, type CarrilDatos } from "./Orquestacion";
import { PASOS, TOTAL_AGENTES, TOTAL_PASOS, porCarril, type PasoPipeline } from "@/components/agentes/catalogo";

/**
 * El pipeline real, corriendo: la pestaña «Qué revisa» de «Cómo trabaja Vigía» (ComoFunciona). Hasta el 2026-11-13 era
 * una banda propia de una pantalla; la garantía «si no está seguro, lo revisa una persona» quedó en la pestaña «Por qué
 * creerle», y el «Verlo trabajar ahora», en la cabecera de la sección.
 *
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
    // La placa oscura de la marca dentro de la sección clara: el diagrama está dibujado para fondo oscuro.
    <div data-tema="oscuro" className="sobre-oscuro rounded-2xl bg-ink p-4 text-paper sm:p-6">
      <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Lo que se revisa">
        {PREGUNTAS.map(({ Icono, texto }) => (
          <li key={texto} className="flex items-center gap-2.5 rounded-xl border border-paper/15 px-3 py-2.5">
            <Icono size={17} className="shrink-0 text-maiz" aria-hidden />
            <span className="text-dato font-semibold leading-snug text-paper">{texto}</span>
          </li>
        ))}
      </ul>

      {/* El circuito entero —qué entra, quién reparte, qué sale— y el carril que se abra. */}
      <Orquestacion carriles={carriles} totalPasos={TOTAL_PASOS} totalAgentes={TOTAL_AGENTES} />
    </div>
  );
}
