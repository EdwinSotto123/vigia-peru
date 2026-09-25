import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareWarning, Shield } from "lucide-react";
import { EncabezadoPagina, EstadoError, EstadoVacio, Cifra } from "@/components/patrones";
import { DenunciasGrid } from "@/components/denuncias/DenunciasGrid";
import { FiltrosDenuncias } from "@/components/denuncias/FiltrosDenuncias";
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
    <div className="space-y-6 px-4 py-8 sm:px-6 lg:px-10">
      <EncabezadoPagina
        titulo="Denuncias ciudadanas"
        bajada="Vecinos, comerciantes y trabajadores reportan obras paralizadas, obras fantasma e irregularidades. Son públicas: cualquiera puede verlas."
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
          titulo="Todavía no hay denuncias de vecinos publicadas"
          accion={
            <Link href="/reporte/nuevo" className={BOTON_DENUNCIAR}>
              <MessageSquareWarning size={16} aria-hidden />
              Denunciar una obra
            </Link>
          }
        >
          Cuando alguien reporte una obra paralizada, una obra fantasma o una irregularidad, va a aparecer aquí con su
          foto y el lugar donde la vio.
        </EstadoVacio>
      ) : (
        <>
          <Cifras muestra={muestra} />

          <div className="flex flex-wrap items-start gap-3 rounded-2xl border border-line bg-paper p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-granate-soft text-granate" aria-hidden>
              <Shield size={14} />
            </span>
            <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-inkSoft">
              <h2 className="font-display text-[15px] font-bold text-ink">Qué pasa con cada denuncia</h2>
              <ul className="mt-1 list-outside list-disc space-y-0.5 pl-4">
                <li>
                  Se publica al instante, tal como llegó: en esta lista y en el mapa de Vigía, con su foto y el lugar
                  que se marcó. Nadie la revisa antes.
                </li>
                <li>
                  Figura como <strong className="font-semibold text-mossTexto">confirmada</strong> sólo cuando la
                  respaldan dos o más reportes independientes del mismo lugar.
                </li>
                <li>
                  Es el testimonio de un vecino, no un hallazgo de Vigía: los agentes que leen contratos no la
                  analizan.
                </li>
              </ul>
            </div>
          </div>

          <FiltrosDenuncias query={query} />

          <DenunciasGrid
            reportes={pagina.data}
            query={query}
            total={pagina.total}
            paginas={Math.max(1, Math.ceil(pagina.total / SIZE))}
            size={SIZE}
          />
        </>
      )}
    </div>
  );
}

/**
 * Las cuatro cifras de arriba. Son un resumen del sitio: no reaccionan a los
 * filtros de abajo. `total` es el conteo del backend; las otras tres se cuentan
 * sobre la muestra de las 200 más recientes, y cuando hay más que eso lo dicen:
 * cada cifra lleva su denominador (DESIGN_SYSTEM.md §10.2).
 */
function Cifras({ muestra }: { muestra: ReportesPagina }) {
  const filas: ApiReporte[] = muestra.data;
  const total = Math.max(muestra.total, filas.length);
  const sobre = filas.length;
  const base = total > sobre ? `de las ${numero(sobre)} más recientes` : `de ${numero(sobre)}`;
  const confirmadas = filas.filter(estaConfirmada).length;
  const conFoto = filas.filter((r) => r.fotoUrl).length;
  const conUbicacion = filas.filter(tieneUbicacion).length;
  const pct = (n: number) => (sobre ? ` (${porcentaje((n / sobre) * 100)})` : "");

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <CifraDenuncias valor={numero(total)} etiqueta="Denuncias publicadas" contexto="desde el inicio" />
      <CifraDenuncias valor={numero(confirmadas)} etiqueta="Confirmadas" contexto={`${base}; por dos o más reportes`} />
      <CifraDenuncias valor={numero(conFoto)} etiqueta="Con foto" contexto={`${base}${pct(conFoto)}`} />
      <CifraDenuncias valor={numero(conUbicacion)} etiqueta="Con punto en el mapa" contexto={`${base}${pct(conUbicacion)}`} />
    </div>
  );
}

/** `Cifra` del sistema dentro de su tarjeta (borde, sin sombra: una tarjeta en reposo no flota). */
function CifraDenuncias({ valor, etiqueta, contexto }: { valor: string; etiqueta: string; contexto: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <Cifra valor={valor} etiqueta={etiqueta} contexto={contexto} />
    </div>
  );
}
