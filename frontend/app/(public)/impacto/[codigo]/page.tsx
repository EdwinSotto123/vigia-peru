import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { Avatar } from "@/components/financiar/RankingTable";
import { EstadoAporte } from "@/components/financiar/EstadoAporte";
import { CuentaCta } from "@/components/financiar/CuentaCta";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { CompartirButton } from "@/components/auditoria/CompartirButton";
import { formatPEN, getComprobante, pct, type Comprobante } from "@/lib/financiamiento";
import { getProcesamientos, type Procesamiento } from "@/lib/auditoria";

export const revalidate = 30;

export async function generateMetadata({ params }: { params: { codigo: string } }) {
  const codigo = params.codigo.toUpperCase();
  const c = await getComprobante(codigo);
  const description = c
    ? `${c.financiador} financió la auditoría de ${c.contratos} contratos públicos en ${c.zona}. ${c.resumen.senales} señales de riesgo halladas.`
    : "Comprobante público de una auditoría financiada en Vigía Perú.";
  return {
    title: `Comprobante de impacto ${codigo} — Vigía Perú`,
    description,
    openGraph: { title: c ? `Auditoría financiada por ${c.financiador}` : `Comprobante de impacto ${codigo}`, description },
    twitter: { card: "summary_large_image" },
  };
}

/**
 * Semilla del tablero en vivo a partir del detalle del comprobante: así la página
 * pinta la lista al instante y sigue funcionando si el endpoint de procesamientos
 * no responde (el tablero la reemplaza en cuanto llega la primera respuesta).
 */
