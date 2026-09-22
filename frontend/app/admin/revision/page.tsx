"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Eye, RefreshCw, ExternalLink, Settings2, CheckCircle2, XCircle } from "lucide-react";
import { AdminShell, Badge, Kpi } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { adminFetch, fmtDate, PERFIL_LABEL, type RevisionRow, type SelfEvalConfig } from "@/lib/admin";

/**
 * Cola de revisión humana (plan 2026-09-16 · U4): alertas que la autoevaluación del pipeline
 * bloqueó (estado 'revision'). Cada fila muestra el motivo del bloqueo; el detalle permite
 * publicar o descartar con motivo (queda en la bitácora y refresca el ranking).
 * Fuente: GET /api/admin/revision · PUT /api/admin/alertas/:id/estado · GET/PUT /api/admin/config/self_eval
 */
export default function RevisionPage() {
  const [rows, setRows] = useState<RevisionRow[] | null>(null);
  const [umbrales, setUmbrales] = useState<SelfEvalConfig | null>(null);
  const [tab, setTab] = useState<"revision" | "resueltas">("revision");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { open, toast } = useDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await adminFetch<{ data: RevisionRow[]; umbrales: SelfEvalConfig }>(`/revision?estado=${tab}`);
      setRows(r.data); setUmbrales(r.umbrales); setErr(null);
    } catch (e) { setErr((e as Error).message); setRows([]); }
    finally { setLoading(false); }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  function resolver(r: RevisionRow, estado: "activa" | "descartada") {
    const publicar = estado === "activa";
    open({
      title: publicar ? `Publicar ${r.codigo}` : `Descartar ${r.codigo}`,
      tone: publicar ? "success" : "danger",
      confirmLabel: publicar ? "Publicar" : "Descartar",
      body: publicar
        ? <>La alerta pasa a <strong>activa</strong>: aparece en listas públicas, mapa y ranking, y cuenta como señal hallada si tiene banderas. Motivo del bloqueo: <em>{r.motivo}</em></>
        : <>La alerta pasa a <strong>descartada</strong>: no se publica y deja de contar. El contrato sigue como procesado. Motivo del bloqueo: <em>{r.motivo}</em></>,
      fields: [{ name: "motivo", label: "Motivo de la decisión", type: "textarea", required: true, placeholder: publicar ? "Revisé las banderas: la evidencia está en el expediente (pág. …)" : "Las banderas no se sostienen: …" }],
      onConfirm: async (v) => {
        await adminFetch(`/alertas/${r.id}/estado`, { method: "PUT", body: JSON.stringify({ estado, motivo: v.motivo }) });
        toast(`${r.codigo} ${publicar ? "publicada" : "descartada"} · ranking refrescado`);
        load();
      },
    });
  }

  function editarUmbrales() {
    if (!umbrales) return;
    open({
      title: "Umbrales de la autoevaluación",
      confirmLabel: "Guardar",
      body: <>Se guardan en <code>ajustes.self_eval</code> y explican el motivo del bloqueo en este panel. El pipeline los aplica desde las variables <code>EVAL_MIN_*</code> de los servicios de agentes: un cambio aquí debe replicarse en el deploy para que bloquee distinto.</>,
      fields: [
        { name: "min_respaldo", label: "Respaldo mínimo de banderas (0–1)", defaultValue: String(umbrales.min_respaldo), hint: "Bloquea si menos de esta fracción de banderas está respaldada por el expediente/OCDS/fuentes (≥ 2 juzgadas)." },
        { name: "min_cita", label: "Citas correctas mínimas (0–1)", defaultValue: String(umbrales.min_cita), hint: "Bloquea si menos de esta fracción de banderas cita norma y fuente (≥ 3 juzgadas)." },
        { name: "min_precio", label: "Precio plausible mínimo (0–1)", defaultValue: String(umbrales.min_precio), hint: "Bloquea si menos de esta fracción de veredictos de precio es plausible (≥ 3 ítems)." },
        { name: "bloquea_tono", label: "Bloquear por tono acusatorio", type: "select", defaultValue: umbrales.bloquea_tono ? "true" : "false", options: [{ value: "true", label: "Sí" }, { value: "false", label: "No" }] },
        { name: "bloquea_coherencia", label: "Bloquear por ítems incoherentes con el objeto", type: "select", defaultValue: umbrales.bloquea_coherencia ? "true" : "false", options: [{ value: "true", label: "Sí" }, { value: "false", label: "No" }] },
      ],
      onConfirm: async (v) => {
        const num = (k: string) => { const n = Number(v[k]); if (!Number.isFinite(n) || n < 0 || n > 1) throw new Error(`"${k}" debe estar entre 0 y 1`); return n; };
        const body: SelfEvalConfig = { min_respaldo: num("min_respaldo"), min_cita: num("min_cita"), min_precio: num("min_precio"), bloquea_tono: v.bloquea_tono === "true", bloquea_coherencia: v.bloquea_coherencia === "true", nota: umbrales.nota ?? "" };
        await adminFetch("/config/self_eval", { method: "PUT", body: JSON.stringify(body) });
        toast("Umbrales guardados"); load();
      },
    });
  }

  const n = rows?.length ?? 0;
  const porClave = (rows ?? []).reduce<Record<string, number>>((acc, r) => { for (const m of r.motivos) acc[m.clave] = (acc[m.clave] ?? 0) + 1; if (!r.motivos.length && r.motivoPipeline) acc.pipeline = (acc.pipeline ?? 0) + 1; return acc; }, {});

  return (
    <AdminShell title="Revisión humana" subtitle="Alertas que la autoevaluación bloqueó: una persona decide si se publican o se descartan" actions={
      <>
        <button onClick={editarUmbrales} disabled={!umbrales} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paperDeep disabled:opacity-50">
          <Settings2 size={12} /> Umbrales
        </button>
        <button onClick={load} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paperDeep">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Actualizar
        </button>
      </>
    }>
      {err && <div className="mb-4 rounded-xl border border-crimson/30 bg-crimson-soft p-3 text-sm text-crimsonTexto">{err}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label={tab === "revision" ? "En revisión" : "Resueltas"} value={rows ? n : "—"} tone={n > 0 && tab === "revision" ? "amber" : "ink"} />
        <Kpi label="Respaldo bajo" value={porClave.respaldo ?? 0} hint={umbrales ? `umbral ${Math.round(umbrales.min_respaldo * 100)} %` : undefined} />
        <Kpi label="Precio dudoso" value={porClave.precio ?? 0} hint={umbrales ? `umbral ${Math.round(umbrales.min_precio * 100)} %` : undefined} />
        <Kpi label="Sin cita" value={porClave.cita ?? 0} hint={umbrales ? `umbral ${Math.round(umbrales.min_cita * 100)} %` : undefined} />
        <Kpi label="Tono / coherencia" value={(porClave.tono ?? 0) + (porClave.coherencia ?? 0)} hint={umbrales ? `${umbrales.bloquea_tono ? "tono" : ""}${umbrales.bloquea_tono && umbrales.bloquea_coherencia ? " + " : ""}${umbrales.bloquea_coherencia ? "coherencia" : ""} activos` : undefined} />
      </div>

      <div className="mt-5 flex items-center gap-2">
        {(["revision", "resueltas"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 text-xs ${tab === t ? "bg-ink text-paper" : "border border-line bg-paper text-mute hover:text-ink"}`}>
            {t === "revision" ? "Pendientes" : "Resueltas"}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-mute">En revisión: no aparece en listas públicas, mapa ni ranking; sí en el detalle con la etiqueta. Cuenta como procesado, no como señal.</span>
      </div>

      <section className="mt-3 overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-mute">
            <tr>
              <th className="px-4 py-2">Contrato</th>
              <th className="px-2 py-2">Entidad · zona</th>
              <th className="px-2 py-2 text-right">Score</th>
              <th className="px-2 py-2 text-right">Banderas</th>
              <th className="px-2 py-2">Motivo del bloqueo</th>
              <th className="px-2 py-2">Analizado</th>
              <th className="px-4 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {rows === null && <tr><td colSpan={7} className="px-4 py-8 text-center text-mute">Cargando…</td></tr>}
            {rows !== null && !rows.length && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-mute">{tab === "revision" ? "Nada espera revisión. La autoevaluación dejó pasar todo lo procesado." : "Todavía no se resolvió ninguna alerta."}</td></tr>
            )}
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="border-t border-line align-top">
                <td className="px-4 py-2">
                  <Link href={`/admin/revision/${r.id}`} className="font-mono text-xs text-ink hover:underline">{r.codigo}</Link>
                  <div className="mt-0.5 line-clamp-2 max-w-[300px] text-[11px] text-mute" title={r.objeto ?? ""}>{r.objeto ?? r.ocid}</div>
                  <div className="text-[11px] text-mute">{[PERFIL_LABEL[r.perfil ?? ""]?.split(" ")[0] ?? r.tipo, r.contribucionCodigo, r.financiador].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="px-2 py-2 text-[12px]">
                  <div className="line-clamp-2 max-w-[240px] text-ink" title={r.entidad ?? ""}>{r.entidad ?? r.entidadRuc ?? "—"}</div>
                  <div className="text-[11px] text-mute">{r.zona ?? r.provincia ?? r.region ?? "—"}</div>
                </td>
                <td className="px-2 py-2 text-right font-mono">{r.score ?? "—"}</td>
                <td className="px-2 py-2 text-right font-mono">{r.banderas}</td>
                <td className="px-2 py-2 max-w-[320px] text-[12px] text-ink">
                  <div className="flex flex-wrap gap-1">{r.motivos.map((m) => <Badge key={m.clave} cls="bg-amber-soft text-amberTexto">{m.clave}</Badge>)}</div>
                  <div className={r.motivos.length ? "mt-1 text-mute" : "text-mute"} title={r.motivoPipeline ? "Motivo registrado por el pipeline al bloquear" : "Recalculado con los umbrales actuales"}>{r.motivo}</div>
                  {r.moderacion && (
                    <div className="mt-1 text-[11px] text-mute">
                      {r.moderacion.accion === "publicar" ? <CheckCircle2 size={11} className="inline text-moss" /> : <XCircle size={11} className="inline text-rust" />}{" "}
                      {r.moderacion.actor} · {r.moderacion.accion} · {fmtDate(r.moderacion.at)}: {r.moderacion.motivo}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 text-[11px] text-mute">{fmtDate(r.analizadoEn ?? r.createdAt)}</td>
                <td className="px-4 py-2 text-right">
                  <div className="inline-flex flex-wrap items-center justify-end gap-1">
                    <Link href={`/admin/revision/${r.id}`} className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper px-2 py-1 text-[11px] text-ink hover:bg-paperDeep"><Eye size={11} /> Revisar</Link>
                    {r.procesamientoOcid && (
                      <Link href={`/app/auditoria/${encodeURIComponent(r.procesamientoOcid)}`} target="_blank" className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper px-2 py-1 text-[11px] text-ink hover:bg-paperDeep"><ExternalLink size={11} /> Traza</Link>
                    )}
                    {r.estado === "revision" && (
                      <>
                        <button onClick={() => resolver(r, "activa")} className="rounded-lg bg-moss px-2 py-1 text-[11px] font-semibold text-paper hover:bg-moss/90">Publicar</button>
                        <button onClick={() => resolver(r, "descartada")} className="rounded-lg border border-rust/40 bg-paper px-2 py-1 text-[11px] text-rust hover:bg-crimson-soft">Descartar</button>
                      </>
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
