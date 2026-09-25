import { Ayuda, EncabezadoPagina, Pagina } from "@/components/patrones";
import {
  BarraFiltros,
  Indicadores,
  Listado,
  ZonaResultados,
  type FiltroSecundario,
  type Indicador,
  type OpcionFaceta,
  type Parametros,
} from "@/components/listado";
import { TablaContratos } from "@/components/contratos/TablaContratos";
import { PROVINCIA_NOMBRE } from "@/components/mapa/provincias";
import { etiquetaMes, ultimosMeses } from "@/components/mapa/meses";
import { getEntidad } from "@/lib/api-client";
import {
  ETAPAS,
  OPERATIVOS,
  ORDENES,
  TIPOS,
  contratosParametros,
  getContratos,
  getResumenContratos,
  parseContratosQuery,
  type ContratoResumen,
  type ResumenContratos,
} from "@/lib/contratos";
import { getZonas } from "@/lib/financiamiento";
import { numero, soles } from "@/lib/formato";

export const metadata = {
  // Solo la parte de la página: el layout raíz agrega " | Vigía Perú".
  title: "Contratos",
  description: "Todos los contratos públicos del SEACE que tiene Vigía, con su tipo, etapa, zona y estado de lectura.",
};

const SIZE = 50;
const RUTA = "/app/contratos";

/**
 * /app/contratos — plantilla Listado (DESIGN_SYSTEM.md §14.1):
 *   EncabezadoPagina → Indicadores → Listado { BarraFiltros, ZonaResultados { TablaContratos } }
 *
 * Todo el estado (búsqueda, faceta, filtros, orden, página) vive en la URL; el API
 * pagina en el servidor con `?page=`. Cada fila abre el resumen del contrato en el
 * panel lateral; el dossier (/app/contratos/[ocid]) está en su pie. El mapa
 * (/app/mapa) muestra los mismos contratos por zona.
 */
export default async function ContratosPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = parseContratosQuery(searchParams);
  const parametros = contratosParametros(query);
  // El total del universo sólo hace falta si algo (fuera de la faceta) recorta la base.
  const recortada = Object.entries(parametros).some(([k, v]) => k !== "riesgo" && k !== "orden" && !!v);
  const [pagina, zonas, entidad, resumen, resumenGlobal] = await Promise.all([
    getContratos({ ...query, size: SIZE }),
    getZonas("departamento"),
    query.entidad ? getEntidad(query.entidad).catch(() => null) : Promise.resolve(null),
    getResumenContratos(query),
    recortada ? getResumenContratos({}) : Promise.resolve(null),
  ]);

  return (
    <Pagina className="space-y-5">
      <EncabezadoPagina
        titulo="Todos los contratos"
        bajada="Convocatorias del SEACE en la base de Vigía, con su tipo, etapa y estado de lectura."
        ayuda={
          <Ayuda titulo="¿Qué contratos hay aquí?">
            Cada convocatoria del SEACE que Vigía tiene en su base. Las que aún no tienen dictamen esperan que alguien
            financie su lectura; se leen por orden de llegada y nadie elige cuál.
          </Ayuda>
        }
      />

      {resumen ? (
        <Indicadores items={indicadores(resumen, recortada, resumenGlobal?.total ?? null, parametros)} />
      ) : (
        <p className="text-[13px] text-mute" role="status">
          No pudimos contar los contratos en este momento.
        </p>
      )}

      <Listado ruta={RUTA} parametros={parametros} paramPagina="page">
        <BarraFiltros
          busqueda={{ param: "q", placeholder: "Buscar por objeto, código o entidad…", etiqueta: "Buscar contratos" }}
          faceta={facetaEstado(resumen)}
          filtros={filtros({
            resumen,
            parametros,
            regiones: (zonas ?? []).map((z) => ({ ubigeo: z.ubigeo, nombre: z.nombre })),
            entidadNombre: entidad?.entidad?.nombre ?? null,
            filas: pagina?.data ?? [],
          })}
          orden={{ param: "orden", porDefecto: "fecha", opciones: ORDENES.map((o) => ({ valor: o.value, etiqueta: o.label })) }}
        />
        <ZonaResultados>
          <TablaContratos pagina={pagina} parametros={parametros} actual={query.page ?? 1} tam={SIZE} />
        </ZonaResultados>
      </Listado>
    </Pagina>
  );
}

