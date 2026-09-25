/**
 * "Todo lo que ya se leyó" sobre la plantilla Listado (DESIGN_SYSTEM.md §14.1): paginación
 * arriba a la derecha y abajo, la `Tabla` del kit y los estados vacío/error. Va dentro del
 * `Listado` + `ZonaResultados` de /app/auditoria, cuya `BarraFiltros` pone los filtros en la URL.
 *
 * Un registro estable: no se refresca cada 5 s como el tablero en vivo, así que se pagina
 * por URL (?pagina=) y se renderiza en el servidor. Paginacion recibe `hrefBase` + `query`
 * (datos), nunca una función: cruzar una función de server a client rompe en producción.
 *
 * Una fila por contrato: resultado (chip) · el contrato · señales · valor · [lo pagó] · leído · ›.
 * "Lo pagó" sólo aparece cuando hay más de un financiador: una columna que repite el mismo
 * nombre en todas las filas no informa nada.
 *
 * El vacío dice la verdad sobre su causa: sin filtros no se culpa a los filtros, y una página
 * que no existe (?pagina=99) se nombra como tal, con un enlace a la primera.
 */

import { Paginacion } from "@/components/ui/Paginacion";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { EstadoError, EstadoVacio } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaTexto, Tabla, type Fila } from "@/components/listado";
import { numero, plural } from "@/lib/formato";
import { estadoVisible, type Procesamiento, type ProcesamientosPagina } from "@/lib/auditoria";
import { CeldaContrato, CeldaValor, EstadoProcesamiento, columnasHistorico, hrefProcesamiento } from "./CeldasProcesamiento";

export const TAM_HISTORICO = 24;

/** Los filtros de /app/auditoria, ya validados (tipo, no interfaz: se pasa como `Record` a Paginacion). */
export type FiltrosAuditoria = {
  ubigeo?: string;
  desde?: string;
  hasta?: string;
  financiador?: string;
};

/** Señales publicadas. En revisión (§10.4) o con el dictamen publicándose: nada, ni un cero. */
function celdaSenales(p: Procesamiento) {
  if (estadoVisible(p) === "revision" || p.score == null) return <></>;
  return <CeldaNumero>{numero(p.banderas ?? 0)}</CeldaNumero>;
}

export function HistoricoProcesados({
  pagina,
  paginaActual,
  filtros,
  conFinanciador,
}: {
  pagina: ProcesamientosPagina | null;
  paginaActual: number;
  filtros: FiltrosAuditoria;
  conFinanciador: boolean;
}) {
  const hayFiltros = !!(filtros.ubigeo || filtros.desde || filtros.hasta || filtros.financiador);
  // Primera página con los mismos filtros: para reintentar y para salir de una página que no existe.
  const qs = new URLSearchParams(Object.entries(filtros).filter((e): e is [string, string] => !!e[1])).toString();
  const primera = `/app/auditoria${qs ? `?${qs}` : ""}#historico`;

  if (pagina == null) {
    return (
      <EstadoError
        titulo="No pudimos leer lo ya leído"
        accion={<EnlaceAccion variante="secundario" href={primera}>Reintentar</EnlaceAccion>}
      >
        El servicio no respondió. No mostramos nada en su lugar.
      </EstadoError>
    );
  }

  const total = pagina.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / TAM_HISTORICO));
  const items = pagina.data ?? [];

  if (total === 0) {
    return hayFiltros ? (
      <EstadoVacio
        compacto
        titulo="Nada leído con estos filtros"
        accion={<EnlaceAccion variante="secundario" href="/app/auditoria#historico">Quitar los filtros</EnlaceAccion>}
      >
        Prueba quitando el último filtro que agregaste.
      </EstadoVacio>
    ) : (
      <EstadoVacio titulo="Todavía no se leyó ningún contrato financiado">
        Cuando termine el primer análisis, aparece aquí con lo que encontró y quién lo pagó.
      </EstadoVacio>
    );
  }

  if (paginaActual > paginas) {
    return (
      <EstadoVacio
        compacto
        titulo={`La página ${numero(paginaActual)} no existe`}
        accion={<EnlaceAccion variante="secundario" href={primera}>Ir a la primera</EnlaceAccion>}
      >
        Lo ya leído tiene {plural(paginas, "página", "páginas")}.
      </EstadoVacio>
    );
  }

  const filas: Fila[] = items.map((p) => ({
    id: p.ocid,
    href: hrefProcesamiento(p.ocid),
    celdas: {
      estado: <EstadoProcesamiento p={p} />,
      contrato: <CeldaContrato p={p} />,
      senales: celdaSenales(p),
      valor: <CeldaValor p={p} />,
      pago: <CeldaTexto sub={<span className="font-mono">{p.contribucionCodigo}</span>}>{p.financiador}</CeldaTexto>,
      leido: <CeldaFecha fecha={p.finalizadoAt} />,
    },
  }));

  const pag = (
    <Paginacion
      actual={paginaActual}
      paginas={paginas}
      total={total}
      tam={TAM_HISTORICO}
      navegacion="url"
      hrefBase="/app/auditoria"
      query={filtros}
      cargando={false}
      nombre="contratos leídos"
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag}</div>
      <Tabla columnas={columnasHistorico(conFinanciador)} filas={filas} etiqueta="Contratos financiados ya leídos" />
      <div className="flex justify-end">{pag}</div>
    </div>
  );
}
