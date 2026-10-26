import Link from "next/link";
import { urlDesde, conDesde } from "@/lib/desde";
import { Ayuda, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, type DatoClave } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { Paginacion } from "@/components/ui/Paginacion";
import { etiquetaTipoEntidad } from "@/lib/entidad-tipo";
import type { ApiEntidad, EntidadesPagina } from "@/lib/api-client";
import { numero, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";

/**
 * El ranking de entidades sobre la plantilla Listado (§14.1): la `Tabla` compartida
 * —puesto · entidad · con dictamen · adjudicado · puntaje · ›— y cada fila abre su VISTA
 * PREVIA en el panel lateral (`detalle.ficha`), con «Abrir la ficha» al pie: se miran
 * varias seguidas sin ir y volver a la ficha, que es pesada.
 *
 * QUÉ CUENTA: `alertas` (API) = contratos de la entidad con dictamen PUBLICADO, con o
 * sin señales (un dictamen de score 0 también suma), y `monto` = lo adjudicado en esos
 * contratos. Por eso la columna dice "con dictamen" y nunca "con señales" (§10.1).
 *
 * El orden es uno solo, el del API (contratos con dictamen, después los que más contratos
 * tienen): el puesto se cuenta sobre toda la lista. Antes había «Mayor monto» y «Mayor
 * puntaje» «en esta página», que reordenaban sólo 20 de 3,162 y dejaban el puesto en 1, 5,
 * 3…: el API no ordena por monto ni por puntaje, así que esas opciones se quitaron.
 *
 * Server-safe: todo llega como datos planos desde page.tsx.
 */

const COLUMNAS: Columna[] = [
  { clave: "puesto", titulo: "Puesto", ancho: "56px", desde: "md" },
  { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1fr)" },
  { clave: "dictamen", titulo: "Con dictamen", ancho: "104px", alinear: "der" },
  { clave: "adjudicado", titulo: "Adjudicado", ancho: "136px", alinear: "der", desde: "md" },
  { clave: "puntaje", titulo: "Puntaje promedio", ancho: "128px", alinear: "der", desde: "lg" },
];

const ACCION = CLASE_ACCION_LISTA;
const ACCION_PRIMARIA =
  "inline-flex min-h-[40px] items-center rounded-full bg-granate px-4 py-1.5 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep";

interface Props {
  /** La página ya traída (y descontada de semillas) por page.tsx; null = el API no respondió. */
  pagina: EntidadesPagina | null;
  /** Número de página pedido en la URL. */
  actual: number;
  /** Parámetros de la URL sin la página, para armar los enlaces de la paginación. */
  parametros: Record<string, string | undefined>;
  /** Búsqueda activa (por nombre o por el comienzo del RUC). */
  q?: string;
  /** Enlace a esta misma vista, para reintentar. */
  aqui: string;
}

export function EntidadesPanel({ pagina, actual, parametros, q, aqui }: Props) {
  if (!pagina) {
    return (
      <EstadoError titulo="No pudimos leer las entidades" accion={<Link href={aqui} className={ACCION}>Reintentar</Link>}>
        El servidor de Vigía no respondió. No mostramos nada en su lugar.
      </EstadoError>
    );
  }

  const { total, size: tam } = pagina;
  const paginas = Math.max(1, Math.ceil(total / tam));

  if (pagina.data.length === 0) {
    const qRuc = q && /^\d{11}$/.test(q) ? q : null;
    if (total > 0) {
      return (
        <EstadoVacio titulo="Esta página no tiene entidades" compacto accion={<Link href={hrefEntidades(parametros)} className={ACCION}>Ir a la página 1</Link>}>
          La lista llega hasta la página {numero(paginas)}.
        </EstadoVacio>
      );
    }
    const sinBusqueda = hrefEntidades({ ...parametros, q: undefined });
    return (
      <EstadoVacio
        compacto
        titulo={qRuc ? `Ninguna entidad de la lista tiene el RUC ${qRuc}` : q ? `Ninguna entidad coincide con «${q}»` : "No hay entidades para mostrar"}
        accion={
          q ? (
            <span className="flex flex-wrap items-center justify-center gap-2">
              {qRuc && (
                <Link href={`/entidad/${qRuc}`} className={ACCION_PRIMARIA}>
                  Abrir la ficha del RUC {qRuc}
                </Link>
              )}
              <Link href={sinBusqueda} className={ACCION}>
                Borrar la búsqueda
              </Link>
            </span>
          ) : undefined
        }
      >
        {qRuc ? "Puede tener ficha aunque no tenga contratos en la lista: ábrela con su RUC." : "Prueba con otra palabra del nombre oficial, o pega el RUC (11 dígitos o su comienzo)."}
      </EstadoVacio>
    );
  }

  // Puesto en el ranking por contratos con dictamen (el orden del servidor desempata), contando las páginas anteriores.
  const conPuesto = pagina.data
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.alertas - a.e.alertas || a.i - b.i)
    .map(({ e }, k) => ({ e, puesto: (actual - 1) * tam + k + 1 }));

  // De dónde vino (esta lista con sus filtros), para las migas de la ficha y para que "volver" la restaure.
  const desde = urlDesde("/app/entidades", parametros);
  const filas: Fila[] = conPuesto.map(({ e, puesto }) => filaEntidad(e, puesto, desde));

  const pag = (subir: boolean) => (
    <Paginacion
      actual={actual}
      paginas={paginas}
      total={total}
      tam={tam}
      navegacion="url"
      hrefBase="/app/entidades"
      query={parametros}
      cargando={false}
      nombre="entidades"
      subir={subir}
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Entidades ordenadas por contratos con dictamen publicado" densidad="compacta" />
      {paginas > 1 && <div className="flex justify-end">{pag(true)}</div>}
    </div>
  );
}

