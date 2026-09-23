"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, fmtDate } from "@/lib/admin";

interface Celda { tipo: string; etapa: string; procesable: boolean | null; n: number }
interface Resumen {
  totales: { total: number; clasificadas: number; procesables: number; noProcesables: number; pendientesDeProcesamiento: number; ultimaClasificacion: string | null };
  celdas: Celda[];
  porTipo: Record<string, number>;
  porEtapa: Record<string, number>;
  motivosNoProcesable: { motivo: string; n: number }[];
  validacionesPendientes: { validacion: string; n: number }[];
}

const TIPOS = ["bienes", "servicios", "consultoria", "obras", "convenio", "directa", "otro", "sin_clasificar"];
const ETAPAS = ["planificacion", "convocada", "adjudicada", "contratada", "en_ejecucion", "finalizada", "desierta", "cancelada", "nula", "desconocida", "sin_clasificar"];

/** Matriz tipo × etapa con la cuenta de contratos y cuántos son procesables (docs/design/MATRIZ_TIPO_ETAPA.md). */
interface ProcConfig { valor: { tipos_activos: string[]; etapas_activas: string[]; nota?: string }; updatedAt?: string; updatedBy?: string; cola: number | null }
const TIPOS_CFG = ["bienes", "servicios", "consultoria", "obras", "convenio", "directa"];
const ETAPAS_CFG = ["convocada", "adjudicada", "contratada", "en_ejecucion", "finalizada"];

