import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Eye } from "lucide-react";
import { AvatarAliado } from "@/components/aliados/TarjetaAliado";
import { KpiTile } from "@/components/aliados/KpiTile";
import { PulseDot } from "@/components/ui/PulseDot";
import { API_BASE } from "@/lib/api-client";

export const revalidate = 30;

interface Aliado { id: number; tipo: "empresa" | "persona" | "organizacion"; nombre: string; slug: string; logoUrl: string | null; desde: string }
interface Contrib { codigo: string; contratos: number; estado: string; pagadaAt: string; ubigeo: string; zona: string; nivel: string; procesados: number; senales: number; enRevision?: number }

/**
 * Mismo vocabulario y colores que ESTADO_UI en lib/admin.ts (panel de contribuciones):
 * copiado aquí en vez de importado porque ese módulo es del panel admin y esta es una
 * página pública — misma paleta visual, sin acoplar una sección a la otra.
 */
const ESTADO_CONTRIB: Record<string, { label: string; cls: string }> = {
  pendiente_pago: { label: "Pendiente", cls: "bg-amber-soft text-amber" },
  pagada: { label: "Pagada", cls: "bg-moss/10 text-moss" },
  en_proceso: { label: "En proceso", cls: "bg-moss/10 text-moss" },
  procesada: { label: "Procesada", cls: "bg-moss text-paper" },
  rechazada: { label: "Rechazada", cls: "bg-crimson-soft text-crimson" },
  reembolsada: { label: "Reembolsada", cls: "bg-paperDeep text-mute" },
};

/** El punto pulsante solo va en "en_proceso" (agentes leyendo contratos ahora mismo) —
 * mismo criterio que EstadoPill.tsx: el punto pulsante siempre significa "en curso". */
function PildoraEstado({ estado }: { estado: string }) {
  const cfg = ESTADO_CONTRIB[estado] ?? { label: estado.replace(/_/g, " "), cls: "bg-paperDeep text-mute" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}>
      {estado === "en_proceso" && <PulseDot color="moss" size={5} />}
      {cfg.label}
    </span>
  );
}

async function getAliado(slug: string): Promise<{ aliado: Aliado; contribuciones: Contrib[] } | null> {
  try {
    const r = await fetch(`${API_BASE}/financiamiento/aliados/${encodeURIComponent(slug)}`, { next: { revalidate: 30 } } as any);
    if (r.ok) return await r.json();
  } catch { /* 404 abajo */ }
  return null;
}

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const data = await getAliado(params.slug);
  if (!data) return { title: "Aliado no encontrado — Vigía Perú" };
  const total = data.contribuciones.reduce((n, c) => n + c.contratos, 0);
  const senales = data.contribuciones.reduce((n, c) => n + c.senales, 0);
  const description = `${data.aliado.nombre} financió la auditoría de ${total} contratos públicos${senales > 0 ? ` · ${senales} señales de riesgo halladas` : ""}. Reconocimiento público y verificable.`;
  return {
    title: `${data.aliado.nombre} — Aliado de transparencia · Vigía Perú`,
    description,
    openGraph: { title: `${data.aliado.nombre} — Aliado de transparencia`, description },
    twitter: { card: "summary" },
  };
}

export default async function AliadoPage({ params }: { params: { slug: string } }) {
  const data = await getAliado(params.slug);
  if (!data) notFound();
  const { aliado, contribuciones } = data;
  const total = contribuciones.reduce((n, c) => n + c.contratos, 0);
  const procesados = contribuciones.reduce((n, c) => n + c.procesados, 0);
  const senales = contribuciones.reduce((n, c) => n + c.senales, 0);
  const enRevision = contribuciones.reduce((n, c) => n + (c.enRevision ?? 0), 0);
  const zonas = new Set(contribuciones.map((c) => c.ubigeo)).size;

  return (
    <div className="container-page py-10">
      <div className="mx-auto max-w-3xl">
        <Link href="/app/aliados" className="inline-flex items-center gap-1.5 text-sm text-mute transition-colors hover:text-ink">
          <ArrowLeft size={14} aria-hidden /> Aliados de transparencia
        </Link>

        <div className="mt-4 flex items-center gap-4">
          <AvatarAliado tipo={aliado.tipo} logoUrl={aliado.logoUrl} nombre={aliado.nombre} size="lg" />
          <div>
            <div className="text-[11px] uppercase tracking-wide text-mute">Aliado de transparencia · {aliado.tipo}</div>
            <h1 className="font-serif text-4xl font-bold text-ink">{aliado.nombre}</h1>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiTile label="Contratos financiados" value={total} />
          <KpiTile
            label="Procesados"
            value={procesados}
            valueTone="verde"
            hint={enRevision > 0 ? `${enRevision} en revisión humana` : undefined}
            hintTone="clay"
          />
          <KpiTile
            label="Señales halladas"
            value={senales}
            valueTone={senales > 0 ? "rust" : undefined}
            hint="contratos con dictamen publicado y ≥ 1 señal"
          />
          <KpiTile label="Zonas apoyadas" value={zonas} />
        </div>
        {enRevision > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-paperDeep p-4 text-[12px] leading-relaxed text-mute">
            <Eye size={14} className="mt-0.5 shrink-0 text-clay" aria-hidden />
            <span>
              <strong className="text-clay">{enRevision}</strong> de los {procesados} procesados {enRevision === 1 ? "espera" : "esperan"} revisión humana: la autoevaluación del análisis
              no alcanzó el umbral para publicar y una persona decide. No cuentan como señales halladas.
            </span>
          </div>
        )}

        <h2 className="mt-8 font-semibold text-ink">Contribuciones</h2>
        <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {contribuciones.map((c) => (
            <li key={c.codigo} className="flex items-center justify-between gap-3 bg-paper px-4 py-3 text-sm transition-colors hover:bg-paperDeep">
              <div>
                <Link href={`/impacto/${c.codigo}`} className="font-mono text-ink hover:underline">{c.codigo}</Link>
                <span className="text-mute"> · </span>
                <Link href={`/app/financiar/${c.ubigeo}`} className="font-semibold hover:underline">{c.zona}</Link>
                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-mute">
                  <span>{new Date(c.pagadaAt).toLocaleDateString("es-PE")}</span>
                  <PildoraEstado estado={c.estado} />
                </div>
              </div>
              <div className="text-right font-mono text-sm text-ink">
                {c.procesados}/{c.contratos}
                <div className="text-[10px] uppercase text-mute">{c.senales} señales{(c.enRevision ?? 0) > 0 ? ` · ${c.enRevision} en revisión` : ""}</div>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-paper p-5 shadow-card">
          <div>
            <div className="text-sm font-semibold text-ink">¿Quieres sumarte al muro?</div>
            <p className="mt-1 text-[13px] text-mute">Desde 5 contratos. Con tu nombre, como colectivo o de forma anónima.</p>
          </div>
          <Link
            href="/app/financiar"
            className="inline-flex items-center gap-2 rounded-xl bg-heroViolet px-4 py-2.5 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper"
          >
            Financiar una auditoría <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}
