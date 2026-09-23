"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, RefreshCw, Activity, Database, Radio, Wallet, ScrollText, Eye, Download, Cpu, Moon } from "lucide-react";
import { AdminShell, Badge } from "@/components/admin/AdminShell";
import { adminFetch, fmtPEN, fmtDate, ESTADO_UI, PERFIL_LABEL, type Resumen, type Operacion, type SaludServicio } from "@/lib/admin";

/**
 * Resumen operativo en UNA pantalla (plan 2026-09-16 · U4): salud (dispatcher, 4 servicios de
 * agentes, relay, ingesta, lote nocturno), cola por estado, pedidos de descarga, aportes por validar
 * y alertas en revisión. Cada tarjeta enlaza a su página. Los servicios se consultan desde la API
 * (timeout 3 s, caché 60 s), nunca desde el navegador.
 */
export default function AdminHome() {
  const [op, setOp] = useState<Operacion | null>(null);
  const [data, setData] = useState<Resumen | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [o, r] = await Promise.all([adminFetch<Operacion>("/operacion"), adminFetch<Resumen>("/resumen")]);
      setOp(o); setData(r); setError(null);
      adminFetch<{ data: LogRow[] }>("/log").then((x) => setLog(x.data.slice(0, 8))).catch(() => {});
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
    return () => clearInterval(id);
  }, []);

  const k = data?.kpi;
  const d = op?.dispatcher;
  const cola = op?.cola ?? {};
  const pendientesCola = (cola.encolado ?? 0) + (cola.esperando_documentos ?? 0);
  const serviciosOk = op ? op.servicios.data.filter((s) => s.ok === true).length : null;
  const relayHint = op?.relay.ok === false
    ? "El orquestador no puede bajar el OCDS desde GCP: el dispatcher re-encola sin gastar intentos. Levantar el VPS o correr el dispatcher desde una IP peruana."
    : "Puente residencial en Lima para leer el OECE";

  return (
    <AdminShell title="Resumen" subtitle="Salud del sistema y lo que espera una decisión, en una pantalla" actions={
      <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paperDeep">
        <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Actualizar
      </button>
    }>
      {error && <div className="mb-4 rounded-xl border border-crimson/30 bg-crimson-soft p-3 text-sm text-crimsonTexto">{error}</div>}

      {/* Lo que espera una decisión humana */}
      <div className="grid gap-3 md:grid-cols-3">
        <Accion href="/admin/revision" icon={<Eye size={15} />} n={op?.revision.n ?? null} label="alertas en revisión humana"
          hint={op?.revision.masAntigua ? `la más antigua espera desde ${fmtDate(op.revision.masAntigua)}` : "la autoevaluación no bloqueó ninguna"} tone="clay" />
        <Accion href="/admin/contribuciones?estado=pendiente_pago" icon={<Wallet size={15} />} n={op?.aportes.pendientesValidar ?? null} label="aportes por validar"
          hint={op ? `${op.aportes.conComprobante} con comprobante subido, ${op.aportes.esperandoContratos} esperan contratos` : undefined} tone="amber" />
        <Accion href="/admin/procesamientos" icon={<Download size={15} />} n={op?.pedidos ? op.pedidos.pendientes + op.pedidos.descargando : null} label="pedidos de descarga abiertos"
          hint={op?.pedidos ? `${op.pedidos.fallidos} fallidos, ${op.pedidos.listos24h} atendidos en 24 h` : "sin tabla de pedidos"} tone={op?.pedidos?.fallidos ? "rust" : "ink"} />
      </div>

      {/* Salud */}
      <h2 className="mt-6 text-[11px] font-semibold uppercase tracking-wide text-mute">Salud</h2>
      <div className="mt-2 grid gap-3 md:grid-cols-5">
        <Health href="/admin/procesamientos" icon={<Activity size={14} />} label="Dispatcher" ok={d?.ok ?? null}
          value={d ? (d.activos > 0 ? `${d.activos} procesando` : d.ultimaCorrida ? `hace ${horas(d.horasDesdeUltimaCorrida)}` : "sin corridas") : "—"}
          hint={d ? `última corrida ${d.ultimaCorrida ? fmtDate(d.ultimaCorrida) : "sin dato"}, ${d.procesados24h} procesados en 24 h${d.errores ? `, ${d.errores} con error` : ""}${d.colgados ? `, ${d.colgados} sin latido` : ""}` : undefined} />
        <Health href="/admin/procesamientos" icon={<Cpu size={14} />} label="Servicios de agentes" ok={serviciosOk === null ? null : serviciosOk === 4 ? true : serviciosOk > 0 ? null : false}
          value={serviciosOk === null ? "—" : `${serviciosOk}/4 responden`}
          hint={op ? `consultado ${fmtDate(op.servicios.consultadoAt)}${op.servicios.cacheado ? " (caché 60 s)" : ""}${op.servicios.data.some((s) => s.ok === null) ? ". Arranque en frío: vuelve a consultar en 1 min" : ""}` : undefined}>
          {op && <ul className="mt-2 space-y-1">{op.servicios.data.map((s) => <Servicio key={s.perfil} s={s} />)}</ul>}
        </Health>
        <Health icon={<Radio size={14} />} label="Relay Perú (OCDS)" ok={op?.relay.ok ?? null}
          value={op ? (op.relay.ok === null ? "sin configurar" : op.relay.ok ? "responde" : "caído") : "—"} hint={relayHint} />
        <Health href="/admin/cobertura" icon={<Database size={14} />} label="Ingesta OECE" ok={op?.ingesta.ok ?? null}
          value={op?.ingesta.ultimaIngesta ? `hace ${horas(op.ingesta.horasSinIngesta)}` : "—"}
          hint={op ? `${op.ingesta.ultimas24h.toLocaleString("es-PE")} nuevas en 24 h, ${op.ingesta.total.toLocaleString("es-PE")} contratos en total` : undefined} />
        <Health href="/admin/cobertura" icon={<Moon size={14} />} label="Lote nocturno (documentos)" ok={op?.lote ? op.lote.estado === "ok" ? true : op.lote.estado === "error" ? false : null : null}
          value={op?.lote ? `${op.lote.ok.toLocaleString("es-PE")}/${op.lote.total.toLocaleString("es-PE")}` : "—"}
          hint={op?.lote ? `${op.lote.id}: ${op.lote.estado}${op.lote.fallidos ? `, ${op.lote.fallidos} fallidos` : ""}, ${fmtDate(op.lote.finalizadoAt ?? op.lote.iniciadoAt)}` : "sin lotes"} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* Cola por estado */}
        <section className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="text-sm font-semibold text-ink">Cola de procesamiento</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {ESTADOS.map(([key, label, cls]) => (
              <li key={key} className="flex items-center justify-between">
                <Link href={`/admin/procesamientos?estado=${key}`} className="hover:underline"><Badge cls={cls}>{label}</Badge></Link>
                <span className="font-mono text-ink">{(cola[key] ?? 0).toLocaleString("es-PE")}</span>
              </li>
            ))}
            <li className="flex items-center justify-between border-t border-line pt-1.5">
              <span className="text-mute">en revisión humana</span>
              <span className="font-mono text-clayTexto">{(cola.revision ?? op?.revision.n ?? 0).toLocaleString("es-PE")}</span>
            </li>
          </ul>
          <p className="mt-3 text-[11px] text-mute">{pendientesCola > 0 ? `${pendientesCola} esperan turno; el dispatcher corre cada 5 min.` : "Nada esperando turno."} Cola financiable global: <span className="font-mono text-ink">{k?.colaGlobal?.toLocaleString("es-PE") ?? "—"}</span> contratos.</p>
          <Link href="/admin/procesamientos" className="mt-2 inline-flex items-center gap-1 text-xs text-mute hover:text-ink">Ver procesamiento <ArrowRight size={12} /></Link>
        </section>

        {/* Financiamiento */}
        <section className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="text-sm font-semibold text-ink">Financiamiento</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <Dato k="Recaudado (confirmado)" v={k ? fmtPEN(k.montoConfirmadoPen) : "—"} sub={k ? `${fmtPEN(k.montoMesPen)} este mes` : undefined} />
            <Dato k="Contratos financiados" v={k?.contratosFinanciados ?? "—"} sub={k ? `${k.asignados} asignados, ${k.procesados} procesados` : undefined} />
            <Dato k="Señales halladas" v={k?.senales ?? "—"} sub={k ? `${k.enRevision ?? 0} en revisión (no cuentan)` : undefined} />
            <Dato k="Financiadores" v={k?.financiadores ?? "—"} sub={k ? `${k.financiadoresOcultos} ocultos por conflicto` : undefined} />
          </dl>
          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
            {(data?.porEstado ?? []).map((e) => (
              <li key={e.estado} className="flex items-center justify-between">
                <Badge cls={ESTADO_UI[e.estado]?.cls ?? "bg-paperDeep text-mute"}>{ESTADO_UI[e.estado]?.label ?? e.estado}</Badge>
                <span className="font-mono text-ink">{e.n} ({fmtPEN(e.monto)})</span>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-3 text-xs text-mute">
            <Link href="/admin/contribuciones" className="inline-flex items-center gap-1 hover:text-ink">Contribuciones <ArrowRight size={12} /></Link>
            <Link href="/admin/financiadores" className="inline-flex items-center gap-1 hover:text-ink">Financiadores <ArrowRight size={12} /></Link>
          </div>
        </section>

        {/* Últimos procesados */}
        <section className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Activity size={14} /> Últimos contratos procesados</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {op && !op.ultimos.length && <li className="py-2 text-mute">Nada procesado aún. Valida un aporte y el dispatcher empieza.</li>}
            {(op?.ultimos ?? []).map((u) => (
              <li key={u.ocid} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/app/auditoria/${encodeURIComponent(u.ocid)}`} target="_blank" className="min-w-0 truncate hover:underline" title={u.titulo ?? u.ocid}>{u.titulo ?? u.ocid}</Link>
                <span className="shrink-0 font-mono text-xs text-mute">
                  {u.alertaEstado === "revision" && <span className="text-clayTexto">revisión, </span>}
                  {u.score != null ? `score ${u.score}, ` : ""}{u.segundos != null ? `${Math.round(u.segundos / 60)} min` : ""}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/admin/procesamientos" className="mt-2 inline-flex items-center gap-1 text-xs text-mute hover:text-ink">Ver procesamiento <ArrowRight size={12} /></Link>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-line bg-paper p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><ScrollText size={14} /> Actividad reciente</h2>
        <ul className="mt-3 divide-y divide-line text-sm">
          {!log.length && <li className="py-2 text-mute">Sin acciones registradas todavía.</li>}
          {log.map((r, i) => (
            <li key={i} className="flex items-center justify-between gap-3 py-2">
              <span className="truncate"><span className="font-medium text-ink">{r.actor}</span> <span className="text-mute">{r.accion.replace(/_/g, " ")}</span> <span className="font-mono text-xs text-mute">{r.objeto}</span></span>
              <span className="shrink-0 text-[11px] text-mute">{fmtDate(r.createdAt)}</span>
            </li>
          ))}
        </ul>
        <Link href="/admin/bitacora" className="mt-2 inline-flex items-center gap-1 text-xs text-mute hover:text-ink">Ver toda la bitácora <ArrowRight size={12} /></Link>
      </section>
    </AdminShell>
  );
}

const ESTADOS: [string, string, string][] = [
  ["procesando", "Procesando", "bg-amber-soft text-amberTexto"],
  ["encolado", "En cola", "bg-paperDeep text-mute"],
  ["esperando_documentos", "Esperando documentos", "bg-amber-soft/60 text-clayTexto"],
  ["error", "Error", "bg-crimson-soft text-crimsonTexto"],
  ["pendiente_de_procesamiento", "Pendiente de procesamiento", "bg-paperDeep text-amberTexto"],
  ["procesado", "Procesado", "bg-moss/10 text-moss"],
];

interface LogRow { actor: string; accion: string; objeto: string; createdAt: string }

const horas = (h: number | null | undefined) => h == null ? "—" : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} d`;

function Accion({ href, icon, n, label, hint, tone }: { href: string; icon: React.ReactNode; n: number | null; label: string; hint?: string; tone: "clay" | "amber" | "rust" | "ink" }) {
  const activo = (n ?? 0) > 0;
  const border = activo ? { clay: "border-clay/50 bg-amber-soft/40", amber: "border-amber/50 bg-amber-soft", rust: "border-rust/40 bg-crimson-soft", ink: "border-line bg-paper" }[tone] : "border-line bg-paper";
  const num = activo ? { clay: "text-clayTexto", amber: "text-amberTexto", rust: "text-rust", ink: "text-ink" }[tone] : "text-ink";
  return (
    <Link href={href} className={`flex items-center justify-between gap-3 rounded-2xl border px-5 py-4 transition-colors hover:border-ink ${border}`}>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-sm text-ink">
          <span className={num}>{icon}</span>
          <strong className={`font-mono text-2xl ${num}`}>{n === null ? "—" : n.toLocaleString("es-PE")}</strong> {label}
        </span>
        {hint && <span className="mt-0.5 block truncate text-[11px] text-mute">{hint}</span>}
      </span>
      <ArrowRight size={16} className="shrink-0 text-mute" />
    </Link>
  );
}

function Health({ href, icon, label, value, hint, ok, children }: { href?: string; icon: React.ReactNode; label: string; value: string; hint?: string; ok: boolean | null; children?: React.ReactNode }) {
  const dot = ok === null ? "bg-amber" : ok ? "bg-moss" : "bg-rust";
  const body = (
    <>
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-mute"><span className="flex items-center gap-1.5">{icon}{label}</span><span className={`h-2 w-2 rounded-full ${dot}`} /></div>
      <div className="mt-1 font-mono text-lg text-ink">{value}</div>
      {hint && <div className="text-[11px] text-mute">{hint}</div>}
      {children}
    </>
  );
  const cls = "block rounded-2xl border border-line bg-paper p-4";
  return href ? <Link href={href} className={`${cls} hover:border-ink`}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Servicio({ s }: { s: SaludServicio }) {
  const dot = s.ok === true ? "bg-moss" : s.ok === null ? "bg-amber" : "bg-rust";
  return (
    <li className="flex items-center justify-between gap-2 text-[11px]" title={`${s.nombre}: ${s.error ?? `HTTP ${s.status}`}${s.detalle?.model ? ` (${s.detalle.model})` : ""}`}>
      <span className="flex items-center gap-1.5 text-ink"><span className={`h-1.5 w-1.5 rounded-full ${dot}`} />{PERFIL_LABEL[s.perfil]?.split(" ")[0] ?? s.perfil}</span>
      <span className="font-mono text-mute">{s.ok === true ? `${s.ms} ms` : s.ok === null ? "arrancando…" : "caído"}</span>
    </li>
  );
}

function Dato({ k, v, sub }: { k: string; v: string | number; sub?: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-mute">{k}</dt>
      <dd className="font-mono text-base text-ink">{typeof v === "number" ? v.toLocaleString("es-PE") : v}</dd>
      {sub && <dd className="text-[10px] text-mute">{sub}</dd>}
    </div>
  );
}
