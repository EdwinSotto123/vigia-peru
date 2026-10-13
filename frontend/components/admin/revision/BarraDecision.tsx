"use client";

/**
 * Cabecera de la revisión, en dos piezas:
 *  · `ResumenAlerta`: de qué contrato se trata y por qué no se publicó sola (en palabras, con los
 *    conteos de la autoevaluación). Va en la columna ancha.
 *  · `PanelDecision`: el estado y las dos decisiones, pegado a un costado (sticky en escritorio) para
 *    decidir sin volver arriba.
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

export function ResumenAlerta({ d }: { d: RevisionDetalle }) {
  const motivos = useMemo(() => motivosLlanos(d), [d]);
  const enRevision = d.estado === "revision";

  return (
    <section aria-label="Resumen de la alerta" className="rounded-2xl border border-line bg-paperSoft p-3.5 sm:p-4">
      {d.objeto && <p className="line-clamp-2 break-words font-display text-base font-bold leading-snug text-ink">{d.objeto}</p>}

      <h2 className={cn("text-[11px] font-semibold uppercase tracking-wide text-mute", d.objeto && "mt-3")}>
        {enRevision ? "Por qué no se publicó sola" : "Por qué la autoevaluación la había frenado"}
      </h2>
      <ul className="mt-1.5 grid gap-x-6 gap-y-1.5 md:grid-cols-2">
        {motivos.map((m, i) => (
          <li key={`${m.clave}-${i}`} className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
            <div className="min-w-0">
              <p className="text-[13px] font-medium leading-snug text-ink">{m.texto}</p>
              {m.ayuda && <p className="text-[12px] leading-snug text-mute">{m.ayuda}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PanelDecision({ d, onDecidir }: { d: RevisionDetalle; onDecidir: (estado: "activa" | "descartada") => void }) {
  const ui = ESTADO_ALERTA[d.estado] ?? { label: d.estado, tono: "muted" as Tone, caja: "border-line bg-paper" };
  const enRevision = d.estado === "revision";

  return (
    <section aria-label="Decisión" className={cn("rounded-2xl border p-3.5", ui.caja)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge tono={ui.tono}>{ui.label}</Badge>
        <span className="font-mono text-xs text-ink">{d.codigo}</span>
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-mute">
        Analizado el {fmtDate(d.analizadoEn ?? d.createdAt)}
        {d.contribucionCodigo ? `, con el aporte ${d.contribucionCodigo}${d.financiador ? ` de ${d.financiador}` : ""}` : ""}
      </p>

      {enRevision && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
            <button type="button" onClick={() => onDecidir("activa")} className={claseBoton("exito", "md", "py-2.5")}>
              <CheckCircle2 size={15} aria-hidden /> Publicar
            </button>
            <button type="button" onClick={() => onDecidir("descartada")} className={claseBoton("peligro", "md", "py-2.5 font-semibold")}>
              <XCircle size={15} aria-hidden /> Descartar
            </button>
          </div>
          <p className="mt-2 text-[11.5px] leading-snug text-mute">
            Mientras no decidas, no aparece en listas públicas, mapa ni ranking. Te pediremos el motivo.
          </p>
        </>
      )}

      {d.moderacion && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-paperSoft px-3 py-2 text-[13px] text-ink">
          {d.moderacion.accion === "publicar"
            ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-moss" aria-hidden />
            : <XCircle size={14} className="mt-0.5 shrink-0 text-rust" aria-hidden />}
          <span className="min-w-0">
            <strong className="font-semibold">{d.moderacion.actor}</strong> la {d.moderacion.accion === "publicar" ? "publicó" : "descartó"} el {fmtDate(d.moderacion.at)}:{" "}
            <span className="text-inkSoft">{redactDnis(d.moderacion.motivo)}</span>
          </span>
        </p>
      )}
    </section>
  );
}

/** Los datos del contrato, en una tarjeta angosta bajo la decisión: se leen sin subir ni bajar. */
export function ContratoDeAlerta({ d }: { d: RevisionDetalle }) {
  const zona = d.zona ?? d.distrito ?? d.provincia ?? d.region;
  return (
    <section aria-label="Datos del contrato" className="rounded-2xl border border-line bg-paperSoft p-3.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-mute">Del contrato</h2>
      <dl className="mt-1.5 space-y-1.5 text-[13px] text-ink">
        <Dato icon={<Building2 size={13} />} k="Entidad">{d.entidad ?? d.entidadRuc ?? "sin dato"}</Dato>
        <Dato icon={<MapPin size={13} />} k="Zona">{zona ?? "sin dato"}</Dato>
        <Dato icon={<Banknote size={13} />} k="Monto">{d.montoAdjudicado != null && d.montoAdjudicado > 0 ? fmtPEN(d.montoAdjudicado) : "sin dato"}</Dato>
        {/* El tipo de contratación con su nombre (Consultoría, Convenio, Contratación directa…), como en la
            cola; el perfil sólo si el tipo no se conoce. */}
        <Dato icon={<Package size={13} />} k="Tipo">{tipoLabel(d.tipo) ?? PERFIL_LABEL[d.perfil ?? ""] ?? PERFIL_LABEL[d.tipo] ?? "sin dato"}</Dato>
        {d.etapa && <Dato icon={<Package size={13} />} k="Etapa">{d.etapa.replace(/_/g, " ")}</Dato>}
        {d.proveedorRuc && <Dato icon={<Building2 size={13} />} k="Proveedor">RUC <span className="font-mono">{d.proveedorRuc}</span></Dato>}
        <Dato icon={<Package size={13} />} k="Alerta"><span className="font-mono">{d.codigo}</span>{d.score != null ? `, puntaje ${d.score}` : ""}</Dato>
      </dl>
    </section>
  );
}

function Dato({ icon, k, children }: { icon: React.ReactNode; k: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="flex w-[5.5rem] shrink-0 items-center gap-1.5 text-[12px] text-mute">
        {icon}
        {k}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
