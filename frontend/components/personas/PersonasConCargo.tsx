import Link from "next/link";
import { Landmark } from "lucide-react";
import { numero, plural } from "@/lib/formato";
import { rutaFuncionario, type FuncionarioHallado } from "@/lib/funcionarios";
import { tituloNatural } from "@/lib/landing";

const MESES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
const mes = (m: string | null) => (m && /^\d{4}-\d{2}/.test(m) ? `${MESES[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}` : null);

/**
 * «Personas con cargo público con ese nombre» en /app/personas (pedido del dueño del 2026-11-16: alguien con un cargo de
 * poder «no aparece en la BBDD»): quien presentó declaraciones juradas de intereses o está o estuvo en una planilla del
 * Estado, hallado por lo que se VE de su nombre. Cada una lleva a su ficha de rastro (cargos, visitas, empresas). El
 * apellido materno va tapado y no se busca. El nombre nunca va a un `title` ni a un `aria-label` (docs/PRIVACIDAD.md).
 */
export function PersonasConCargo({ personas }: { personas: FuncionarioHallado[] }) {
  if (!personas.length) return null;
  return (
    <section aria-labelledby="personas-con-cargo" className="rounded-2xl border border-line bg-paper" data-bloque>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-4 py-3">
        <h2 id="personas-con-cargo" className="text-bloque font-semibold text-ink">
          {personas.length === 1 ? "Una persona con cargo público con ese nombre" : `${numero(personas.length)} personas con cargo público con ese nombre`}
        </h2>
        <p className="text-rotulo text-mute">De la planilla del Estado y de las declaraciones juradas de intereses. El apellido materno va tapado y no se busca.</p>
      </div>
      <ul className="divide-y divide-line/70" data-lista="avance">
        {personas.map((p) => {
          const situacion = p.planillaEntidades > 0 ? (p.planillaHoy ? "En planilla hoy" : `En planilla hasta ${mes(p.planillaHasta) ?? "una fecha sin dato"}`) : null;
          const partes = [situacion, p.declaraciones > 0 ? plural(p.declaraciones, "declaración jurada", "declaraciones juradas") : null].filter(Boolean);
          return (
            <li key={p.codigo}>
              <Link
                href={rutaFuncionario(p.codigo)}
                prefetch={false}
                className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 transition-colors hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Landmark size={15} strokeWidth={1.9} className="shrink-0 text-mute" aria-hidden />
                  <span className="min-w-0">
                    <span className="block text-dato font-semibold text-granate underline decoration-granate/35 underline-offset-2">{p.nombre}</span>
                    <span className="block text-rotulo text-mute">
                      {p.cargo ? tituloNatural(p.cargo) : "Cargo sin detalle"}
                      {p.entidad ? `, ${tituloNatural(p.entidad)}` : ""}
                    </span>
                  </span>
                </span>
                <span className="text-meta text-inkSoft">{partes.join("; ")}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
