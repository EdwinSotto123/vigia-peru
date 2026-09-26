import { Suspense } from "react";
import { Ayuda, EncabezadoPagina, Pagina } from "@/components/patrones";
import { BarraFiltros, Indicadores, Listado, Vistas, ZonaResultados, type FiltroSecundario } from "@/components/listado";
import { ListaSenales, ListaSenalesSkeleton } from "@/components/alertas/ListaSenales";
import { EnRevision, EnRevisionSkeleton, indicadoresRevision } from "@/components/alertas/EnRevision";
import { Paginacion } from "@/components/ui/Paginacion";
import { PaginacionCursor } from "@/components/ui/PaginacionCursor";
import { getResumenProcesamientos } from "@/lib/auditoria";
import { numero, porcentaje, relativo } from "@/lib/formato";
import { SEVERIDAD } from "@/lib/severidad";
import {
  MAX_ATRAS,
  contarContratosConDictamen,
  contarCotejadas,
  contarSenalesPublicadas,
  facetasSenales,
  filtrarSenales,
  getAnalisisEnRevision,
  getCatalogoReglas,
  getUltimoAnalisisConSenales,
  getUltimoAnalisisPublicado,
  getUniversoSenales,
  parseSenalesQuery,
  senalesQueryParams,
  type CatalogoReglas,
  type NivelBandera,
  type SenalesQuery,
} from "@/lib/revision";
import { TAM_SENALES, getSenalesPagina, getSenalesUniverso, type FacetasApi, type OpcionSenales } from "@/lib/senales";

export const metadata = {
  title: "Señales",
  description:
    "Cada señal de riesgo publicada por Vigía Perú, con la regla que la disparó, la norma que cita, la evidencia del expediente y el agente que la encontró.",
};

const RUTA = "/app/hallazgos";

/**
 * /app/hallazgos — la plantilla Listado (DESIGN_SYSTEM.md §14.1) en su forma de
 * referencia: encabezado → vistas → indicadores → barra de filtros → resultados.
 *
 * Dos poblaciones, un solo destino: `?vista=revision` muestra los financiados cuyo
 * análisis terminó y la autoevaluación frenó. Es una vista, no otra página, porque
 * la cifra que importa es la comparación entre ambas.
 *
 * Las señales salen de `GET /senales` (lib/senales.ts): el API filtra, cuenta las facetas
 * y pagina por cursor (`?cursor=`; `?atras=` guarda los cursores de las páginas anteriores
 * para "Anterior" y para saber en qué tramo de la lista se está). Una llamada por página
 * (más una de `limit=1` para las cifras del universo cuando hay filtros), en vez de
 * `/alertas?limit=500` y un `/contratos/:ocid` por alerta. COMPAT-API-VIEJA: si el API
 * responde 404 en `/senales`, la vista cae a la ruta vieja (`VistaPublicadasRespaldo`).
 *
 * Cada vista va dentro de <Suspense>: el encabezado pinta de inmediato; lo demás entra
 * sobre un esqueleto de su misma forma, nunca con un cero provisional.
 */
export default async function HallazgosPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const query = parseSenalesQuery(searchParams);

  return (
    <Pagina className="space-y-5">
      <EncabezadoPagina
        titulo="Señales"
        bajada="Reglas que dispararon en contratos leídos, con su norma y su evidencia."
        ayuda={
          <Ayuda titulo="¿Qué es una señal?">
            Una regla que disparó sobre un contrato que los agentes leyeron. Trae la norma que cita, el texto del
            expediente que la sostiene y el agente que la encontró. Es un indicio para volver a la fuente, nunca una
            acusación.
          </Ayuda>
        }
      />

      {query.vista === "revision" ? (
        <Suspense fallback={<Esperando vista="revision" />}>
          <VistaRevision />
        </Suspense>
      ) : (
        <Suspense key={JSON.stringify(query)} fallback={<Esperando vista="publicadas" />}>
          <VistaPublicadas query={query} />
        </Suspense>
      )}
    </Pagina>
  );
}

function vistas(activa: SenalesQuery["vista"], publicadas: number | null, enRevision: number | null) {
  return (
    <Vistas
      etiqueta="Qué señales ver"
      vistas={[
        { href: RUTA, etiqueta: "Publicadas", conteo: publicadas, activa: activa === "publicadas" },
        { href: `${RUTA}?vista=revision`, etiqueta: "Financiados en revisión", conteo: enRevision, activa: activa === "revision" },
      ]}
    />
  );
}

