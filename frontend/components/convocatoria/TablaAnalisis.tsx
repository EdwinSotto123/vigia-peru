import Link from "next/link";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, CeldaTexto, Tabla, TablaSkeleton, type Columna, type Fila, type OpcionFaceta } from "@/components/listado";
import { Paginacion } from "@/components/ui/Paginacion";
import { ICONO_SEVERIDAD, Severidad } from "@/components/ui/Severidad";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { CORTE_ALTA, CORTE_MEDIA, ETIQUETA_PESO } from "@/lib/severidad";
import { numero, soles } from "@/lib/formato";
import { cn } from "@/lib/utils";
import {
  analisisQueryParams,
  codigoDe,
  codigoExacto,
  ETIQUETA_TIPO,
  facetasAnalisis,
  hayFiltros,
  hrefAnalisis,
  ORDENES,
  ORDEN_POR_DEFECTO,
  RIESGO_URL,
  tipoDe,
  TOPE_API,
  type AnalisisPublicado,
  type AnalisisQuery,
  type TipoAnalisis,
} from "./analisisPublicados";
import { NIVEL_ANALISIS, NIVELES, nivelDeAnalisis, UI_NIVEL, type NivelAnalisis } from "./sections/conteoRiesgo";

/**
 * Los análisis publicados sobre la plantilla Listado (§14.1): la `Tabla` compartida con la
 * anatomía de fila de todos los listados —peso del riesgo (chip) · qué se contrató y quién
 * compra · zona y tipo · adjudicado · señales · leído · ›— y el informe a un clic.
 *
 * Server-safe: la usa la página pública (server component) y el panel del equipo (cliente).
 * Todo lo que recibe son datos; los enlaces los arma `Paginacion` con `hrefBase` + `query`.
 */

export const TAM_ANALISIS = 25;

/** Anchos medidos contra el menú lateral de 256 px: tipo, zona y fecha entran desde xl sin ahogar el título. */
export const COLUMNAS_ANALISIS: Columna[] = [
  {
    clave: "riesgo", desde: "md", apilar: true,
    titulo: "Riesgo",
    ancho: "124px",
    ayuda: (
      <Ayuda titulo="¿Qué es el peso del riesgo?">
        El tramo del puntaje (0 a 100), que suma el peso de cada señal publicada: alto desde {CORTE_ALTA}, medio desde{" "}
        {CORTE_MEDIA}, bajo por debajo. &ldquo;Sin señales&rdquo; son los leídos y publicados sin ninguna.
      </Ayuda>
    ),
  },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  {
    clave: "zona",
    titulo: "Zona y tipo",
    ancho: "128px",
    desde: "xl",
    ayuda: (
      <Ayuda titulo="¿De dónde sale el tipo?">
        Se deduce de las palabras con que el SEACE describe el objeto (adquisición, servicio, obra, consultoría). Es
        aproximado: una compra &ldquo;para la obra&rdquo; puede quedar como obra.
      </Ayuda>
    ),
  },
  { clave: "adjudicado", titulo: "Adjudicado", ancho: "112px", alinear: "der", desde: "lg" },
  { clave: "senales", titulo: "Señales", ancho: "92px", alinear: "der", desde: "lg" },
  { clave: "leido", titulo: "Leído", ancho: "92px", desde: "xl" },
];

// Punto por tipo: paleta textil, la de las series categóricas (§3.4), nunca un tono de severidad.
const TONO_TIPO: Record<TipoAnalisis, string> = {
  bienes: "bg-textil-anil",
  servicios: "bg-textil-achiote",
  obras: "bg-textil-verde",
  consultoria: "bg-textil-ocre",
  sin_tipo: "bg-line",
};

const TONO_FACETA: Record<NivelAnalisis, OpcionFaceta["tono"]> = { alta: "alta", media: "media", baja: "baja", sin_senales: "positivo" };

