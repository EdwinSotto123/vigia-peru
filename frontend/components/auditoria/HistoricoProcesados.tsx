"use client";

/**
 * Histórico de contratos ya procesados: a diferencia del tablero en vivo (TableroAuditoria,
 * en cola/procesando/procesado reciente, con polling), esto es un registro estable: no
 * necesita refrescarse cada 5 s, así que se pagina por URL (?pagina=) en vez de pelear con
 * el polling. `pagina` ya viene resuelta por el server component (/app/auditoria/page.tsx).
 *
 * Una tabla, no una rejilla de tarjetas: las mismas filas que el tablero (FilaProcesamiento),
 * más la columna de quién pagó cada lectura, que es por lo que también se filtra.
 *
 * "use client": recibe solo datos serializables (nunca una función); `href` se arma ACÁ
 * mismo a partir de los filtros primitivos, porque una función no puede cruzar de un server
 * component a un client component (Paginacion es "use client"; React no puede serializarla).
 *
 * El vacío dice la verdad sobre su causa: sin filtros puestos no se culpa a los filtros, y
 * una página que no existe (?pagina=99) se nombra como tal, con un enlace a la primera. Va
 * sin llamita: la página ya la muestra en el tablero de arriba (una por pantalla).
 */

import Link from "next/link";
import { Paginacion } from "@/components/ui/Paginacion";
import { plural } from "@/lib/formato";
import { AvisoSinLlamita } from "./TableroAuditoria";
import { CabeceraFilas, FilaProcesamiento } from "./FilaProcesamiento";
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
        pagina == null ? (
          <AvisoSinLlamita tono="error" titulo="No pudimos cargar el histórico">
            El servicio no respondió. Vuelve a cargar la página en un momento.
          </AvisoSinLlamita>
        ) : fueraDeRango ? (
          <AvisoSinLlamita
            titulo={`La página ${paginaActual} no existe`}
            accion={
              <Link href={href(1)} className="text-[13px] font-semibold text-granate underline-offset-2 hover:underline">
                Ir a la primera
              </Link>
            }
          >
            El histórico tiene {plural(paginas, "página", "páginas")}.
          </AvisoSinLlamita>
        ) : hayFiltros ? (
          <AvisoSinLlamita titulo="Nada coincide con estos filtros">
            Los filtros puestos están arriba, cada uno con su propia X: quita uno y vuelve a mirar.
          </AvisoSinLlamita>
        ) : (
          <AvisoSinLlamita titulo="Todavía no se leyó ningún contrato financiado">
            Cuando termine el primer análisis, aparece acá con lo que encontró y quién lo pagó.
          </AvisoSinLlamita>
        )
      ) : (
        // Las pistas de la fila son `minmax(0, 1fr)`: el objeto con `truncate` no estira la
        // tabla (en 390 px la rejilla vieja scrolleaba en horizontal por eso).
        <div className="overflow-hidden rounded-2xl border border-line bg-paper">
          <CabeceraFilas estado="Resultado" tiempo="Leído" conFinanciador />
          <ul>
            {items.map((p) => (
              <li key={p.ocid} className="border-b border-line/70 last:border-b-0">
                <FilaProcesamiento p={p} ahora={0} conFinanciador />
              </li>
            ))}
          </ul>
        </div>
      )}
      {items.length > 8 && paginador}
    </div>
  );
}
