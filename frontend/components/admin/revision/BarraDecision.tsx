"use client";

/**
 * La decisión y los datos de la alerta (rediseño 2026-10-30), en piezas que la ficha acomoda según el ancho:
 *  · `EstadoAlerta`: en qué quedó (en revisión, publicada, descartada), el ⓘ con qué pasa al decidir y, si ya se
 *    decidió, quién, cuándo y por qué. En escritorio va dentro de `PanelDecision`; en el celular, sobre las pestañas.
 *  · `PanelDecision`: el estado y las dos decisiones, en la columna angosta y pegado arriba (sticky) en escritorio, para
 *    decidir sin volver arriba. En el celular los botones van en `BarraDecisionMovil`.
 *  · `BarraDecisionMovil`: Publicar y Descartar siempre a mano en el celular, pegados al pie de la pantalla.
 *  · `ContratoDeAlerta`: los datos del contrato y del análisis (fecha, aporte, puntaje) en filas de ícono, rótulo y valor.
 * Lo que antes eran párrafos abiertos («Mientras no decidas…», «Analizado el … con el aporte …») va al ⓘ o a esas filas.
 */

import { AlertTriangle, Banknote, Building2, CalendarClock, CheckCircle2, HandCoins, MapPin, Package, XCircle } from "lucide-react";
import { Badge, claseBoton, type Tone } from "@/components/admin/ui";
import { Ayuda } from "@/components/patrones/Ayuda";
import { redactDnis } from "@/components/Redact";
import { fmtDate, fmtPEN, PERFIL_LABEL, type RevisionDetalle } from "@/lib/admin";
import { tipoLabel } from "@/lib/contratos";
import { cn } from "@/lib/utils";

/** Mismos tonos que la cola de revisión (estadoAlerta del kit): en revisión = pending, publicada = ok. */
export const ESTADO_ALERTA: Record<string, { label: string; tono: Tone; caja: string }> = {
  revision: { label: "En revisión, sin publicar", tono: "pending", caja: "border-clay/40 bg-paper" },
  activa: { label: "Publicada", tono: "ok", caja: "border-moss/40 bg-paper" },
  confirmada: { label: "Publicada", tono: "ok", caja: "border-moss/40 bg-paper" },
  descartada: { label: "Descartada", tono: "danger", caja: "border-line bg-paper" },
};

const estadoUi = (estado: string) => ESTADO_ALERTA[estado] ?? { label: estado, tono: "muted" as Tone, caja: "border-line bg-paper" };

type Decidir = (estado: "activa" | "descartada") => void;

