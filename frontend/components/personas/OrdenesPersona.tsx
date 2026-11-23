import { Suspense, type ReactNode } from "react";
import Link from "next/link";
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
import { ExpedienteSiaf } from "@/components/ordenes/ExpedienteSiaf";
import { AvisoDato, BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { Paginacion } from "@/components/ui/Paginacion";
import { motivoDudoso } from "@/lib/datoDudoso";
import { fechaConAnio, oracion, soles } from "@/lib/formato";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { DocumentosProceso } from "@/components/ordenes/DocumentosProceso";
import { CONOSCE_BUSCADOR, enlacesProceso } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { tipoContratacion, type FichaPersona, type OrdenPersona, type OrdenesPersona, type ProcesoGanado, type filtrosOrdenesDeUrl } from "@/lib/personas";
import { rutaContrato } from "@/lib/rutas";

/** Cuántas órdenes por página en la pestaña Órdenes de una persona: 10, páginas cortas (pedido del usuario del 2026-11-23). */
export const TAM_ORDENES = 10;

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
            <TablaOrdenes pagina={pagina} parametros={parametros} ruta={ruta} actual={filtros.page} procesos={ficha?.procesos ?? []} />
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

/**
 * El proceso que la orden probablemente paga (2026-11-23, el usuario: «¿por qué no trae documentos?»): CONOSCE no dice qué
 * proceso paga una orden, pero la persona lo ganó en la misma entidad. Se elige el de su misma clase (una orden «directa»,
 * una contratación directa; una que «deviene de procesos», un proceso con concurso) con la buena pro antes de la orden y a
 * lo más tres años antes, el más reciente. Por ejemplo: el alquiler de oficinas de la Municipalidad de Lima por S/ 1.92 M
 * al año sale de la contratación directa de S/ 5.76 M por tres años. Es una inferencia y el panel lo dice.
 */
function procesoDeLaOrden(o: OrdenPersona, procesos: ProcesoGanado[]): { p: ProcesoGanado; otros: number } | null {
  if (!o.fecha || !/directa|deviene/i.test(o.tipoContratacion ?? "")) return null;
  const directa = /directa/i.test(o.tipoContratacion ?? "");
  const tope = new Date(o.fecha);
  tope.setFullYear(tope.getFullYear() - 3);
  const desde = tope.toISOString().slice(0, 10);
  const xs = procesos
    .filter((x) => x.entidadRuc === o.entidadRuc && x.fecha && x.fecha <= o.fecha && x.fecha >= desde)
    .sort((a, b) => Number(/directa/i.test(b.tipoProceso ?? "") === directa) - Number(/directa/i.test(a.tipoProceso ?? "") === directa) || (b.fecha ?? "").localeCompare(a.fecha ?? ""));
  return xs.length ? { p: xs[0], otros: xs.length - 1 } : null;
}

/**
 * El proceso de la orden en su panel: qué es, cuándo y cuánto, y sus documentos. Si Vigía lo tiene, su ficha (con sus
 * documentos y su análisis); si no, se dice (no tiene análisis ni banderas) y sus PDF vienen del registro del OECE.
 */
function BloqueProceso({ p, otros }: { p: ProcesoGanado; otros: number }) {
  const enlaces = enlacesProceso(p.ocid, { codigo: p.codigo, conosce: true }).filter((e) => !/CONOSCE/.test(e.texto));
  return (
    <section aria-label="El proceso que respalda la orden" className="space-y-3 rounded-xl border border-line bg-paperSoft p-3.5">
      <h3 className="flex items-center gap-1.5 text-cuerpo font-semibold text-ink">
        El proceso que la respalda
        <Ayuda titulo="¿Cómo se sabe?">
          CONOSCE no dice qué proceso paga cada orden. Este es el que la persona ganó en la misma entidad, de la misma clase
          (directa o con concurso) y con la buena pro antes de la orden, el más reciente de los últimos tres años. Es lo más
          probable, no un dato publicado.
        </Ayuda>
      </h3>
      {/* Sus banderas en Vigía (casos_cruce), si las tiene: la orden las hereda. */}
      {p.cruces && p.cruces.length > 0 && <CrucesCelda cruces={p.cruces} max={4} etiquetaLista="Antecedentes del proceso" />}
      <DatosClave
        items={[
          { etiqueta: "Proceso", valor: p.nomenclatura ?? `Código ${p.codigo}`, mono: true },
          { etiqueta: "Tipo", valor: p.tipoProceso },
          { etiqueta: "Objeto", valor: p.objeto ? oracion(p.objeto) : null },
          { etiqueta: "Buena pro", valor: p.fecha ? fechaConAnio(p.fecha) : null, mono: true },
          { etiqueta: "Adjudicado", valor: p.monto != null ? soles(p.monto) : null, mono: true },
        ]}
      />
      {p.ocid ? (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta">
          <Link href={rutaContrato(p.ocid)} prefetch={false} className="font-semibold text-granate underline-offset-2 hover:underline">
            Ver el proceso en Vigía, con sus documentos y su análisis
          </Link>
          {enlaces.map((e) => (
            <a key={e.href} href={e.href} target="_blank" rel="noreferrer" className="font-medium text-granate underline-offset-2 hover:underline">
              {e.texto}
            </a>
          ))}
        </p>
      ) : (
        // Sin el proceso en Vigía: lo que se pierde, dicho, y sus PDF del registro del OECE.
        <DocumentosProceso codigo={p.codigo} />
      )}
      {otros > 0 && <p className="text-rotulo text-mute">Ganó {otros === 1 ? "otro proceso" : `otros ${otros} procesos`} en la entidad en esos tres años: están en su pestaña Procesos.</p>}
    </section>
  );
}

async function TablaOrdenes({
  pagina: p,
  parametros,
  ruta,
  actual,
  procesos,
}: {
  pagina: Promise<OrdenesPersona | null>;
  parametros: Parametros;
  ruta: string;
  actual: number;
  procesos: ProcesoGanado[];
}) {
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
    const proceso = procesoDeLaOrden(o, procesos);
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
                // La entidad lleva a su ficha (el proveedor es esta persona: no se enlaza). Sólo en el panel: la fila
                // entera ya es un botón.
                {
                  etiqueta: "Entidad",
                  valor: entidad && o.entidadRuc ? (
                    <Link href={`/entidad/${o.entidadRuc}`} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
                      {entidad}
                    </Link>
                  ) : (
                    entidad
                  ),
                },
                // Con el año: «Emitida: 4 ago.» no decía de qué año era la orden.
                { etiqueta: "Emitida", valor: o.fecha ? fechaConAnio(o.fecha) : null, mono: true },
                { etiqueta: "Estado", valor: o.estado },
                { etiqueta: "Monto", valor: o.monto != null ? (motivo ? `${soles(o.monto)}, tal como lo publicó CONOSCE` : soles(o.monto)) : null, mono: true },
                { etiqueta: "Tipo de servicio", valor: o.servicio },
                { etiqueta: "Cómo se contrató", valor: tipo?.corto ?? null },
                { etiqueta: "¿Tuvo convocatoria?", valor: tipo?.convocatoria || null },
                // El expediente SIAF de la orden (su compromiso y su pago), a pedido: lo busca en el SEACE al tocarlo.
                ...(o.entidadRuc && o.fecha && o.numero
                  ? [{ etiqueta: "Expediente SIAF", valor: <ExpedienteSiaf entidadRuc={o.entidadRuc} fecha={o.fecha} compra={false} numero={o.numero} />, ayuda: <AyudaTermino clave="expediente-siaf" /> }]
                  : []),
              ]}
            />
            {proceso && <BloqueProceso p={proceso.p} otros={proceso.otros} />}
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
