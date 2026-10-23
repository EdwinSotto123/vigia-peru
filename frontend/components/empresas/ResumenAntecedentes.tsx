import Link from "next/link";
import { EstadoVacio } from "@/components/patrones";
import { Badge } from "@/components/ui/Badge";
import { TIPO_CRUCE } from "@/lib/cruces";
import { plural } from "@/lib/formato";
import { CORTO_EMPRESA, type AntecedentePorTipo } from "@/lib/empresas";

const VARIANTE = { alta: "crimson", media: "amber", baja: "neutral" } as const;
const SEV = { alta: "Grave", media: "Para revisar", baja: "Leve" } as const;

/**
 * Lo que dicen de la empresa otros registros públicos, en el Inicio de su ficha: cada tipo de antecedente con cuántos
 * registros y su gravedad más alta, de lo más grave a lo más leve, y el enlace a sus casos con la fuente. Sin puntaje ni
 * ranking (el usuario lo sacó el 2026-10-22: «tiene mucho sesgo y parece acusación»): son hechos, cada uno verificable.
 * Server-safe.
 */
export function ResumenAntecedentes({ antecedentes, ruta }: { antecedentes: AntecedentePorTipo[]; ruta: string }) {
  if (!antecedentes.length) {
    return (
      <EstadoVacio compacto titulo="Ningún otro registro la nombra">
        No figura en las sanciones del Tribunal, las penalidades, los aportes y gastos de campaña, las autoridades y candidatos,
        ni en los demás cruces de Vigía.
      </EstadoVacio>
    );
  }
  return (
    <ol className="grid gap-2 sm:grid-cols-2">
      {antecedentes.map((a, i) => (
        <li key={a.tipo}>
          <Link
            href={`${ruta}?seccion=antecedentes&atipo=${a.tipo}`}
            className="flex h-full gap-3 rounded-xl border border-line/80 bg-paperSoft p-3 transition-colors duration-rapido hover:border-granate/40"
          >
            <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-paperDeep px-1.5 font-mono text-rotulo font-semibold tabular-nums text-ink" aria-hidden>
              {i + 1}
            </span>
            <span className="min-w-0 flex-1 space-y-1">
              <span className="block text-dato font-semibold text-ink">{CORTO_EMPRESA[a.tipo] ?? TIPO_CRUCE[a.tipo]?.corto ?? a.etiqueta}</span>
              <span className="flex flex-wrap items-center gap-1.5 text-meta text-inkSoft">
                <Badge variant={VARIANTE[a.severidad]}>{SEV[a.severidad]}</Badge>
                {plural(a.n, "registro", "registros")}
              </span>
              {TIPO_CRUCE[a.tipo]?.explica && <span className="block text-meta leading-relaxed text-mute">{TIPO_CRUCE[a.tipo].explica}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
