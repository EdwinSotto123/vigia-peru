import type { ReactNode } from "react";
import { ArrowUpRight, BadgeCheck, CircleAlert, CircleDashed, ExternalLink, FileText, Gavel, MessageSquareWarning, ShieldAlert, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Insignia, type Tono } from "@/components/gobserva/ui/Insignia";
import {
  CLASES_DE_HECHO, ESTADOS_CHEQUEO, SECTORES, fechaCorta, type EstadoChequeo, type Sector, type TipoHecho,
} from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

/**
 * Las piezas comunes de Gobserva Salud. Server-safe. Toda insignia lleva texto (el color nunca va solo) y cada clase de
 * hecho tiene SIEMPRE el mismo rótulo, ícono y tono en toda la web: una sanción firme no se parece a una denuncia.
 */

const HECHO: Record<TipoHecho | "reclamo", { tono: Tono; Icono: LucideIcon }> = {
  sancion_firme: { tono: "urgente", Icono: Gavel },
  denuncia: { tono: "aviso", Icono: MessageSquareWarning },
  reclamo: { tono: "neutro", Icono: MessageSquareWarning },
  registro_administrativo: { tono: "neutro", Icono: FileText },
  verificacion_externa: { tono: "acento", Icono: ExternalLink },
};

/** «Sanción firme», «Denuncia», «Registro administrativo»…, con su explicación al pasar el cursor. */
export function InsigniaHecho({ tipo, className }: { tipo: TipoHecho | "reclamo"; className?: string }) {
  const h = HECHO[tipo];
  const c = CLASES_DE_HECHO[tipo];
  return (
    <Insignia tono={h.tono} Icono={h.Icono} title={c.explica} className={className}>
      {c.rotulo}
    </Insignia>
  );
}

const ESTADO: Record<EstadoChequeo, { tono: Tono; Icono: LucideIcon }> = {
  ok: { tono: "exito", Icono: ShieldCheck },
  atencion: { tono: "aviso", Icono: CircleAlert },
  alerta: { tono: "urgente", Icono: ShieldAlert },
  sin_dato: { tono: "neutro", Icono: CircleDashed },
  externo: { tono: "acento", Icono: BadgeCheck },
};

export const iconoEstado = (e: EstadoChequeo) => ESTADO[e].Icono;
export const tonoEstado = (e: EstadoChequeo) => ESTADO[e].tono;

/** El estado de un chequeo: «Conforme», «Revisa», «Alerta», «Sin dato», «Verifica fuera». */
export function InsigniaEstado({ estado, className }: { estado: EstadoChequeo; className?: string }) {
  const e = ESTADO[estado];
  return (
    <Insignia tono={e.tono} Icono={e.Icono} className={className}>
      {ESTADOS_CHEQUEO[estado].rotulo}
    </Insignia>
  );
}

export function InsigniaSector({ sector }: { sector: Sector }) {
  return <Insignia>{SECTORES[sector] ?? sector}</Insignia>;
}

/** La categoría (I-1 … III-2) en su placa; «Sin categoría» si RENIPRESS no la trae. */
export function InsigniaCategoria({ categoria, className }: { categoria: string | null; className?: string }) {
  return (
    <Insignia tono={categoria ? "acento" : "neutro"} className={cn("font-mono", className)} title={categoria ? `Categoría ${categoria} (NTS N.° 021-MINSA/DGSP-V.03)` : "RENIPRESS no registra una categoría"}>
      {categoria ?? "Sin categoría"}
    </Insignia>
  );
}

/**
 * La fuente de un dato con su fecha: «RENIPRESS (SUSALUD), al 19 nov. 2026». Enlaza a la fuente oficial en otra pestaña.
 * `al` puede ser una fecha (AAAA-MM-DD), un mes (AAAA-MM) o un año.
 */
export function FuenteFecha({ nombre, url, al, className, children }: { nombre: string; url: string | null; al?: string | number | null; className?: string; children?: ReactNode }) {
  const cuando = al == null ? null : typeof al === "number" ? String(al) : /^\d{4}$/.test(al) ? al : fechaCorta(al);
  const contenido = (
    <>
      <span>{children ?? nombre}</span>
      {cuando && <span className="text-mute">, al {cuando}</span>}
    </>
  );
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-1 text-rotulo text-inkSoft", className)}>
      <span className="font-semibold text-mute">Fuente:</span>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink hover:decoration-ink">
          {contenido}
          <ArrowUpRight size={12} aria-hidden className="ml-0.5 inline align-baseline" />
          <span className="sr-only"> (fuente oficial, se abre en otra pestaña)</span>
        </a>
      ) : (
        contenido
      )}
    </span>
  );
}
