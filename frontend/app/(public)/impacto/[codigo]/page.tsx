import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, ShieldCheck, Share2 } from "lucide-react";
import { Avatar } from "@/components/financiar/RankingTable";
import { formatPEN, getComprobante, pct } from "@/lib/financiamiento";

export const revalidate = 30;

export async function generateMetadata({ params }: { params: { codigo: string } }) {
  return { title: `Comprobante de impacto ${params.codigo.toUpperCase()} — Vigía Perú` };
}

const ESTADO: Record<string, { label: string; tone: string }> = {
  pendiente_pago: { label: "Pago pendiente de validación", tone: "text-amber" },
  pagada: { label: "Pago confirmado · esperando contratos en cola", tone: "text-moss" },
  en_proceso: { label: "Pago confirmado · auditoría en proceso", tone: "text-moss" },
  procesada: { label: "Auditoría completada", tone: "text-moss" },
  rechazada: { label: "Aporte rechazado", tone: "text-rust" },
  reembolsada: { label: "Aporte reembolsado", tone: "text-mute" },
};

export default async function ImpactoPage({ params }: { params: { codigo: string } }) {
  const c = await getComprobante(params.codigo);
  if (!c) notFound();
  const est = ESTADO[c.estado] ?? { label: c.estado, tone: "text-mute" };
  const p = pct(c.resumen.procesados, c.contratos);

  return (
    <div className="container-page py-10">
      <div className="mx-auto max-w-3xl">
        <div className="rounded-3xl border border-line bg-paper p-8 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-mute">Comprobante de impacto</div>
              <h1 className="font-mono text-3xl font-bold text-ink">{c.codigo}</h1>
              <div className={`mt-1 inline-flex items-center gap-1.5 text-sm ${est.tone}`}>
                {c.estado === "pendiente_pago" ? <Clock size={14} /> : <CheckCircle2 size={14} />} {est.label}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Avatar tipo={c.tipo} logoUrl={c.logoUrl} nombre={c.financiador} />
              <div>
                <div className="text-sm font-semibold text-ink">{c.slug ? <Link href={`/aliado/${c.slug}`} className="hover:underline">{c.financiador}</Link> : c.financiador}</div>
                <div className="text-[11px] text-mute">{c.tipo}</div>
              </div>
            </div>
          </div>

          <p className="mt-6 text-lg text-ink">
            Financió la auditoría de <strong className="font-mono">{c.contratos}</strong> contratos en{" "}
            <Link href={`/financiar/${c.ubigeo}`} className="font-semibold hover:underline">{c.zona}</Link>
            <span className="text-mute"> ({c.nivel})</span>.
          </p>
          <p className="mt-1 text-sm text-mute">
            Aporte: {formatPEN(c.montoPen)} · {c.pagadaAt ? `confirmado el ${new Date(c.pagadaAt).toLocaleDateString("es-PE")}` : `registrado el ${new Date(c.createdAt).toLocaleDateString("es-PE")}`}
          </p>
          {c.mensajePublico && <p className="mt-3 border-l-2 border-amber pl-3 text-sm italic text-mute">“{c.mensajePublico}”</p>}

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <K label="Procesados" v={`${c.resumen.procesados} / ${c.contratos}`} />
            <K label="En cola" v={String(c.resumen.asignados - c.resumen.procesados)} />
            <K label="Señales halladas" v={String(c.resumen.senales)} />
            <K label="Monto auditado" v={formatPEN(c.resumen.montoAuditado)} />
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-paperDeep">
            <div className="h-full rounded-full bg-moss" style={{ width: `${p}%` }} />
          </div>

          {/* contratos */}
          <div className="mt-8">
            <h2 className="font-semibold text-ink">Contratos procesados con este aporte</h2>
            {c.detalle.length ? (
              <ul className="mt-2 divide-y divide-line rounded-2xl border border-line">
                {c.detalle.map((k) => (
                  <li key={k.ocid} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${k.procesadaAt ? (k.banderas > 0 ? "bg-rust" : "bg-moss") : "bg-line"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ink">{k.titulo ?? k.ocid}</div>
                      <div className="text-[11px] text-mute">{k.entidad ?? "—"} · <span className="font-mono">{k.ocid}</span>{k.valorReferencial ? ` · ${formatPEN(k.valorReferencial)}` : ""}</div>
                    </div>
                    <div className="text-right text-[11px]">
                      {k.procesadaAt ? (
                        k.alertaCodigo ? <Link href={`/app/convocatoria/${encodeURIComponent(k.ocid)}`} className="font-mono text-ink hover:underline">{k.banderas} señales →</Link> : <span className="text-mute">procesado</span>
                      ) : <span className="text-mute">en cola</span>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-mute">
                {c.estado === "pendiente_pago" ? "Los contratos se asignan al confirmar el pago." : "Esperando contratos nuevos en la cola de esta zona."}
              </p>
            )}
          </div>

          <div className="mt-8 flex items-start gap-2 rounded-xl bg-paperDeep p-4 text-[13px] text-mute">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-moss" />
            <span>Este aporte financió capacidad de procesamiento. Los contratos se asignaron por antigüedad y los resultados fueron producidos por el pipeline de Vigía Perú sin intervención del financiador.</span>
          </div>

          <div className="mt-6 flex flex-wrap gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-mute"><Share2 size={14} /> vigia.pe/impacto/{c.codigo}</span>
            <Link href="/financiar" className="rounded-lg bg-ink px-3 py-1.5 font-semibold text-paper">Financiar otra zona</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function K({ label, v }: { label: string; v: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <div className="text-[11px] uppercase tracking-wide text-mute">{label}</div>
      <div className="font-mono text-lg text-ink">{v}</div>
    </div>
  );
}
