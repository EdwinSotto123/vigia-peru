"use client";

/**
 * Cabecera de la revisión: en qué estado está la alerta, de qué contrato se trata, por qué no se
 * publicó sola (en palabras, con los conteos de la autoevaluación) y las dos decisiones.
 */

import { useMemo } from "react";
import { AlertTriangle, Banknote, Building2, CheckCircle2, MapPin, Package, XCircle } from "lucide-react";
import { Badge, claseBoton, type Tone } from "@/components/admin/ui";
import { redactDnis } from "@/components/Redact";
import { fmtDate, fmtPEN, PERFIL_LABEL, type RevisionDetalle } from "@/lib/admin";
import { tipoLabel } from "@/lib/contratos";
import { cn } from "@/lib/utils";
import { motivosLlanos } from "./motivos";

/** Mismos tonos que la cola de revisión (estadoAlerta del kit): en revisión = pending, publicada = ok. */
export const ESTADO_ALERTA: Record<string, { label: string; tono: Tone; caja: string }> = {
  revision: { label: "En revisión, sin publicar", tono: "pending", caja: "border-clay/40 bg-paper" },
  activa: { label: "Publicada", tono: "ok", caja: "border-moss/40 bg-paper" },
  confirmada: { label: "Publicada", tono: "ok", caja: "border-moss/40 bg-paper" },
  descartada: { label: "Descartada", tono: "danger", caja: "border-line bg-paper" },
};

export function BarraDecision({ d, onDecidir }: { d: RevisionDetalle; onDecidir: (estado: "activa" | "descartada") => void }) {
  const motivos = useMemo(() => motivosLlanos(d), [d]);
  const ui = ESTADO_ALERTA[d.estado] ?? { label: d.estado, tono: "muted" as Tone, caja: "border-line bg-paper" };
  const enRevision = d.estado === "revision";
  const zona = d.zona ?? d.distrito ?? d.provincia ?? d.region;

  return (
    <section aria-label="Decisión" className={cn("rounded-2xl border p-4 sm:p-5", ui.caja)}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tono={ui.tono}>{ui.label}</Badge>
            <span className="font-mono text-xs text-ink">{d.codigo}</span>
            <span className="text-[11px] text-mute">
              Analizado el {fmtDate(d.analizadoEn ?? d.createdAt)}
              {d.contribucionCodigo ? `, con el aporte ${d.contribucionCodigo}${d.financiador ? ` de ${d.financiador}` : ""}` : ""}
            </span>
          </div>
          {d.objeto && <p className="mt-2 line-clamp-2 break-words font-display text-base font-bold leading-snug text-ink">{d.objeto}</p>}
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-[13px] text-ink">
            <Dato icon={<Building2 size={13} />} k="Entidad">{d.entidad ?? d.entidadRuc ?? "sin dato"}</Dato>
            <Dato icon={<MapPin size={13} />} k="Zona">{zona ?? "sin dato"}</Dato>
            <Dato icon={<Banknote size={13} />} k="Monto adjudicado">{d.montoAdjudicado != null && d.montoAdjudicado > 0 ? fmtPEN(d.montoAdjudicado) : "sin dato"}</Dato>
            {/* El tipo de contratación con su nombre (Consultoría, Convenio, Contratación directa…), como en la
                cola; el perfil sólo si el tipo no se conoce. Antes esos tres decían "sin dato". */}
            <Dato icon={<Package size={13} />} k="Tipo">{tipoLabel(d.tipo) ?? PERFIL_LABEL[d.perfil ?? ""] ?? PERFIL_LABEL[d.tipo] ?? "sin dato"}</Dato>
          </dl>

          <h2 className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-mute">
            {enRevision ? "Por qué no se publicó sola" : "Por qué la autoevaluación la había frenado"}
          </h2>
          <ul className="mt-2 space-y-2">
            {motivos.map((m, i) => (
              <li key={`${m.clave}-${i}`} className="flex items-start gap-2">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{m.texto}</p>
                  {m.ayuda && <p className="text-[12px] leading-snug text-mute">{m.ayuda}</p>}
                </div>
              </li>
            ))}
          </ul>

          {d.moderacion && (
            <p className="mt-4 flex items-start gap-1.5 rounded-xl bg-paperSoft px-3 py-2 text-[13px] text-ink">
              {d.moderacion.accion === "publicar"
                ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-moss" aria-hidden />
                : <XCircle size={14} className="mt-0.5 shrink-0 text-rust" aria-hidden />}
              <span className="min-w-0">
                <strong className="font-semibold">{d.moderacion.actor}</strong> la {d.moderacion.accion === "publicar" ? "publicó" : "descartó"} el {fmtDate(d.moderacion.at)}:{" "}
                <span className="text-inkSoft">{redactDnis(d.moderacion.motivo)}</span>
              </span>
            </p>
          )}
        </div>

        {enRevision && (
          <div className="flex shrink-0 flex-col gap-2 lg:w-60">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              <button type="button" onClick={() => onDecidir("activa")} className={claseBoton("exito", "md", "py-2.5")}>
                <CheckCircle2 size={15} aria-hidden /> Publicar
              </button>
              <button type="button" onClick={() => onDecidir("descartada")} className={claseBoton("peligro", "md", "py-2.5 font-semibold")}>
                <XCircle size={15} aria-hidden /> Descartar
              </button>
            </div>
            <p className="text-[11px] leading-snug text-mute">
              Mientras no decidas, no aparece en listas públicas, mapa ni ranking. Revisa el informe de abajo: te pediremos el motivo.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Dato({ icon, k, children }: { icon: React.ReactNode; k: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <dt className="shrink-0 text-mute" title={k}>
        {icon}
        <span className="sr-only">{k}</span>
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
