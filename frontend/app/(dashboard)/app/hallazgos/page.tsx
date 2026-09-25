import { Suspense } from "react";
import Link from "next/link";
import { EncabezadoPagina } from "@/components/patrones";
import { FiltrosSenales, SelectorVista } from "@/components/alertas/FiltrosSenales";
import { ListaSenales, ListaSenalesSkeleton } from "@/components/alertas/ListaSenales";
import { EnRevision, EnRevisionSkeleton } from "@/components/alertas/EnRevision";
import { getResumenProcesamientos } from "@/lib/auditoria";
import { numero, plural, relativo } from "@/lib/formato";
import {
  contarCotejadas,
  contarSenalesPublicadas,
  facetasSenales,
  filtrarSenales,
  getAnalisisEnRevision,
  getUltimoAnalisisPublicado,
  getUniversoSenales,
  parseSenalesQuery,
  type SenalesQuery,
} from "@/lib/revision";

export const metadata = {
  title: "Señales",
  description:
    "Cada señal de riesgo publicada por Vigía Perú, con la regla que la disparó, la norma que cita, la evidencia del expediente y el agente que la encontró.",
};

const TAM = 25;

/**
 * /app/hallazgos — la señal como unidad de primera clase. Plantilla "Listado"
 * (DESIGN_SYSTEM.md §14): encabezado → filtros (chips con conteo) → tabla densa →
 * paginación → estado vacío.
 *
 * Aquí las señales publicadas se listan, se filtran por regla, severidad, entidad y
 * agente, y se abren en sitio con su norma, su cita del expediente y —obligatorio—
 * qué NO prueban.
 *
 * Dos poblaciones, un solo destino: `?vista=revision` muestra los contratos
 * financiados cuyo análisis terminó y la autoevaluación frenó. No es otra página
 * porque la cifra que importa es la comparación entre ambas.
 *
 * La vista va dentro de <Suspense> porque enriquecer cada señal con su agente y su
 * cotejo (un fetch por contrato, ver lib/revision.ts) cuesta ~6 s en frío. El
 * encabezado pinta de inmediato y la tabla entra sobre un esqueleto de su misma
 * forma; nunca se muestra un cero provisional. Todo lo que cruza hacia los
 * componentes cliente son datos planos: ni una función atraviesa ese límite.
 */
export default async function HallazgosPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const query = parseSenalesQuery(searchParams);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8 lg:px-10">
      <EncabezadoPagina
        titulo="Señales con norma y evidencia"
        bajada="Una señal es una regla que disparó sobre un contrato que los agentes leyeron: trae la norma que cita, el texto del expediente que la sostiene y el agente que la encontró. Es un indicio para volver a la fuente, nunca una acusación."
      />

      {query.vista === "revision" ? (
        <Suspense fallback={<EsperandoVista>{<EnRevisionSkeleton />}</EsperandoVista>}>
          <VistaRevision />
        </Suspense>
      ) : (
        <Suspense key={JSON.stringify(query)} fallback={<EsperandoVista>{<ListaSenalesSkeleton />}</EsperandoVista>}>
          <VistaPublicadas query={query} />
        </Suspense>
      )}
    </div>
  );
}

/**
 * Estado de carga: el selector de vista mantiene su sitio pero sin conteos —un "0"
 * provisional se lee como un dato, y durante seis segundos sería un dato falso.
 */
function EsperandoVista({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4" role="status" aria-busy>
      <SelectorVista vista="publicadas" publicadas={null} enRevision={null} inerte />
      <span className="sr-only">Cargando las señales…</span>
      {children}
    </div>
  );
}

async function VistaPublicadas({ query }: { query: SenalesQuery }) {
  const [universo, resumen] = await Promise.all([getUniversoSenales(), getResumenProcesamientos().catch(() => null)]);
  // Contratos CON SEÑALES (§10.1: al menos una señal publicada) = los que aparecen en el universo.
  const publicados = new Set(universo.senales.map((s) => s.alertaCodigo).filter((c): c is string => !!c));
  const ultimo = await getUltimoAnalisisPublicado(publicados);
  const filtradas = filtrarSenales(universo.senales, query);
  const facetas = facetasSenales(universo.senales, query);
  const pagina = Math.min(query.pagina, Math.max(1, Math.ceil(filtradas.length / TAM)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SelectorVista
          vista="publicadas"
          publicadas={universo.senales.length}
          enRevision={resumen?.porEstado.revision ?? null}
        />
        {/* Toda cifra con su denominador (§10.2): señales filtradas de las publicadas, y en
            cuántos contratos con señales, de los que tienen dictamen publicado. */}
        {!universo.fallo && (
          <p className="text-[13px] tabular-nums text-inkSoft" aria-live="polite">
            <strong className="font-semibold text-ink">{numero(filtradas.length)}</strong> de{" "}
            {plural(universo.senales.length, "señal publicada", "señales publicadas")}, en{" "}
            {plural(publicados.size, "contrato con señales", "contratos con señales")} de {numero(universo.contratos)} con
            dictamen publicado
          </p>
        )}
      </div>

      {ultimo && (
        <p className="text-[13px] leading-relaxed text-inkSoft">
          El último contrato con señales publicadas se leyó{" "}
          <time dateTime={ultimo.analizadoEn} className="font-medium text-ink">
            {relativo(ultimo.analizadoEn)}
          </time>
          :{" "}
          {ultimo.ocid ? (
            <Link href={`/app/convocatoria/${ultimo.ocid}`} className="font-medium text-granate underline-offset-2 hover:underline">
              {ultimo.entidad}
            </Link>
          ) : (
            <span className="font-medium text-ink">{ultimo.entidad}</span>
          )}
          .
        </p>
      )}

      <FiltrosSenales query={query} facetas={facetas} />

      <ListaSenales
        senales={filtradas.slice((pagina - 1) * TAM, pagina * TAM)}
        total={filtradas.length}
        pagina={pagina}
        tam={TAM}
        query={query}
        cotejadas={contarCotejadas(filtradas)}
        fallo={universo.fallo}
        contratosSinDetalle={universo.contratosSinDetalle}
      />
    </div>
  );
}

async function VistaRevision() {
  // `contarSenalesPublicadas` reusa el mismo fetch cacheado de /alertas sin pagar el
  // enriquecimiento: esta vista sólo necesita el número para ponerlo al lado.
  const [items, publicadas, resumen] = await Promise.all([
    getAnalisisEnRevision(),
    contarSenalesPublicadas(),
    getResumenProcesamientos().catch(() => null),
  ]);
  // Los financiados leídos: `procesado` ya incluye a los que quedaron en revisión (son un subconjunto).
  const leidosFinanciados = resumen?.porEstado.procesado ?? null;
  return (
    <div className="space-y-4">
      <SelectorVista vista="revision" publicadas={publicadas} enRevision={items.length} />
      <EnRevision items={items} procesados={leidosFinanciados} publicadas={publicadas} />
    </div>
  );
}
