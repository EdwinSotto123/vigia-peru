import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { FiltrosSenales, SelectorVista } from "@/components/alertas/FiltrosSenales";
import { ListaSenales, ListaSenalesSkeleton } from "@/components/alertas/ListaSenales";
import { EnRevision, EnRevisionSkeleton } from "@/components/alertas/EnRevision";
import { getResumenProcesamientos } from "@/lib/auditoria";
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
 * /app/hallazgos — la señal como unidad de primera clase.
 *
 * Hasta ahora la señal no tenía superficie propia: vivía dentro de la pestaña 1 del
 * dossier de un contrato, y /app/alertas listaba *contratos* con los slugs de sus
 * reglas como píldoras decorativas. Aquí las ~220 señales publicadas se listan, se
 * filtran por regla, severidad, entidad y agente, y se abren en sitio con su norma,
 * su cita del expediente y —obligatorio— qué NO prueban.
 *
 * Dos poblaciones, un solo destino: `?vista=revision` muestra los análisis que
 * terminaron y la autoevaluación bloqueó. No es otra página porque la cifra que
 * importa es la comparación entre ambas, y separarlas la escondería.
 *
 * Nota de arquitectura: la vista va dentro de <Suspense> porque enriquecer cada
 * señal con su agente y su cotejo (un fetch por contrato, ver lib/revision.ts)
 * cuesta ~6 s en frío y 0 en caliente. El encabezado pinta de inmediato y la tabla
 * entra sobre un esqueleto de su misma forma; nunca se muestra un cero provisional
 * en lugar de un conteo que todavía no se sabe. Todo lo que cruza hacia los
 * componentes cliente son datos planos: ni una función atraviesa ese límite.
 */
export default async function HallazgosPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const query = parseSenalesQuery(searchParams);

  return (
    <div className="space-y-5 px-6 py-8 lg:px-10">
      <PageHeader
        title="Señales con norma y evidencia"
        subtitle="Una señal es una regla que disparó sobre un contrato que los agentes leyeron de verdad: trae la norma que cita, el texto del expediente que la sostiene y el agente que la encontró. Es un indicio para volver a la fuente, nunca una acusación."
      />

      {query.vista === "revision" ? (
        <Suspense fallback={<Cargando>{<EnRevisionSkeleton />}</Cargando>}>
          <VistaRevision />
        </Suspense>
      ) : (
        <Suspense key={JSON.stringify(query)} fallback={<Cargando>{<ListaSenalesSkeleton />}</Cargando>}>
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
function Cargando({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <SelectorVista vista="publicadas" publicadas={null} enRevision={null} inerte />
      {children}
    </div>
  );
}

async function VistaPublicadas({ query }: { query: SenalesQuery }) {
  const [universo, resumen] = await Promise.all([getUniversoSenales(), getResumenProcesamientos().catch(() => null)]);
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
          enRevision={resumen?.porEstado.revision ?? 0}
        />
        <p className="text-[13px] text-mute">
          <span className="font-mono tabular-nums text-ink">{filtradas.length.toLocaleString("es-PE")}</span>{" "}
          {filtradas.length === 1 ? "señal" : "señales"} de{" "}
          <span className="font-mono tabular-nums">{universo.senales.length.toLocaleString("es-PE")}</span>, sobre{" "}
          <span className="font-mono tabular-nums">{universo.contratos.toLocaleString("es-PE")}</span> contratos leídos
        </p>
      </div>

      {ultimo && (
        <p className="text-[13px] leading-relaxed text-mute">
          El último contrato con señales publicadas se analizó{" "}
          <time dateTime={ultimo.analizadoEn} className="font-medium text-ink">
            {haceCuanto(ultimo.analizadoEn)}
          </time>
          :{" "}
          {ultimo.ocid ? (
            <Link href={`/app/convocatoria/${ultimo.ocid}`} className="font-medium text-heroViolet hover:underline">
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
  return (
    <div className="space-y-4">
      <SelectorVista vista="revision" publicadas={publicadas} enRevision={items.length} />
      <EnRevision items={items} procesados={resumen?.porEstado.procesado ?? null} publicadas={publicadas} />
    </div>
  );
}

/**
 * "hace 5 h", "hace 3 días". Se calcula al renderizar en el servidor: la página es
 * dinámica (depende de la URL), así que no queda congelado en un build viejo.
 */
function haceCuanto(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return min <= 1 ? "hace un momento" : `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return `hace ${d} días`;
}