/** Migración 19: qué tipos × etapas entran hoy a la cola financiable. Lo demás se descarga y clasifica igual. */
function ProcesamientoActivo() {
  const [cfg, setCfg] = useState<ProcConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => adminFetch<ProcConfig>("/config/procesamiento").then(setCfg).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  if (!cfg) return null;
  const v = cfg.valor;
  const toggle = (k: "tipos_activos" | "etapas_activas", x: string) => {
    const cur = new Set(v[k] ?? []); cur.has(x) ? cur.delete(x) : cur.add(x);
    setCfg({ ...cfg, valor: { ...v, [k]: Array.from(cur) } });
  };
  async function guardar() {
    setSaving(true); setMsg(null);
    try {
      await adminFetch("/config/procesamiento", { method: "PUT", body: JSON.stringify({ tipos_activos: v.tipos_activos, etapas_activas: v.etapas_activas, nota: v.nota ?? "" }) });
      setMsg("Guardado. La cola financiable se recalculó."); load();
    } catch (e) { setMsg((e as Error).message); } finally { setSaving(false); }
  }
  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-[12px] ${on ? "border-ink bg-ink text-paper" : "border-line bg-paper text-mute hover:text-ink"}`;
  return (
    <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wide text-mute">Procesamiento activo (entra a la cola financiable)</div>
        <div className="text-[11px] text-mute">cola hoy: <span className="font-mono text-ink">{cfg.cola?.toLocaleString("es-PE") ?? "—"}</span>{cfg.updatedAt ? `, editada ${fmtDate(cfg.updatedAt)}${cfg.updatedBy ? ` por ${cfg.updatedBy}` : ""}` : ""}</div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5"><span className="mr-1 text-[12px] text-mute">Tipos:</span>{TIPOS_CFG.map((t) => <button key={t} type="button" onClick={() => toggle("tipos_activos", t)} className={chip(v.tipos_activos?.includes(t))}>{t}</button>)}</div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5"><span className="mr-1 text-[12px] text-mute">Etapas:</span>{ETAPAS_CFG.map((t) => <button key={t} type="button" onClick={() => toggle("etapas_activas", t)} className={chip(v.etapas_activas?.includes(t))}>{t.replace("_", " ")}</button>)}</div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={guardar} disabled={saving} className="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper disabled:opacity-50">{saving ? "Guardando…" : "Guardar"}</button>
        {msg && <span className="text-[12px] text-mute">{msg}</span>}
        <span className="text-[11px] text-mute">Los tipos no activos se siguen descargando y clasificando; sus contratos aparecen como “documentos listos”.</span>
      </div>
    </div>
  );
}

export default function ClasificacionPage() {
  const [r, setR] = useState<Resumen | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { adminFetch<Resumen>("/clasificacion/resumen").then(setR).catch((e) => setErr(e.message)); }, []);

  const grid = useMemo(() => {
    const m = new Map<string, { n: number; np: number }>();
    for (const c of r?.celdas ?? []) {
      const k = `${c.tipo}|${c.etapa}`;
      const cur = m.get(k) ?? { n: 0, np: 0 };
      cur.n += c.n;
      if (c.procesable === false) cur.np += c.n;
      m.set(k, cur);
    }
    return m;
  }, [r]);
  const tipos = TIPOS.filter((t) => (r?.porTipo[t] ?? 0) > 0);
  const etapas = ETAPAS.filter((e) => (r?.porEtapa[e] ?? 0) > 0);
  const max = Math.max(1, ...Array.from(grid.values()).map((v) => v.n));

  return (
    <AdminShell title="Clasificación" subtitle="Tipo de contratación × etapa: qué se puede analizar y qué queda pendiente de procesamiento">
      {err && <div className="rounded-xl border border-rust/30 bg-crimson-soft px-3 py-2 text-sm text-rust">{err}</div>}
      <ProcesamientoActivo />
      {r && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <K l="Contratos" v={r.totales.total} />
            <K l="Clasificados" v={r.totales.clasificadas} />
            <K l="Procesables" v={r.totales.procesables} tone="text-moss" />
            <K l="No procesables" v={r.totales.noProcesables} tone="text-amberTexto" />
            <K l="En cola, pendientes" v={r.totales.pendientesDeProcesamiento} tone="text-amberTexto" />
          </div>

          <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full text-sm">
              <thead className="bg-paperDeep text-left text-[11px] uppercase tracking-wide text-mute">
                <tr><th className="px-3 py-2">tipo \ etapa</th>{etapas.map((e) => <th key={e} className="px-2 py-2 text-right">{e.replace("_", " ")}</th>)}<th className="px-3 py-2 text-right">total</th></tr>
              </thead>
              <tbody>
                {tipos.map((t) => (
                  <tr key={t} className="border-t border-line">
                    <td className="px-3 py-1.5 font-medium text-ink">{t}</td>
                    {etapas.map((e) => {
                      const v = grid.get(`${t}|${e}`);
                      if (!v) return <td key={e} className="px-2 py-1.5 text-right text-mute/40">0</td>;
                      const bg = `rgba(198,140,52,${0.08 + 0.5 * (v.n / max)})`;
                      return (
                        <td key={e} className="px-2 py-1.5 text-right font-mono text-xs" style={{ background: bg }}>
                          <Link href={`/app/contratos?tipo=${t}&etapa=${e}`} className="hover:underline">{v.n.toLocaleString("es-PE")}</Link>
                          {v.np > 0 && <span className="ml-1 text-[10px] text-amberTexto" title="no procesables">({v.np})</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-1.5 text-right font-mono text-xs text-ink">{(r.porTipo[t] ?? 0).toLocaleString("es-PE")}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-line bg-paperDeep"><td className="px-3 py-1.5 text-[11px] uppercase text-mute">total</td>{etapas.map((e) => <td key={e} className="px-2 py-1.5 text-right font-mono text-xs">{(r.porEtapa[e] ?? 0).toLocaleString("es-PE")}</td>)}<td className="px-3 py-1.5 text-right font-mono text-xs font-semibold">{r.totales.total.toLocaleString("es-PE")}</td></tr></tfoot>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-mute">Entre paréntesis: contratos de la celda marcados como no procesables. Última clasificación: {fmtDate(r.totales.ultimaClasificacion)}. Reclasificar: <code className="rounded bg-paperDeep px-1">python -m backend.core.clasificacion --reclasificar</code>.</p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Lista titulo="Motivos de no procesable" rows={r.motivosNoProcesable.map((m) => [m.motivo, m.n])} vacio="Todo lo clasificado es procesable." />
            <Lista titulo="Validaciones pendientes (agentes omitidos por falta de datos)" rows={r.validacionesPendientes.map((v) => [v.validacion, v.n])} vacio="Sin validaciones pendientes." />
          </div>
        </>
      )}
    </AdminShell>
  );
}

function K({ l, v, tone = "text-ink" }: { l: string; v: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <div className={`font-mono text-xl font-semibold ${tone}`}>{v.toLocaleString("es-PE")}</div>
      <div className="text-[10px] uppercase tracking-wide text-mute">{l}</div>
    </div>
  );
}

function Lista({ titulo, rows, vacio }: { titulo: string; rows: [string, number][]; vacio: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4">
      <div className="text-[11px] uppercase tracking-wide text-mute">{titulo}</div>
      {!rows.length ? <p className="mt-2 text-sm text-mute">{vacio}</p> : (
        <ul className="mt-2 divide-y divide-line text-sm">
          {rows.map(([k, n]) => <li key={k} className="flex justify-between py-1.5"><code className="text-[12px] text-ink">{k}</code><span className="font-mono text-xs text-mute">{n.toLocaleString("es-PE")}</span></li>)}
        </ul>
      )}
    </div>
  );
}
