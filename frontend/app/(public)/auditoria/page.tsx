import Link from "next/link";
import { Activity, ArrowRight, CheckCircle2, Clock, Cpu, ShieldCheck } from "lucide-react";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { FiltroRegion } from "@/components/auditoria/FiltroRegion";
import { getProcesamientos, getResumenProcesamientos } from "@/lib/auditoria";
import { getZonas } from "@/lib/financiamiento";

export const metadata = {
  title: "Auditoría en vivo — Vigía Perú",
  description:
    "Mira en tiempo real cómo cada contrato público financiado pasa de la cola al análisis de 10 fases y al dictamen con señales de riesgo.",
};

export const revalidate = 10;

export default async function AuditoriaPage({ searchParams }: { searchParams?: { ubigeo?: string } }) {
  const ubigeo = searchParams?.ubigeo && /^\d{2,6}$/.test(searchParams.ubigeo) ? searchParams.ubigeo : undefined;
  const [resumen, zonas, initial] = await Promise.all([
    getResumenProcesamientos(),
    getZonas("departamento"),
    getProcesamientos({ ubigeo, limit: 100 }),
  ]);
  const opciones = (zonas ?? [])
    .filter((z) => z.totalCola > 0 || z.financiados > 0)
    .sort((a, b) => b.financiados - a.financiados || a.nombre.localeCompare(b.nombre, "es"))
    .map((z) => ({ ubigeo: z.ubigeo, nombre: z.nombre, hint: z.financiados > 0 ? `${z.financiados.toLocaleString("es-PE")} financiados` : undefined }));
  const zonaActual = ubigeo ? (zonas ?? []).find((z) => z.ubigeo === ubigeo)?.nombre : undefined;
  const enCola = (resumen?.porEstado.encolado ?? 0) + (resumen?.porEstado.error ?? 0);
  const procesando = resumen?.porEstado.procesando ?? 0;

  return (
    <div className="bg-paper">
      {/* ─── HERO ─── */}
      <section className="border-b border-line bg-paperDeep">
        <div className="container-page grid gap-8 py-12 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-mute">
              <Activity size={12} /> Tablero público · se actualiza solo
            </span>
            <h1 className="mt-4 font-serif text-4xl font-bold leading-[1.05] tracking-tight text-ink sm:text-5xl">
              Auditoría en vivo
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-mute">
              Cada contrato financiado por un aliado de transparencia pasa por <strong className="text-ink">10 fases de análisis</strong>:
              reglas de contratación, lectura del expediente, precios de mercado, prensa, red de personas y dictamen.
              Aquí lo ves ocurrir, contrato por contrato.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Kpi icon={<Clock size={14} />} label="En cola" value={enCola} />
            <Kpi icon={<Cpu size={14} />} label="Procesando" value={procesando} vivo={procesando > 0} />
            <Kpi icon={<CheckCircle2 size={14} />} label="Procesados hoy" value={resumen?.procesadosHoy ?? 0} />
          </div>
        </div>
      </section>

      {/* ─── TABLERO ─── */}
      <section className="container-page py-10">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-bold text-ink">{zonaActual ? `En vivo en ${zonaActual}` : "En vivo en todo el Perú"}</h2>
            <p className="mt-0.5 text-sm text-mute">Los contratos entran por orden de llegada. Nadie elige cuáles.</p>
          </div>
          <FiltroRegion opciones={opciones} valor={ubigeo} />
        </div>
        <TableroAuditoria key={ubigeo ?? "all"} ubigeo={ubigeo} initial={initial} autoRefreshMs={5000} />
      </section>

      {/* ─── LEYENDA + CTA ─── */}
      <section className="border-t border-line bg-paperDeep py-12">
        <div className="container-page grid gap-6 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-start">
          <Paso icon={<Clock size={16} />} titulo="En cola">
            Asignado a un aporte confirmado. Espera turno por antigüedad de la convocatoria.
          </Paso>
          <Paso icon={<Cpu size={16} />} titulo="Procesando">
            Los agentes leen el expediente y cruzan fuentes oficiales. Entre 3 y 10 minutos por contrato.
          </Paso>
          <Paso icon={<CheckCircle2 size={16} />} titulo="Procesado">
            Dictamen publicado con cada señal de riesgo citando norma y evidencia. Se publica aunque señale al financiador.
          </Paso>
          <div className="rounded-2xl border border-line bg-paper p-5 lg:max-w-xs">
            <ShieldCheck size={18} className="text-moss" />
            <div className="mt-2 text-sm font-semibold text-ink">¿Tu zona no aparece?</div>
            <p className="mt-1 text-[13px] text-mute">Cuando alguien financia la auditoría de una zona, sus contratos entran aquí. Puedes ser tú.</p>
            <Link href="/financiar" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline-offset-2 hover:underline">
              Financiar una auditoría <ArrowRight size={14} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function Kpi({ icon, label, value, vivo = false }: { icon: React.ReactNode; label: string; value: number; vivo?: boolean }) {
  return (
    <div className={`rounded-2xl border bg-paper p-4 transition-all ${vivo ? "border-amber/50 ring-1 ring-amber/20" : "border-line"}`}>
      <div className="font-mono text-2xl font-semibold text-ink">{value.toLocaleString("es-PE")}</div>
      <div className={`mt-1 inline-flex items-center gap-1 text-[11px] uppercase tracking-wide ${vivo ? "text-amber" : "text-mute"}`}>
        {vivo ? (
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-70" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber" />
          </span>
        ) : icon}
        {label}
      </div>
    </div>
  );
}

function Paso({ icon, titulo, children }: { icon: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="inline-flex items-center gap-2 text-ink">{icon}<h3 className="font-semibold">{titulo}</h3></div>
      <p className="mt-1 text-sm leading-relaxed text-mute">{children}</p>
    </div>
  );
}
