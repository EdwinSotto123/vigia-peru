import Link from "next/link";
import { CalendarClock, ChevronRight, Layers, Lock } from "lucide-react";
import { Dato } from "@/components/ui/Dato";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { tituloNatural } from "@/lib/landing";
import { cierreMenor, limpiar, nombreRegion, type Menor } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";
import { ChipTipo } from "./Piezas";

/**
 * Una contratación menor abierta (≤8 UIT) en la lista de Gobserva Licitaciones (2026-11-07): qué se compra, quién y
 * dónde, cuántos ítems y, en su columna, cuándo cierra la cotización (rojo a menos de 6 horas). Sin monto: la entidad no
 * publica uno referencial. Todo el bloque abre la ficha. Server-safe.
 */

export const enlaceMenor = (base: string, m: { id: number }) => rutaEn(base, `/menor/${m.id}`);

/** La región (o las regiones) de los ítems: la primera y cuántas más. */
export function regionesMenor(regiones: string[] | null | undefined): string {
  if (!regiones?.length) return "Lugar en el detalle";
  return regiones.length === 1 ? nombreRegion(regiones[0]) : `${nombreRegion(regiones[0])} y ${numero(regiones.length - 1)} más`;
}

export function CierreMenor({ cierra, alinear = "inicio", className }: { cierra: string | null; alinear?: "inicio" | "fin"; className?: string }) {
  const c = cierreMenor(cierra);
  return (
    <span className={cn("flex min-w-0 flex-col items-start gap-1", alinear === "fin" && "lg:items-end lg:text-right", className)}>
      <span className="text-rotulo text-mute">Cotización</span>
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-rotulo font-semibold",
          c.cerrada ? "bg-paperDeep text-mute" : c.urgente ? "bg-crimson-soft text-crimsonTexto" : "bg-paperDeep text-inkSoft",
        )}
      >
        <CalendarClock size={12} aria-hidden />
        {c.texto}
      </span>
    </span>
  );
}

export function FilaMenor({ m, base }: { m: Menor; base: string }) {
  const cerrada = !!m.invitacion && !/abierta/i.test(m.invitacion);
  return (
    <Link
      href={enlaceMenor(base, m)}
      className="group grid min-w-0 gap-x-6 gap-y-3 px-4 py-4 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:px-5 lg:grid-cols-[minmax(0,1fr)_13rem_1rem] lg:items-center"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <ChipTipo tipo={m.tipo} />
          {cerrada && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-soft px-2.5 py-0.5 text-rotulo font-semibold text-amberTexto">
              <Lock size={11} aria-hidden /> Invitación cerrada
            </span>
          )}
          <span className="min-w-0 truncate font-mono text-rotulo text-mute">{m.codigo}</span>
        </div>
        <p className="mt-2 line-clamp-2 font-display text-destacado font-semibold leading-snug text-ink group-hover:text-granate">
          {limpiar(m.descripcion) || "Contratación sin descripción registrada"}
        </p>
        <p className="mt-1.5 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft">
          <Dato tipo="entidad" className="min-w-0 max-w-full truncate">
            {m.entidad ? tituloNatural(m.entidad) : "Entidad sin nombre registrado"}
          </Dato>
          <Dato tipo="lugar">{regionesMenor(m.regiones)}</Dato>
          {m.items > 0 && <Dato icono={Layers}>{m.items === 1 ? "1 ítem" : `${numero(m.items)} ítems`}</Dato>}
        </p>
        {m.rubros && m.rubros.length > 0 && (
          <p className="mt-1 line-clamp-1 text-rotulo text-mute">{m.rubros.map((r) => limpiar(r)).join(", ")}</p>
        )}
      </div>
      <div className="border-t border-line pt-3 lg:border-0 lg:pt-0">
        <CierreMenor cierra={m.cierra} alinear="fin" />
      </div>
      <ChevronRight size={16} aria-hidden className="hidden text-mute transition-transform duration-rapido group-hover:translate-x-0.5 group-hover:text-granate lg:block" />
    </Link>
  );
}
