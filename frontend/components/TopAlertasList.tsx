import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatSoles, severidadColor } from "@/lib/mock-data";
import { PrefetchLink } from "@/components/PrefetchLink";
import type { Alerta } from "@/types";

/**
 * Lista top de alertas. Recibe la data por props para que el caller decida
 * de dónde la trae (API real, mock, etc.).
 */
export function TopAlertasList({ alertas }: { alertas: Alerta[] }) {
  const top = [...alertas].sort((a, b) => b.score - a.score).slice(0, 6);

  return (
    <div className="surface overflow-hidden p-0">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div>
          <h3 className="font-serif text-xl font-bold">Top alertas del mes</h3>
          <p className="text-sm text-ash">
            Ordenadas por score de riesgo. Click para ver el dossier.
          </p>
        </div>
        <Link href="/" className="text-sm font-medium text-navy hover:underline">
          Ver todas
        </Link>
      </div>
      {top.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-mute">
          Sin alertas activas. El motor las publica aquí apenas el pipeline
          detecte coincidencias.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {top.map((a) => (
            <li key={a.id}>
              <PrefetchLink
                href={`/app/convocatoria/${a.codigoconvocatoria}`}
                ocid={String(a.codigoconvocatoria)}
                className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-bone"
              >
                <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-ink text-bone">
                  <span className="text-xl font-bold leading-none">{a.score}</span>
                  <span className="text-[9px] uppercase tracking-wider opacity-70">score</span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-ash">
                    <span>{a.region}</span>
                    <span>·</span>
                    <span>{a.codigoconvocatoria}</span>
                  </div>
                  <div className="truncate text-sm font-semibold text-ink">
                    {a.objeto}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {a.banderas.slice(0, 3).map((b, i) => (
                      <span
                        key={`${b.regla}-${i}`}
                        className={"pill border " + severidadColor(b.severidad)}
                      >
                        {b.regla.replaceAll("_", " ")}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="hidden text-right md:block">
                  <div className="font-mono text-sm font-semibold">
                    {formatSoles(a.montoSoles)}
                  </div>
                  <div className="text-xs text-ash">{a.fechaBuenaPro}</div>
                </div>
                <ChevronRight size={18} className="text-ash" />
              </PrefetchLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