function semillaDesdeComprobante(c: Comprobante): Procesamiento[] {
  return c.detalle.map((k) => ({
    ocid: k.ocid,
    estado: k.procesadaAt ? "procesado" : "encolado",
    faseActual: k.procesadaAt ? "final" : null,
    faseIndex: k.procesadaAt ? 10 : null,
    iniciadoAt: null,
    finalizadoAt: k.procesadaAt,
    intentos: 0,
    contribucionCodigo: c.codigo,
    financiador: c.financiador,
    financiadorVisible: true,
    ubigeo: c.ubigeo,
    zona: c.zona,
    titulo: k.titulo,
    entidad: k.entidad,
    montoPen: k.valorReferencial,
    alertaCodigo: k.alertaCodigo,
    alertaEstado: k.alertaEstado ?? null,
    score: k.score,
    banderas: k.banderas,
  }));
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
  // El tablero en vivo arranca con lo que ya sabe el API de procesamientos; si aún no
  // responde (o la contribución no tiene asignaciones), usa el detalle del comprobante.
  const enVivo = await getProcesamientos({ codigo: c.codigo, limit: 300 });
  const semilla = enVivo && enVivo.length ? enVivo : semillaDesdeComprobante(c);
  // Primer contrato procesado: el resultado más antiguo del aporte, con enlace a su auditoría.
  const primero = [...c.detalle].filter((k) => k.procesadaAt).sort((a, b) => String(a.procesadaAt).localeCompare(String(b.procesadaAt)))[0] ?? null;

  return (
    <div className="container-page py-10">
      <div className="mx-auto max-w-4xl">
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
            <Link href={`/app/financiar/${c.ubigeo}`} className="font-semibold hover:underline">{c.zona}</Link>
            <span className="text-mute"> ({c.nivel})</span>.
          </p>
          <p className="mt-1 text-sm text-mute">
            Aporte: {formatPEN(c.montoPen)} · {c.pagadaAt ? `confirmado el ${new Date(c.pagadaAt).toLocaleDateString("es-PE")}` : `registrado el ${new Date(c.createdAt).toLocaleDateString("es-PE")}`}
          </p>
          {c.mensajePublico && <p className="mt-3 border-l-2 border-amber pl-3 text-sm italic text-mute">“{c.mensajePublico}”</p>}

          {/* Estado del aporte en 4 pasos */}
          <div className="mt-6">
            <EstadoAporte estado={c.estado} procesados={c.resumen.procesados} contratos={c.contratos} />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <K label="Procesados" v={`${c.resumen.procesados} / ${c.contratos}`} hint={(c.resumen.enRevision ?? 0) > 0 ? `${c.resumen.enRevision} en revisión humana` : undefined} />
            <K label="En cola" v={String(c.resumen.asignados - c.resumen.procesados)} />
            <K label="Señales halladas" v={String(c.resumen.senales)} hint={c.resumen.contratosConSenal != null ? `en ${c.resumen.contratosConSenal} contrato${c.resumen.contratosConSenal === 1 ? "" : "s"} con dictamen publicado` : undefined} />
            <K label="Monto auditado" v={formatPEN(c.resumen.montoAuditado)} />
          </div>
          {(c.resumen.enRevision ?? 0) > 0 && (
            <p className="mt-2 text-[12px] text-mute">
              <strong className="text-clay">{c.resumen.enRevision}</strong> contrato{c.resumen.enRevision === 1 ? "" : "s"} procesado{c.resumen.enRevision === 1 ? "" : "s"} {c.resumen.enRevision === 1 ? "espera" : "esperan"} revisión humana:
              la autoevaluación no alcanzó el umbral para publicar y una persona decide. No cuentan como señales halladas.
            </p>
          )}
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-paperDeep">
            <div className="h-full rounded-full bg-moss" style={{ width: `${p}%` }} />
          </div>

          {/* primer contrato procesado */}
          {primero && (
            <Link href={`/app/auditoria/${encodeURIComponent(primero.ocid)}`} className="group mt-6 flex items-center justify-between gap-3 rounded-2xl border border-moss/30 bg-moss/5 px-4 py-3 text-sm text-ink transition-colors hover:border-moss/60">
              <span className="min-w-0">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-moss">Primer contrato procesado con este aporte</span>
                <span className="mt-0.5 block truncate font-medium">{primero.titulo ?? primero.ocid}</span>
                <span className="block text-[11px] text-mute">
                  {primero.entidad ?? "Entidad no identificada"}
                  {primero.alertaEstado === "revision" ? " · en revisión humana" : primero.banderas > 0 ? ` · ${primero.banderas} señal${primero.banderas === 1 ? "" : "es"} de riesgo` : " · sin señales"}
                </span>
              </span>
              <ArrowRight size={16} className="shrink-0 text-moss transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          )}

          {/* contratos en vivo */}
          <div className="mt-8">
            <h2 className="font-semibold text-ink">Contratos procesados con este aporte</h2>
            <p className="mt-0.5 text-[13px] text-mute">
              {c.estado === "pendiente_pago"
                ? "Los contratos se asignan al confirmar el pago. Desde ese momento verás aquí cada uno avanzar en vivo."
                : "Cada contrato pasa de la cola al análisis y al dictamen. Haz clic en uno para verlo fase por fase."}
            </p>
            <div className="mt-4">
              <TableroAuditoria codigo={c.codigo} autoRefreshMs={5000} limit={300} initial={semilla} />
            </div>
          </div>

          <div className="mt-8 flex items-start gap-2 rounded-xl bg-paperDeep p-4 text-[13px] text-mute">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-moss" />
            <span>Este aporte financió capacidad de procesamiento. Los contratos se asignaron por antigüedad y los resultados fueron producidos por el pipeline de Vigía Perú sin intervención del financiador.</span>
          </div>

          <div className="mt-6"><CuentaCta codigo={c.codigo} /></div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <CompartirButton
              path={`/impacto/${c.codigo}`}
              titulo={`Auditoría financiada por ${c.financiador} · Vigía Perú`}
              texto={`${c.financiador} financió la auditoría de ${c.contratos} contratos públicos en ${c.zona}. ${c.resumen.senales} señales de riesgo halladas.`}
            />
            <Link href="/app/financiar" className="ml-auto rounded-lg bg-heroViolet px-3 py-1.5 font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper">Financiar otra zona</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function K({ label, v, hint }: { label: string; v: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-3 shadow-card">
      <div className="text-[11px] uppercase tracking-wide text-mute">{label}</div>
      <div className="font-mono text-lg text-ink">{v}</div>
      {hint && <div className="text-[10px] text-mute">{hint}</div>}
    </div>
  );
}

