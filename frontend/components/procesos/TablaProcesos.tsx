import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { EstadoContratoChip } from "@/components/contratos/estadoLectura";
import { limpiarObjeto } from "@/components/contratos/recortar";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila, type Parametros } from "@/components/listado";
import { Paginacion } from "@/components/ui/Paginacion";
import { DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { numero, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import type { ProcesoPartido, ProcesosPartido } from "@/lib/partidosApi";
import type { DatoDudosoContrato } from "@/lib/contratos";
import { Dato } from "@/components/ui/Dato";
import { AvisoContrato, ConBanderaDato } from "@/components/contratos/DatoDudosoContrato";

/** La fila trae además el posible error de carga del OECE (migración 102, lib/estadoFila.ts de la API). */
type Proceso = ProcesoPartido & { datoDudoso?: DatoDudosoContrato | null };

/**
 * Procesos adjudicados de CONOSCE en la `Tabla` del kit: convocado, estado en Vigía (leído o no y su peso del riesgo),
 * el proceso (qué se compró, entidad y lugar), los antecedentes del ganador, lo adjudicado y el ganador. El estado y los
 * antecedentes sólo existen para los procesos que también están en la base de Vigía (con ocid). La usan la ficha de un partido (los de sus gobiernos, GET /partidos/:clave/procesos) y la de
 * una entidad (los suyos desde 2015, GET /entidades/:ruc/procesos); en la de la entidad no se repite la entidad en
 * cada fila. Cada fila abre su resumen en el panel; si el proceso también está en la base de Vigía, el panel lleva a
 * su ficha. Paginado por URL (`paramPagina`), con los filtros de la barra. Server-safe.
 */

const COLUMNAS: Columna[] = [
  { clave: "fecha", titulo: "Convocado", ancho: "92px", desde: "md" },
  {
    clave: "estado", titulo: "Estado en Vigía", ancho: "132px", desde: "md", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué dice el estado?">
        Si Vigía ya leyó el contrato, su peso del riesgo (alto, medio, bajo o sin señales) o «En revisión». Si no, en qué
        punto está («En cola», «Docs listos», «Sin leer»). «No está en Vigía»: el OECE lo registra, pero no entró a la base
        de Vigía, así que no se leyó ni se cruzó con otras fuentes.
      </Ayuda>
    ),
  },
  { clave: "proceso", titulo: "Contrato", ancho: "minmax(0,1.6fr)" },
  {
    clave: "cruces", titulo: "Antecedentes", ancho: "minmax(0,1fr)", desde: "md", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué son los antecedentes del ganador?">
        Datos oficiales donde aparece quien ganó (o sus socios y representantes): aportes y gastos de campaña, candidaturas,
        sanciones, penalidades, visitas a entidades, socios comunes con otros postores, sobreprecios. En rojo, los graves.
        No prueban una irregularidad.
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Adjudicado", ancho: "116px", alinear: "der" },
  { clave: "ganador", titulo: "Ganador", ancho: "minmax(0,0.8fr)", desde: "xl" },
];

const NIVEL: Record<string, string> = { regional: "Gobierno regional", provincial: "Municipalidad provincial", distrital: "Municipalidad distrital" };

const enSoles = (p: Proceso) => !p.moneda || /soles/i.test(p.moneda);
const monto = (v: number | null, p: Proceso) =>
  v == null ? "Sin dato" : enSoles(p) ? soles(v) : `${numero(Math.round(v))} ${p.moneda ?? ""}`.trim();

export function TablaProcesos({
  pagina,
  parametros,
  ruta,
  actual,
  paramPagina = "page",
  deEntidad = false,
}: {
  pagina: ProcesosPartido | null;
  parametros: Parametros;
  ruta: string;
  actual: number;
  paramPagina?: string;
  /** La lista de UNA entidad: sin la entidad en cada fila y con el texto vacío de una entidad. */
  deEntidad?: boolean;
}) {
  if (!pagina) {
    return (
      <EstadoError titulo="No pudimos cargar los contratos" accion={<a href={ruta} className={ACCION}>Reintentar</a>}>
        Suele ser momentáneo: vuelve a intentarlo en unos segundos.
      </EstadoError>
    );
  }
  const filtrado = Object.entries(parametros).some(([k, v]) => !["anio", "seccion", "orden", "porden"].includes(k) && !!v);
  if (pagina.total === 0) {
    return filtrado ? (
      <EstadoVacio compacto titulo="Ningún proceso coincide con estos filtros">Prueba otra palabra o quita el filtro más restrictivo.</EstadoVacio>
    ) : (
      <EstadoVacio compacto titulo={deEntidad ? "Sin contratos adjudicados desde 2015" : "Sin contratos adjudicados en este período"}>
        {deEntidad
          ? "El OECE no registra contratos adjudicados por esta entidad desde 2015."
          : "El OECE no registra contratos adjudicados por los gobiernos de este partido en estos años."}
      </EstadoVacio>
    );
  }
  const paginas = Math.max(1, Math.ceil(pagina.total / pagina.size));
  const pag = (
    <Paginacion
      actual={actual}
      paginas={paginas}
      total={pagina.total}
      tam={pagina.size}
      navegacion="url"
      hrefBase={ruta}
      query={parametros}
      paramPagina={paramPagina}
      cargando={false}
      nombre="contratos"
    />
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-inkSoft">
          {plural(pagina.total, "contrato", "contratos")}
          {filtrado ? " con estos filtros" : ""}, {solesCompacto(pagina.montoAdjudicadoPen)} adjudicados en soles.
        </p>
        {pag}
      </div>
      <Tabla columnas={COLUMNAS} filas={pagina.data.map((p) => filaDe(p, deEntidad))} etiqueta={deEntidad ? "Procesos adjudicados de la entidad" : "Procesos adjudicados de sus gobiernos"} />
      <div className="flex justify-end">{pag}</div>
    </div>
  );
}

function filaDe(p: Proceso, deEntidad: boolean): Fila {
  // Sin los "¿" que el SEACE deja donde iban comillas y en oración, como la lista de contratos.
  const titulo = p.descripcion ? oracion(limpiarObjeto(p.descripcion)) : p.nomenclatura ?? `Proceso ${p.codigo}`;
  const entidad = p.entidad ? tituloNatural(p.entidad) : "Entidad sin nombre";
  const datos: DatoClave[] = [
    { etiqueta: "Nomenclatura", valor: p.nomenclatura ?? "Sin dato", mono: true },
    { etiqueta: "Tipo de proceso", valor: p.tipoProceso ?? "Sin dato" },
    { etiqueta: "Objeto", valor: p.objeto ?? "Sin dato" },
    { etiqueta: "Convocado", valor: p.fecha },
    { etiqueta: "Entidad", valor: <Link href={`/entidad/${p.entidadRuc}`} className="text-granate underline-offset-2 hover:underline">{entidad}</Link> },
    ...(p.nivel ? [{ etiqueta: "Gobierno", valor: [NIVEL[p.nivel], p.lugar].filter(Boolean).join(", ") }] : []),
    { etiqueta: "Valor referencial", valor: monto(p.montoReferencial, p) },
    { etiqueta: "Adjudicado", valor: monto(p.montoAdjudicado, p) },
    { etiqueta: p.proveedores > 1 ? `Ganadores (${p.proveedores})` : "Ganador", valor: p.proveedor ? (p.proveedores > 1 ? `${p.proveedor} y otros` : p.proveedor) : "Sin dato" },
    { etiqueta: "Ítems", valor: numero(p.items) },
  ];
  return {
    id: `${p.codigo}-${p.entidadRuc}`,
    celdas: {
      fecha: <CeldaFecha fecha={p.fecha} />,
      estado: (
        <ConBanderaDato dato={p.datoDudoso}>
          {p.ocid && p.estadoProcesamiento ? (
            <EstadoContratoChip
              c={{ estadoProcesamiento: p.estadoProcesamiento as never, estadoOperativo: p.estadoOperativo as never, enRevision: !!p.enRevision, score: p.score ?? null, banderas: p.banderas ?? 0 }}
            />
          ) : (
            <span className="text-[12px] text-mute">No está en Vigía</span>
          )}
        </ConBanderaDato>
      ),
      cruces: <CrucesCelda cruces={p.cruces} />,
      // En la ficha de una entidad la entidad es la misma en todas las filas: va la nomenclatura.
      proceso: (
        <CeldaPrincipal
          titulo={titulo}
          dosLineas
          meta={
            deEntidad
              ? [p.objeto && <Dato key="objeto" tipo="tipo" nombre="Objeto">{p.objeto}</Dato>, p.nomenclatura && <Dato key="nom" tipo="codigo" nombre="Nomenclatura" mono>{p.nomenclatura}</Dato>]
              : [
                  p.objeto && <Dato key="objeto" tipo="tipo" nombre="Objeto">{p.objeto}</Dato>,
                  <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
                  p.lugar && <Dato key="lugar" tipo="lugar">{p.lugar}</Dato>,
                ]
          }
        />
      ),
      monto: <CeldaNumero>{p.montoAdjudicado == null ? <span className="font-sans text-mute">Sin dato</span> : enSoles(p) ? solesCompacto(p.montoAdjudicado) : monto(p.montoAdjudicado, p)}</CeldaNumero>,
      ganador: (
        <span className="line-clamp-2 text-[13px] text-inkSoft" title={p.proveedor ?? undefined}>
          {p.proveedor ?? "Sin dato"}
          {p.proveedores > 1 && <span className="text-mute"> y {p.proveedores - 1} más</span>}
        </span>
      ),
    },
    detalle: {
      titulo,
      etiqueta: `Ver el resumen del proceso ${p.nomenclatura ?? p.codigo}`,
      descripcion: (
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-mono">{p.codigo}</span>
          <span>{entidad}</span>
        </span>
      ),
      contenido: (
        <div className="space-y-4">
          <AvisoContrato dato={p.datoDudoso} />
          <DatosClave items={datos} />
        </div>
      ),
      pie: (
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12px] text-mute">Fuente: OECE (CONOSCE desde 2018; Contrataciones Abiertas antes), procesos adjudicados</span>
          {p.ocid ? (
            <Link
              href={`/app/contratos/${encodeURIComponent(p.ocid)}`}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-granate px-4 py-1.5 text-[13px] font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
            >
              Ver su ficha en Vigía <ArrowRight size={14} aria-hidden />
            </Link>
          ) : (
            <Link href={`/entidad/${p.entidadRuc}`} className="inline-flex min-h-[40px] items-center gap-1.5 text-[13px] font-semibold text-granate hover:underline">
              Ver la entidad <ArrowRight size={14} aria-hidden />
            </Link>
          )}
        </span>
      ),
    },
  };
}

const ACCION =
  "inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[14px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";