/** Carga: las vistas sin conteos (un "0" provisional se lee como dato) y la tabla en esqueleto. */
function Esperando({ vista }: { vista: SenalesQuery["vista"] }) {
  return (
    <div className="space-y-5" role="status" aria-busy>
      {vistas(vista, null, null)}
      <span className="sr-only">Cargando las señales…</span>
      {vista === "revision" ? <EnRevisionSkeleton /> : <ListaSenalesSkeleton />}
    </div>
  );
}

const ETIQUETA_NIVEL: Record<NivelBandera, string> = { alta: "Alta", media: "Media", baja: "Baja" };

const catalogo = () => getCatalogoReglas().catch(() => ({}) as CatalogoReglas);

/** Un enlace a esta página con estos parámetros (datos planos, para los `href` de la paginación). */
function hrefSenales(params: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const qs = p.toString();
  return qs ? `${RUTA}?${qs}` : RUTA;
}

const conteoDe = (f: OpcionSenales[], ...valores: string[]) => f.filter((x) => valores.includes(x.valor)).reduce((s, x) => s + x.n, 0);
const cotejadasDe = (f: FacetasApi) => (f.cotejo.length ? f.cotejo.filter((x) => x.etiqueta === "Cotejada").reduce((s, x) => s + x.n, 0) : null);

async function VistaPublicadas({ query }: { query: SenalesQuery }) {
  const cat = catalogo();
  const pagina = await getSenalesPagina(query, cat);
  // COMPAT-API-VIEJA: la API de prod todavía no tiene `/senales`.
  if (pagina.estado === "sin-endpoint") return <VistaPublicadasRespaldo query={query} />;

  const filtrado = !!(query.severidad || query.regla || query.agente || query.cotejo || query.entidad || query.q);
  const [universo, resumen, contratos, ultimo] = await Promise.all([
    // Las cifras de arriba hablan del universo entero: sin filtros, es la misma respuesta.
    pagina.estado === "ok" && !filtrado ? Promise.resolve({ total: pagina.total, facetas: pagina.facetas }) : cat.then(getSenalesUniverso),
    getResumenProcesamientos().catch(() => null),
    contarContratosConDictamen(),
    getUltimoAnalisisConSenales(),
  ]);

  if (pagina.estado !== "ok") {
    return (
      <div className="space-y-5">
        {vistas("publicadas", universo?.total ?? null, resumen?.porEstado.revision ?? null)}
        <ListaSenales senales={[]} total={0} query={query} fallo contratosSinDetalle={0} paginador={null} />
      </div>
    );
  }

  const { senales, facetas, total, siguiente } = pagina;
  const params = senalesQueryParams(query);

  // ── Paginación por cursor. `atras` lleva los cursores de las páginas anteriores: con él
  // hay "Anterior" y se sabe en qué tramo se está. Si se llenó (MAX_ATRAS), el tramo ya no
  // se sabe y se dice sólo cuántas se ven.
  const n = query.cursor ? query.atras.length + 2 : 1;
  const desde = (n - 1) * TAM_SENALES + 1;
  const tramoConocido = !query.cursor || query.atras.length < MAX_ATRAS;
  const texto =
    senales.length === 0
      ? `0 de ${numero(total)}`
      : tramoConocido
        ? `${numero(desde)}–${numero(desde + senales.length - 1)} de ${numero(total)}`
        : `${numero(senales.length)} de ${numero(total)}`;
  const anterior = !query.cursor
    ? null
    : query.atras.length
      ? hrefSenales({ ...params, cursor: query.atras[query.atras.length - 1], atras: query.atras.slice(0, -1).join(",") || undefined })
      : hrefSenales(params);
  const posterior = siguiente
    ? hrefSenales({
        ...params,
        cursor: siguiente,
        atras: (query.cursor ? [...query.atras, query.cursor] : []).slice(-MAX_ATRAS).join(",") || undefined,
      })
    : null;
  const paginador = <PaginacionCursor texto={texto} anterior={anterior} siguiente={posterior} />;

  // ── Cifras del universo (sin filtros).
  const totalU = universo?.total ?? null;
  const altas = universo ? conteoDe(universo.facetas.severidad, "alta") : null;
  const cotejadas = universo ? cotejadasDe(universo.facetas) : null;
  const dondeU = universo?.facetas.contratos != null
    ? `en ${numero(universo.facetas.contratos)} contratos`
    : universo?.facetas.entidades != null
      ? `en ${numero(universo.facetas.entidades)} entidades`
      : undefined;

  // ── Filtros: las opciones y sus conteos vienen del API (cruzados sobre los otros filtros).
  const opcionesEntidad = facetas.entidad
    ? facetas.entidad.map((f) => ({ valor: f.valor, etiqueta: f.etiqueta, conteo: f.n }))
    : query.entidad
      ? // Sin lista de entidades en el API: la elegida (desde un enlace) se ve y se quita.
        [{ valor: query.entidad, etiqueta: senales.find((s) => s.rucEntidad === query.entidad)?.entidad ?? `RUC ${query.entidad}` }]
      : [];
  const filtros: FiltroSecundario[] = [
    { param: "regla", etiqueta: "Regla", todas: "Toda regla", opciones: facetas.regla.map((f) => ({ valor: f.valor, etiqueta: f.etiqueta, conteo: f.n })) },
    ...(opcionesEntidad.length ? [{ param: "entidad", etiqueta: "Entidad", todas: "Toda entidad", opciones: opcionesEntidad }] : []),
    { param: "agente", etiqueta: "Agente que la encontró", todas: "Todo agente", opciones: facetas.agente.map((f) => ({ valor: f.valor, etiqueta: f.etiqueta, conteo: f.n })) },
    ...(facetas.cotejo.length
      ? [{ param: "cotejo", etiqueta: "Cotejo", todas: "Todo cotejo", opciones: facetas.cotejo.map((f) => ({ valor: f.valor, etiqueta: f.etiqueta, conteo: f.n })) }]
      : []),
  ];

  return (
    <div className="space-y-5">
      {vistas("publicadas", totalU, resumen?.porEstado.revision ?? null)}

      <Indicadores
        items={[
          { valor: totalU != null ? numero(totalU) : null, etiqueta: "señales publicadas", contexto: dondeU },
          {
            valor: altas != null ? numero(altas) : null,
            etiqueta: "señales altas",
            tono: "alta",
            contexto: totalU && altas != null ? `${porcentaje((altas / totalU) * 100)} del total` : undefined,
            href: `${RUTA}?severidad=alta`,
          },
          {
            valor: cotejadas != null ? numero(cotejadas) : null,
            etiqueta: "cotejadas",
            contexto: totalU != null ? `de ${numero(totalU)}` : undefined,
            ayuda: <AyudaCotejo />,
          },
          {
            valor: contratos != null ? numero(contratos) : null,
            etiqueta: "contratos con dictamen",
            contexto: ultimo ? `último leído ${relativo(ultimo.analizadoEn)}` : undefined,
          },
        ]}
      />

      <Listado ruta={RUTA} parametros={params}>
        <BarraFiltros
          busqueda={{ param: "q", placeholder: "Buscar por entidad, objeto o código…", etiqueta: "Buscar en las señales", min: 3 }}
          faceta={{
            param: "severidad",
            etiqueta: "Severidad",
            todas: "Todas",
            // Todas las severidades con los otros filtros: la suma de la faceta cruzada.
            conteoTodas: facetas.severidad.length ? facetas.severidad.reduce((s, f) => s + f.n, 0) : total,
            opciones: facetas.severidad.map((f) => {
              const nivel = f.valor as NivelBandera;
              return { valor: f.valor, etiqueta: ETIQUETA_NIVEL[nivel] ?? f.etiqueta, conteo: f.n, icono: SEVERIDAD[nivel].icono, tono: nivel };
            }),
          }}
          filtros={filtros}
        />
        <ZonaResultados>
          <ListaSenales
            senales={senales}
            total={total}
            query={query}
            fallo={false}
            contratosSinDetalle={0}
            paginador={paginador}
            paginaVacia={!!query.cursor && senales.length === 0}
          />
        </ZonaResultados>
      </Listado>
    </div>
  );
}

