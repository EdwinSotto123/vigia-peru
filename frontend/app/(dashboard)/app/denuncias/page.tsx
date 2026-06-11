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
import { DenunciasGrid } from "@/components/denuncias/DenunciasGrid";
import { getReportes, getConvergencias } from "@/lib/api-client";
import { REPORTES_MOCK, CONVERGENCIAS_MOCK } from "@/lib/mock-data";
import type { ReporteCiudadano, Convergencia } from "@/types";

export default async function DenunciasPage() {
  let reportes: ReporteCiudadano[] = [];
  let convergencias: Convergencia[] = [];
  let source: "api" | "mock" = "api";
  try {
    const [r, c] = await Promise.all([getReportes({ limit: 200 }), getConvergencias()]);
    reportes = r as any;
    convergencias = c as any;
  } catch (e) {
    console.error("[denuncias page] API falló, uso mock:", (e as Error).message);
    reportes = REPORTES_MOCK;
    convergencias = CONVERGENCIAS_MOCK;
    source = "mock";
  }

  const total = reportes.length;
  const verificados = reportes.filter((r) => r.confirmado).length;
  const enConvergencia = new Set(convergencias.flatMap((c) => c.reporteIds)).size;
  const conFoto = reportes.filter((r) => r.fotoUrl).length;

  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <PageHeader
        eyebrow="Acceso libre · sin login"
        icon={<MessageSquareWarning size={11} className="text-clay" />}
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
              className="inline-flex items-center gap-1.5 rounded-full bg-rust px-4 py-2 text-sm font-medium text-paper hover:bg-rust/90"
            >
              <MessageSquareWarning size={14} />
              Denunciar algo
            </Link>
          </div>
        }
      />

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={<MessageSquareWarning size={14} />} label="Denuncias totales" value={total} sub="acumulado del mes" tone="ink" />
        <Kpi icon={<CheckCircle2 size={14} />} label="Verificadas" value={verificados} sub="≥ 2 reportes independientes" tone="moss" />
        <Kpi icon={<GitMerge size={14} />} label="Convergentes" value={enConvergencia} sub="coinciden con alerta automática" tone="rust" />
        <Kpi icon={<Camera size={14} />} label="Con evidencia foto" value={conFoto} sub={total ? `${Math.round((conFoto / total) * 100)}% del total` : ""} tone="ink" />
      </div>

      {/* Reglas / disclaimer */}
      <div className="surface flex flex-wrap items-start gap-3 p-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-paperDeep text-clay">
          <Shield size={14} />
        </div>
        <div className="min-w-0 flex-1 text-xs leading-relaxed text-mute">
          <p className="font-medium text-ink">Cómo se modera lo que ves acá</p>
          <ul className="mt-1 space-y-0.5">
            <li>· Para que aparezca como <strong className="text-moss">verificado</strong> se requieren ≥ 2 reportes independientes del mismo punto en ≤ 30 días.</li>
            <li>· Los reportes sin foto figuran en este listado pero <strong className="text-ink">no se publican como pin en el mapa público</strong>.</li>
            <li>· Cuando un reporte coincide geográfica y temporalmente con una alerta automática → se marca <strong className="text-rust">convergente</strong>.</li>
            <li>· Los datos personales del denunciante son anónimos por defecto.</li>
          </ul>
        </div>
      </div>

      <DenunciasGrid reportes={reportes} convergencias={convergencias} />

      {/* Banner final — CTA */}
      <div className="surface relative isolate overflow-hidden border-l-4 border-l-rust p-5">
        <div aria-hidden className="absolute -right-20 -top-20 -z-10 h-60 w-60 rounded-full bg-rust/8 blur-3xl" />
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rust text-paper">
            <MessageSquareWarning size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-serif text-lg font-bold text-ink">¿Ves algo que no cuadra?</h3>
            <p className="text-sm text-mute">Saca la foto, marca el punto en el mapa, cuenta qué viste. En 30 segundos tu reporte se cruza contra las contrataciones del Estado.</p>
          </div>
          <Link href="/reporte/nuevo" className="inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper hover:bg-coal">
            Reportar ahora
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, sub, tone }: { icon: React.ReactNode; label: string; value: number; sub?: string; tone: "ink" | "rust" | "moss" }) {
  const cls = {
    ink: "border-line bg-paperSoft text-ink",
    rust: "border-rust/30 bg-crimson-soft text-rust",
    moss: "border-moss/30 bg-paperSoft text-moss",
  }[tone];
  return (
    <div className={`rounded-2xl border p-3 ${cls}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-mute">{label}</span>
        {icon}
      </div>
      <div className="mt-1 font-mono text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-mute">{sub}</div>}
    </div>
  );
}
