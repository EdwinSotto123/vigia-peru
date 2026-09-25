import Link from "next/link";
import { EstadoError, EstadoVacio } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { Paginacion } from "@/components/ui/Paginacion";
import { etiquetaTipoEntidad } from "@/lib/entidad-tipo";
import type { ApiEntidad, EntidadesPagina } from "@/lib/api-client";
import { numero, soles } from "@/lib/formato";

/**
 * El ranking de entidades sobre la plantilla Listado (§14.1): la `Tabla` compartida
 * —puesto · entidad · con dictamen · adjudicado · puntaje · ›— y la fila entera lleva
 * a la ficha de la entidad.
 *
 * QUÉ CUENTA: `alertas` (API) = contratos de la entidad con dictamen PUBLICADO, con o
 * sin señales (un dictamen de score 0 también suma), y `monto` = lo adjudicado en esos
 * contratos. Por eso la columna dice "con dictamen" y nunca "con señales" (§10.1).
 *
 * El puesto es el del ranking por contratos con dictamen (el orden del backend) y se
 * cuenta sobre toda la lista, no sobre la página. `orden` sólo reordena la página
 * actual: el API no ordena por monto ni por puntaje.
 *
 * Server-safe: todo llega como datos planos desde page.tsx.
 */

export type OrdenEntidades = "dictamen" | "monto" | "puntaje";

export const ORDENES_ENTIDADES: { valor: OrdenEntidades; etiqueta: string }[] = [
  { valor: "dictamen", etiqueta: "Más contratos con dictamen" },
  { valor: "monto", etiqueta: "Mayor monto (en esta página)" },
  { valor: "puntaje", etiqueta: "Mayor puntaje (en esta página)" },
];

const COLUMNAS: Columna[] = [
  { clave: "puesto", titulo: "Puesto", ancho: "56px", desde: "md" },
  { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1fr)" },
  { clave: "dictamen", titulo: "Con dictamen", ancho: "104px", alinear: "der" },
  { clave: "adjudicado", titulo: "Adjudicado", ancho: "136px", alinear: "der", desde: "md" },
  { clave: "puntaje", titulo: "Puntaje promedio", ancho: "128px", alinear: "der", desde: "lg" },
];

/** La acción de un estado vacío o de error: un enlace con forma de píldora secundaria. */
const ACCION =
  "inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[14px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";
const ACCION_PRIMARIA =
  "inline-flex min-h-[40px] items-center rounded-full bg-granate px-4 py-1.5 text-[14px] font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep";

interface Props {
  /** La página ya traída (y descontada de semillas) por page.tsx; null = el API no respondió. */
  pagina: EntidadesPagina | null;
  /** Número de página pedido en la URL. */
  actual: number;
  orden: OrdenEntidades;
  /** Parámetros de la URL sin la página, para armar los enlaces de la paginación. */
  parametros: Record<string, string | undefined>;
  /** Búsqueda activa (por nombre). */
  q?: string;
  /** Enlace a esta misma vista, para reintentar. */
  aqui: string;
}

export function EntidadesPanel({ pagina, actual, orden, parametros, q, aqui }: Props) {
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
        titulo={qRuc ? "La búsqueda mira el nombre, no el RUC" : q ? `Ninguna entidad coincide con «${q}»` : "No hay entidades para mostrar"}
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
        {qRuc ? "Con el RUC se llega directo a su ficha." : "Prueba con otra palabra del nombre oficial, o pega el RUC de 11 dígitos."}
      </EstadoVacio>
    );
  }

  // Puesto en el ranking por contratos con dictamen (el orden del servidor desempata),
  // contando las páginas anteriores. Luego, si se pidió, se reordena la página.
  const conPuesto = pagina.data
    .map((e, i) => ({ e, i }))
    .sort((a, b) => b.e.alertas - a.e.alertas || a.i - b.i)
    .map(({ e }, k) => ({ e, puesto: (actual - 1) * tam + k + 1 }));
  const ordenadas =
    orden === "monto"
      ? [...conPuesto].sort((a, b) => b.e.monto - a.e.monto)
      : orden === "puntaje"
        ? [...conPuesto].sort((a, b) => b.e.scorePromedio - a.e.scorePromedio)
        : conPuesto;

  const filas: Fila[] = ordenadas.map(({ e, puesto }) => filaEntidad(e, puesto));

  const pag = (
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
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag}</div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Entidades ordenadas por contratos con dictamen publicado" />
      <div className="flex justify-end">{pag}</div>
    </div>
  );
}

function filaEntidad(e: ApiEntidad, puesto: number): Fila {
  // El tipo no es un nivel de riesgo: se infiere del nombre oficial cuando el backend
  // no lo declara, y si no se puede, dice "Sin clasificar".
  const tipo = etiquetaTipoEntidad(e.tipo, e.nombre, "corto");
  // Las entidades sembradas para la demo traen `reportes`/`serie` de una metadata
  // inventada: en esas filas el total de contratos registrados no es confiable.
  const contratosConfiables = e.reportes == null && e.serie == null && e.contratos != null;
  const leida = e.alertas > 0;
  return {
    id: e.ruc,
    href: `/entidad/${e.ruc}`,
    celdas: {
      puesto: <span className="font-mono text-[12px] tabular-nums text-mute">{numero(puesto)}</span>,
      entidad: (
        <CeldaPrincipal
          titulo={e.nombre}
          meta={
            <>
              {tipo}
              {e.region ? ` · ${e.region}` : ""} ·{" "}
              <span className="font-mono" translate="no">
                RUC {e.ruc}
              </span>
            </>
          }
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
        <span className="text-[13px] text-mute">Sin dato</span>
      ),
    },
  };
}

/** `/app/entidades` con estos parámetros (sin página: vuelve a la 1). */
export function hrefEntidades(parametros: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `/app/entidades?${qs}` : "/app/entidades";
}
