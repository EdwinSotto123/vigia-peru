"use client";

/**
 * Lista completa y paginada de /app/alertas. A diferencia de TopAlertasList (teaser
 * client-side: ordena y recorta un lote fijo ya traído), esta recibe exactamente la
 * página que el server component ya pidió al API (filtrada + paginada server-side) y
 * solo la pinta — mismo patrón que ContratosLista.
 *
 * "use client" es necesario: arma `href` acá mismo (a partir de `query`, datos planos)
 * porque un Server Component no puede pasarle una función como prop a <Paginacion>
 * (Client Component) — solo datos serializables cruzan ese límite. Pasarle `href` ya
 * armado desde page.tsx rompía el build (`next build` fallaba prerenderizando /app/alertas).
 */

import { ChevronRight, Inbox, WifiOff } from "lucide-react";
import { formatSoles, severidadColor } from "@/lib/mock-data";
import { PrefetchLink } from "@/components/PrefetchLink";
import { Paginacion } from "@/components/ui/Paginacion";
import { alertasQueryString, type AlertasQuery } from "@/lib/alertas-query";
import type { ApiAlerta } from "@/lib/api-client";

interface Props {
  data: ApiAlerta[];
  total: number;
  pagina: number;
  tam: number;
  query: AlertasQuery;
  /** true si el API falló (para distinguir "no se pudo cargar" de "0 resultados con estos filtros"). */
  fallo: boolean;
  pathname?: string;
}

export function AlertasLista({ data, total, pagina, tam, query, fallo, pathname = "/app/alertas" }: Props) {
  const paginas = Math.max(1, Math.ceil(total / tam));
  const href = (n: number) => {
    const qs = alertasQueryString({ ...query, pagina: n });
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const pag = (
    <Paginacion
      actual={pagina}
      paginas={paginas}
      total={total}
      tam={tam}
      navegacion="url"
      href={href}
      onChange={() => {}}
      cargando={false}
      nombre="alertas"
    />
  );

  return (
    <div className="space-y-2">
      {pag}
      <div className="surface overflow-hidden p-0">
        {fallo && data.length === 0 ? (
          <Aviso icon={<WifiOff size={16} />} text="No se pudo cargar la lista de alertas. Reintenta en unos segundos." />
        ) : data.length === 0 ? (
          <Aviso icon={<Inbox size={16} />} text="Ninguna alerta coincide con estos filtros." />
        ) : (
          <ul className="divide-y divide-line">
            {data.map((a) => (
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
      {data.length > 10 && pag}
    </div>
  );
}

function Aviso({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-6 py-12 text-center text-sm text-mute">
      <span className="text-mute" aria-hidden>{icon}</span>
      {text}
    </div>
  );
}
