import Link from "next/link";
import { Building2, CalendarClock, ChevronRight, Layers, MapPin, MessageSquareWarning } from "lucide-react";
import { solesCompacto, numero, fechaCorta } from "@/lib/formato";
import { diasHasta, haceDias, limpiar, nombreRegion, nombreTipo, type Oportunidad } from "@/lib/licitaciones";
import { tituloNatural } from "@/lib/landing";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";

/**
 * Una convocatoria del SEACE como oportunidad: qué se compra (la línea que manda), quién compra y dónde, el
 * procedimiento, el valor referencial (o que no se publicó) y cuándo se convocó; si el OCDS trae el plazo de consultas y
 * observaciones, cuántos días quedan. Toda la tarjeta abre la ficha. Server-safe.
 */
export function TarjetaOportunidad({ o, base, compacta = false }: { o: Oportunidad; base: string; compacta?: boolean }) {
  const consultas = diasHasta(o.consultasHasta);
  const abiertas = consultas != null && consultas >= 0;
  return (
    <Link
      href={rutaEn(base, `/oportunidad/${encodeURIComponent(o.ocid)}`)}
      className="group flex h-full min-w-0 flex-col rounded-2xl border border-line bg-paper p-4 transition-[border-color,box-shadow,transform] duration-rapido hover:-translate-y-0.5 hover:border-granate/50 hover:shadow-[0_14px_40px_-24px_rgb(var(--granate)/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-granate-50 px-2.5 py-0.5 text-rotulo font-semibold text-granate">{nombreTipo(o.tipo)}</span>
        {o.procedimiento && <span className="rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">{o.procedimiento}</span>}
        <span className="ml-auto text-rotulo text-mute">Convocada {haceDias(o.fecha)}</span>
      </div>
      <p className={cn("mt-3 font-display font-semibold leading-snug text-ink group-hover:text-granate", compacta ? "line-clamp-2 text-cuerpo" : "line-clamp-3 text-destacado")}>
        {limpiar(o.objeto) || "Convocatoria sin objeto registrado"}
      </p>
      <ul className="mt-3 space-y-1 text-meta text-inkSoft">
        <li className="flex min-w-0 items-center gap-1.5">
          <Building2 size={14} aria-hidden className="shrink-0 text-mute" />
          <span className="truncate">{o.entidad ? tituloNatural(o.entidad) : "Entidad sin nombre registrado"}</span>
        </li>
        <li className="flex items-center gap-1.5">
          <MapPin size={14} aria-hidden className="shrink-0 text-mute" />
          {nombreRegion(o.region)}
          {o.items > 1 && (
            <>
              <Layers size={14} aria-hidden className="ml-2 shrink-0 text-mute" />
              {numero(o.items)} ítems
            </>
          )}
        </li>
      </ul>
      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <div className="min-w-0">
          {o.valor ? (
            <>
              <p className="text-rotulo text-mute">Valor referencial</p>
              <p className="font-display text-bloque font-bold leading-tight tabular-nums text-ink">{solesCompacto(o.valor)}</p>
            </>
          ) : (
            <p className="text-meta text-mute">Valor referencial no publicado</p>
          )}
          {abiertas && (
            <p className="mt-1 inline-flex items-center gap-1 text-rotulo font-semibold text-amberTexto">
              <MessageSquareWarning size={13} aria-hidden />
              {consultas === 0 ? "Consultas hasta hoy" : `Consultas hasta el ${fechaCorta(o.consultasHasta)} (${consultas === 1 ? "1 día" : `${numero(consultas)} días`})`}
            </p>
          )}
          {!abiertas && !compacta && (
            <p className="mt-1 inline-flex items-center gap-1 text-rotulo text-mute">
              <CalendarClock size={13} aria-hidden /> {fechaCorta(o.fecha)}
            </p>
          )}
        </div>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-meta font-semibold text-granate">
          Ver ficha <ChevronRight size={15} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
