/**
 * Tarjeta de resultados de un análisis terminado: score (gauge), señales de riesgo con
 * severidad, norma y evidencia, mercado (mediana vs ofertado), documentos leídos,
 * recortes/validaciones pendientes y UN botón al dictamen completo.
 *
 * Sin hooks: sirve en server components (/app/contratos/[ocid]) y dentro de
 * ContratoEnVivo (client). `revision` (la autoevaluación bloqueó la publicación) → aviso,
 * sin publicar señales.
 */

import Link from "next/link";
import { AlertTriangle, ArrowRight, BadgeCheck, CheckCircle2, Eye, FileText, Scale, Scissors } from "lucide-react";
import { duracion, reglaLabel, severidadCls, type ResultadoAnalisis as Resultado } from "@/lib/auditoria";
import { validacionLabel } from "@/lib/contratos";
import { CompartirButton } from "./CompartirButton";
import { ScoreGauge } from "./ScoreGauge";

interface Props {
  resultado: Resultado | null;
  ocid: string;
  /** Respaldo cuando `resultado` aún no llegó (score/banderas de la vista). */
  score?: number | null;
  banderas?: number;
  duracionMs?: number | null;
  /** Ruta que se comparte (por defecto /app/auditoria/[ocid]). */
  sharePath?: string;
  compacto?: boolean;
  className?: string;
}

const pct = (n: number | null | undefined) => (n == null ? null : `${n > 0 ? "+" : ""}${Math.round(n)} %`);
/** Precios unitarios con decimales; totales redondeados. */
const soles = (n: number) => `S/ ${n.toLocaleString("es-PE", { maximumFractionDigits: n < 1000 ? 2 : 0 })}`;

