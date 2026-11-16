import Link from "next/link";
import { UserRound } from "lucide-react";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaPersona, type PersonaPorNombre } from "@/lib/personas";

/**
 * «Personas con ese nombre»: quienes coinciden, por lo que se VE de su nombre (primer apellido y nombres), con lo buscado
 * en /app/personas (pedido del dueño del 2026-11-16: «lo busco y parece que no tiene perfil»). Cada una lleva a su ficha.
 * Va arriba de la lista, que sigue buscando por entidad y servicio. El apellido tapado no se busca: la API descarta todo
 * resultado que sólo coincida por él. El nombre nunca va a un `title` ni a un `aria-label` (docs/PRIVACIDAD.md).
 */
export function PersonasPorNombre({ personas }: { personas: PersonaPorNombre[] }) {
  if (!personas.length) return null;
  return (
    <section aria-labelledby="personas-por-nombre" className="rounded-2xl border border-line bg-paper" data-bloque>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3">
        <h2 id="personas-por-nombre" className="text-bloque font-semibold text-ink">
          {personas.length === 1 ? "Una persona con ese nombre" : `${numero(personas.length)} personas con ese nombre`}
        </h2>
        <p className="text-rotulo text-mute">Por su primer apellido y sus nombres. El otro apellido va tapado y no se busca.</p>
      </div>
      <ul className="divide-y divide-line/70" data-lista="avance">
        {personas.map((p) => {
          const partes = [
            p.procesos > 0 ? `${plural(p.procesos, "proceso ganado", "procesos ganados")} por ${solesCompacto(p.montoProcesos)}` : null,
            p.ordenes > 0 ? `${plural(p.ordenes, "orden de servicio", "órdenes de servicio")} por ${solesCompacto(p.monto)}` : null,
          ].filter(Boolean);
          return (
            <li key={p.codigo}>
              <Link
                href={rutaPersona(p.codigo, p.ordenes === 0 && p.procesos > 0 ? "procesos" : undefined)}
                prefetch={false}
                className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 transition-colors hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <UserRound size={15} strokeWidth={1.9} className="shrink-0 text-mute" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-dato font-semibold text-granate underline decoration-granate/35 underline-offset-2">{p.nombre}</span>
                    {p.entidad && <span className="block text-rotulo text-mute">Sobre todo en {tituloNatural(p.entidad)}</span>}
                  </span>
                </span>
                <span className="text-meta text-inkSoft">{partes.join("; ") || "Sin montos registrados"}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
