import { DatosClave, EstadoVacio, FuenteDato } from "@/components/patrones";
import { CONOSCE_BUSCADOR } from "@/lib/fuentes";
import {
  BarraFiltros,
  CeldaFecha,
  CeldaNumero,
  CeldaPrincipal,
  Tabla,
  type Columna,
  type Fila,
  type Parametros,
} from "@/components/listado";
import { AvisoDato, BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { motivoDudoso } from "@/lib/datoDudoso";
import { fecha, fechaCorta, numero, oracion, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { tipoContratacion } from "@/lib/personas";
import { type FacetasOrdenes, type OrdenEmpresa, type Pagina } from "@/lib/empresas";
import { entidadEtq, NoCargo, opcionesDe, ORDEN_LISTA, Paginas } from "./comun";
import { P_ORDENES } from "@/lib/parametrosEmpresa";

/** La pestaña Órdenes: las órdenes de compra y de servicio que le emitieron. (Partido de SeccionesEmpresa.tsx, 2026-10-22.) */

// ─── Órdenes ──────────────────────────────────────────────────────────────────

export { P_ORDENES };

const COLUMNAS_ORDENES: Columna[] = [
  { clave: "fecha", titulo: "Emitida", ancho: "92px", desde: "md", apilar: true },
  { clave: "orden", titulo: "Orden", ancho: "minmax(0,1.8fr)" },
  { clave: "estado", titulo: "Estado y banderas", ancho: "minmax(0,0.7fr)", desde: "lg", apilar: true },
  // En el celular el monto va bajo la descripción, con su nombre (como en Contratos): en su columna le quitaba el ancho.
  { clave: "monto", titulo: "Monto", ancho: "116px", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

/** Los filtros de sus órdenes, con su conteo: año, entidad y tipo a la vista; región, estado y posible error, detrás. */
export function BarraOrdenes({ facetas: f }: { facetas: FacetasOrdenes | null }) {
  return (
    <BarraFiltros
      busqueda={{ param: P_ORDENES.q, placeholder: "Buscar en la descripción, la entidad o el número…", etiqueta: "Buscar en sus órdenes", min: 3 }}
      visibles={[
        { param: P_ORDENES.anio, etiqueta: "Año", corta: "Año", todas: "Todos los años", opciones: opcionesDe(f?.anios) },
        { param: P_ORDENES.entidad, etiqueta: "Entidad que compró", corta: "Entidad", todas: "Toda entidad", opciones: opcionesDe(f?.entidades, entidadEtq) },
        {
          param: P_ORDENES.tipo, etiqueta: "Tipo de orden", corta: "Tipo", todas: "Compra y servicio",
          opciones: [
            { valor: "compra", etiqueta: "Órdenes de compra", conteo: f?.tipos.compra ?? null },
            { valor: "servicio", etiqueta: "Órdenes de servicio", conteo: f?.tipos.servicio ?? null },
          ].filter((o) => o.conteo == null || o.conteo > 0),
        },
      ]}
      filtros={[
        { param: P_ORDENES.departamento, etiqueta: "Región de la entidad", todas: "Todo el Perú", opciones: opcionesDe(f?.departamentos, (x) => tituloNatural(String(x.valor))) },
        { param: P_ORDENES.estado, etiqueta: "Estado de la orden", todas: "Todo estado", opciones: opcionesDe(f?.estados?.filter((x) => x.n > 0)) },
        ...(f?.dudosas
          ? [{ param: P_ORDENES.dudosa, etiqueta: "Posible error de carga", todas: "Todas", opciones: [{ valor: "si", etiqueta: "Sólo con posible error", conteo: f.dudosas }] }]
          : []),
      ]}
      orden={{ param: P_ORDENES.orden, porDefecto: "reciente", opciones: ORDEN_LISTA }}
    />
  );
}

export async function BarraOrdenesConConteos({ pagina }: { pagina: Promise<(Pagina<OrdenEmpresa> & { facetas: FacetasOrdenes | null }) | null> }) {
  return <BarraOrdenes facetas={(await pagina)?.facetas ?? null} />;
}

export async function OrdenesEmpresa({ pagina: p, ruta, parametros, actual }: { pagina: Promise<Pagina<OrdenEmpresa> | null>; ruta: string; parametros: Parametros; actual: number }) {
  const pagina = await p;
  if (!pagina) return <NoCargo que="sus órdenes" />;
  if (!pagina.total) return <EstadoVacio compacto titulo="Ninguna orden con estos filtros">Quita el filtro de año, de tipo o la búsqueda.</EstadoVacio>;
  const filas: Fila[] = pagina.data.map((o, i) => {
    const motivo = o.montoDudoso != null ? motivoDudoso(o.dudosoMotivo) ?? "mayor_100m" : null;
    const tipo = tipoContratacion(o.tipoContratacion);
    const entidad = o.entidad ? tituloNatural(o.entidad) : null;
    const descripcion = o.descripcion ? oracion(o.descripcion) : "Sin descripción";
    const clase = o.tipoOrden && /compra/i.test(o.tipoOrden) ? "Orden de compra" : "Orden de servicio";
    return {
      id: `${o.orden ?? i}-${o.fecha}-${o.entidadRuc}`,
      celdas: {
        fecha: <CeldaFecha fecha={o.fecha} />,
        orden: (
          <CeldaPrincipal
            titulo={descripcion}
            dosLineas
            meta={[
              entidad && <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
              <Dato key="tipo" tipo="tipo">{clase}</Dato>,
              o.numero && <Dato key="numero" tipo="codigo" nombre="Número de orden" mono>{`N.° ${o.numero}`}</Dato>,
            ]}
          />
        ),
        estado: (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-meta text-inkSoft">{o.estado ?? "Sin estado"}</span>
            {motivo && <BanderaDato motivo={motivo} fuente="conosce_ordenes" />}
          </span>
        ),
        monto: <CeldaNumero sub={motivo ? "posible error de CONOSCE" : tipo?.corto}>{o.monto != null ? soles(o.monto) : "Sin dato"}</CeldaNumero>,
      },
      detalle: {
        titulo: o.numero ? `${clase} N.° ${o.numero}` : clase,
        etiqueta: `Ver el detalle de la orden ${o.numero ?? ""}`.trim(),
        descripcion: entidad ?? undefined,
        contenido: (
          <div className="space-y-4">
            {motivo && <AvisoDato motivo={motivo} fuente="conosce_ordenes">{`La orden trae ${soles(o.monto)} en el archivo oficial de CONOSCE.`}</AvisoDato>}
            <DatosClave
              items={[
                { etiqueta: "Qué se compró", valor: descripcion },
                { etiqueta: "Entidad", valor: entidad },
                { etiqueta: "Emitida", valor: o.fecha ? fechaCorta(o.fecha) : null, mono: true },
                { etiqueta: "Estado", valor: o.estado },
                { etiqueta: "Monto", valor: o.monto != null ? (motivo ? `${soles(o.monto)}, tal como lo publicó CONOSCE` : soles(o.monto)) : null, mono: true },
                { etiqueta: "Cómo se contrató", valor: tipo?.corto ?? null },
                { etiqueta: "¿Tuvo convocatoria?", valor: tipo?.convocatoria || null },
              ]}
            />
          </div>
        ),
        pie: (
          <FuenteDato
            fuente={`OECE, CONOSCE, órdenes de compra y de servicio${o.orden ? ` (${o.orden})` : ""}`}
            enlaces={[{ texto: "Buscador de CONOSCE (OECE): búscala por entidad y número", href: CONOSCE_BUSCADOR }]}
          />
        ),
      },
    };
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-inkSoft">{plural(pagina.total, "orden", "órdenes")}</p>
        <Paginas total={pagina.total} size={pagina.size} actual={actual} ruta={ruta} parametros={parametros} param={P_ORDENES.page} nombre="órdenes" />
      </div>
      <Tabla columnas={COLUMNAS_ORDENES} filas={filas} etiqueta="Órdenes de compra y de servicio" />
      <Paginas total={pagina.total} size={pagina.size} actual={actual} ruta={ruta} parametros={parametros} param={P_ORDENES.page} nombre="órdenes" />
    </div>
  );
}
