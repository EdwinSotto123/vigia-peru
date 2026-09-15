"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, fmtDate } from "@/lib/admin";

interface Mes { mes: string | null; contratos: number; conRecord: number; conDocs: number; docsPublicados: number; docsVigentes: number; clasificados: number; analizados: number; enCola: number }
interface Lote { id: string; tipo: string; estado: string; total: number; ok: number; fallidos: number; iniciadoAt: string | null; finalizadoAt: string | null; error: string | null }
interface Cobertura {
  meses: Mes[];
  lotes: Lote[];
  documentos: { total: number; vigentes: number; bytesVigentes: number; proximaExpiracion: string | null } | null;
  porFormato: { formato: string | null; n: number; bytes: number }[];
  generadoAt: string;
}

const gb = (b: number) => `${(b / 1e9).toLocaleString("es-PE", { maximumFractionDigits: b < 1e9 ? 2 : 1 })} GB`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Qué tiene Vigía de cada mes, a ciencia cierta: sale de las tablas que escribe el pipeline (migración 16). */
export default function CoberturaPage() {
  const [d, setD] = useState<Cobertura | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = () => adminFetch<Cobertura>("/cobertura").then(setD).catch((e) => setErr(e.message));
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    return () => clearInterval(id);
  }, []);
  const meses = (d?.meses ?? []).filter((m) => m.mes);
  const tot = meses.reduce((a, m) => ({ contratos: a.contratos + m.contratos, conRecord: a.conRecord + m.conRecord, conDocs: a.conDocs + m.conDocs, docsPublicados: a.docsPublicados + m.docsPublicados, docsVigentes: a.docsVigentes + m.docsVigentes, analizados: a.analizados + m.analizados }), { contratos: 0, conRecord: 0, conDocs: 0, docsPublicados: 0, docsVigentes: 0, analizados: 0 });

  return (
    <AdminShell title="Cobertura" subtitle="Qué hay descargado, en el bucket y analizado, mes por mes (fuente: Cloud SQL, no estimaciones)">
      {err && <div className="rounded-xl border border-rust/30 bg-crimson-soft px-3 py-2 text-sm text-rust">{err}</div>}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <K l="Contratos en DB" v={tot.contratos.toLocaleString("es-PE")} />
            <K l="Con record completo" v={`${tot.conRecord.toLocaleString("es-PE")} · ${pct(tot.conRecord, tot.contratos)} %`} />
            <K l="Con documentos en GCS" v={`${tot.conDocs.toLocaleString("es-PE")} · ${pct(tot.conDocs, tot.contratos)} %`} />
            <K l="Documentos vigentes" v={`${(d.documentos?.vigentes ?? 0).toLocaleString("es-PE")} · ${gb(d.documentos?.bytesVigentes ?? 0)}`} hint={d.documentos?.proximaExpiracion ? `primera expiración ${fmtDate(d.documentos.proximaExpiracion)}` : "retención 90 días"} />
            <K l="Analizados" v={tot.analizados.toLocaleString("es-PE")} />
          </div>

          <div className="mt-6 overflow-x-auto rounded-2xl border border-line bg-paper">
            <table className="w-full text-sm">
              <thead className="bg-paperDeep text-left text-[11px] uppercase tracking-wide text-mute">
                <tr><th className="px-3 py-2">Mes de convocatoria</th><th className="text-right">Contratos</th><th className="text-right">Record completo</th><th className="text-right">Docs publicados</th><th className="text-right">Docs en GCS</th><th className="text-right">Contratos con docs</th><th className="text-right">Clasificados</th><th className="text-right">Analizados</th><th className="text-right">En cola</th></tr>
              </thead>
              <tbody>
                {meses.map((m) => (
                  <tr key={m.mes} className="border-t border-line font-mono text-xs">
                    <td className="px-3 py-1.5 font-sans text-sm text-ink">{new Date(m.mes! + "T12:00:00").toLocaleDateString("es-PE", { month: "long", year: "numeric" })}</td>
                    <td className="text-right">{m.contratos.toLocaleString("es-PE")}</td>
                    <td className="text-right"><Barra a={m.conRecord} b={m.contratos} /></td>
                    <td className="text-right">{m.docsPublicados.toLocaleString("es-PE")}</td>
                    <td className="text-right"><Barra a={m.docsVigentes} b={m.docsPublicados} /></td>
                    <td className="text-right">{m.conDocs.toLocaleString("es-PE")}</td>
                    <td className="text-right"><Barra a={m.clasificados} b={m.contratos} /></td>
                    <td className="text-right">{m.analizados.toLocaleString("es-PE")}</td>
                    <td className="text-right">{m.enCola.toLocaleString("es-PE")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-mute">
            <strong>Record completo</strong> = bajado por lotes desde <code>/record/&lt;ocid&gt;</code> (trae partes, adjudicaciones y contratos); sin él solo tenemos el release recortado de <code>/releasesAfter</code>.
            <strong> Docs en GCS</strong> = vigentes (no expirados) en <code>gs://vigia-peru-batch/batch/documentos/</code>. Actualizado {fmtDate(d.generadoAt)}.
          </p>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="overflow-hidden rounded-2xl border border-line bg-paper">
              <div className="border-b border-line bg-paperDeep px-3 py-2 text-[11px] uppercase tracking-wide text-mute">Lotes ingeridos (job vigia-ingest)</div>
              <table className="w-full text-sm">
                <tbody>
                  {!d.lotes.length && <tr><td className="px-3 py-6 text-center text-mute">Todavía no se ingirió ningún lote.</td></tr>}
                  {d.lotes.map((l) => (
                    <tr key={l.id} className="border-t border-line">
                      <td className="px-3 py-1.5 font-mono text-[11px] text-ink">{l.id}</td>
                      <td className="text-[12px] text-mute">{l.tipo}</td>
                      <td className="font-mono text-xs">{l.ok.toLocaleString("es-PE")}/{l.total.toLocaleString("es-PE")}{l.fallidos ? <span className="text-rust"> · {l.fallidos} fallidos</span> : null}</td>
                      <td><span className={`rounded-full px-2 py-0.5 text-[11px] ${l.estado === "ok" ? "bg-moss/10 text-moss" : l.estado === "error" ? "bg-crimson-soft text-crimson" : "bg-amber-soft text-amber"}`}>{l.estado}</span></td>
                      <td className="px-3 text-right text-[11px] text-mute">{fmtDate(l.finalizadoAt ?? l.iniciadoAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="rounded-2xl border border-line bg-paper p-4">
              <div className="text-[11px] uppercase tracking-wide text-mute">Documentos vigentes por formato</div>
              <ul className="mt-2 divide-y divide-line text-sm">
                {!d.porFormato.length && <li className="py-1.5 text-mute">Ninguno.</li>}
                {d.porFormato.map((f) => (
                  <li key={f.formato ?? "?"} className="flex justify-between py-1.5"><span className="uppercase text-ink">{f.formato ?? "?"}</span><span className="font-mono text-xs text-mute">{f.n.toLocaleString("es-PE")} · {gb(f.bytes)}</span></li>
                ))}
              </ul>
              <p className="mt-3 text-[11px] text-mute">Lifecycle del bucket: Nearline a los 30 días, borrado a los 90. Lo financiado después de expirar se vuelve a bajar esa noche.</p>
            </div>
          </div>
        </>
      )}
    </AdminShell>
  );
}

function K({ l, v, hint }: { l: string; v: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <div className="font-mono text-lg font-semibold text-ink">{v}</div>
      <div className="text-[10px] uppercase tracking-wide text-mute">{l}</div>
      {hint && <div className="text-[10px] text-mute">{hint}</div>}
    </div>
  );
}

function Barra({ a, b }: { a: number; b: number }) {
  const p = pct(a, b);
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span className="inline-block h-1.5 w-12 overflow-hidden rounded-full bg-paperDeep" aria-hidden><span className="block h-full bg-moss" style={{ width: `${p}%` }} /></span>
      <span className="w-14 text-right">{a.toLocaleString("es-PE")}</span>
      <span className="w-9 text-right text-mute">{p} %</span>
    </span>
  );
}