/** Las props de `BarraFiltros` para esta lista: sólo datos (la arman un server y un client component). */
export function barraAnalisis(items: AnalisisPublicado[], query: AnalisisQuery) {
  const f = facetasAnalisis(items, query);
  return {
    busqueda: { param: "q", placeholder: "Código, objeto, entidad o RUC", etiqueta: "Buscar por código, OCID, objeto, entidad o RUC" },
    faceta: {
      param: "riesgo",
      etiqueta: ETIQUETA_PESO,
      todas: "Todos",
      // La opción ya se nombra sola ("Riesgo alto"): el chip activo no repite el nombre de la faceta.
      nombreEnChip: false,
      conteoTodas: f.riesgoTodas,
      // Las mismas palabras que el chip de cada fila. Sin opciones que lleven a cero, salvo la
      // elegida (se ve con su conteo real).
      opciones: NIVELES.filter((n) => f.riesgo[n] > 0 || query.riesgo === n).map<OpcionFaceta>((n) => ({
        valor: RIESGO_URL[n],
        etiqueta: UI_NIVEL[n].etiqueta,
        conteo: f.riesgo[n],
        icono: UI_NIVEL[n].icono,
        tono: TONO_FACETA[n],
      })),
    },
    filtros: [
      { param: "tipo", etiqueta: "Tipo de contrato", todas: "Todo tipo", opciones: f.tipo.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta, conteo: o.n })) },
      { param: "zona", etiqueta: "Zona", todas: "Toda zona", opciones: f.zona.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta, conteo: o.n })) },
    ],
    orden: { param: "orden", porDefecto: ORDEN_POR_DEFECTO, opciones: ORDENES },
  };
}

interface Props {
  /** Todos los análisis (sin filtrar): para distinguir "no hay ninguno" de "el filtro no deja ver nada". */
  universo: AnalisisPublicado[];
  /** Ya filtrados y ordenados. */
  filtrados: AnalisisPublicado[];
  query: AnalisisQuery;
  /** Ruta de este listado (`/app/convocatoria` o `/admin/analisis`). */
  ruta: string;
  parcial: boolean;
  fallo: string | null;
}

export function TablaAnalisis({ universo, filtrados, query, ruta, parcial, fallo }: Props) {
  const total = filtrados.length;
  const paginas = Math.max(1, Math.ceil(total / TAM_ANALISIS));
  const pagina = Math.min(query.pagina, paginas);
  const pag = (
    <Paginacion
      actual={pagina}
      paginas={paginas}
      total={total}
      tam={TAM_ANALISIS}
      navegacion="url"
      hrefBase={ruta}
      query={analisisQueryParams(query)}
      cargando={false}
      nombre="análisis"
    />
  );

  if (fallo) {
    return (
      <EstadoError
        titulo="No pudimos cargar los análisis publicados"
        detalle={fallo}
        accion={
          <Link href={ruta} className={claseAccion("secundario")}>
            Reintentar
          </Link>
        }
      >
        El servidor no respondió. No mostramos nada en su lugar.
      </EstadoError>
    );
  }
  if (universo.length === 0) {
    return (
      <EstadoVacio
        titulo="Todavía no hay análisis publicados"
        accion={
          <Link href="/app/financiar" className={claseAccion("primario")}>
            Financiar la lectura de tu zona
          </Link>
        }
      >
        Vigía lee los contratos en orden de cola, cuando alguien financia la lectura de su zona.
      </EstadoVacio>
    );
  }
  if (total === 0) return <SinResultados query={query} ruta={ruta} />;

  const exacto = codigoExacto(filtrados, query.q);
  const filas: Fila[] = filtrados.slice((pagina - 1) * TAM_ANALISIS, pagina * TAM_ANALISIS).map((it) => filaDe(it, it === exacto));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag}</div>
      <Tabla columnas={COLUMNAS_ANALISIS} filas={filas} etiqueta="Análisis publicados" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        {parcial ? (
          <p className="inline-flex items-center gap-1 text-[12.5px] text-mute">
            Se listan los {numero(TOPE_API)} análisis más recientes
            <Ayuda titulo="¿Y los anteriores?">
              El índice devuelve hasta {numero(TOPE_API)} análisis, del más reciente al más antiguo. Uno anterior sigue
              publicado: ábrelo por su código desde la búsqueda.
            </Ayuda>
          </p>
        ) : (
          <span />
        )}
        {pag}
      </div>
    </div>
  );
}

function filaDe(it: AnalisisPublicado, resaltada: boolean): Fila {
  const titulo = String(it.objeto || "").trim() || "Contrato sin objeto registrado";
  const codigo = codigoDe(it);
  const tipo = tipoDe(it);
  const zona = it.region || null;
  const monto = Number(it.monto) || 0;
  return {
    // El código de la alerta es único; el de la convocatoria puede repetirse si se releyó.
    id: `${it.codigo ?? ""}-${codigo}`,
    href: hrefAnalisis(it),
    resaltada,
    celdas: {
      riesgo: <ChipNivel it={it} />,
      contrato: (
        <CeldaPrincipal
          titulo={titulo}
          meta={
            <>
              <span className="font-mono tabular-nums text-inkSoft">{codigo}</span>
              {/* Zona y tipo tienen columna desde xl; antes, van en esta línea para no perderse. */}
              <span className="xl:hidden">
                {zona && ` · ${zona}`}
                {tipo !== "sin_tipo" && ` · ${ETIQUETA_TIPO[tipo]}`}
              </span>
              {` · ${it.entidad || "Entidad sin dato"}`}
            </>
          }
        />
      ),
      zona: (
        <CeldaTexto
          sub={
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONO_TIPO[tipo])} />
              {ETIQUETA_TIPO[tipo]}
            </span>
          }
        >
          {zona ?? <span className="text-mute">Zona sin dato</span>}
        </CeldaTexto>
      ),
      adjudicado: <CeldaNumero>{monto > 0 ? soles(monto) : <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
      senales: <SenalesFila it={it} />,
      leido: <CeldaFecha fecha={it.analizado_en} />,
    },
  };
}

