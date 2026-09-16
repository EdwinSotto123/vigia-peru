"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch, fmtDate, type ProgresoDocumentos } from "@/lib/admin";

interface Mes { mes: string | null; contratos: number; conRecord: number; conDocs: number; docsPublicados: number; docsVigentes: number; clasificados: number; analizados: number; enCola: number }
interface Lote { id: string; tipo: string; estado: string; total: number; ok: number; fallidos: number; iniciadoAt: string | null; finalizadoAt: string | null; error: string | null }
interface Cobertura {
  meses: Mes[];
  lotes: Lote[];
  documentos: { total: number; vigentes: number; bytesVigentes: number; proximaExpiracion: string | null } | null;
  porFormato: { formato: string | null; n: number; bytes: number }[];
  fuentes?: Fuente[];
  generadoAt: string;
}
interface Fuente { fuente: string; tabla: string | null; cargas: number; cargasConError: number; filas: number; ultimaClave: string | null; ultimaDescarga: string | null; ultimaCarga: string | null; ultimoError: string | null }

/** Etiqueta y cadencia de cada pipeline de `backend/scrapers` (batch-nocturno.sh, paso 6). */
const FUENTES: Record<string, { nombre: string; cadencia: string; cruce: string }> = {
  pnda_visitas: { nombre: "Visitas a entidades (PNDA / PCM)", cadencia: "días 1 y 15", cruce: "visitas de postores antes de la convocatoria" },
  portal_visitas_manual: { nombre: "Visitas — exportación manual del portal PCM", cadencia: "manual (Turnstile bloquea la automatización)", cruce: "igual que PNDA visitas; todas las entidades" },
  onpe_claridad: { nombre: "Aportantes de campaña (ONPE Claridad)", cadencia: "mensual, con sesión gráfica", cruce: "aportante = postor o socio en la entidad del partido" },
  jne_infogob: { nombre: "Autoridades vigentes (JNE)", cadencia: "día 5", cruce: "alcalde/gobernador y su organización política" },
  pnda_dji: { nombre: "Declaraciones de intereses (DJI)", cadencia: "día 5", cruce: "empleos previos y parientes de funcionarios" },
};

