"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, RotateCcw, ExternalLink, Loader2, Play, Repeat, Eye } from "lucide-react";
import { AdminShell, Badge, Kpi } from "@/components/admin/AdminShell";
import { adminFetch, fmtDate, PERFIL_LABEL } from "@/lib/admin";
import { useDialog } from "@/components/admin/Dialog";

/**
 * Monitor del dispatcher: qué contratos financiados están en cola, procesándose
 * o terminados, con worker, latido y error. Permite re-encolar uno, re-analizar un
 * contrato ya terminado (≈ US$ 0.25, ~3 min; bloqueado si hay uno activo) y abrir su traza.
 * Filtro por perfil (servicio de agentes): bienes / servicios / obras / otros.
 * Fuente: GET /api/admin/procesamientos?estado=&perfil= · POST …/:ocid/reencolar · POST …/:ocid/reanalizar
 */

type Estado = "encolado" | "procesando" | "procesado" | "error" | "pendiente_de_procesamiento" | "esperando_documentos";

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
  perfil: "bienes" | "servicios" | "obras" | "otros" | null;
  tipo: string | null;
  alertaEstado: string | null;
  score: number | null;
}

const ESTADO_UI: Record<Estado, { label: string; cls: string }> = {
  encolado: { label: "En cola", cls: "bg-paperDeep text-mute" },
  procesando: { label: "Procesando", cls: "bg-amber-soft text-amberTexto" },
  procesado: { label: "Procesado", cls: "bg-moss/10 text-moss" },
  error: { label: "Error", cls: "bg-crimson-soft text-crimsonTexto" },
  pendiente_de_procesamiento: { label: "Pendiente", cls: "bg-paperDeep text-amberTexto" },
  esperando_documentos: { label: "Esperando docs", cls: "bg-amber-soft/60 text-clayTexto" },
};

const TABS: { k: Estado | "todos"; l: string }[] = [
  { k: "todos", l: "Todos" },
  { k: "procesando", l: "Procesando" },
  { k: "encolado", l: "En cola" },
  { k: "error", l: "Error" },
  { k: "pendiente_de_procesamiento", l: "Pendientes" },
  { k: "esperando_documentos", l: "Esperando documentos" },
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
    perfil: pick("perfil"),
    tipo: pick("tipo", "tipo_contratacion"),
    alertaEstado: pick("alertaEstado", "alerta_estado"),
    score: pick("score"),
  };
}

const PERFILES = ["bienes", "servicios", "obras", "otros"] as const;
type Perfil = (typeof PERFILES)[number];

