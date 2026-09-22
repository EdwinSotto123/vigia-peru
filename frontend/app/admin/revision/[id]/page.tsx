"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, CheckCircle2, ExternalLink, ShieldCheck, ShieldAlert, XCircle } from "lucide-react";
import { AdminShell, Badge } from "@/components/admin/AdminShell";
import { useDialog } from "@/components/admin/Dialog";
import { redactChildren, redactDnis } from "@/components/Redact";
import { adminFetch, fmtDate, PERFIL_LABEL, type BanderaRevision, type RevisionDetalle } from "@/lib/admin";

type Detalle = Omit<RevisionDetalle, "banderas"> & { banderas: BanderaRevision[] };

const SEV: Record<string, string> = { alta: "bg-crimson-soft text-crimsonTexto", media: "bg-amber-soft text-amberTexto", baja: "bg-paperDeep text-mute" };

/**
 * Detalle de una alerta en revisión: banderas con su verificación determinista y el juicio de
 * respaldo, dictamen, autoevaluación y las dos decisiones (publicar / descartar) con motivo.
 * Los DNIs y apellidos que puedan venir en evidencias/dictamen pasan por Redact.
 */
export default function RevisionDetallePage({ params }: { params: { id: string } }) {
  const [d, setD] = useState<Detalle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { open, toast } = useDialog();

  const load = useCallback(() => adminFetch<Detalle>(`/revision/${params.id}`).then(setD).catch((e) => setErr(e.message)), [params.id]);
  useEffect(() => { load(); }, [load]);

  function resolver(estado: "activa" | "descartada") {
    if (!d) return;
    const publicar = estado === "activa";
    open({
      title: publicar ? `Publicar ${d.codigo}` : `Descartar ${d.codigo}`,
      tone: publicar ? "success" : "danger",
      confirmLabel: publicar ? "Publicar" : "Descartar",
      body: publicar
        ? <>La alerta pasa a <strong>activa</strong>: aparece en listas públicas, mapa y ranking, y cuenta como señal hallada. Queda en la bitácora con tu nombre.</>
        : <>La alerta pasa a <strong>descartada</strong>: no se publica y deja de contar como señal. El contrato sigue como procesado. Queda en la bitácora con tu nombre.</>,
      fields: [{ name: "motivo", label: "Motivo de la decisión", type: "textarea", required: true }],
      onConfirm: async (v) => {
        await adminFetch(`/alertas/${d.id}/estado`, { method: "PUT", body: JSON.stringify({ estado, motivo: v.motivo }) });
        toast(`${d.codigo} ${publicar ? "publicada" : "descartada"} · ranking refrescado`);
        load();
      },
    });
  }

  const respaldo = new Map((d?.autoevaluacion?.perBandera ?? []).map((b) => [b.regla, b]));

  return (
    <AdminShell title={d ? d.codigo : "Revisión"} subtitle={d?.objeto ?? undefined} actions={
      <>
        <Link href="/admin/revision" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paperDeep"><ArrowLeft size={12} /> Cola</Link>
        {d?.procesamientoOcid && (
          <Link href={`/app/auditoria/${encodeURIComponent(d.procesamientoOcid)}`} target="_blank" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paperDeep"><ExternalLink size={12} /> Ver traza</Link>
        )}
        <Link href={`/app/contratos/${encodeURIComponent(d?.ocid ?? "")}`} target="_blank" className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-3 py-1.5 text-xs text-ink hover:bg-paperDeep"><ExternalLink size={12} /> Contrato</Link>
        {d?.estado === "revision" && (
          <>
            <button onClick={() => resolver("activa")} className="rounded-lg bg-moss px-3 py-1.5 text-xs font-semibold text-paper hover:bg-moss/90">Publicar</button>
            <button onClick={() => resolver("descartada")} className="rounded-lg border border-rust/40 bg-paper px-3 py-1.5 text-xs text-rust hover:bg-crimson-soft">Descartar</button>
          </>
        )}
      </>
    }>
      {err && <div className="mb-4 rounded-xl border border-crimson/30 bg-crimson-soft p-3 text-sm text-crimsonTexto">{err}</div>}
      {!d && !err && <div className="h-40 animate-pulse rounded-2xl bg-paperDeep" />}
      {d && (
        <>
          {/* Cabecera: estado + motivo */}
          <div className={`rounded-2xl border p-5 ${d.estado === "revision" ? "border-clay/40 bg-amber-soft/40" : d.estado === "activa" ? "border-moss/40 bg-moss/5" : "border-line bg-paper"}`}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge cls={d.estado === "revision" ? "bg-paperDeep text-clayTexto" : d.estado === "activa" ? "bg-moss/10 text-moss" : "bg-crimson-soft text-crimsonTexto"}>
                {d.estado === "revision" ? "En revisión humana" : d.estado === "activa" ? "Publicada" : d.estado}
              </Badge>
              <span className="font-mono text-ink">score {d.score ?? "—"}</span>
              <span className="text-mute">· {d.banderas.length} banderas · {PERFIL_LABEL[d.perfil ?? ""] ?? d.tipo} · {d.etapa ?? "etapa —"}</span>
              <span className="ml-auto text-[11px] text-mute">analizada {fmtDate(d.analizadoEn ?? d.createdAt)}{d.contribucionCodigo ? ` · ${d.contribucionCodigo} · ${d.financiador}` : ""}</span>
            </div>
            <div className="mt-2 text-sm text-ink"><strong>{d.entidad ?? d.entidadRuc ?? "Entidad —"}</strong> <span className="text-mute">· {d.zona ?? d.provincia ?? d.region ?? "—"} · OCID {d.ocid}</span></div>
            <h2 className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-mute">Motivo del bloqueo</h2>
            <p className="mt-1 text-sm text-ink">{d.motivo}{d.motivoPipeline && <span className="text-[11px] text-mute"> · registrado por el pipeline al bloquear</span>}</p>
            {d.motivos.length > 0 && (
              <ul className="mt-2 space-y-1 text-[12px] text-mute">
                {d.motivos.map((m) => <li key={m.clave}><Badge cls="bg-amber-soft text-amberTexto">{m.clave}</Badge> {m.texto}{d.motivoPipeline ? " (recalculado con los umbrales actuales y las banderas persistidas)" : ""}</li>)}
              </ul>
            )}
            {d.moderacion && (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-ink">
                {d.moderacion.accion === "publicar" ? <CheckCircle2 size={14} className="text-moss" /> : <XCircle size={14} className="text-rust" />}
                <strong>{d.moderacion.actor}</strong> · {d.moderacion.accion} · {fmtDate(d.moderacion.at)}: <span className="text-mute">{d.moderacion.motivo}</span>
              </p>
            )}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
            {/* Banderas */}
            <section>
              <h2 className="text-sm font-semibold text-ink">Banderas ({d.banderas.length})</h2>
              <p className="text-[11px] text-mute">Cada bandera trae su verificación determinista (identificadores, montos y URLs cotejados contra OCDS/SUNAT/RNP/documentos) y el juicio de respaldo del evaluador.</p>
              <ul className="mt-3 space-y-2">
                {d.banderas.map((b) => {
                  const j = respaldo.get(b.regla);
                  return (
                    <li key={b.id} className="rounded-2xl border border-line bg-paper p-4">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge cls={SEV[b.severidad] ?? SEV.baja}>{b.severidad}</Badge>
                        <span className="font-semibold text-ink">{b.regla.replace(/_/g, " ")}</span>
                        <span className="text-[11px] text-mute">· {b.agente ?? "—"}</span>
                        {b.verificacion && (
                          <span className={`ml-auto inline-flex items-center gap-1 text-[11px] ${b.verificacion.ok ? "text-moss" : "text-rust"}`} title={(b.verificacion.motivos ?? []).join(" · ")}>
                            {b.verificacion.ok ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />} verificación {b.verificacion.ok ? "ok" : "falló"} · {b.verificacion.n_checks ?? 0} cotejos
                          </span>
                        )}
                      </div>
                      {b.evidencia && <p className="mt-2 text-[13px] leading-relaxed text-ink">{redactDnis(b.evidencia)}</p>}
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-mute">
                        {b.norma && <span>Norma: <span className="text-ink">{b.norma}</span></span>}
                        {b.fuenteUrl && <a href={b.fuenteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink hover:underline"><ExternalLink size={10} /> fuente</a>}
                      </div>
                      {(b.verificacion?.motivos?.length ?? 0) > 0 && (
                        <ul className="mt-2 list-disc pl-4 text-[11px] text-mute">{b.verificacion!.motivos!.map((m, i) => <li key={i}>{m}</li>)}</ul>
                      )}
                      {j && (
                        <p className={`mt-2 rounded-lg px-2.5 py-1.5 text-[12px] ${j.respaldada ? "bg-moss/10 text-moss" : "bg-crimson-soft text-crimsonTexto"}`}>
                          <strong>{j.respaldada ? "Respaldada" : "No respaldada"}</strong> según el evaluador: {redactDnis(j.reason ?? "")}
                        </p>
                      )}
                    </li>
                  );
                })}
                {!d.banderas.length && <li className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-mute">Sin banderas persistidas (todas fueron descartadas por la verificación).</li>}
              </ul>
            </section>

            {/* Autoevaluación */}
            <section className="space-y-4">
              <div className="rounded-2xl border border-line bg-paper p-4">
                <h2 className="text-sm font-semibold text-ink">Autoevaluación</h2>
                {d.autoevaluacion ? (
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <Metrica k="Respaldo de banderas" v={d.autoevaluacion.respaldo} umbral={d.umbrales.min_respaldo} />
                    <Metrica k="Citas correctas" v={d.autoevaluacion.cita} umbral={d.umbrales.min_cita} />
                    <Metrica k="Precio plausible" v={d.autoevaluacion.precio} umbral={d.umbrales.min_precio} />
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-mute">Tono · coherencia</dt>
                      <dd className="text-[13px] text-ink">{d.autoevaluacion.tono ?? "—"} · {d.autoevaluacion.coherencia ?? "—"}</dd>
                    </div>
                  </dl>
                ) : <p className="mt-2 text-sm text-mute">Sin autoevaluación guardada.</p>}
                {d.autoevaluacion?.tonoReason && <p className="mt-2 text-[11px] text-mute"><strong>Tono:</strong> {d.autoevaluacion.tonoReason}</p>}
                {d.autoevaluacion?.coherenciaReason && <p className="mt-1 text-[11px] text-mute"><strong>Coherencia:</strong> {d.autoevaluacion.coherenciaReason}</p>}
                {(d.autoevaluacion?.perPrecio?.length ?? 0) > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] uppercase tracking-wide text-mute">Juicio de precio por ítem</div>
                    <ul className="mt-1 space-y-1 text-[12px]">
                      {d.autoevaluacion!.perPrecio.map((p, i) => (
                        <li key={i} className={p.plausible ? "text-ink" : "text-rust"}>
                          <span className="font-medium">{(p.item ?? "").slice(0, 80)}</span>{p.item && p.item.length > 80 ? "…" : ""} — {p.plausible ? "plausible" : "implausible"}{p.reason ? `: ${p.reason}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {(d.validacionesPendientes?.length ?? 0) > 0 && (
                  <p className="mt-3 text-[11px] text-mute">Validaciones pendientes: {d.validacionesPendientes.join(", ")}</p>
                )}
              </div>

              <div className="rounded-2xl border border-line bg-paper p-4">
                <h2 className="text-sm font-semibold text-ink">Bitácora de esta alerta</h2>
                <ul className="mt-2 divide-y divide-line text-[12px]">
                  {!d.log.length && <li className="py-1.5 text-mute">Sin acciones registradas.</li>}
                  {d.log.map((l, i) => (
                    <li key={i} className="py-1.5"><span className="font-medium text-ink">{l.actor}</span> <span className="text-mute">{l.accion.replace(/_/g, " ")}</span> <span className="text-[11px] text-mute">· {fmtDate(l.createdAt)}</span>
                      {motivoDe(l.detalle) && <div className="text-mute">{motivoDe(l.detalle)}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>

          {/* Dictamen */}
          <section className="mt-6 rounded-2xl border border-line bg-paper p-5">
            <h2 className="text-sm font-semibold text-ink">Dictamen</h2>
            {d.dictamen ? (
              <div className="prose prose-sm mt-3 max-w-none text-ink prose-headings:font-serif prose-headings:text-ink prose-a:text-clayTexto">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                  p: ({ node, children, ...props }) => <p {...props}>{redactChildren(children)}</p>,
                  li: ({ node, children, ...props }) => <li {...props}>{redactChildren(children)}</li>,
                  td: ({ node, children, ...props }) => <td {...props}>{redactChildren(children)}</td>,
                }}>{d.dictamen}</ReactMarkdown>
              </div>
            ) : <p className="mt-2 text-sm text-mute">Sin dictamen guardado.</p>}
          </section>
        </>
      )}
    </AdminShell>
  );
}

const motivoDe = (detalle: unknown): string | null =>
  detalle && typeof detalle === "object" && "motivo" in detalle ? String((detalle as { motivo: unknown }).motivo ?? "") || null : null;

function Metrica({ k, v, umbral }: { k: string; v: { n?: number; ok?: number } | null; umbral: number }) {
  const n = v?.n ?? 0, ok = v?.ok ?? 0;
  const r = n ? ok / n : null;
  const bajo = r !== null && r < umbral;
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-mute">{k}</dt>
      <dd className={`font-mono text-[13px] ${bajo ? "text-rust" : "text-ink"}`}>{r === null ? "—" : `${Math.round(r * 100)} %`} <span className="text-[10px] text-mute">({ok}/{n} · umbral {Math.round(umbral * 100)} %)</span></dd>
    </div>
  );
}
