import { Suspense } from "react";
import type { Metadata } from "next";
import { Ayuda, EncabezadoPagina, Pagina } from "@/components/patrones";
import { BarraFiltros, Indicadores, IndicadoresSkeleton, Listado, ZonaResultados, type Indicador } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { AgentsPipeline } from "@/components/convocatoria/sections/AgentsPipeline";
import { DespachoEquipo } from "@/components/convocatoria/DespachoEquipo";
import { barraAnalisis, TablaAnalisis, TablaAnalisisSkeleton } from "@/components/convocatoria/TablaAnalisis";
import {
  analisisQueryParams,
  filtrarAnalisis,
  getAnalisisPublicados,
  ordenarAnalisis,
  parseAnalisisQuery,
  RIESGO_URL,
  type AnalisisPublicado,
  type AnalisisQuery,
} from "@/components/convocatoria/analisisPublicados";
import { contarPorNivel } from "@/components/convocatoria/sections/conteoRiesgo";
import { getResumenVivo } from "@/lib/contratos";
import { numero, plural, relativo } from "@/lib/formato";

export const metadata: Metadata = {
  title: "Análisis publicados",
  description:
    "Contratos del Estado que Vigía ya leyó: peso del riesgo, señales con su evidencia, precios de mercado y dictamen.",
};

const RUTA = "/app/convocatoria";

/**
 * /app/convocatoria — plantilla Listado (DESIGN_SYSTEM.md §14.1):
 * encabezado → indicadores → barra de filtros → resultados.
 *
 * Antes la tabla filtraba en el navegador con `useState` (chips de riesgo y de tipo, zona,
 * orden, búsqueda): el filtro no se podía compartir ni deshacer con atrás. Ahora todo va a
 * la URL (`?q=&riesgo=&tipo=&zona=&orden=&pagina=`) y esta página lo lee.
 *
 * El <Suspense> no lleva `key`: al filtrar, la lista anterior queda atenuada (ZonaResultados)
 * hasta que llega la nueva, en vez de saltar al esqueleto en cada clic.
 */
export default function ConvocatoriaPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const query = parseAnalisisQuery(searchParams);
  return (
    <Pagina className="space-y-5">
      <EncabezadoPagina
        titulo="Análisis publicados"
        bajada="Contratos que Vigía ya leyó, con su peso de riesgo, sus señales y el dictamen."
        ayuda={
          <Ayuda titulo="¿Cómo llega un contrato aquí?">
            Vigía no analiza contratos a pedido: los lee en orden de cola, zona por zona, cuando alguien financia la lectura
            de esa zona.
          </Ayuda>
        }
        acciones={
          <>
            <DespachoEquipo />
            <Suspense fallback={<AgentsPipeline />}>
              <PipelineConDuracion />
            </Suspense>
            <EnlaceAccion href="/app/auditoria" variante="secundario">
              Ver la cola en vivo
            </EnlaceAccion>
            <EnlaceAccion href="/app/financiar" flecha>
              Financiar la lectura de tu zona
            </EnlaceAccion>
          </>
        }
      />
      <Suspense fallback={<Esperando />}>
        <VistaAnalisis query={query} />
      </Suspense>
    </Pagina>
  );
}

/** "Cómo se lee un contrato", con la duración real medida en producción (si el API la da). */
async function PipelineConDuracion() {
  const r = await getResumenVivo();
  return <AgentsPipeline medianaSeg={r?.estimado?.medianaSeg ?? null} nLecturas={r?.estimado?.n ?? null} />;
}

/** Carga: la forma de lo que viene (cifras y tabla), nunca un cero provisional. */
function Esperando() {
  return (
    <div role="status" aria-busy className="space-y-5">
      <span className="sr-only">Cargando los análisis publicados…</span>
      <IndicadoresSkeleton n={4} />
      <TablaAnalisisSkeleton />
    </div>
  );
}

async function VistaAnalisis({ query }: { query: AnalisisQuery }) {
  const { items, parcial, fallo } = await getAnalisisPublicados();
  const filtrados = ordenarAnalisis(filtrarAnalisis(items, query), query);
  return (
    <div className="space-y-5">
      {!fallo && items.length > 0 && <Indicadores items={indicadores(items)} />}
      <Listado ruta={RUTA} parametros={analisisQueryParams(query)}>
        {!fallo && items.length > 0 && <BarraFiltros {...barraAnalisis(items, query)} />}
        <ZonaResultados>
          <TablaAnalisis universo={items} filtrados={filtrados} query={query} ruta={RUTA} parcial={parcial} fallo={fallo} />
        </ZonaResultados>
      </Listado>
    </div>
  );
}

/**
 * Las cifras de cabecera, sobre todos los análisis (no sobre el filtro): cuántos, cuántos
 * pesan alto, cuántos terminaron limpios y cuándo fue la última lectura. Los conteos salen
 * de `contarPorNivel`, la misma función que cuenta las opciones del filtro.
 */
function indicadores(items: AnalisisPublicado[]): Indicador[] {
  const c = contarPorNivel(items);
  const conSenales = c.alta + c.media + c.baja;
  const ultima = items.reduce<string | null>((max, it) => (!max || it.analizado_en > max ? it.analizado_en : max), null);
  const hace7d = Date.now() - 7 * 86_400_000;
  const semana = items.filter((it) => new Date(it.analizado_en).getTime() >= hace7d).length;
  return [
    {
      valor: numero(c.total),
      etiqueta: "análisis publicados",
      contexto: `${numero(conSenales)} con señales`,
    },
    {
      valor: numero(c.alta),
      etiqueta: "riesgo alto",
      tono: "alta",
      contexto: `de ${numero(c.total)} publicados`,
      href: `${RUTA}?riesgo=${RIESGO_URL.alta}`,
    },
    {
      valor: numero(c.sin_senales),
      etiqueta: "sin señales",
      tono: "positivo",
      contexto: `de ${numero(c.total)} publicados`,
      href: `${RUTA}?riesgo=${RIESGO_URL.sin_senales}`,
    },
    {
      valor: ultima ? relativo(ultima) : null,
      etiqueta: "última lectura",
      contexto: semana > 0 ? `${plural(semana, "análisis", "análisis")} en los últimos 7 días` : "ninguno en los últimos 7 días",
    },
  ];
}
