import Link from "next/link";
import {
  MessageSquareWarning,
  CheckCircle2,
  GitMerge,
  Camera,
  Shield,
  ArrowRight,
  Cloud,
} from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { NumberTicker } from "@/components/magicui/NumberTicker";
import { DenunciasGrid } from "@/components/denuncias/DenunciasGrid";
import { FiltrosDenuncias } from "@/components/denuncias/FiltrosDenuncias";
import { getReportes, getReportesPagina, getConvergencias } from "@/lib/api-client";
import { REPORTES_MOCK, CONVERGENCIAS_MOCK } from "@/lib/mock-data";
import { parseDenunciasQuery, confirmadosDe } from "@/lib/denuncias-query";
import type { ReporteCiudadano, Convergencia } from "@/types";

// Tamaño de página de la grilla (tarjetas, no pines). El mapa se sigue
// alimentando de un batch más grande (MAPA_LIMIT) que respeta los mismos
// filtros pero no la paginación — un fetch de 24 rompería el mapa mostrando
// solo una fracción de los pines.
const SIZE = 24;
const MAPA_LIMIT = 200;

export default async function DenunciasPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const query = parseDenunciasQuery(searchParams);
  const confirmados = confirmadosDe(query.estado);

  let reportes: ReporteCiudadano[] = []; // página actual de la grilla (filtrada + paginada, server-side)
  let reportesMapa: ReporteCiudadano[] = []; // mismos filtros, sin paginar — para los pines del mapa
  let convergencias: Convergencia[] = [];
  let total = 0;
  let snapshot: ReporteCiudadano[] = []; // muestra global sin filtrar, solo para las KPI de arriba
  let source: "api" | "mock" = "api";
  try {
    const [pagina, mapa, c, kpiSnapshot] = await Promise.all([
      getReportesPagina({
        region: query.region,
        categoria: query.categoria,
        confirmados,
        limit: SIZE,
        offset: (query.page - 1) * SIZE,
      }),
      getReportes({ region: query.region, categoria: query.categoria, confirmados, limit: MAPA_LIMIT }),
      getConvergencias(),
      getReportes({ limit: 200 }),
    ]);
    reportes = pagina.data as any;
    total = pagina.total;
    reportesMapa = mapa as any;
    convergencias = c as any;
    snapshot = kpiSnapshot as any;
  } catch (e) {
    console.error("[denuncias page] API falló, uso mock:", (e as Error).message);
    reportes = REPORTES_MOCK;
    reportesMapa = REPORTES_MOCK;
    convergencias = CONVERGENCIAS_MOCK;
    snapshot = REPORTES_MOCK;
    total = REPORTES_MOCK.length;
    source = "mock";
  }

  // KPI: siempre sobre la muestra global sin filtrar (igual que antes de tener
  // filtros server-side) — la franja de arriba es un resumen del sitio, no
  // reacciona a lo que elijas en los filtros de abajo.
  const totalKpi = snapshot.length;
  const verificados = snapshot.filter((r) => r.confirmado).length;
  const enConvergencia = new Set(convergencias.flatMap((c) => c.reporteIds)).size;
  const conFoto = snapshot.filter((r) => r.fotoUrl).length;
  const paginas = Math.max(1, Math.ceil(total / SIZE));

  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <PageHeader
        title="Denuncias ciudadanas"
        subtitle="Vecinos, comerciantes y trabajadores reportan obras paralizadas, fantasmas o irregularidades. Tú puedes verlas todas — son públicas y verificables."
        actions={
          <div className="flex items-center gap-2">
            <span
              className={
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest " +
                (source === "api"
                  ? "border-moss/40 bg-moss/10 text-moss"
                  : "border-amber/40 bg-amber-soft text-amber")
              }
            >
              <Cloud size={11} />
              {source === "api" ? "live · Cloud SQL" : "mock"}
            </span>
            <Link
              href="/reporte/nuevo"
              className="inline-flex items-center gap-1.5 rounded-full bg-heroViolet px-4 py-2 text-sm font-medium text-paper shadow-card transition-colors hover:bg-heroViolet-deep"
            >
              <MessageSquareWarning size={14} />
              Denunciar algo
            </Link>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<MessageSquareWarning size={14} />} label="Denuncias totales" value={totalKpi} sub="acumulado del mes" tone="ink" />
        <Kpi icon={<CheckCircle2 size={14} />} label="Verificadas" value={verificados} sub="≥ 2 reportes independientes" tone="moss" />
        <Kpi icon={<GitMerge size={14} />} label="Convergentes" value={enConvergencia} sub="coinciden con alerta automática" tone="amber" />
        <Kpi icon={<Camera size={14} />} label="Con evidencia foto" value={conFoto} sub={totalKpi ? `${Math.round((conFoto / totalKpi) * 100)}% del total` : ""} tone="ink" />
      </div>

      {/* Reglas / disclaimer */}
      <div className="surface flex flex-wrap items-start gap-3 p-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-heroGreen-soft text-heroGreen">
          <Shield size={14} />
        </div>
        <div className="min-w-0 flex-1 text-xs leading-relaxed text-mute">
          <p className="font-medium text-ink">Cómo se modera lo que ves acá</p>
          <ul className="mt-1 space-y-0.5">
            <li>· Para que aparezca como <strong className="text-moss">verificado</strong> se requieren ≥ 2 reportes independientes del mismo punto en ≤ 30 días.</li>
            <li>· Los reportes sin foto figuran en este listado pero <strong className="text-ink">no se publican como pin en el mapa público</strong>.</li>
            <li>· Cuando un reporte coincide geográfica y temporalmente con una alerta automática → se marca <strong className="text-amber">convergente</strong>.</li>
            <li>· Los datos personales del denunciante son anónimos por defecto.</li>
          </ul>
        </div>
      </div>

      <FiltrosDenuncias query={query} />

      <DenunciasGrid
        reportes={reportes}
        reportesMapa={reportesMapa}
        convergencias={convergencias}
        query={query}
        total={total}
        paginas={paginas}
        size={SIZE}
      />

      {/* Banner final — CTA */}
      <div className="surface relative isolate overflow-hidden border-l-4 border-l-heroViolet p-5">
        <div aria-hidden className="absolute -right-20 -top-20 -z-10 h-60 w-60 rounded-full bg-heroViolet/10 blur-3xl" />
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-heroViolet text-paper">
            <MessageSquareWarning size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-serif text-lg font-bold text-ink">¿Ves algo que no cuadra?</h3>
            <p className="text-sm text-mute">Saca la foto, marca el punto en el mapa, cuenta qué viste. En 30 segundos tu reporte se cruza contra las contrataciones del Estado.</p>
          </div>
          <Link href="/reporte/nuevo" className="inline-flex items-center gap-1.5 rounded-full bg-heroViolet px-4 py-2 text-sm font-medium text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper">
            Reportar ahora
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: number; sub?: string; tone: "ink" | "rust" | "moss" | "amber" }) {
  const cls = {
    ink: "border-line bg-paperSoft text-ink",
    rust: "border-rust/30 bg-crimson-soft text-rust",
    moss: "border-moss/30 bg-paperSoft text-moss",
    amber: "border-amber/30 bg-amber-soft text-amber",
  }[tone];
  return (
    <div className={`rounded-2xl border p-3 shadow-card ${cls}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-mute">{label}</span>
        {icon}
      </div>
      {/* Cuenta desde 0 al entrar en pantalla — antes era texto estático. Estas 4
          cifras son lo primero que se lee en la página, donde más se notaba que
          todo estaba quieto. */}
      <NumberTicker value={value} className="mt-1 block font-mono text-2xl font-bold" />
      {sub && <div className="mt-0.5 text-[10px] text-mute">{sub}</div>}
    </div>
  );
}
