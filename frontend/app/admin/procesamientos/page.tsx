"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, RotateCcw, ExternalLink, Loader2 } from "lucide-react";
import { AdminShell, Badge, Kpi } from "@/components/admin/AdminShell";
import { adminFetch, fmtDate } from "@/lib/admin";

/**
 * Monitor del dispatcher: qué contratos financiados están en cola, procesándose
 * o terminados, con worker, latido y error. Permite re-encolar uno.
 * Fuente: GET /api/admin/procesamientos · POST /api/admin/procesamientos/:ocid/reencolar
 */

type Estado = "encolado" | "procesando" | "procesado" | "error";

interface ProcAdmin {
  ocid: string;
  estado: Estado;
  faseActual: string | null;
  faseIndex: number | null;
  intentos: number;
  worker: string | null;
  error: string | null;
  latidoAt: string | null;
  encoladoAt: string | null;
  iniciadoAt: string | null;
  finalizadoAt: string | null;
  contribucionCodigo: string | null;
  financiador: string | null;
  zona: string | null;
  titulo: string | null;
  entidad: string | null;
}

const ESTADO_UI: Record<Estado, { label: string; cls: string }> = {
  encolado: { label: "En cola", cls: "bg-paperDeep text-mute" },
  procesando: { label: "Procesando", cls: "bg-amber-soft text-amber" },
  procesado: { label: "Procesado", cls: "bg-moss/10 text-moss" },
  error: { label: "Error", cls: "bg-crimson-soft text-crimson" },
};

const TABS: { k: Estado | "todos"; l: string }[] = [
  { k: "todos", l: "Todos" },
  { k: "procesando", l: "Procesando" },
  { k: "encolado", l: "En cola" },
  { k: "error", l: "Error" },
  { k: "procesado", l: "Procesados" },
];

// El API puede devolver snake_case (columnas crudas) o camelCase: normalizamos acá.
function normalize(r: any): ProcAdmin {
  const pick = (...keys: string[]) => {
    for (const k of keys) if (r[k] !== undefined) return r[k];
    return null;
  };
  return {
    ocid: r.ocid,
    estado: r.estado,
    faseActual: pick("faseActual", "fase_actual"),
    faseIndex: pick("faseIndex", "fase_index"),
    intentos: Number(r.intentos ?? 0),
    worker: pick("worker"),
    error: pick("error"),
    latidoAt: pick("latidoAt", "latido_at"),
    encoladoAt: pick("encoladoAt", "encolado_at"),
    iniciadoAt: pick("iniciadoAt", "iniciado_at"),
    finalizadoAt: pick("finalizadoAt", "finalizado_at"),
    contribucionCodigo: pick("contribucionCodigo", "contribucion_codigo"),
    financiador: pick("financiador"),
    zona: pick("zona"),
    titulo: pick("titulo", "objeto"),
    entidad: pick("entidad"),
  };
}