export function EstadoAlerta({ d, className }: { d: RevisionDetalle; className?: string }) {
  const ui = estadoUi(d.estado);
  const mod = d.moderacion;
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tono={ui.tono}>{ui.label}</Badge>
        {d.estado === "revision" && (
          <Ayuda titulo="¿Qué pasa al decidir?">
            Mientras no decidas, no aparece en listas públicas, mapa ni ranking. Si la publicas, aparece ahí y cuenta como señal
            hallada; si la descartas, queda fuera y el contrato sigue como procesado. Te pediremos el motivo: queda en la
            bitácora con tu correo.
          </Ayuda>
        )}
      </div>
      {mod && (
        <div className="mt-2 flex items-start gap-1.5 text-meta leading-snug text-ink">
          {mod.accion === "publicar"
            ? <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-moss" aria-hidden />
            : <XCircle size={14} className="mt-0.5 shrink-0 text-rust" aria-hidden />}
          <div className="min-w-0">
            <span className="break-words">
              <strong className="font-semibold">{mod.actor}</strong> la {mod.accion === "publicar" ? "publicó" : "descartó"} el {fmtDate(mod.at)}
            </span>
            {/* Tres renglones como mucho; entero (y tapado) en la bitácora del detalle técnico. Sin `title`: no pasaría
                por Redact. */}
            <span className="mt-0.5 line-clamp-3 break-words text-rotulo text-inkSoft">{redactDnis(mod.motivo)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Publicar y Descartar: los mismos dos botones en el panel de escritorio y en la barra del celular. */
function BotonesDecision({ onDecidir, className }: { onDecidir: Decidir; className?: string }) {
  return (
    <div className={className}>
      <button type="button" onClick={() => onDecidir("activa")} className={claseBoton("exito", "md", "py-2.5")}>
        <CheckCircle2 size={15} aria-hidden /> Publicar
      </button>
      <button type="button" onClick={() => onDecidir("descartada")} className={claseBoton("peligro", "md", "py-2.5 font-semibold")}>
        <XCircle size={15} aria-hidden /> Descartar
      </button>
    </div>
  );
}

export function PanelDecision({ d, onDecidir, className }: { d: RevisionDetalle; onDecidir: Decidir; className?: string }) {
  return (
    <section aria-label="Decisión" className={cn("rounded-2xl border p-3.5", estadoUi(d.estado).caja, className)}>
      <EstadoAlerta d={d} />
      {d.estado === "revision" && <BotonesDecision onDecidir={onDecidir} className="mt-3 grid gap-2" />}
    </section>
  );
}

/**
 * En el celular la decisión queda pegada al pie de la pantalla mientras se lee la ficha. Es `sticky` y no `fixed`: al
 * llegar al final se queda en su lugar, sobre el pie del panel, y nunca tapa «Cerrar sesión». Va como último hijo de un
 * bloque que envuelve toda la ficha (no de la grilla: en una grilla sólo se pegaría dentro de su propia celda).
 */
export function BarraDecisionMovil({ codigo, onDecidir }: { codigo: string; onDecidir: Decidir }) {
  return (
    <section
      aria-label={`Decidir sobre ${codigo}`}
      className="sticky bottom-0 z-barra -mx-4 mt-4 border-t border-line bg-paper/95 px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))] pt-2.5 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden"
    >
      <BotonesDecision onDecidir={onDecidir} className="grid grid-cols-2 gap-2" />
    </section>
  );
}

/** Los datos del contrato y del análisis, en una tarjeta angosta bajo la decisión: se leen sin subir ni bajar. */
export function ContratoDeAlerta({ d }: { d: RevisionDetalle }) {
  const zona = d.zona ?? d.distrito ?? d.provincia ?? d.region;
  return (
    <section aria-label="Datos del contrato y del análisis" className="rounded-2xl border border-line bg-paperSoft p-3.5">
      <h2 className="text-micro font-semibold uppercase tracking-wide text-mute">Del contrato</h2>
      <dl className="mt-1.5 space-y-1.5 text-meta text-ink">
        <Dato icon={<Building2 size={13} />} k="Entidad">{d.entidad ?? d.entidadRuc ?? "sin dato"}</Dato>
        <Dato icon={<MapPin size={13} />} k="Zona">{zona ?? "sin dato"}</Dato>
        <Dato icon={<Banknote size={13} />} k="Monto">{d.montoAdjudicado != null && d.montoAdjudicado > 0 ? fmtPEN(d.montoAdjudicado) : "sin dato"}</Dato>
        {/* El tipo de contratación con su nombre (Consultoría, Convenio, Contratación directa…), como en la
            cola; el perfil sólo si el tipo no se conoce. */}
        <Dato icon={<Package size={13} />} k="Tipo">{tipoLabel(d.tipo) ?? PERFIL_LABEL[d.perfil ?? ""] ?? PERFIL_LABEL[d.tipo] ?? "sin dato"}</Dato>
        {d.etapa && <Dato icon={<Package size={13} />} k="Etapa">{d.etapa.replace(/_/g, " ")}</Dato>}
        {d.proveedorRuc && <Dato icon={<Building2 size={13} />} k="Proveedor">RUC <span className="font-mono">{d.proveedorRuc}</span></Dato>}
      </dl>

      {/* Lo del análisis, separado por un filete (no otra caja): antes iba en una frase bajo el estado. */}
      <h2 className="mt-3 border-t border-line pt-2.5 text-micro font-semibold uppercase tracking-wide text-mute">Del análisis</h2>
      <dl className="mt-1.5 space-y-1.5 text-meta text-ink">
        <Dato icon={<AlertTriangle size={13} />} k="Alerta"><span className="font-mono">{d.codigo}</span>{d.score != null ? `, puntaje ${d.score}` : ""}</Dato>
        <Dato icon={<CalendarClock size={13} />} k="Analizado">{fmtDate(d.analizadoEn ?? d.createdAt)}</Dato>
        {d.contribucionCodigo && (
          <Dato icon={<HandCoins size={13} />} k="Aporte">
            <span className="font-mono">{d.contribucionCodigo}</span>
            {d.financiador ? `, ${d.financiador}` : ""}
          </Dato>
        )}
      </dl>
    </section>
  );
}

function Dato({ icon, k, children }: { icon: React.ReactNode; k: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <dt className="flex w-[5.5rem] shrink-0 items-center gap-1.5 text-rotulo text-mute">
        {icon}
        {k}
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
