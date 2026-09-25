import { Suspense } from "react";
import { Ayuda, EncabezadoPagina, Pagina } from "@/components/patrones";
import { BarraFiltros, Indicadores, Listado, Vistas, ZonaResultados } from "@/components/listado";
import { ListaSenales, ListaSenalesSkeleton } from "@/components/alertas/ListaSenales";
import { EnRevision, EnRevisionSkeleton, indicadoresRevision } from "@/components/alertas/EnRevision";
import { getResumenProcesamientos } from "@/lib/auditoria";
import { numero, porcentaje, relativo } from "@/lib/formato";
import { SEVERIDAD } from "@/lib/severidad";
import {
  contarCotejadas,
  contarSenalesPublicadas,
  facetasSenales,
  filtrarSenales,
  getAnalisisEnRevision,
  getUltimoAnalisisPublicado,
  getUniversoSenales,
  parseSenalesQuery,
  senalesQueryParams,
  type NivelBandera,
  type SenalesQuery,
} from "@/lib/revision";

export const metadata = {
  title: "Señales",
  description:
    "Cada señal de riesgo publicada por Vigía Perú, con la regla que la disparó, la norma que cita, la evidencia del expediente y el agente que la encontró.",
};

const TAM = 25;

/**
 * /app/hallazgos — la plantilla Listado (DESIGN_SYSTEM.md §14.1) en su forma de
 * referencia: encabezado → vistas → indicadores → barra de filtros → resultados.
 *
 * Dos poblaciones, un solo destino: `?vista=revision` muestra los financiados cuyo
 * análisis terminó y la autoevaluación frenó. Es una vista, no otra página, porque
 * la cifra que importa es la comparación entre ambas.
 *
 * Cada vista va dentro de <Suspense>: enriquecer cada señal con su agente y su cotejo
 * cuesta ~6 s en frío. El encabezado pinta de inmediato; lo demás entra sobre un
 * esqueleto de su misma forma, nunca con un cero provisional.
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
        { href: "/app/hallazgos", etiqueta: "Publicadas", conteo: publicadas, activa: activa === "publicadas" },
        { href: "/app/hallazgos?vista=revision", etiqueta: "Financiados en revisión", conteo: enRevision, activa: activa === "revision" },
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

async function VistaPublicadas({ query }: { query: SenalesQuery }) {
  const [universo, resumen] = await Promise.all([getUniversoSenales(), getResumenProcesamientos().catch(() => null)]);
  // Contratos CON SEÑALES (§10.1: al menos una señal publicada) = los que aparecen en el universo.
  const publicados = new Set(universo.senales.map((s) => s.alertaCodigo).filter((c): c is string => !!c));
  const ultimo = await getUltimoAnalisisPublicado(publicados);
  const filtradas = filtrarSenales(universo.senales, query);
  const facetas = facetasSenales(universo.senales, query);
  const pagina = Math.min(query.pagina, Math.max(1, Math.ceil(filtradas.length / TAM)));
  const total = universo.senales.length;
  const altas = universo.senales.filter((s) => s.severidad === "alta").length;
  const cotejadas = contarCotejadas(universo.senales);

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
              href: "/app/hallazgos?severidad=alta",
            },
            {
              valor: numero(cotejadas),
              etiqueta: "cotejadas",
              contexto: `de ${numero(total)}`,
              ayuda: (
                <Ayuda titulo="¿Qué es una señal cotejada?">
                  El cotejo automático no encontró contradicciones entre el monto, el RUC, la fecha o el enlace que cita la
                  señal y el registro oficial. Revisa los datos, no la conclusión. &ldquo;Sin cotejo&rdquo; no quiere decir
                  falsa: ese análisis es anterior a que el cotejo se guardara.
                </Ayuda>
              ),
            },
            {
              valor: numero(universo.contratos),
              etiqueta: "contratos con dictamen",
              contexto: ultimo ? `último leído ${relativo(ultimo.analizadoEn)}` : undefined,
            },
          ]}
        />
      )}

      <Listado ruta="/app/hallazgos" parametros={senalesQueryParams(query)}>
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
            senales={filtradas.slice((pagina - 1) * TAM, pagina * TAM)}
            total={filtradas.length}
            pagina={pagina}
            tam={TAM}
            query={query}
            fallo={universo.fallo}
            contratosSinDetalle={universo.contratosSinDetalle}
          />
        </ZonaResultados>
      </Listado>
    </div>
  );
}

async function VistaRevision() {
  // `contarSenalesPublicadas` reusa el mismo fetch cacheado de /alertas sin pagar el
  // enriquecimiento: esta vista sólo necesita el número para la pestaña.
  const [items, publicadas, resumen] = await Promise.all([
    getAnalisisEnRevision(),
    contarSenalesPublicadas(),
    getResumenProcesamientos().catch(() => null),
  ]);
  // Los financiados leídos: `procesado` ya incluye a los que quedaron en revisión (son un subconjunto).
  const leidosFinanciados = resumen?.porEstado.procesado ?? null;
  return (
    <div className="space-y-5">
      {vistas("revision", publicadas, items.length)}
      <Indicadores items={indicadoresRevision(items, leidosFinanciados, publicadas)} />
      <EnRevision items={items} />
    </div>
  );
}