// ─── Indicadores ─────────────────────────────────────────────────────────────

/**
 * Las cifras de cabecera, con las palabras de §10.1, sobre la base que reparte la faceta:
 * todo lo que cumple los demás filtros (el resumen cuenta cada faceta sin su propio
 * filtro). Así "leídos" y los chips de la faceta hablan de los mismos contratos.
 *   · leídos = el análisis terminó por cualquier vía (publicado, en revisión o descartado);
 *   · con dictamen publicado = leídos cuya alerta está publicada (alto + medio + bajo).
 * "En cola" no va aquí: el balde `en_cola` del resumen también cuenta a los ya leídos.
 */
function indicadores(resumen: ResumenContratos, recortada: boolean, universo: number | null, parametros: Parametros): Indicador[] {
  const r = resumen.porRiesgo;
  const n = (k: keyof typeof r) => r[k] ?? 0;
  const base = Object.values(r).reduce<number>((s, v) => s + (v ?? 0), 0);
  const conDictamen = n("alto") + n("medio") + n("bajo");
  const leidos = conDictamen + n("en_revision") + n("descartado");
  return [
    {
      valor: numero(base),
      etiqueta: "contratos publicados",
      contexto: !recortada ? "convocatorias del SEACE" : universo != null ? `con estos filtros, de ${numero(universo)}` : "con estos filtros",
    },
    { valor: numero(leidos), etiqueta: "leídos", contexto: `de ${numero(base)} publicados` },
    {
      valor: numero(conDictamen),
      etiqueta: "con dictamen publicado",
      contexto: `de ${numero(leidos)} leídos`,
      ayuda: (
        <Ayuda titulo="¿Leído o con dictamen?">
          Leído: el análisis terminó, por cualquier vía. Con dictamen publicado: leídos cuyo resultado ya es público; el
          resto está en revisión humana o se descartó.
        </Ayuda>
      ),
    },
    {
      valor: numero(n("alto")),
      etiqueta: "con riesgo alto",
      tono: "alta",
      contexto: `de ${numero(conDictamen)} con dictamen`,
      href: hrefCon(parametros, { riesgo: "alto" }),
    },
  ];
}