function AyudaCotejo() {
  return (
    <Ayuda titulo="¿Qué es una señal cotejada?">
      El cotejo automático no encontró contradicciones entre el monto, el RUC, la fecha o el enlace que cita la señal y el
      registro oficial. Revisa los datos, no la conclusión. &ldquo;Sin cotejo&rdquo; no quiere decir falsa: ese análisis es
      anterior a que el cotejo se guardara.
    </Ayuda>
  );
}

/**
 * COMPAT-API-VIEJA: la vista de antes, mientras la API de prod no tenga `/senales`. Arma el
 * universo con `/alertas?limit=500` + un `/contratos/:ocid` por alerta y filtra, cuenta y
 * pagina en memoria (`?pagina=`). Borrar junto con `getUniversoSenales` cuando `/senales`
 * esté en prod.
 */
async function VistaPublicadasRespaldo({ query }: { query: SenalesQuery }) {
  const [universo, resumen] = await Promise.all([getUniversoSenales(), getResumenProcesamientos().catch(() => null)]);
  // Contratos CON SEÑALES (§10.1: al menos una señal publicada) = los que aparecen en el universo.
  const publicados = new Set(universo.senales.map((s) => s.alertaCodigo).filter((c): c is string => !!c));
  const ultimo = await getUltimoAnalisisPublicado(publicados);
  const filtradas = filtrarSenales(universo.senales, query);
  const facetas = facetasSenales(universo.senales, query);
  const pagina = Math.min(query.pagina, Math.max(1, Math.ceil(filtradas.length / TAM_SENALES)));
  const total = universo.senales.length;
  const altas = universo.senales.filter((s) => s.severidad === "alta").length;
  const cotejadas = contarCotejadas(universo.senales);
  // La ruta vieja no sabe buscar ni filtrar por cotejo: esos parámetros no se ofrecen acá.
  const params = { ...senalesQueryParams(query), q: undefined, cotejo: undefined };

  return (
    <div className="space-y-5">
      {vistas("publicadas", total, resumen?.porEstado.revision ?? null)}

      {!universo.fallo && (
        <Indicadores
          items={[
            { valor: numero(total), etiqueta: "señales publicadas", contexto: `en ${numero(publicados.size)} contratos` },
            {
              valor: numero(altas),
              etiqueta: "señales altas",
              tono: "alta",
              contexto: total ? `${porcentaje((altas / total) * 100)} del total` : undefined,
              href: `${RUTA}?severidad=alta`,
            },
            { valor: numero(cotejadas), etiqueta: "cotejadas", contexto: `de ${numero(total)}`, ayuda: <AyudaCotejo /> },
            {
              valor: numero(universo.contratos),
              etiqueta: "contratos con dictamen",
              contexto: ultimo ? `último leído ${relativo(ultimo.analizadoEn)}` : undefined,
            },
          ]}
        />
      )}

      <Listado ruta={RUTA} parametros={params}>
        <BarraFiltros
          faceta={{
            param: "severidad",
            etiqueta: "Severidad",
            todas: "Todas",
            conteoTodas: filtrarSenales(universo.senales, { ...query, severidad: undefined }).length,
            opciones: facetas.severidad.map((f) => {
              const nivel = f.valor as NivelBandera;
              return { valor: f.valor, etiqueta: ETIQUETA_NIVEL[nivel] ?? f.etiqueta, conteo: f.n, icono: SEVERIDAD[nivel].icono, tono: nivel };
            }),
          }}
          filtros={[
            { param: "regla", etiqueta: "Regla", todas: "Toda regla", opciones: facetas.regla.map((f) => ({ valor: f.valor, etiqueta: f.etiqueta, conteo: f.n })) },
            { param: "entidad", etiqueta: "Entidad", todas: "Toda entidad", opciones: facetas.entidad.map((f) => ({ valor: f.valor, etiqueta: f.etiqueta, conteo: f.n })) },
            { param: "agente", etiqueta: "Agente que la encontró", todas: "Todo agente", opciones: facetas.agente.map((f) => ({ valor: f.valor, etiqueta: f.etiqueta, conteo: f.n })) },
          ]}
        />
        <ZonaResultados>
          <ListaSenales
            senales={filtradas.slice((pagina - 1) * TAM_SENALES, pagina * TAM_SENALES)}
            total={filtradas.length}
            query={query}
            fallo={universo.fallo}
            contratosSinDetalle={universo.contratosSinDetalle}
            paginador={
              <Paginacion
                actual={pagina}
                paginas={Math.max(1, Math.ceil(filtradas.length / TAM_SENALES))}
                total={filtradas.length}
                tam={TAM_SENALES}
                navegacion="url"
                hrefBase={RUTA}
                query={params}
                cargando={false}
                nombre="señales"
              />
            }
          />
        </ZonaResultados>
      </Listado>
    </div>
  );
}

async function VistaRevision() {
  const [items, universo, resumen] = await Promise.all([
    getAnalisisEnRevision(),
    // Sólo el número de señales publicadas, para la pestaña: `/senales?limit=1`.
    getSenalesUniverso({}),
    getResumenProcesamientos().catch(() => null),
  ]);
  // COMPAT-API-VIEJA: sin `/senales`, el número sale del fetch cacheado de `/alertas`, como antes.
  const publicadas = universo ? universo.total : await contarSenalesPublicadas();
  // Los financiados leídos: `procesado` ya incluye a los que quedaron en revisión (son un subconjunto).
  const leidosFinanciados = resumen?.porEstado.procesado ?? null;
  // Cuántos están en revisión, contado en SQL por el resumen; la lista puede traer menos.
  const totalRevision = resumen?.porEstado.revision ?? null;
  return (
    <div className="space-y-5">
      {vistas("revision", publicadas, totalRevision ?? items.length)}
      <Indicadores items={indicadoresRevision(items, leidosFinanciados, publicadas, totalRevision)} />
      <EnRevision items={items} total={totalRevision} />
    </div>
  );
}