export function ResultadoAnalisis({ resultado: r, ocid, score, banderas, duracionMs, sharePath, compacto = false, className = "" }: Props) {
  const dossierId = r?.codigo?.replace(/^OECE-/, "") ?? ocid;
  const dossierHref = `/app/convocatoria/${encodeURIComponent(dossierId)}`;
  const enRevision = r?.estado === "revision";
  const senales = r?.banderas ?? [];
  const n = r ? senales.length : (banderas ?? 0);
  const porSev = { alta: 0, media: 0, baja: 0 };
  for (const s of senales) porSev[s.severidad] += 1;
  const conSenales = n > 0;
  const mercadoItems = (r?.mercado?.items ?? []).filter((it) => it.mediana != null && it.ofertado != null);
  const mercado = r?.mercado && (r.mercado.nConMediana ?? 0) > 0 ? r.mercado : null;
  const titulo = enRevision ? "En revisión humana" : conSenales ? `${n} ${n === 1 ? "señal de riesgo" : "señales de riesgo"}` : "Sin señales de riesgo";

  return (
    <section className={`rounded-2xl border bg-paper ${enRevision ? "border-clay/40" : conSenales ? "border-rust/30" : "border-moss/30"} ${compacto ? "p-4" : "p-5"} ${className}`} aria-label="Resultado del análisis">
      {/* score + resumen */}
      <div className={`flex ${compacto ? "flex-col items-start gap-3" : "flex-wrap items-center gap-4"}`}>
        <ScoreGauge score={r?.score ?? score ?? null} size={compacto ? 112 : 132} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-mute">Resultado</div>
          <h2 className={`mt-0.5 inline-flex items-center gap-2 font-serif font-bold leading-tight text-ink ${compacto ? "text-lg" : "text-xl"}`}>
            {enRevision ? <Eye size={18} className="text-clay" aria-hidden /> : conSenales ? <AlertTriangle size={18} className="text-rust" aria-hidden /> : <CheckCircle2 size={18} className="text-moss" aria-hidden />}
            {titulo}
          </h2>
          {!enRevision && conSenales && (
            <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-mute">
              {porSev.alta > 0 && <span className="text-rust">{porSev.alta} alta{porSev.alta === 1 ? "" : "s"}</span>}
              {porSev.media > 0 && <span className="text-amber">{porSev.media} media{porSev.media === 1 ? "" : "s"}</span>}
              {porSev.baja > 0 && <span>{porSev.baja} baja{porSev.baja === 1 ? "" : "s"}</span>}
            </p>
          )}
          <p className="mt-1.5 text-[12px] leading-snug text-mute">
            {enRevision
              ? "La autoevaluación no respaldó lo suficiente el análisis: una persona lo revisa antes de publicarlo."
              : conSenales
                ? "Una señal no es una acusación: es un patrón que cita norma y evidencia oficial y merece revisión."
                : "Ningún patrón de riesgo en lo revisado. El dictamen explica qué se cotejó."}
            {duracionMs != null && duracionMs > 0 && <> Análisis en <span className="font-mono">{duracion(duracionMs)}</span>.</>}
          </p>
        </div>
      </div>

      {enRevision && r?.revisionMotivo && (
        <p className="mt-3 rounded-xl border border-clay/30 bg-paperSoft px-3 py-2 text-[12px] leading-snug text-inkSoft">
          <span className="font-semibold text-clay">Motivo:</span> {r.revisionMotivo}
        </p>
      )}

      {/* señales */}
      {!enRevision && senales.length > 0 && (
        <ol className={`mt-4 divide-y divide-line border-t border-line ${compacto ? "" : ""}`} aria-label="Señales de riesgo">
          {senales.slice(0, compacto ? 4 : 8).map((s, i) => {
            const sev = severidadCls(s.severidad);
            return (
              <li key={`${s.regla}-${i}`} className="py-2.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${sev.dot}`} aria-hidden />
                  <span className="text-[13px] font-semibold text-ink">{reglaLabel(s.regla)}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${sev.text}`}>{sev.label}</span>
                  {s.verificada === true && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-moss" title="Cotejada contra fuentes oficiales (OCDS · SUNAT · documentos)">
                      <BadgeCheck size={11} aria-hidden /> verificada
                    </span>
                  )}
                </div>
                {s.norma && (
                  <p className="mt-0.5 inline-flex items-start gap-1 text-[11px] text-mute">
                    <Scale size={11} className="mt-[2px] shrink-0" aria-hidden /> <span>{s.norma}</span>
                  </p>
                )}
                {s.evidencia && !compacto && (
                  <blockquote className="mt-1 border-l-2 border-line pl-2 text-[12px] leading-snug text-inkSoft">{s.evidencia}</blockquote>
                )}
              </li>
            );
          })}
          {senales.length > (compacto ? 4 : 8) && (
            <li className="py-2 text-[11px] text-mute">y {senales.length - (compacto ? 4 : 8)} más en el dictamen</li>
          )}
        </ol>
      )}

      {/* mercado · documentos · recortes */}
      {!enRevision && (mercado || r?.documentos || (r?.recortes ?? 0) > 0 || (r?.validacionesPendientes?.length ?? 0) > 0) && (
        <dl className={`mt-3 grid gap-2 border-t border-line pt-3 text-[12px] ${compacto ? "" : "sm:grid-cols-2"}`}>
          {mercado && (
            <div className="rounded-xl bg-paperSoft p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-mute">Mercado</dt>
              <dd className="mt-1 space-y-1 text-ink">
                {mercadoItems.slice(0, compacto ? 1 : 3).map((it, i) => (
                  <div key={i} className="leading-snug">
                    <div className="line-clamp-1 text-[11px] text-mute" title={it.item ?? ""}>{it.item ?? "Ítem"}</div>
                    <div className="font-mono text-[12px] tabular-nums">
                      mediana {soles(it.mediana!)} · ofertado {soles(it.ofertado!)}
                      {it.diffPct != null && <span className={`ml-1 font-semibold ${it.diffPct >= 30 ? "text-rust" : it.diffPct >= 10 ? "text-amber" : "text-moss"}`}>Δ {pct(it.diffPct)}</span>}
                    </div>
                  </div>
                ))}
                {mercado.totalMercado != null && mercado.totalOfertado != null && mercadoItems.length !== 1 && (
                  <div className="font-mono text-[11px] tabular-nums text-mute">
                    lote: {soles(mercado.totalMercado)} mercado · {soles(mercado.totalOfertado)} ofertado
                    {mercado.sobreprecioPct != null && <span className={`ml-1 font-semibold ${mercado.sobreprecioPct >= 30 ? "text-rust" : "text-ink"}`}>Δ {pct(mercado.sobreprecioPct)}</span>}
                  </div>
                )}
                {(mercado.nItems ?? 0) > mercadoItems.length && <div className="text-[11px] text-mute">{mercado.nConMediana} de {mercado.nItems} ítems con mediana de mercado</div>}
              </dd>
            </div>
          )}
          {(r?.documentos || (r?.recortes ?? 0) > 0 || (r?.validacionesPendientes?.length ?? 0) > 0) && (
            <div className="rounded-xl bg-paperSoft p-3">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-mute">Expediente</dt>
              <dd className="mt-1 space-y-1 text-ink">
                {r?.documentos && (
                  <div className="inline-flex items-center gap-1.5" title={r.documentos.titulos.join(" · ")}>
                    <FileText size={12} className="text-mute" aria-hidden />
                    <span className="font-mono tabular-nums">{r.documentos.n}</span> documento{r.documentos.n === 1 ? "" : "s"} leído{r.documentos.n === 1 ? "" : "s"}
                    {r.documentos.paginas > 0 && <> · <span className="font-mono tabular-nums">{r.documentos.paginas}</span> páginas</>}
                    {r.documentos.conError > 0 && <span className="text-amber"> · {r.documentos.conError} con error</span>}
                  </div>
                )}
                {(r?.recortes ?? 0) > 0 && (
                  <div className="inline-flex items-center gap-1.5 text-mute" title="Topes aplicados por el pipeline (documentos o ítems fuera del análisis); el dictamen los lista tal cual.">
                    <Scissors size={12} aria-hidden /> {r!.recortes} recorte{r!.recortes === 1 ? "" : "s"} declarado{r!.recortes === 1 ? "" : "s"}
                  </div>
                )}
                {(r?.validacionesPendientes?.length ?? 0) > 0 && (
                  <ul className="text-[11px] text-clay">
                    {r!.validacionesPendientes.map((v) => <li key={v}>· pendiente: {validacionLabel(v)}</li>)}
                  </ul>
                )}
              </dd>
            </div>
          )}
        </dl>
      )}

      {/* acciones: un botón por destino */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {!enRevision && (
          <Link href={dossierHref} className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper shadow-card transition-transform hover:scale-[1.01]">
            Leer el dictamen completo <ArrowRight size={15} aria-hidden />
          </Link>
        )}
        <CompartirButton titulo={`Análisis ${r?.codigo ?? ocid} — Vigía Perú`} texto={titulo} path={sharePath ?? `/app/auditoria/${encodeURIComponent(ocid)}`} className="rounded-full" />
      </div>
      {!enRevision && r && !r.dictamenListo && <p className="mt-2 text-[11px] text-mute">El dictamen se está publicando; si el enlace no muestra nada todavía, vuelve en un minuto.</p>}
    </section>
  );
}