export default function AdminProcesamientosPage() {
  const [rows, setRows] = useState<ProcAdmin[] | null>(null);
  const [tab, setTab] = useState<Estado | "todos">("todos");
  const [perfil, setPerfil] = useState<Perfil | "todos">("todos");
  // ?estado= y ?perfil= (enlaces desde /admin): se leen una vez en el cliente, sin useSearchParams (evita el Suspense del prerender).
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const e = sp.get("estado"), p = sp.get("perfil");
    if (e && TABS.some((t) => t.k === e)) setTab(e as Estado);
    if (p && (PERFILES as readonly string[]).includes(p)) setPerfil(p as Perfil);
  }, []);
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

  const { open, toast } = useDialog();

  function reencolar(p: ProcAdmin) {
    open({
      title: `Re-encolar ${p.ocid}`, confirmLabel: "Re-encolar",
      body: <>Se reinician los intentos y el dispatcher lo toma en su próxima corrida (cada 5 min).</>,
      onConfirm: async () => {
        await adminFetch(`/procesamientos/${encodeURIComponent(p.ocid)}/reencolar`, { method: "POST", body: "{}" });
        toast(`${p.ocid} re-encolado`); load();
      },
    });
  }

  function reanalizar(p: ProcAdmin) {
    const activo = (rows ?? []).find((r) => r.estado === "procesando");
    open({
      title: `Re-analizar ${p.ocid}`, confirmLabel: activo ? "Hay uno en curso" : "Re-analizar", tone: "danger",
      body: activo
        ? <>No se puede lanzar ahora: <strong>{activo.ocid}</strong> está en análisis y el servicio de agentes devuelve 429 al segundo request concurrente. Espera a que termine.</>
        : <>Vuelve a correr las 10 fases del pipeline sobre este contrato: <strong>≈ US$ 0.25</strong> y <strong>~3 min</strong> (hasta 10 si el expediente es pesado). La alerta actual se reemplaza al persistir la nueva; si estaba en revisión, seguirá en revisión hasta que la publiques. El dispatcher lo toma en su próxima corrida (cada 5 min).</>,
      fields: activo ? [] : [{ name: "motivo", label: "Motivo (queda en la bitácora)", placeholder: "p. ej. se corrigió el parser de documentos", required: true }],
      onConfirm: async (v) => {
        if (activo) throw new Error("Espera a que termine el análisis en curso.");
        await adminFetch(`/procesamientos/${encodeURIComponent(p.ocid)}/reanalizar`, { method: "POST", body: JSON.stringify({ motivo: v.motivo }) });
        toast(`${p.ocid} re-encolado para re-análisis`); load();
      },
    });
  }

  function reencolarErrores() {
    open({
      title: "Re-encolar todos los contratos con error", tone: "danger", confirmLabel: "Re-encolar todos",
      body: <>Reinicia intentos de todos los procesamientos en estado <strong>error</strong>. Úsalo después de arreglar la causa (p. ej. relay caído).</>,
      onConfirm: async () => {
        const r = await adminFetch<{ reencolados: number }>("/procesamientos/reencolar-errores", { method: "POST", body: "{}" });
        toast(`${r.reencolados} re-encolados`); load();
      },
    });
  }

  async function procesarAhora() {
    setBusy("run");
    try {
      await adminFetch("/dispatcher/run", { method: "POST", body: "{}" });
      toast("Dispatcher lanzado · toma los contratos en cola en ~1 min");
      setTimeout(load, 8000);
    } catch (e) { toast((e as Error).message, "error"); }
    finally { setBusy(null); }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { encolado: 0, procesando: 0, procesado: 0, error: 0, pendiente_de_procesamiento: 0, esperando_documentos: 0 };
    for (const r of rows ?? []) c[r.estado] = (c[r.estado] ?? 0) + 1;
    return c;
  }, [rows]);

  const porPerfil = useMemo(() => {
    const c: Record<string, number> = { bienes: 0, servicios: 0, obras: 0, otros: 0 };
    for (const r of rows ?? []) if (r.perfil) c[r.perfil] = (c[r.perfil] ?? 0) + 1;
    return c;
  }, [rows]);

  const visible = useMemo(
    () => (rows ?? []).filter((r) => (tab === "todos" || r.estado === tab) && (perfil === "todos" || r.perfil === perfil)),
    [rows, tab, perfil],
  );

  return (
    <AdminShell
      title="Procesamiento"
      subtitle="Contratos financiados: cola → procesando → procesado. Lo mueve el dispatcher (Cloud Run Job, cada 5 min)."
      actions={
        <>
          {counts.error > 0 && (
            <button onClick={reencolarErrores} className="inline-flex items-center gap-1.5 rounded-lg border border-rust/40 bg-paper px-3 py-1.5 text-xs text-rust hover:bg-crimson-soft">
              Re-encolar {counts.error} con error
            </button>
          )}
          <button onClick={procesarAhora} disabled={busy === "run"} className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper disabled:opacity-60">
            {busy === "run" ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} />} Procesar ahora
          </button>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paperDeep"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Actualizar
          </button>
        </>
      }
    >
      {msg && (
        <div className="mb-4 rounded-xl border border-line bg-paper px-4 py-2 text-sm text-ink">{msg}</div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Kpi label="En cola" value={counts.encolado} />
        <Kpi label="Procesando" value={counts.procesando} tone="amber" />
        <Kpi label="Procesados" value={counts.procesado} tone="moss" />
        <Kpi label="Con error" value={counts.error} tone={counts.error > 0 ? "rust" : "ink"} hint="máx. 3 intentos" />
        <Kpi label="Pendientes" value={counts.pendiente_de_procesamiento} tone={counts.pendiente_de_procesamiento > 0 ? "amber" : "ink"} hint="tipo/etapa sin análisis aplicable" />
        <Kpi label="Esperando docs" value={counts.esperando_documentos} tone={counts.esperando_documentos > 0 ? "amber" : "ink"} hint="los baja el lote nocturno" />
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
        <Link href="/app/auditoria" target="_blank" className="ml-auto inline-flex items-center gap-1 text-xs text-mute hover:text-ink">
          <ExternalLink size={12} /> Tablero público
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[11px] uppercase tracking-wide text-mute">Perfil</span>
        <button onClick={() => setPerfil("todos")} className={`rounded-full px-3 py-1 ${perfil === "todos" ? "bg-ink text-paper" : "border border-line bg-paper text-mute hover:text-ink"}`}>Todos</button>
        {PERFILES.map((pf) => (
          <button key={pf} onClick={() => setPerfil(pf)} className={`rounded-full px-3 py-1 ${perfil === pf ? "bg-ink text-paper" : "border border-line bg-paper text-mute hover:text-ink"}`} title={PERFIL_LABEL[pf]}>
            {PERFIL_LABEL[pf].split(" ")[0]} <span className="font-mono text-[10px] opacity-70">{porPerfil[pf] ?? 0}</span>
          </button>
        ))}
        <span className="text-[11px] text-mute">· un servicio de agentes por perfil (agent-orchestrator-adk · agente-servicios · agente-obras · agente-otros)</span>
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
                    {[p.perfil ? PERFIL_LABEL[p.perfil].split(" ")[0] : p.tipo, p.zona, p.contribucionCodigo, p.financiador].filter(Boolean).join(" · ")}
                  </div>
                </td>
                <td className="px-2 py-2">
                  <Badge cls={ESTADO_UI[p.estado]?.cls ?? "bg-paperDeep text-mute"}>{ESTADO_UI[p.estado]?.label ?? p.estado}</Badge>
                  {p.estado === "procesado" && p.alertaEstado === "revision" && (
                    <div className="mt-1"><Badge cls="bg-paperDeep text-clayTexto">En revisión humana</Badge></div>
                  )}
                  {p.estado === "procesado" && p.score != null && <div className="mt-0.5 font-mono text-[10px] text-mute">score {p.score}</div>}
                </td>
                <td className="px-2 py-2 font-mono text-xs text-ink">
                  {p.faseActual ?? "—"}
                  {p.faseIndex != null && <span className="text-mute"> · {p.faseIndex}/10</span>}
                </td>
                <td className="px-2 py-2 text-right font-mono text-xs">{p.intentos}</td>
                <td className="px-2 py-2 font-mono text-[11px] text-mute">{p.worker ?? "—"}</td>
                <td className="px-2 py-2 text-[11px] text-mute">{fmtDate(p.latidoAt ?? p.finalizadoAt ?? p.encoladoAt)}</td>
                <td className="px-2 py-2 max-w-[220px] text-[11px] text-crimsonTexto">
                  <span className="line-clamp-2">{p.error ?? ""}</span>
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="inline-flex items-center gap-1">
                    <Link
                      href={`/app/auditoria/${encodeURIComponent(p.ocid)}`}
                      target="_blank"
                      className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper px-2 py-1 text-[11px] text-ink hover:bg-paperDeep"
                      title="Carriles por agente + bitácora del procesamiento"
                    >
                      <Eye size={11} /> Ver traza
                    </Link>
                    {(p.estado === "procesado" || p.estado === "error" || p.estado === "pendiente_de_procesamiento") && (
                      <button
                        onClick={() => reanalizar(p)}
                        className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper px-2 py-1 text-[11px] text-ink hover:bg-paperDeep"
                        title="Vuelve a correr el pipeline (≈ US$ 0.25, ~3 min)"
                      >
                        <Repeat size={11} /> Re-analizar
                      </button>
                    )}
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

      <PedidosDescarga onChange={load} />
    </AdminShell>
  );
}

