"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronRight, CircleDashed, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { severidadColor } from "@/lib/formato";
import { reglaLabel } from "@/lib/auditoria";
import { PersonName, Ruc, esPersonaNatural, redactDnis } from "../../Redact";
import type { EstadoCorrida, NivelDossier } from "../dossier";
import { evidenciaComoTexto } from "./Evidencia";

const ORDEN: Record<string, number> = { alta: 0, media: 1, baja: 2 };

export function ResumenHumano({
  conv,
  ganador,
  nGanadores = ganador ? 1 : 0,
  nAlta,
  nMedia,
  nBaja,
  banderasArr,
  fmtMoney,
  nivel,
  corrida,
  onVerEvidencia,
}: {
  conv: any;
  ganador: any;
  /** Cuántos postores ganaron algo (lotes/ítems adjudicados a distintos proveedores). */
  nGanadores?: number;
  nAlta: number;
  nMedia: number;
  nBaja: number;
  /** Señales que se pueden sostener (sin las de sobreprecio que el mercado no midió). */
  banderasArr: any[];
  fmtMoney: (n: any) => string;
  nivel: NivelDossier;
  corrida: EstadoCorrida;
  onVerEvidencia: () => void;
}) {
  // Montos: referencial (lo que el Estado presupuestó) contra adjudicado (lo que se pagará).
  // El referencial sale del OCDS (tender.value); si no vino, se dice, no se reemplaza.
  const referencial = Number(conv.cuantia_total) > 0 ? Number(conv.cuantia_total) : null;
  const adjudicado =
    Number(conv.monto_adjudicado) > 0 ? Number(conv.monto_adjudicado) : Number(ganador?.monto_ganado) > 0 ? Number(ganador.monto_ganado) : null;
  const variacion = adjudicado !== null && referencial !== null ? ((adjudicado - referencial) / referencial) * 100 : null;

  const top = [...banderasArr]
    .sort((a, b) => (ORDEN[(a.severidad || "media").toLowerCase()] ?? 1) - (ORDEN[(b.severidad || "media").toLowerCase()] ?? 1))
    .slice(0, 2);

  const natural = esPersonaNatural(ganador?.ruc);
  const Icono = nivel.nivel === "limpio" ? CheckCircle2 : nivel.nivel === "incompleto" ? CircleDashed : AlertTriangle;

  return (
    <section className={cn("surface overflow-hidden border-2 p-0", nivel.ui.borde)}>
      {/* CABECERA: nivel del dossier (misma escala que la barra lateral) + conteo de señales */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-paperDeep px-4 py-2">
        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-bold", nivel.ui.fondo, nivel.ui.texto, nivel.ui.borde)}>
          <Icono size={12} aria-hidden />
          {nivel.etiqueta}
        </span>
        {nAlta > 0 && (
          <span className={cn("rounded-full border px-1.5 py-0 text-[11px] font-semibold", severidadColor("alta"))}>
            {nAlta} {nAlta === 1 ? "señal alta" : "señales altas"}
          </span>
        )}
        {nMedia > 0 && (
          <span className={cn("rounded-full border px-1.5 py-0 text-[11px] font-semibold", severidadColor("media"))}>
            {nMedia} {nMedia === 1 ? "media" : "medias"}
          </span>
        )}
        {nBaja > 0 && (
          <span className={cn("rounded-full border px-1.5 py-0 text-[11px] font-semibold", severidadColor("baja"))}>
            {nBaja} {nBaja === 1 ? "baja" : "bajas"}
          </span>
        )}
        {banderasArr.length > 0 && (
          <button
            type="button"
            onClick={onVerEvidencia}
            className="ml-auto inline-flex items-center gap-1 rounded text-[12px] font-semibold text-heroViolet hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50"
          >
            Ver evidencia <ChevronRight size={12} aria-hidden />
          </button>
        )}
      </div>

      {/* Un análisis que no terminó no se presenta como limpio: se dice qué corrió. */}
      {!corrida.completa && (
        <div className="border-b border-line bg-paperSoft px-4 py-2.5 text-[12px] leading-relaxed text-inkSoft">
          <strong className="font-semibold text-ink">Este análisis no terminó completo.</strong>{" "}
          {corrida.hayTraza ? (
            corrida.nombres.length > 0 ? (
              <>
                Corrieron {corrida.nombres.length} de {corrida.total} agentes ({corrida.nombres.join(", ")}).{" "}
              </>
            ) : (
              <>La traza no registra ningún agente del pipeline. </>
            )
          ) : (
            <>No quedó registro de qué agentes corrieron. </>
          )}
          {corrida.faltan.length > 0 && <>Faltó {corrida.faltan.join(" y ")}. </>}
          {banderasArr.length === 0
            ? "Que no haya señales aquí no significa que el contrato esté limpio."
            : "Las señales que sí se registraron se muestran abajo."}
        </div>
      )}

      {/* MONTOS */}
      <div className="grid grid-cols-2 divide-x divide-line border-b border-line">
        <div className="p-3" title="Valor referencial publicado por la entidad en el registro OCDS (lo que planeaba gastar).">
          <div className="text-[11px] font-medium text-mute">Presupuesto del Estado</div>
          <div className="mt-0.5 font-mono text-lg font-bold tabular-nums leading-tight text-ink">
            {referencial !== null ? fmtMoney(referencial) : <span className="font-sans text-sm font-normal italic text-mute">no publicado</span>}
          </div>
          <div className="mt-0.5 text-[11px] text-mute">valor referencial</div>
        </div>
        <div className="p-3" title="Lo que se adjudicó al ganador, según el registro OCDS.">
          <div className="text-[11px] font-medium text-mute">Monto adjudicado</div>
          {adjudicado !== null ? (
            <>
              <div
                className={cn(
                  "mt-0.5 font-mono text-lg font-bold tabular-nums leading-tight",
                  variacion !== null && variacion > 0.1 ? "text-crimsonTexto" : "text-ink",
                )}
              >
                {fmtMoney(adjudicado)}
              </div>
              <div className="mt-0.5 text-[11px] text-mute">
                {variacion === null ? (
                  "sin presupuesto con qué compararlo"
                ) : Math.abs(variacion) < 0.1 ? (
                  "igual al presupuesto"
                ) : (
                  <span className={cn("font-semibold", variacion > 0 ? "text-crimsonTexto" : "text-mossTexto")}>
                    {variacion > 0 ? "+" : "−"}
                    {Math.abs(variacion).toFixed(1)} %{" "}
                    <span className="font-normal text-mute">{variacion > 0 ? "sobre el presupuesto" : "bajo el presupuesto"}</span>
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="mt-0.5 text-sm italic text-mute">pendiente de adjudicación</div>
          )}
        </div>
      </div>

      {/* QUIÉN */}
      <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        <div className="p-3" title="Entidad pública que convoca y pagará el contrato.">
          <div className="text-[11px] font-medium text-mute">Entidad que contrata</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-ink">
            {conv.entidad && conv.buyer_ruc ? (
              <Link
                href={`/entidad/${encodeURIComponent(conv.buyer_ruc)}`}
                className="underline decoration-line underline-offset-2 hover:decoration-heroViolet"
                title="Ver el perfil de la entidad"
              >
                {conv.entidad}
              </Link>
            ) : (
              conv.entidad || "—"
            )}
          </div>
          {conv.region && (
            <div className="mt-0.5 flex items-center gap-1 text-[11px] text-mute">
              <MapPin size={9} aria-hidden /> {conv.region}
            </div>
          )}
        </div>
        <div className="p-3" title="Quien ganó la buena pro y ejecutará el contrato.">
          <div className="text-[11px] font-medium text-mute">{natural ? "Ganador (persona natural)" : "Empresa ganadora"}</div>
          <div className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-ink">
            {ganador?.nombre ? (
              natural ? <PersonName name={ganador.nombre} orden="sunat" /> : ganador.nombre
            ) : (
              <span className="italic text-mute">Sin adjudicación</span>
            )}
          </div>
          {ganador?.ruc && (
            <div className="mt-0.5 font-mono text-[11px] text-heroViolet">
              RUC <Ruc value={ganador.ruc} />
            </div>
          )}
          {nGanadores > 1 && <div className="mt-0.5 text-[11px] text-mute">y {nGanadores - 1} ganador(es) más en otros ítems</div>}
        </div>
      </div>

      {/* TOP HALLAZGOS */}
      {top.length > 0 && (
        <div className="border-t border-line bg-paperSoft px-4 py-2.5">
          <div className="mb-1 text-[11px] font-medium text-mute">Hallazgos prioritarios</div>
          <ul className="space-y-1">
            {top.map((b, i) => {
              const s = (b.severidad || "").toLowerCase();
              const texto = evidenciaComoTexto(b.evidencia) || reglaLabel(String(b.regla || "Señal"));
              return (
                <li key={`${b.regla ?? "senal"}-${i}`} className="flex items-start gap-2 text-[12px] leading-snug text-ink">
                  <span
                    aria-hidden
                    className={cn(
                      "mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                      s === "alta" ? "bg-rust" : s === "media" ? "bg-amber" : "bg-mute",
                    )}
                  />
                  <span className="sr-only">Severidad {s || "media"}: </span>
                  <span className="line-clamp-2">{redactDnis(texto)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
