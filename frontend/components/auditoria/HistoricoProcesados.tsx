/**
 * Histórico de contratos ya procesados: a diferencia del tablero en vivo (TableroAuditoria,
 * en cola/procesando/procesado reciente, con polling), esto es un registro estable — no
 * necesita refrescarse cada 5 s, así que se pagina por URL (?pagina=) en vez de pelear con
 * el polling. `pagina` ya viene resuelta por el server component (/app/auditoria/page.tsx).
 */

import { Inbox } from "lucide-react";
import { Paginacion } from "@/components/ui/Paginacion";
import { Tarjeta } from "./TableroAuditoria";
import type { ProcesamientosPagina } from "@/lib/auditoria";

const TAM = 24;

export function HistoricoProcesados({ pagina, paginaActual, pathname, queryString }: {
  pagina: ProcesamientosPagina | null;
  paginaActual: number;
  pathname: string;
  queryString: (pagina: number) => string;
}) {
  const total = pagina?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / TAM));
  const items = pagina?.data ?? [];

  return (
    <div className="space-y-3">
      <Paginacion
        actual={paginaActual}
        paginas={paginas}
        total={total}
        tam={TAM}
        navegacion="url"
        href={(n) => { const qs = queryString(n); return qs ? `${pathname}?${qs}` : pathname; }}
        onChange={() => {}}
        cargando={false}
        nombre="procesados"
      />
      {items.length === 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-line p-6 text-sm text-mute">
          <Inbox size={18} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <div className="font-medium text-ink">Nada coincide con estos filtros.</div>
            <div className="mt-0.5">Prueba ampliando el rango de fechas o quitando el patrocinador.</div>
          </div>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <li key={p.ocid}>
              <Tarjeta p={p} ahora={0} />
            </li>
          ))}
        </ul>
      )}
      {items.length > 8 && (
        <Paginacion
          actual={paginaActual}
          paginas={paginas}
          total={total}
          tam={TAM}
          navegacion="url"
          href={(n) => { const qs = queryString(n); return qs ? `${pathname}?${qs}` : pathname; }}
          onChange={() => {}}
          cargando={false}
          nombre="procesados"
        />
      )}
    </div>
  );
}