const NEPOTISMO = "Un pariente declarado en la DJI de un funcionario figura como su proveedor (indicio, no acusación)";

function filaEntidad(e: ApiEntidad, puesto: number, desde?: string): Fila {
  // El tipo no es un nivel de riesgo: se infiere del nombre oficial cuando el backend
  // no lo declara, y si no se puede, dice "Sin clasificar".
  const tipo = etiquetaTipoEntidad(e.tipo, e.nombre, "corto");
  // Las entidades sembradas para la demo traen `reportes`/`serie` de una metadata
  // inventada: en esas filas el total de contratos registrados no es confiable.
  const contratosConfiables = e.reportes == null && e.serie == null && e.contratos != null;
  const leida = e.alertas > 0;
  const nombre = tituloNatural(e.nombre);
  return {
    id: e.ruc,
    celdas: {
      puesto: <span className="font-mono text-rotulo tabular-nums text-mute">{numero(puesto)}</span>,
      entidad: (
        <CeldaPrincipal
          // Con su nombre propio, como en su ficha: no en las mayúsculas del SEACE.
          titulo={nombre}
          meta={[
            e.conNepotismo && (
              <span key="nep" className="pill border-amber/30 bg-amber-soft text-amberTexto" title={NEPOTISMO}>
                Posible nepotismo
              </span>
            ),
            <Dato key="tipo" tipo="tipo" nombre="Tipo de entidad">{tipo}</Dato>,
            e.region && <Dato key="region" tipo="lugar">{e.region}</Dato>,
            <Dato key="ruc" tipo="ruc">
              RUC <span className="font-mono tabular-nums" translate="no">{e.ruc}</span>
            </Dato>,
          ]}
        />
      ),
      dictamen: (
        <CeldaNumero sub={contratosConfiables ? `de ${numero(e.contratos)}` : undefined}>{numero(e.alertas)}</CeldaNumero>
      ),
      adjudicado: <CeldaNumero>{leida ? soles(e.monto) : "Sin dato"}</CeldaNumero>,
      // Un chip neutro, no de severidad: el promedio de una entidad no es el peso del
      // riesgo de un contrato (§10.1) y un 0 redondeado no prueba "sin señales".
      puntaje: leida ? (
        <span className="pill border-line bg-paperSoft tabular-nums text-inkSoft">
          <span className="font-semibold text-ink">{numero(e.scorePromedio)}</span> de 100
        </span>
      ) : (
        <span className="text-meta text-mute">Sin dato</span>
      ),
    },
    detalle: {
      titulo: nombre,
      etiqueta: `Vista previa de ${nombre}`,
      descripcion: <span className="font-mono tabular-nums">RUC {e.ruc}</span>,
      ficha: conDesde(`/entidad/${e.ruc}`, desde),
      contenido: <VistaPrevia e={e} tipo={tipo} puesto={puesto} contratosConfiables={contratosConfiables} />,
    },
  };
}

/** El panel de una fila (§14.4), sólo con lo que trae la fila: dónde está y lo que Vigía ya leyó de ella. */
function VistaPrevia({ e, tipo, puesto, contratosConfiables }: { e: ApiEntidad; tipo: string; puesto: number; contratosConfiables: boolean }) {
  const leida = e.alertas > 0;
  const lugar = [e.distrito, e.provincia, e.region].filter((x, i, xs) => x && xs.indexOf(x) === i).map((x) => tituloNatural(x!)).join(", ");
  const datos: DatoClave[] = [
    { etiqueta: "Tipo", valor: tipo },
    { etiqueta: "Dónde", valor: lugar || null },
    ...(e.pliegoNombreMef ? [{ etiqueta: "Pliego en el MEF", valor: tituloNatural(e.pliegoNombreMef) }] : []),
    { etiqueta: "Puesto en la lista", valor: numero(puesto), mono: true },
    {
      etiqueta: "Contratos con dictamen",
      valor: contratosConfiables ? `${numero(e.alertas)} de ${numero(e.contratos)} registrados` : numero(e.alertas),
      mono: true,
    },
    { etiqueta: "Adjudicado en esos contratos", valor: leida ? soles(e.monto) : null, mono: true },
    {
      etiqueta: "Puntaje promedio",
      valor: leida ? `${numero(e.scorePromedio)} de 100` : null,
      mono: true,
      ayuda: (
        <Ayuda titulo="¿Qué es el puntaje promedio?">
          El promedio, de 0 a 100, de sus contratos con dictamen; uno sin señales puntúa 0. No es una probabilidad de delito: la
          ficha muestra las señales que lo explican.
        </Ayuda>
      ),
    },
  ];
  return (
    <CuerpoDetalle>
      {e.conNepotismo && (
        <ChipsDetalle>
          <span className="pill border-amber/30 bg-amber-soft text-amberTexto">Posible nepotismo</span>
          <span className="text-meta text-inkSoft">{NEPOTISMO}.</span>
        </ChipsDetalle>
      )}
      <DatosClave items={datos} />
      {!leida && <p className="text-meta leading-snug text-inkSoft">Vigía todavía no publicó el dictamen de ninguno de sus contratos.</p>}
    </CuerpoDetalle>
  );
}

/** `/app/entidades` con estos parámetros (sin página: vuelve a la 1). */
export function hrefEntidades(parametros: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `/app/entidades?${qs}` : "/app/entidades";
}