interface Pedido {
  id: number; ocid: string; motivo: string; estado: "pendiente" | "descargando" | "listo" | "fallido";
  solicitadoAt: string; tomadoAt: string | null; atendidoAt: string | null; intentos: number; loteId: string | null;
  error: string | null; titulo: string | null; entidad: string | null;
}

const PEDIDO_UI: Record<Pedido["estado"], { label: string; cls: string }> = {
  pendiente: { label: "Esta noche", cls: "bg-amber-soft text-amberTexto" },
  descargando: { label: "Descargando", cls: "bg-amber-soft/60 text-clayTexto" },
  listo: { label: "Listo", cls: "bg-moss/10 text-moss" },
  fallido: { label: "Fallido", cls: "bg-crimson-soft text-crimsonTexto" },
};

/** Pedidos de descarga (migración 15): contratos financiados sin documentos en GCS; los atiende el batch nocturno. */
function PedidosDescarga({ onChange }: { onChange: () => void }) {
  const [rows, setRows] = useState<Pedido[] | null>(null);
  const { toast } = useDialog();
  const load = useCallback(() => { adminFetch<{ data: Pedido[] }>("/pedidos").then((r) => setRows(r.data)).catch(() => setRows([])); }, []);
  useEffect(() => { load(); }, [load]);
  const abiertos = (rows ?? []).filter((p) => p.estado !== "listo");
  const listos = (rows ?? []).filter((p) => p.estado === "listo").length;
  async function reintentar(p: Pedido) {
    try {
      await adminFetch(`/pedidos/${p.id}/reintentar`, { method: "POST", body: "{}" });
      toast(`${p.ocid} vuelve a la cola de descarga`); load(); onChange();
    } catch (e) { toast((e as Error).message, "error"); }
  }
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif text-lg font-bold text-ink">Pedidos de descarga</h2>
        <span className="text-[11px] text-mute">{abiertos.length} abiertos · {listos} atendidos · los baja el lote nocturno (<code>descargar pedidos</code>) desde IP peruana</span>
      </div>
      <div className="mt-2 overflow-hidden rounded-2xl border border-line bg-paper">
        <table className="w-full text-sm">
          <thead className="bg-paperDeep text-left text-[11px] uppercase tracking-wide text-mute">
            <tr><th className="px-3 py-2">Contrato</th><th>Estado</th><th>Solicitado</th><th>Noches</th><th>Lote</th><th></th></tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={6} className="px-3 py-6 text-center text-mute">Cargando…</td></tr>}
            {rows !== null && !abiertos.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-mute">Ningún contrato financiado espera documentos.</td></tr>}
            {abiertos.map((p) => (
              <tr key={p.id} className="border-t border-line align-top">
                <td className="max-w-md px-3 py-2">
                  <Link href={`/app/contratos/${encodeURIComponent(p.ocid)}`} className="font-mono text-xs text-ink hover:underline">{p.ocid}</Link>
                  <div className="truncate text-[12px] text-mute" title={p.titulo ?? ""}>{p.titulo ?? "—"}</div>
                  {p.error && <div className="text-[11px] text-rust">{p.error}</div>}
                </td>
                <td><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PEDIDO_UI[p.estado].cls}`}>{PEDIDO_UI[p.estado].label}</span></td>
                <td className="text-[12px] text-mute">{fmtDate(p.solicitadoAt)}</td>
                <td className="font-mono text-xs">{p.intentos}</td>
                <td className="font-mono text-[11px] text-mute">{p.loteId ?? "—"}</td>
                <td className="px-2 py-2 text-right">
                  {p.estado === "fallido" && (
                    <button onClick={() => reintentar(p)} className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper px-2 py-1 text-[11px] text-ink hover:bg-paperDeep">
                      <RotateCcw size={11} /> Reintentar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
