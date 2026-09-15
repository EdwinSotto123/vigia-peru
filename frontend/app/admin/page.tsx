"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, RefreshCw, Activity, Database, Radio, Wallet, ScrollText } from "lucide-react";
import { AdminShell, Kpi, Badge } from "@/components/admin/AdminShell";
import { adminFetch, fmtPEN, fmtDate, ESTADO_UI, type Resumen } from "@/lib/admin";
import { ESTADO_FILL, ESTADO_LABEL, type ZonaEstado } from "@/lib/financiamiento";

export default function AdminHome() {
  const [data, setData] = useState<Resumen | null>(null);
  const [salud, setSalud] = useState<Salud | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      // Primero lo rápido (KPIs); la salud hace un ping al relay (hasta 4 s) y llega después.
      setData(await adminFetch<Resumen>("/resumen")); setError(null);
      adminFetch<{ data: LogRow[] }>("/log").then((x) => setLog(x.data.slice(0, 8))).catch(() => {});
      adminFetch<Salud>("/salud").then(setSalud).catch(() => setSalud(null));
    }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const k = data?.kpi;
  const maxMonto = Math.max(1, ...(data?.serie.map((s) => s.monto) ?? [1]));

  return (
    <AdminShell title="Resumen" subtitle="Estado de Financia una auditoría" actions={
      <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paperDeep">
        <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Actualizar
      </button>
    }>
      {error && <div className="mb-4 rounded-xl border border-crimson/30 bg-crimson-soft p-3 text-sm text-crimson">{error}</div>}

      {k && k.pendientesValidar > 0 && (
        <Link href="/admin/contribuciones?estado=pendiente_pago" className="mb-5 flex items-center justify-between rounded-2xl border border-amber/40 bg-amber-soft px-5 py-3 text-sm text-ink hover:border-amber">
          <span className="flex items-center gap-2"><AlertTriangle size={16} className="text-amber" />
            <strong>{k.pendientesValidar}</strong> aporte{k.pendientesValidar === 1 ? "" : "s"} por validar · {k.pendientesConComprobante} con comprobante subido
          </span>
          <ArrowRight size={16} />
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Recaudado (confirmado)" value={k ? fmtPEN(k.montoConfirmadoPen) : "—"} hint={k ? `${fmtPEN(k.montoMesPen)} este mes` : undefined} tone="moss" />
        <Kpi label="Contratos financiados" value={k?.contratosFinanciados ?? "—"} hint={k ? `${k.asignados} asignados · ${k.procesados} procesados` : undefined} />
        <Kpi label="Financiadores" value={k?.financiadores ?? "—"} hint={k ? `${k.financiadoresOcultos} ocultos por conflicto` : undefined} />
        <Kpi label="Aportes últimos 7 días" value={k?.aportes7d ?? "—"} />
        <Kpi label="Pendientes de validar" value={k?.pendientesValidar ?? "—"} tone={k && k.pendientesValidar > 0 ? "amber" : "ink"} />
        <Kpi label="Señales halladas" value={k?.senales ?? "—"} hint="en contratos financiados" />
        <Kpi label="Cola global" value={k?.colaGlobal ?? "—"} hint="contratos sin analizar" />
        <Kpi label="Esperando contratos" value={k?.esperandoContratos ?? "—"} hint="aportes con cupo sin asignar" tone={k && k.esperandoContratos > 0 ? "amber" : "ink"} />
      </div>

      {/* Salud del sistema */}
      <div className="mt-6 grid gap-3 md:grid-cols-4">
        <Health icon={<Database size={14} />} label="Ingesta OECE" ok={salud?.ingesta.ok ?? null}
          value={salud?.ingesta.ultimaIngesta ? `hace ${Math.round(salud.ingesta.horasSinIngesta ?? 0)} h` : "—"}
          hint={salud ? `${salud.ingesta.ultimas24h.toLocaleString("es-PE")} nuevas en 24 h · ${salud.ingesta.total.toLocaleString("es-PE")} en total` : undefined} />
        <Health icon={<Activity size={14} />} label="Dispatcher" ok={salud ? (salud.procesamientos.porEstado.error ?? 0) === 0 : null}
          value={salud ? `${salud.procesamientos.activos} procesando` : "—"}
          hint={salud ? `último latido ${salud.procesamientos.ultimoLatido ? fmtDate(salud.procesamientos.ultimoLatido) : "—"} · ${salud.procesamientos.porEstado.error ?? 0} con error` : undefined} />
        <Health icon={<Radio size={14} />} label="Relay Perú (OCDS)" ok={salud?.relay.ok ?? null}
          value={salud ? (salud.relay.ok === null ? "sin configurar" : salud.relay.ok ? "responde" : "caído") : "—"}
          hint={salud?.relay.ok === false ? "El orquestador no puede bajar el OCDS desde GCP: el dispatcher re-encola sin gastar intentos. Levantar el VPS o correr el dispatcher desde una IP peruana." : "Puente residencial en Lima para leer el OECE"} />
        <Health icon={<Wallet size={14} />} label="Por atender" ok={salud ? salud.contribuciones.pendientesValidar === 0 : null}
          value={salud ? `${salud.contribuciones.pendientesValidar} aportes` : "—"}
          hint={salud ? `${salud.contribuciones.esperandoContratos} aportes esperan contratos nuevos` : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Serie 30 días */}
        <section className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="text-sm font-semibold text-ink">Recaudación · últimos 30 días</h2>
          {data && data.serie.every((x) => x.monto === 0 && x.pendientes === 0) && (
            <p className="mt-4 rounded-xl bg-paperDeep p-4 text-sm text-mute">Sin aportes confirmados en los últimos 30 días. El gráfico se llena con la primera validación.</p>
          )}
          {data ? (
            <div className="mt-4 flex h-40 items-end gap-[3px]">
              {data.serie.map((s) => (
                <div key={s.dia} className="group relative flex-1">
                  <div className="w-full rounded-t bg-moss/80 transition-colors group-hover:bg-moss" style={{ height: `${Math.max(2, (s.monto / maxMonto) * 100)}%` }} />
                  {s.pendientes > 0 && <div className="absolute inset-x-0 bottom-0 h-1 bg-amber" />}
                  <div className="pointer-events-none absolute -top-9 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-ink px-2 py-1 text-[10px] text-paper group-hover:block">
                    {new Date(s.dia).toLocaleDateString("es-PE", { day: "2-digit", month: "short" })} · {fmtPEN(s.monto)} · {s.aportes} aportes
                  </div>
                </div>
              ))}
            </div>
          ) : <div className="mt-4 h-40 animate-pulse rounded-xl bg-paperDeep" />}
          <div className="mt-2 flex gap-4 text-[11px] text-mute"><span><span className="inline-block h-2 w-2 rounded-sm bg-moss" /> confirmado</span><span><span className="inline-block h-2 w-2 rounded-sm bg-amber" /> día con pendientes</span></div>
        </section>

        {/* Por estado */}
        <section className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="text-sm font-semibold text-ink">Contribuciones por estado</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {(data?.porEstado ?? []).map((e) => (
              <li key={e.estado} className="flex items-center justify-between">
                <Badge cls={ESTADO_UI[e.estado]?.cls ?? "bg-paperDeep text-mute"}>{ESTADO_UI[e.estado]?.label ?? e.estado}</Badge>
                <span className="font-mono text-ink">{e.n} · {fmtPEN(e.monto)}</span>
              </li>
            ))}
            {data && !data.porEstado.length && <li className="text-mute">Sin contribuciones todavía.</li>}
          </ul>
          <h2 className="mt-6 text-sm font-semibold text-ink">Top financiadores</h2>
          <ol className="mt-2 space-y-1 text-sm">
            {(data?.top ?? []).map((t, i) => (
              <li key={t.nombre + i} className="flex justify-between"><span>{i + 1}. {t.nombre} <span className="text-mute">· {t.tipo}</span></span><span className="font-mono">{t.contratosFinanciados}</span></li>
            ))}
            {data && !data.top.length && <li className="text-mute">—</li>}
          </ol>
        </section>
      </div>

      {/* Cola por región */}
      <section className="mt-6 rounded-2xl border border-line bg-paper p-5">
        <h2 className="text-sm font-semibold text-ink">Cola de auditoría por región</h2>
        <table className="mt-3 w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-mute"><tr><th className="py-1">Región</th><th>Estado</th><th className="text-right">Pendientes</th><th className="text-right">Financiados</th><th className="text-right">Procesados</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {(data?.cola ?? []).map((z) => (
              <tr key={z.ubigeo} className="border-t border-line">
                <td className="py-2"><Link href={`/app/financiar/${z.ubigeo}`} target="_blank" className="hover:underline">{z.nombre}</Link></td>
                <td><span className="inline-flex items-center gap-1.5 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: ESTADO_FILL[z.estado as ZonaEstado] }} />{ESTADO_LABEL[z.estado as ZonaEstado]}</span></td>
                <td className="text-right font-mono">{z.pendientes}</td><td className="text-right font-mono">{z.financiados}</td><td className="text-right font-mono">{z.procesados}</td><td className="text-right font-mono">{z.totalCola}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-paper p-5">
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
          <Link href="/admin/bitacora" className="mt-2 inline-block text-xs text-mute hover:text-ink">Ver toda la bitácora →</Link>
        </section>
        <section className="rounded-2xl border border-line bg-paper p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Activity size={14} /> Últimos contratos procesados</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {!salud?.procesamientos.ultimos.length && <li className="py-2 text-mute">Nada procesado aún. Valida un aporte y el dispatcher empieza.</li>}
            {(salud?.procesamientos.ultimos ?? []).map((u) => (
              <li key={u.ocid} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/app/auditoria/${encodeURIComponent(u.ocid)}`} target="_blank" className="min-w-0 truncate hover:underline">{u.titulo ?? u.ocid}</Link>
                <span className="shrink-0 font-mono text-xs text-mute">{u.score != null ? `score ${u.score} · ` : ""}{u.segundos != null ? `${Math.round(u.segundos / 60)} min` : ""}</span>
              </li>
            ))}
          </ul>
          <Link href="/admin/procesamientos" className="mt-2 inline-block text-xs text-mute hover:text-ink">Ver procesamiento →</Link>
        </section>
      </div>
    </AdminShell>
  );
}

interface Salud {
  ingesta: { ultimaIngesta: string | null; ultimas24h: number; total: number; conUbigeo: number; horasSinIngesta: number | null; ok: boolean };
  procesamientos: { porEstado: Record<string, number>; ultimos: { ocid: string; finalizadoAt: string | null; segundos: number | null; titulo: string | null; score: number | null }[]; ultimoInicio: string | null; ultimoLatido: string | null; activos: number };
  contribuciones: { pendientesValidar: number; esperandoContratos: number };
  relay: { url: string | null; ok: boolean | null };
}
interface LogRow { actor: string; accion: string; objeto: string; createdAt: string }

function Health({ icon, label, value, hint, ok }: { icon: React.ReactNode; label: string; value: string; hint?: string; ok: boolean | null }) {
  const dot = ok === null ? "bg-line" : ok ? "bg-moss" : "bg-amber";
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-mute"><span className="flex items-center gap-1.5">{icon}{label}</span><span className={`h-2 w-2 rounded-full ${dot}`} /></div>
      <div className="mt-1 font-mono text-lg text-ink">{value}</div>
      {hint && <div className="text-[11px] text-mute">{hint}</div>}
    </div>
  );
}
