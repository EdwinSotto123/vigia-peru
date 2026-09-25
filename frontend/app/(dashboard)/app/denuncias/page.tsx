import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareWarning } from "lucide-react";
import { Ayuda, EncabezadoPagina, EstadoError, EstadoVacio, Pagina } from "@/components/patrones";
import { DenunciasGrid } from "@/components/denuncias/DenunciasGrid";
import { getReportesPagina, type ApiReporte, type ReportesPagina } from "@/lib/api-client";
import { estaConfirmada, tieneUbicacion } from "@/lib/denuncias-meta";
import { parseDenunciasQuery, confirmadosDe, denunciasQueryString } from "@/lib/denuncias-query";
import { numero, porcentaje } from "@/lib/formato";

export const metadata: Metadata = {
  title: "Denuncias ciudadanas",
  description:
    "Obras paralizadas, obras fantasma e irregularidades que reportan los vecinos, con su foto y el lugar donde las vieron.",
};

// Tamaño de página de la grilla.
const SIZE = 24;
// Muestra para las cifras de arriba: las 200 más recientes, sin filtros.
const MUESTRA = 200;

/** El único llamado a denunciar de la página: en el estado vacío lo lleva el propio mensaje. */
const BOTON_DENUNCIAR =
  "inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-granate px-4 py-2 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep";

/**
 * /app/denuncias: lo que reportan los vecinos.
 *
 * Antes, si el API fallaba, esta página mostraba en silencio las 6 denuncias de
 * `REPORTES_MOCK` (fotos de banco de imágenes pegadas a municipalidades reales)
 * con un sello "mock" que nadie iba a leer. Ahora dice que no pudo leer y ofrece
 * reintentar; y sin denuncias reales, dice que todavía no hay ninguna.
 */
export default async function DenunciasPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const query = parseDenunciasQuery(searchParams);
  const confirmados = confirmadosDe(query.estado);

  let pagina: ReportesPagina | null = null;
  let muestra: ReportesPagina | null = null;
  try {
    [pagina, muestra] = await Promise.all([
      getReportesPagina({
        region: query.region,
        categoria: query.categoria,
        confirmados,
        limit: SIZE,
        offset: (query.page - 1) * SIZE,
      }),
      getReportesPagina({ limit: MUESTRA }),
    ]);
  } catch (e) {
    console.error("[denuncias] el API de reportes no respondió:", (e as Error).message);
  }

  const qs = denunciasQueryString(query);
  const aqui = qs ? `/app/denuncias?${qs}` : "/app/denuncias";
  const sinNinguna = !!muestra && muestra.total === 0 && muestra.data.length === 0;

  return (
    <Pagina className="space-y-5">
      <EncabezadoPagina
        titulo="Denuncias ciudadanas"
        bajada="Testimonios de vecinos, no hallazgos de Vigía: obras paralizadas, obras fantasma e irregularidades, con foto y lugar."
        ayuda={
          <Ayuda titulo="¿Qué pasa con cada denuncia?">
            <span className="block">
              Se publica al instante, tal como llegó: en esta lista y en el mapa de Vigía, con su foto y el lugar que se
              marcó. Nadie la revisa antes.
            </span>
            <span className="mt-2 block">
              Figura como confirmada sólo cuando la respaldan dos o más reportes independientes del mismo lugar.
            </span>
            <span className="mt-2 block">
              Es el testimonio de un vecino, no un hallazgo de Vigía: los agentes que leen contratos no la analizan.
            </span>
          </Ayuda>
        }
        acciones={
          !pagina || !sinNinguna ? (
            <Link href="/reporte/nuevo" className={BOTON_DENUNCIAR}>
              <MessageSquareWarning size={16} aria-hidden />
              Denunciar una obra
            </Link>
          ) : undefined
        }
      />

      {!pagina || !muestra ? (
        <EstadoError
          titulo="No pudimos leer las denuncias"
          accion={
            <Link href={aqui} className="text-sm font-semibold text-granate underline-offset-2 hover:underline">
              Reintentar
            </Link>
          }
        >
          El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento.
        </EstadoError>
      ) : sinNinguna ? (
        <EstadoVacio
          compacto
          titulo="Todavía no hay denuncias de vecinos publicadas"
          accion={
            <Link href="/reporte/nuevo" className={BOTON_DENUNCIAR}>
              <MessageSquareWarning size={16} aria-hidden />
              Denunciar una obra
            </Link>
          }
        >
          Cuando alguien reporte una obra, aparece aquí con su foto y el lugar donde la vio.
        </EstadoVacio>
      ) : (
        <>
          <Cifras muestra={muestra} />
          <DenunciasGrid
            reportes={pagina.data}
            query={query}
            total={pagina.total}
            paginas={Math.max(1, Math.ceil(pagina.total / SIZE))}
            size={SIZE}
          />
        </>
      )}
    </Pagina>
  );
}

/**
 * Las cifras de arriba, en UNA línea de datos (DESIGN_SYSTEM.md §10.7). Son un
 * resumen del sitio: no reaccionan a los filtros de abajo. `total` es el conteo del
 * backend; las otras tres se cuentan sobre la muestra de las 200 más recientes, y
 * cuando hay más que eso lo dicen: cada cifra lleva su denominador (§10.2).
 */
function Cifras({ muestra }: { muestra: ReportesPagina }) {
  const filas: ApiReporte[] = muestra.data;
  const total = Math.max(muestra.total, filas.length);
  const sobre = filas.length;
  const recortada = total > sobre;
  const confirmadas = filas.filter(estaConfirmada).length;
  const conFoto = filas.filter((r) => r.fotoUrl).length;
  const conUbicacion = filas.filter(tieneUbicacion).length;
  const pct = (n: number) => (sobre ? ` (${porcentaje((n / sobre) * 100)})` : "");

  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] tabular-nums text-inkSoft">
      <span>
        <strong className="font-semibold text-ink">{numero(total)}</strong> publicadas desde el inicio
      </span>
      <span>
        <strong className="font-semibold text-ink">{numero(confirmadas)}</strong> de {numero(sobre)} confirmadas
      </span>
      <span>
        <strong className="font-semibold text-ink">{numero(conFoto)}</strong> de {numero(sobre)} con foto{pct(conFoto)}
      </span>
      <span>
        <strong className="font-semibold text-ink">{numero(conUbicacion)}</strong> de {numero(sobre)} con punto en el mapa
        {pct(conUbicacion)}
      </span>
      {recortada && <span className="text-mute">sobre las {numero(sobre)} más recientes</span>}
      <Ayuda titulo="¿Qué cuentan estas cifras?">
        <span className="block">
          El total cuenta todas las denuncias publicadas; las otras tres, las {numero(sobre)} más recientes. Son del sitio
          entero: no cambian con los filtros de abajo.
        </span>
        <span className="mt-2 block">Confirmada: la respaldan dos o más reportes independientes del mismo lugar.</span>
      </Ayuda>
    </p>
  );
}
