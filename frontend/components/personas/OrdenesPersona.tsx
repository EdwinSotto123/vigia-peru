import { Suspense, type ReactNode } from "react";
import { Ayuda, AyudaTermino, CabeceraPestana, DatosClave, EstadoError, EstadoVacio, FuenteDato } from "@/components/patrones";
import {
  BarraFiltros,
  CeldaFecha,
  CeldaNumero,
  CeldaPrincipal,
  Listado,
  Tabla,
  TablaSkeleton,
  ZonaResultados,
  type Columna,
  type Fila,
  type Parametros,
} from "@/components/listado";
import { AvisoDato, BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { Paginacion } from "@/components/ui/Paginacion";
import { motivoDudoso } from "@/lib/datoDudoso";
import { fechaCorta, oracion, soles } from "@/lib/formato";
import { CONOSCE_BUSCADOR } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { tipoContratacion, type FichaPersona, type OrdenesPersona, type filtrosOrdenesDeUrl } from "@/lib/personas";

/** Cuántas órdenes por página en la pestaña Órdenes de una persona. */
export const TAM_ORDENES = 20;

type FiltrosOrdenes = ReturnType<typeof filtrosOrdenesDeUrl>;

/** Los parámetros de la pestaña Órdenes en la URL (para `Listado` y la paginación). */
export const parametrosOrdenes = (f: FiltrosOrdenes): Parametros => ({
  seccion: "ordenes",
  oent: f.entidad,
  oanio: f.anio ? String(f.anio) : undefined,
  oq: f.q,
});

/**
 * La pestaña Órdenes de una persona que recibe órdenes de servicio: todas, de la más reciente a la más antigua,
 * paginadas en el servidor, con buscador y filtros por entidad y año (en la URL: `oent`, `oanio`, `oq`, `opag`). Cada
 * orden abre su panel. La usan la ficha de persona contratada y la de planilla (si la persona también es locador).
 */
export function PestanaOrdenes({
  ruta,
  pagina,
  filtros,
  ficha,
  descripcion,
  ayuda,
}: {
  ruta: string;
  pagina: Promise<OrdenesPersona | null>;
  filtros: FiltrosOrdenes;
  /** La ficha de la persona: de ahí salen las opciones (y sus conteos) de entidad y año. */
  ficha: FichaPersona | null;
  descripcion?: ReactNode;
  ayuda?: ReactNode;
}) {
  const parametros = parametrosOrdenes(filtros);
  const entidades = (ficha?.entidades ?? []).map((e) => ({ valor: e.entidadRuc, etiqueta: e.entidad ? tituloNatural(e.entidad) : e.entidadRuc, conteo: e.ordenes }));
  const anual = ficha?.anual ?? [];
  const anios = [...new Set(anual.map((a) => a.anio))]
    .sort((a, b) => b - a)
    .map((a) => ({ valor: String(a), etiqueta: String(a), conteo: anual.filter((x) => x.anio === a).reduce((n, x) => n + x.ordenes, 0) }));
  return (
    <div className="space-y-4">
      <CabeceraPestana ayuda={ayuda}>{descripcion ?? "Todas sus órdenes de servicio, de la más reciente a la más antigua: toca una para su detalle."}</CabeceraPestana>
      <Listado ruta={ruta} parametros={parametros} paramPagina="opag">
        <BarraFiltros
          busqueda={{ param: "oq", placeholder: "Buscar en la descripción, la entidad o el número…", etiqueta: "Buscar en sus órdenes", min: 3 }}
          visibles={[
            ...(entidades.length > 1 ? [{ param: "oent", etiqueta: "Entidad", corta: "Entidad", todas: "Toda entidad", opciones: entidades }] : []),
            ...(anios.length > 1 ? [{ param: "oanio", etiqueta: "Año", corta: "Año", todas: "Todos los años", opciones: anios }] : []),
          ]}
        />
        <ZonaResultados>
          <Suspense fallback={<TablaSkeleton columnas={COLUMNAS_ORDENES} filas={10} />}>
            <TablaOrdenes pagina={pagina} parametros={parametros} ruta={ruta} actual={filtros.page} />
          </Suspense>
        </ZonaResultados>
      </Listado>
    </div>
  );
}

// En el celular la fecha y el estado (con sus banderas) se apilan bajo la descripción, no bajo la fecha angosta.
const COLUMNAS_ORDENES: Columna[] = [
  { clave: "fecha", titulo: "Emitida", ancho: "92px", desde: "md", apilar: true },
  { clave: "orden", titulo: "Orden de servicio", ancho: "minmax(0,1.8fr)", ayuda: <AyudaTermino clave="orden-servicio" /> },
  {
    clave: "estado",
    titulo: "Estado y banderas",
    ancho: "minmax(0,0.7fr)",
    desde: "lg",
    apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué es «posible error de carga»?">
        Un monto que el Estado publicó y no se puede creer: el RUC del proveedor escrito como monto, una orden de hasta 8 UIT
        que pasa 20 veces su tope. Vigía lo guarda y lo muestra tal como vino, pero no lo suma en los totales.
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Monto", ancho: "116px", alinear: "der" },
];

async function TablaOrdenes({ pagina: p, parametros, ruta, actual }: { pagina: Promise<OrdenesPersona | null>; parametros: Parametros; ruta: string; actual: number }) {
  const pagina = await p;
  if (!pagina) return <EstadoError titulo="No pudimos cargar sus órdenes">Suele ser momentáneo: vuelve a intentarlo en unos segundos.</EstadoError>;
  if (!pagina.total) return <EstadoVacio compacto titulo="Ninguna orden con estos filtros">Quita el filtro de entidad o de año.</EstadoVacio>;
  const pag = (
    <Paginacion
      actual={actual}
      paginas={Math.max(1, Math.ceil(pagina.total / pagina.size))}
      total={pagina.total}
      tam={pagina.size}
      navegacion="url"
      hrefBase={ruta}
      query={parametros}
      paramPagina="opag"
      cargando={false}
      nombre="órdenes"
    />
  );
  const filas: Fila[] = pagina.data.map((o, i) => {
    // El monto es siempre el que publicó CONOSCE; si puede ser un error suyo, la fila lo dice y va aparte de las sumas.
    const motivo = o.montoDudoso != null ? motivoDudoso(o.dudosoMotivo) ?? "mayor_100m" : null;
    const tipo = tipoContratacion(o.tipoContratacion);
    const entidad = o.entidad ? tituloNatural(o.entidad) : null;
    const descripcion = o.descripcion ? oracion(o.descripcion) : "Sin descripción";
    return {
      id: `${o.orden ?? i}-${o.fecha}`,
      celdas: {
        fecha: <CeldaFecha fecha={o.fecha} />,
        orden: (
          <CeldaPrincipal
            titulo={descripcion}
            dosLineas
            meta={[
              entidad && <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
              o.servicio && <Dato key="servicio" tipo="servicio">{o.servicio}</Dato>,
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
        monto: motivo ? (
          <CeldaNumero sub="posible error de CONOSCE">{soles(o.monto)}</CeldaNumero>
        ) : (
          <CeldaNumero sub={tipo?.corto}>{o.monto != null ? soles(o.monto) : "Sin dato"}</CeldaNumero>
        ),
      },
      detalle: {
        titulo: o.numero ? `Orden de servicio N.° ${o.numero}` : "Orden de servicio",
        etiqueta: `Ver el detalle de la orden ${o.numero ?? ""}`.trim(),
        descripcion: entidad ?? undefined,
        contenido: (
          <div className="space-y-4">
            {motivo && (
              <AvisoDato motivo={motivo} fuente="conosce_ordenes">
                {`La orden trae ${soles(o.monto)} en el archivo oficial de CONOSCE.`}
              </AvisoDato>
            )}
            <DatosClave
              items={[
                { etiqueta: "Qué se pagó", valor: descripcion },
                { etiqueta: "Entidad", valor: entidad },
                { etiqueta: "Emitida", valor: o.fecha ? fechaCorta(o.fecha) : null, mono: true },
                { etiqueta: "Estado", valor: o.estado },
                { etiqueta: "Monto", valor: o.monto != null ? (motivo ? `${soles(o.monto)}, tal como lo publicó CONOSCE` : soles(o.monto)) : null, mono: true },
                { etiqueta: "Tipo de servicio", valor: o.servicio },
                { etiqueta: "Cómo se contrató", valor: tipo?.corto ?? null },
                { etiqueta: "¿Tuvo convocatoria?", valor: tipo?.convocatoria || null },
              ]}
            />
          </div>
        ),
        // CONOSCE no tiene enlace por orden: su buscador, por entidad y número.
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
      <div className="flex justify-end">{pag}</div>
      <Tabla columnas={COLUMNAS_ORDENES} filas={filas} etiqueta="Órdenes de servicio" />
      <div className="flex justify-end">{pag}</div>
    </div>
  );
}
