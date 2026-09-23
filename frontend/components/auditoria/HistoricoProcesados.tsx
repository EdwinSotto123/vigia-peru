"use client";

/**
 * Histórico de contratos ya procesados: a diferencia del tablero en vivo (TableroAuditoria,
 * en cola/procesando/procesado reciente, con polling), esto es un registro estable: no
 * necesita refrescarse cada 5 s, así que se pagina por URL (?pagina=) en vez de pelear con
 * el polling. `pagina` ya viene resuelta por el server component (/app/auditoria/page.tsx).
 *
 * "use client": recibe solo datos serializables (nunca una función); `href` se arma ACÁ
 * mismo a partir de los filtros primitivos, porque una función no puede cruzar de un server
 * component a un client component (Paginacion es "use client"; React no puede serializarla).
 *
 * El vacío dice la verdad sobre su causa: sin filtros puestos no se culpa a los filtros, y
 * una página que no existe (?pagina=99) se nombra como tal, con un enlace a la primera.
 */

import Link from "next/link";
import { Inbox } from "lucide-react";
import { Paginacion } from "@/components/ui/Paginacion";
import { Tarjeta } from "./TableroAuditoria";
import type { ProcesamientosPagina } from "@/lib/auditoria";

const TAM = 24;

export function HistoricoProcesados({ pagina, paginaActual, pathname, ubigeo, desde, hasta, financiador }: {
  pagina: ProcesamientosPagina | null;
  paginaActual: number;
  pathname: string;
  ubigeo?: string;
  desde?: string;
  hasta?: string;
  financiador?: string;
}) {
  const total = pagina?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / TAM));
  const items = pagina?.data ?? [];
  const hayFiltros = !!(ubigeo || desde || hasta || financiador);
  const fueraDeRango = total > 0 && paginaActual > paginas;

  const href = (n: number) => {
    const params = new URLSearchParams();
    if (ubigeo) params.set("ubigeo", ubigeo);
    if (desde) params.set("desde", desde);
    if (hasta) params.set("hasta", hasta);
    if (financiador) params.set("financiador", financiador);
    if (n > 1) params.set("pagina", String(n));
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const paginador = (
    <Paginacion
      actual={Math.min(paginaActual, paginas)}
      paginas={paginas}
      total={total}
      tam={TAM}
      navegacion="url"
      href={href}
      onChange={() => {}}
      cargando={false}
      nombre="contratos leídos"
    />
  );

  return (
    <div className="space-y-3">
      {!fueraDeRango && paginador}
      {items.length === 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-line p-6 text-sm text-mute">
          <Inbox size={18} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            {pagina == null ? (
              <>
                <div className="font-medium text-ink">No pudimos cargar el histórico.</div>
                <div className="mt-0.5">El servicio no respondió. Vuelve a cargar la página en un momento.</div>
              </>
            ) : fueraDeRango ? (
              <>
                <div className="font-medium text-ink">La página {paginaActual} no existe.</div>
                <div className="mt-0.5">
                  El histórico tiene {paginas} {paginas === 1 ? "página" : "páginas"}.{" "}
                  <Link href={href(1)} className="font-medium text-ink underline underline-offset-2">Ir a la primera</Link>.
                </div>
              </>
            ) : hayFiltros ? (
              <>
                <div className="font-medium text-ink">Nada coincide con estos filtros.</div>
                <div className="mt-0.5">Los filtros puestos están arriba, cada uno con su propia X: quita uno y vuelve a mirar.</div>
              </>
            ) : (
              <>
                <div className="font-medium text-ink">Todavía no se leyó ningún contrato.</div>
                <div className="mt-0.5">Cuando termine el primer análisis, aparece acá con lo que encontró y quién lo pagó.</div>
              </>
            )}
          </div>
        </div>
      ) : (
        // `grid-cols-1` explícito: la pista implícita `auto` se dimensiona al max-content, y
        // las tarjetas llevan `truncate` (= white-space: nowrap), cuyo min-content es el texto
        // entero. En 390 px eso hacía scrollear la página en horizontal. `grid-cols-N` es
        // `minmax(0, 1fr)`, que es lo que corta la cadena.
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <li key={p.ocid}>
              <Tarjeta p={p} ahora={0} />
            </li>
          ))}
        </ul>
      )}
      {items.length > 8 && paginador}
    </div>
  );
}
