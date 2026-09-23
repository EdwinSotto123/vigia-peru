import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareWarning, CheckCircle2, Camera, Shield, MapPin, WifiOff, Inbox } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { NumberTicker } from "@/components/magicui/NumberTicker";
import { DenunciasGrid } from "@/components/denuncias/DenunciasGrid";
import { FiltrosDenuncias } from "@/components/denuncias/FiltrosDenuncias";
import { getReportesPagina, type ApiReporte, type ReportesPagina } from "@/lib/api-client";
import { estaConfirmada, tieneUbicacion } from "@/lib/denuncias-meta";
import { parseDenunciasQuery, confirmadosDe, denunciasQueryString } from "@/lib/denuncias-query";

export const metadata: Metadata = {
  title: "Denuncias ciudadanas",
  description:
    "Obras paralizadas, obras fantasma e irregularidades que reportan los vecinos, con su foto y el lugar donde las vieron.",
};

// Tamaño de página de la grilla.
const SIZE = 24;
// Muestra para las cifras de arriba: las 200 más recientes, sin filtros.
const MUESTRA = 200;

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
      <PageHeader
        title="Denuncias ciudadanas"
        subtitle="Vecinos, comerciantes y trabajadores reportan obras paralizadas, obras fantasma e irregularidades. Son públicas: cualquiera puede verlas."
        actions={
          // Un solo llamado a denunciar en toda la página. En el estado vacío lo
          // lleva el propio mensaje, así que acá se omite para no duplicarlo.
          !pagina || !sinNinguna ? (
            <Link
              href="/reporte/nuevo"
              className="inline-flex items-center gap-1.5 rounded-full bg-heroViolet px-4 py-2 text-sm font-medium text-paper shadow-card transition-colors hover:bg-heroViolet-deep"
            >
              <MessageSquareWarning size={14} aria-hidden />
              Denunciar una obra
            </Link>
          ) : undefined
        }
      />

      {!pagina || !muestra ? (
        <Aviso
          icono={<WifiOff size={18} />}
          titulo="No pudimos leer las denuncias"
          cuerpo="El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento."
          accion={
            <Link href={aqui} className="font-medium text-heroViolet hover:underline">
              Reintentar
            </Link>
          }
        />
      ) : sinNinguna ? (
        <Aviso
          icono={<Inbox size={18} />}
          titulo="Todavía no hay denuncias de vecinos publicadas"
          cuerpo="Cuando alguien reporte una obra paralizada, una obra fantasma o una irregularidad, va a aparecer aquí con su foto y el lugar donde la vio."
          accion={
            <Link
              href="/reporte/nuevo"
              className="inline-flex items-center gap-1.5 rounded-full bg-heroViolet px-4 py-2 text-sm font-medium text-paper shadow-card transition-colors hover:bg-heroViolet-deep"
            >
              <MessageSquareWarning size={14} aria-hidden />
              Denunciar una obra
            </Link>
          }
        />
      ) : (
        <>
          <Cifras muestra={muestra} />

          <div className="surface flex flex-wrap items-start gap-3 p-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-heroGreen-soft text-heroGreenTexto">
              <Shield size={14} aria-hidden />
            </div>
            <div className="min-w-0 flex-1 text-xs leading-relaxed text-mute">
              <p className="font-medium text-ink">Qué pasa con cada denuncia</p>
              <ul className="mt-1 list-outside list-disc space-y-0.5 pl-4">
                <li>
                  Se publica al instante, tal como llegó: en esta lista y en el mapa de Vigía, con su foto y el lugar
                  que se marcó. Nadie la revisa antes.
                </li>
                <li>
                  Figura como <strong className="text-mossTexto">confirmada</strong> sólo cuando la respaldan dos o
                  más reportes independientes del mismo lugar.
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
 * sobre la muestra de las 200 más recientes, y cuando hay más que eso lo dicen.
 */
function Cifras({ muestra }: { muestra: ReportesPagina }) {
  const filas: ApiReporte[] = muestra.data;
  const total = Math.max(muestra.total, filas.length);
  const sobre = filas.length;
  const recorte = total > sobre ? ` de las ${sobre.toLocaleString("es-PE")} más recientes` : "";
  const confirmadas = filas.filter(estaConfirmada).length;
  const conFoto = filas.filter((r) => r.fotoUrl).length;
  const conUbicacion = filas.filter(tieneUbicacion).length;
  const pct = (n: number) => (sobre ? `${Math.round((n / sobre) * 100)} %` : "");

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi icon={<MessageSquareWarning size={14} />} label="Denuncias" value={total} sub="desde el inicio" />
      <Kpi icon={<CheckCircle2 size={14} />} label="Confirmadas" value={confirmadas} sub={`por 2 o más reportes${recorte}`} />
      <Kpi icon={<Camera size={14} />} label="Con foto" value={conFoto} sub={`${pct(conFoto)}${recorte}`} />
      <Kpi icon={<MapPin size={14} />} label="Con ubicación" value={conUbicacion} sub={`punto marcado en el mapa${recorte}`} />
    </div>
  );
}

function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paperSoft p-3 text-ink shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-mute">{label}</span>
        <span className="text-mute" aria-hidden>{icon}</span>
      </div>
      <NumberTicker value={value} className="mt-1 block font-mono text-2xl font-bold" />
      {sub && <div className="mt-0.5 text-[11px] leading-snug text-mute">{sub}</div>}
    </div>
  );
}

function Aviso({
  icono,
  titulo,
  cuerpo,
  accion,
}: {
  icono: React.ReactNode;
  titulo: string;
  cuerpo: string;
  accion?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-paperSoft/60 px-6 py-10 text-center">
      <span className="inline-flex text-mute" aria-hidden>{icono}</span>
      <h2 className="mt-2 font-serif text-lg font-bold text-ink">{titulo}</h2>
      <p className="mx-auto mt-1 max-w-[60ch] text-[13.5px] leading-relaxed text-mute">{cuerpo}</p>
      {accion && <div className="mt-4 text-sm">{accion}</div>}
    </div>
  );
}