const gb = (b: number) => `${(b / 1e9).toLocaleString("es-PE", { maximumFractionDigits: b < 1e9 ? 2 : 1 })} GB`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** Qué tiene Vigía de cada mes, a ciencia cierta: sale de las tablas que escribe el pipeline (migración 16). */
export default function CoberturaPage() {
  const [d, setD] = useState<Cobertura | null>(null);
  const [pr, setPr] = useState<ProgresoDocumentos | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = () => {
      adminFetch<Cobertura>("/cobertura").then(setD).catch((e) => setErr(e.message));
      adminFetch<ProgresoDocumentos>("/cobertura/progreso").then(setPr).catch(() => setPr(null));
    };
    load();
    const id = setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    return () => clearInterval(id);
  }, []);
  const meses = (d?.meses ?? []).filter((m) => m.mes);
  const tot = meses.reduce((a, m) => ({ contratos: a.contratos + m.contratos, conRecord: a.conRecord + m.conRecord, conDocs: a.conDocs + m.conDocs, docsPublicados: a.docsPublicados + m.docsPublicados, docsVigentes: a.docsVigentes + m.docsVigentes, analizados: a.analizados + m.analizados }), { contratos: 0, conRecord: 0, conDocs: 0, docsPublicados: 0, docsVigentes: 0, analizados: 0 });

  return (
    <AdminShell title="Cobertura" subtitle="Qué hay descargado, en el bucket y analizado, mes por mes (fuente: Cloud SQL, no estimaciones)">
      {err && <div className="rounded-xl border border-rust/30 bg-crimson-soft px-3 py-2 text-sm text-rust">{err}</div>}
      {pr && <Progreso pr={pr} />}
      {d && (
        <>
          <FuentesExternas fuentes={d.fuentes ?? []} />
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
                    <td className="px-3 py-1.5 font-sans text-sm text-ink">{new Date(m.mes!.slice(0, 10) + "T12:00:00").toLocaleDateString("es-PE", { month: "long", year: "numeric" })}</td>
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

/** Lote nocturno de documentos: cuánto falta, a qué ritmo va y qué falló (plan 2026-09-16 · U4). */
function Progreso({ pr }: { pr: ProgresoDocumentos }) {
  const lote = pr.loteActual;
  const dia = (iso: string) => new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-PE", { weekday: "short", day: "2-digit", month: "short" });
  return (
    <section className="mb-6 rounded-2xl border border-line bg-paper p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Lote nocturno de documentos</h2>
        <span className="text-[11px] text-mute">
          {lote ? <>último lote <span className="font-mono">{lote.id}</span> · {lote.estado} · {lote.ok.toLocaleString("es-PE")}/{lote.total.toLocaleString("es-PE")}{lote.fallidos ? <span className="text-rust"> · {lote.fallidos} fallidos</span> : null} · {fmtDate(lote.finalizadoAt ?? lote.iniciadoAt)}</> : "sin lotes de documentos"}
        </span>
      </div>
      <div className="mt-3 flex items-baseline gap-3">
        <span className="font-mono text-2xl font-semibold text-ink">{pr.vigentes.toLocaleString("es-PE")}</span>
        <span className="text-sm text-mute">de {pr.publicados.toLocaleString("es-PE")} documentos publicados en el SEACE ya están en el almacén · <span className="font-mono text-ink">{pr.pct} %</span></span>
      </div>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuenow={pr.pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-moss" style={{ width: `${Math.min(100, pr.pct)}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div><dt className="text-[10px] uppercase tracking-wide text-mute">Faltan</dt><dd className="font-mono text-ink">{pr.restantes.toLocaleString("es-PE")} <span className="text-[11px] text-mute">docs · {pr.contratosSinBajar.toLocaleString("es-PE")} contratos sin bajar</span></dd></div>
        <div><dt className="text-[10px] uppercase tracking-wide text-mute">Ritmo</dt><dd className="font-mono text-ink">{pr.porNoche ? `${pr.porNoche.toLocaleString("es-PE")} / noche` : "—"} <span className="text-[11px] text-mute">promedio 7 días</span></dd></div>
        <div><dt className="text-[10px] uppercase tracking-wide text-mute">Estimación de fin</dt><dd className="font-mono text-ink">{pr.nochesRestantes !== null ? `${pr.nochesRestantes} noche${pr.nochesRestantes === 1 ? "" : "s"}` : "—"} {pr.estimadoFin && <span className="text-[11px] text-mute">≈ {new Date(pr.estimadoFin).toLocaleDateString("es-PE", { day: "2-digit", month: "short" })}</span>}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-wide text-mute">Ítems pendientes en lotes</dt><dd className="font-mono text-ink">{pr.itemsPendientes.toLocaleString("es-PE")}</dd></div>
      </dl>
      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_1fr]">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-mute">Descargados por noche (7 días)</div>
          <ul className="mt-1 space-y-1 text-[12px]">
            {!pr.ritmo.length && <li className="text-mute">Sin descargas en la última semana.</li>}
            {pr.ritmo.map((r) => {
              const max = Math.max(...pr.ritmo.map((x) => x.n), 1);
              return (
                <li key={r.dia} className="flex items-center gap-2">
                  <span className="w-20 text-mute">{dia(r.dia)}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paperDeep"><span className="block h-full bg-moss" style={{ width: `${Math.round((r.n / max) * 100)}%` }} /></span>
                  <span className="w-28 whitespace-nowrap text-right font-mono text-ink" title={`${r.contratos.toLocaleString("es-PE")} contratos`}>{r.n.toLocaleString("es-PE")}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-mute">Últimos errores por ítem</div>
          {!pr.errores.length ? <p className="mt-1 text-[12px] text-mute">Ningún ítem falló en los últimos lotes.</p> : (
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto text-[11px]">
              {pr.errores.map((e, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2 border-t border-line py-1 first:border-0">
                  <span className="min-w-0 truncate font-mono text-ink" title={`${e.loteId} · ${e.clave}`}>{e.clave}</span>
                  <span className="min-w-0 truncate text-rust" title={e.error ?? ""}>{e.error ?? "error"}</span>
                  <span className="shrink-0 text-mute">{fmtDate(e.procesadoAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** Datasets que no vienen del SEACE (migración 23): cuántas filas hay, hasta qué periodo y si la última carga falló. */
function FuentesExternas({ fuentes }: { fuentes: Fuente[] }) {
  const claves = Array.from(new Set([...Object.keys(FUENTES), ...fuentes.map((f) => f.fuente)]));
  return (
    <section className="mb-6 rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink">Fuentes externas</h2>
        <span className="text-[11px] text-mute">se cargan desde la laptop (IP peruana) en el batch nocturno · fuente: <code>datasets_cargas</code></span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase tracking-wide text-mute">
            <tr><th className="py-1 pr-3">Fuente</th><th className="text-right">Filas</th><th className="text-right">Cargas</th><th className="pl-3">Hasta</th><th className="pl-3">Última carga</th><th className="pl-3">Cadencia</th><th className="pl-3">Sirve para</th></tr>
          </thead>
          <tbody>
            {claves.map((k) => {
              const f = fuentes.find((x) => x.fuente === k);
              const meta = FUENTES[k] ?? { nombre: k, cadencia: "—", cruce: "—" };
              const conError = (f?.cargasConError ?? 0) > 0;
              return (
                <tr key={k} className="border-t border-line">
                  <td className="py-1.5 pr-3">
                    <div className="text-ink">{meta.nombre}</div>
                    <div className="font-mono text-[10px] text-mute">{k}{f?.tabla ? ` → ${f.tabla}` : ""}</div>
                  </td>
                  <td className="text-right font-mono text-xs">{f ? f.filas.toLocaleString("es-PE") : <span className="text-mute">sin cargas</span>}</td>
                  <td className="text-right font-mono text-xs">{f ? <>{f.cargas}{conError && <span className="text-rust" title={f.ultimoError ?? ""}> · {f.cargasConError} con error</span>}</> : "—"}</td>
                  <td className="pl-3 font-mono text-xs">{f?.ultimaClave ?? "—"}</td>
                  <td className="pl-3 text-xs text-mute">{f?.ultimaCarga ? fmtDate(f.ultimaCarga) : "—"}</td>
                  <td className="pl-3 text-xs text-mute">{meta.cadencia}</td>
                  <td className="pl-3 text-xs text-mute">{meta.cruce}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
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