export default function AdminProcesamientosPage() {
  const [rows, setRows] = useState<ProcAdmin[] | null>(null);
  const [tab, setTab] = useState<Estado | "todos">("todos");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminFetch<{ data?: any[] } | any[]>("/procesamientos");
      const list = Array.isArray(r) ? r : (r.data ?? []);
      setRows(list.map(normalize));
      setMsg(null);
    } catch (e) {
      setRows([]);
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Refresco suave mientras la pestaña está visible.
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, 15000);
    return () => clearInterval(id);
  }, [load]);

  async function reencolar(p: ProcAdmin) {
    if (!confirm(`¿Re-encolar ${p.ocid}? Se reinician los intentos y el dispatcher lo tomará en su próxima corrida.`)) return;
    setBusy(p.ocid);
    try {
      await adminFetch(`/procesamientos/${encodeURIComponent(p.ocid)}/reencolar`, { method: "POST", body: "{}" });
      setMsg(`${p.ocid} re-encolado`);
      load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { encolado: 0, procesando: 0, procesado: 0, error: 0 };
    for (const r of rows ?? []) c[r.estado] = (c[r.estado] ?? 0) + 1;
    return c;
  }, [rows]);

  const visible = useMemo(
    () => (rows ?? []).filter((r) => tab === "todos" || r.estado === tab),
    [rows, tab],
  );

  return (
    <AdminShell
      title="Procesamiento"
      subtitle="Contratos financiados: cola → procesando → procesado. Lo mueve el dispatcher (Cloud Run Job, cada 5 min)."
      actions={
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paperDeep"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Actualizar
        </button>
      }
    >
      {msg && (
        <div className="mb-4 rounded-xl border border-line bg-paper px-4 py-2 text-sm text-ink">{msg}</div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="En cola" value={counts.encolado} />
        <Kpi label="Procesando" value={counts.procesando} tone="amber" />
        <Kpi label="Procesados" value={counts.procesado} tone="moss" />
        <Kpi label="Con error" value={counts.error} tone={counts.error > 0 ? "rust" : "ink"} hint="máx. 3 intentos" />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`rounded-full px-3 py-1 text-xs ${tab === t.k ? "bg-ink text-paper" : "border border-line bg-paper text-mute hover:text-ink"}`}
          >
            {t.l}
          </button>
        ))}
        <Link href="/auditoria" target="_blank" className="ml-auto inline-flex items-center gap-1 text-xs text-mute hover:text-ink">
          <ExternalLink size={12} /> Tablero público
        </Link>
      </div>

      <section className="mt-3 overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-mute">
            <tr>
              <th className="px-4 py-2">Contrato</th>
              <th className="px-2 py-2">Estado</th>
              <th className="px-2 py-2">Fase</th>
              <th className="px-2 py-2 text-right">Intentos</th>
              <th className="px-2 py-2">Worker</th>
              <th className="px-2 py-2">Latido</th>
              <th className="px-2 py-2">Error</th>
              <th className="px-4 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-mute">
                  <Loader2 size={16} className="mx-auto animate-spin" />
                </td>
              </tr>
            )}
            {rows !== null && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-mute">
                  {rows.length === 0
                    ? "No hay procesamientos todavía. Aparecen al validar un aporte."
                    : "Nada en este estado."}
                </td>
              </tr>
            )}
            {visible.map((p) => (
              <tr key={p.ocid} className="border-t border-line align-top">
                <td className="px-4 py-2">
                  <div className="font-mono text-xs text-ink">{p.ocid}</div>
                  {p.titulo && <div className="mt-0.5 line-clamp-1 max-w-[320px] text-[11px] text-mute">{p.titulo}</div>}
                  <div className="text-[11px] text-mute">
                    {[p.zona, p.contribucionCodigo, p.financiador].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <Badge cls={ESTADO_UI[p.estado]?.cls ?? "bg-paperDeep text-mute"}>{ESTADO_UI[p.estado]?.label ?? p.estado}</Badge>
                </td>
                <td className="px-2 py-2 font-mono text-xs text-ink">
                  {p.faseActual ?? "—"}
                  {p.faseIndex != null && <span className="text-mute"> · {p.faseIndex}/10</span>}
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs">{p.intentos}</td>
                <td className="px-2 py-2 font-mono text-[11px] text-mute">{p.worker ?? "—"}</td>
                <td className="px-2 py-2 text-[11px] text-mute">{fmtDate(p.latidoAt ?? p.finalizadoAt ?? p.encoladoAt)}</td>
                <td className="px-2 py-2 max-w-[220px] text-[11px] text-crimson">
                  <span className="line-clamp-2">{p.error ?? ""}</span>
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="inline-flex items-center gap-1">
                    <Link
                      href={`/auditoria/${encodeURIComponent(p.ocid)}`}
                      target="_blank"
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper px-2 py-1 text-[11px] text-ink hover:bg-paperDeep"
                    >
                      <ExternalLink size={11} /> En vivo
                    </Link>
                    {p.estado !== "procesado" && (
                      <button
                        onClick={() => reencolar(p)}
                        disabled={busy === p.ocid}
                        className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper px-2 py-1 text-[11px] text-ink hover:bg-paperDeep disabled:opacity-50"
                      >
                        <RotateCcw size={11} className={busy === p.ocid ? "animate-spin" : ""} /> Re-encolar
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