function hrefCon(parametros: Parametros, cambio: Parametros): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...parametros, ...cambio })) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${RUTA}?${qs}` : RUTA;
}

// ─── Faceta principal y filtros ──────────────────────────────────────────────

/**
 * La faceta principal es el ESTADO del contrato (peso del riesgo, o sin leer), no la
 * cola: la pregunta que casi todos traen es "¿qué se encontró y qué falta leer?". Casi
 * todo lo publicado está sin leer, y esta faceta separa a los leídos por su resultado
 * con las mismas palabras que el chip de cada fila. La cola y los documentos
 * (`operativo`) son la pregunta de quien va a financiar: van en Filtros.
 *
 * Los conteos salen del resumen, que cuenta la faceta sin su propio filtro; sin
 * resumen no hay conteo (nunca un 0 inventado).
 */
function facetaEstado(resumen: ResumenContratos | null) {
  const r = resumen?.porRiesgo;
  const c = (k: keyof NonNullable<typeof r>) => (r ? r[k] ?? 0 : null);
  const opciones: OpcionFaceta[] = [
    { valor: "alto", etiqueta: "Riesgo alto", conteo: c("alto"), icono: "alerta", tono: "alta" },
    { valor: "medio", etiqueta: "Riesgo medio", conteo: c("medio"), icono: "atencion", tono: "media" },
    // El API junta "bajo" y "sin señales" (score < 40): la etiqueta lo dice.
    { valor: "bajo", etiqueta: "Riesgo bajo o sin señales", conteo: c("bajo"), icono: "info", tono: "baja" },
    { valor: "en_revision", etiqueta: "En revisión", conteo: c("en_revision"), icono: "revision", tono: "neutro" },
    { valor: "sin_analizar", etiqueta: "Sin leer", conteo: c("sin_analizar"), icono: "vacio", tono: "neutro" },
  ];
  return {
    param: "riesgo",
    etiqueta: "Estado",
    todas: "Todos",
    // La opción ya se nombra sola ("Riesgo alto"): el chip activo no repite el nombre de la faceta.
    nombreEnChip: false,
    conteoTodas: r ? Object.values(r).reduce<number>((s, v) => s + (v ?? 0), 0) : null,
    opciones,
  };
}

const MONTOS_DESDE = [50_000, 100_000, 500_000, 1_000_000, 5_000_000, 10_000_000];
const MONTOS_HASTA = [50_000, 100_000, 500_000, 1_000_000, 5_000_000];

/** Un preset de monto; si la URL trae otro valor, se agrega con su formato (el select no queda en blanco). */
function opcionesMonto(presets: number[], actual: string | undefined) {
  const opciones = presets.map((m) => ({ valor: String(m), etiqueta: soles(m) }));
  if (actual && !opciones.some((o) => o.valor === actual)) opciones.push({ valor: actual, etiqueta: soles(Number(actual)) });
  return opciones;
}

/** Nombre de la zona elegida: departamento de la lista, provincia por su ubigeo, distrito por la fila. */
function nombreZona(ubigeo: string, filas: ContratoResumen[]): string {
  if (ubigeo.length === 4 && PROVINCIA_NOMBRE[ubigeo]) return `Provincia de ${PROVINCIA_NOMBRE[ubigeo]}`;
  const fila = filas.find((f) => f.ubigeo === ubigeo && f.zona);
  return fila?.zona ?? `Zona ${ubigeo}`;
}

function filtros({
  resumen,
  parametros,
  regiones,
  entidadNombre,
  filas,
}: {
  resumen: ResumenContratos | null;
  parametros: Parametros;
  regiones: { ubigeo: string; nombre: string }[];
  entidadNombre: string | null;
  filas: ContratoResumen[];
}): FiltroSecundario[] {
  // Conteo de una opción: del resumen si respondió (0 es un dato); si no, sin número.
  const conteo = (m: Partial<Record<string, number>> | undefined, k: string) => (resumen ? m?.[k] ?? 0 : null);

  const zonas = [...regiones].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map((z) => ({ valor: z.ubigeo, etiqueta: z.nombre }));
  const ubigeo = parametros.ubigeo;
  if (ubigeo && !zonas.some((z) => z.valor === ubigeo)) zonas.unshift({ valor: ubigeo, etiqueta: nombreZona(ubigeo, filas) });

  const meses = ultimosMeses(12).map((m) => ({ valor: m.desde.slice(0, 7), etiqueta: m.etiqueta }));
  if (parametros.mes && !meses.some((m) => m.valor === parametros.mes)) meses.push({ valor: parametros.mes, etiqueta: etiquetaMes(parametros.mes) });

  return [
    {
      param: "operativo",
      etiqueta: "Cola y documentos",
      todas: "Todos",
      opciones: OPERATIVOS.map((o) => ({ valor: o.value, etiqueta: o.label, conteo: conteo(resumen?.porOperativo, o.value) })),
    },
    {
      param: "tipo",
      etiqueta: "Tipo",
      todas: "Todo tipo",
      opciones: TIPOS.map((t) => ({ valor: t.value, etiqueta: t.label, conteo: conteo(resumen?.porTipo, t.value) })),
    },
    // Sin conteo: el resumen no cuenta por etapa.
    { param: "etapa", etiqueta: "Etapa", todas: "Toda etapa", opciones: ETAPAS.map((e) => ({ valor: e.value, etiqueta: e.label })) },
    { param: "ubigeo", etiqueta: "Zona", todas: "Todo el Perú", opciones: zonas },
    // La entidad llega por enlace (su ficha, un dictamen): sólo aparece si está puesta, para poder quitarla.
    ...(parametros.entidad
      ? [{ param: "entidad", etiqueta: "Entidad", todas: "Toda entidad", opciones: [{ valor: parametros.entidad, etiqueta: entidadNombre ?? `RUC ${parametros.entidad}` }] }]
      : []),
    { param: "mes", etiqueta: "Mes de convocatoria", todas: "Todo el histórico", opciones: meses },
    { param: "monto_min", etiqueta: "Valor referencial desde", todas: "Sin mínimo", opciones: opcionesMonto(MONTOS_DESDE, parametros.monto_min) },
    { param: "monto_max", etiqueta: "Valor referencial hasta", todas: "Sin máximo", opciones: opcionesMonto(MONTOS_HASTA, parametros.monto_max) },
  ];
}