/** Señales publicadas del contrato: el total y, debajo, cuántas de cada severidad (ícono + número). */
function SenalesFila({ it }: { it: AnalisisPublicado }) {
  const n = Number(it.n_banderas) || 0;
  const porSeveridad = { alta: Number(it.n_alta) || 0, media: Number(it.n_media) || 0, baja: Number(it.n_baja) || 0 };
  const partes = (["alta", "media", "baja"] as const).map((k) => [k, porSeveridad[k]] as const).filter(([, v]) => v > 0);
  return (
    <CeldaNumero
      sub={
        partes.length > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            {partes.map(([k, v]) => (
              <span key={k} className="inline-flex items-center gap-0.5">
                <Severidad bandera={k} formato="punto" />
                {numero(v)}
              </span>
            ))}
          </span>
        ) : undefined
      }
    >
      <span className={n > 0 ? undefined : "text-mute"}>{numero(n)}</span>
    </CeldaNumero>
  );
}

/**
 * El peso del riesgo de un análisis, con la palabra de lib/severidad (color + ícono + palabra).
 * Sale de `nivelDeAnalisis`, la misma función que cuenta las opciones del filtro. Lo usa
 * también el autocompletado del panel del equipo.
 */
export function ChipNivel({ it }: { it: Pick<AnalisisPublicado, "score" | "n_banderas"> }) {
  const nivel = nivelDeAnalisis(it);
  if (!nivel) return <span className="pill border-line bg-paperDeep text-mute">Sin dato</span>;
  const ui = UI_NIVEL[nivel];
  const Icono = ICONO_SEVERIDAD[ui.icono];
  return (
    <span className={cn("pill whitespace-nowrap", ui.fondo, ui.texto, ui.borde)} title={NIVEL_ANALISIS[nivel].rango}>
      <Icono size={11} aria-hidden />
      {ui.etiqueta}
    </span>
  );
}

/** Filtrado vacío ≠ todavía no hay datos: con texto escrito, lo más probable es que ese contrato no se haya leído. */
function SinResultados({ query, ruta }: { query: AnalisisQuery; ruta: string }) {
  const q = query.q;
  const pareceCodigo = !!q && /^(ocds-|oece-)?[\w-]*\d{5,}$/i.test(q.trim());
  const quitar = hayFiltros(query) && (
    <Link href={ruta} className={claseAccion("secundario")}>
      Quitar los filtros
    </Link>
  );
  if (!q) {
    return (
      <EstadoVacio compacto titulo="Ningún análisis coincide con los filtros" accion={quitar || undefined}>
        Prueba quitando el último filtro que agregaste.
      </EstadoVacio>
    );
  }
  return (
    <EstadoVacio
      compacto
      titulo={`Ningún análisis publicado coincide con «${q}»`}
      accion={
        <span className="flex flex-wrap justify-center gap-2">
          {/* La lista trae los más recientes: por su código, el informe dice si existe. */}
          {pareceCodigo && (
            <Link href={`/app/convocatoria/${encodeURIComponent(codigoDe({ ocid: q.trim() }))}`} className={claseAccion("secundario")}>
              Abrir el informe de {codigoDe({ ocid: q.trim() })}
            </Link>
          )}
          <Link href={`/app/contratos?q=${encodeURIComponent(codigoDe({ ocid: q.trim() }))}`} className={claseAccion("secundario")}>
            Buscarlo entre los contratos del SEACE
          </Link>
          {quitar}
        </span>
      }
    >
      Vigía no analiza a pedido: lee los contratos en orden de cola, cuando alguien financia la lectura de su zona.
    </EstadoVacio>
  );
}

export function TablaAnalisisSkeleton() {
  return <TablaSkeleton columnas={COLUMNAS_ANALISIS} filas={10} />;
}
