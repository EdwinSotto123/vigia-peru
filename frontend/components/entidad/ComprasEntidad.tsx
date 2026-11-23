import { Suspense } from "react";
import { Ayuda, CabeceraPestana } from "@/components/patrones";
import { Listado, ZonaResultados, type Parametros } from "@/components/listado";
import { BarraCompras, ListaCompras, ListaComprasCargando } from "@/components/compras/ListaCompras";
import { CLASES_COMPRA, P_COMPRAS, getCompras, parametrosCompras, type FiltrosCompras } from "@/lib/compras";

/**
 * La pestaña Compras de la ficha de una entidad (`?seccion=contratos`): todo lo que compró en UNA lista, una fila por
 * compra (components/compras/ListaCompras.tsx, GET /compras, migración 240). Antes eran cuatro vistas que se repetían
 * (Contratos, Órdenes, Menores y Catálogo): una compra por catálogo estaba en dos, un contrato menor en dos, un proceso y
 * sus pagos en dos. Los enlaces de antes (`vista=catalogo&csob=si`, `vista=ordenes&oant=…`, `cruce=…`) siguen andando:
 * lib/compras.ts los traduce a los filtros de esta lista.
 */

/** Filas por página: diez (páginas cortas; con veinte la pestaña medía dos pantallas de tabla). */
export const TAM = 10;

export function ComprasEntidad({ ruc, ruta, filtros }: { ruc: string; ruta: string; filtros: FiltrosCompras }) {
  const parametros: Parametros = { seccion: "contratos", ...parametrosCompras(filtros) };
  const pagina = getCompras({ entidad: ruc }, filtros, TAM);
  return (
    <div>
      <CabeceraPestana ayuda={<AyudaCompras />} />
      <Listado ruta={ruta} parametros={parametros} paramPagina={P_COMPRAS.page}>
        <Suspense fallback={<div className="min-h-[52px]" />}>
          <BarraCompras pagina={pagina} ancla="entidad" con={filtros.con} proceso={Object.keys(filtros.proceso ?? {})} />
        </Suspense>
        <ZonaResultados>
          <Suspense fallback={<ListaComprasCargando />}>
            <ListaCompras pagina={pagina} ruta={ruta} parametros={parametros} actual={filtros.page ?? 1} ancla="entidad" />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </div>
  );
}

/** La ⓘ de la pestaña: qué hay en la lista, cómo se compra y por qué cada compra va una sola vez. */
export function AyudaCompras() {
  return (
    <Ayuda titulo="¿Qué compras hay aquí?">
      <span className="block">
        Todo lo que compró la entidad, una fila por compra: sus procesos de selección desde 2015 (OECE), sus compras por el
        catálogo de Perú Compras desde 2017, sus contratos menores desde 2025 y sus órdenes del SEACE desde 2018.
      </span>
      {CLASES_COMPRA.map((c) => (
        <span key={c.valor} className="mt-2 block">
          <span className="font-semibold text-ink">{c.etiqueta}:</span> {c.explica}
        </span>
      ))}
      <span className="mt-2 block">
        Una compra deja huella en más de un registro: la del catálogo y el contrato menor también tienen su orden en el SEACE,
        y un proceso se paga con órdenes. Vigía las junta por el número de la orden, el proveedor, el monto y la fecha, y cada
        compra va una vez con todo en su panel. Las banderas salen del cruce automático de datos públicos: son motivos para
        revisar, no pruebas.
      </span>
    </Ayuda>
  );
}
