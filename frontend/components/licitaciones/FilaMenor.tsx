import Link from "next/link";
import { CalendarClock, ChevronRight, Layers, Lock } from "lucide-react";
import { Dato } from "@/components/ui/Dato";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { tituloNatural } from "@/lib/landing";
import { cierreMenor, limpiar, nombreRegion, type Menor } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";
import { ChipTipo, IconoTipo, PuntoVivo } from "./Piezas";

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

export function CierreMenor({ cierra, alinear = "inicio", sinRotulo = false, className }: { cierra: string | null; alinear?: "inicio" | "fin"; sinRotulo?: boolean; className?: string }) {
  const c = cierreMenor(cierra);
  // El tono dice cuánto falta: en horas, rojo con el punto que late; hoy, ámbar con el punto; mañana, ámbar; después, neutro.
  const hoy = !c.cerrada && !c.urgente && /^Cierra hoy/.test(c.texto);
  const manana = !c.cerrada && /^Cierra mañana/.test(c.texto);
  return (
    <span className={cn("flex min-w-0 flex-col items-start gap-1", alinear === "fin" && "lg:items-end lg:text-right", className)}>
      {!sinRotulo && <span className="text-rotulo text-mute">Cotización</span>}
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-rotulo font-semibold",
          c.cerrada
            ? "bg-paperDeep text-mute"
            : c.urgente
              ? "bg-crimson-soft text-crimsonTexto"
              : hoy || manana
                ? "bg-amber-soft text-amberTexto"
                : "bg-paperDeep text-inkSoft",
        )}
      >
        {c.urgente || hoy ? <PuntoVivo /> : <CalendarClock size={12} aria-hidden />}
        {c.texto}
      </span>
    </span>
  );
}

/**
 * La fila de una contratación menor (2026-11-22, el usuario: «esto es texto plano»): el tipo en su ícono, el código, qué
 * se compra, quién, dónde y cuántos ítems, los rubros en pastillas y el cierre en su pastilla con tono (y un punto que
 * late si cierra hoy o en horas). Más corta que antes: el cierre va bajo el texto, sin su rótulo ni su filete.
 */
export function FilaMenor({ m, base }: { m: Menor; base: string }) {
  const cerrada = !!m.invitacion && !/abierta/i.test(m.invitacion);
  const rubros = (m.rubros ?? []).map((r) => limpiar(r)).filter(Boolean);
  return (
    <Link
      href={enlaceMenor(base, m)}
      className="gs-mira group grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3.5 gap-y-2.5 px-4 py-4 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:px-5 lg:grid-cols-[2.75rem_minmax(0,1fr)_13rem_1rem] lg:items-center lg:gap-x-5"
    >
      <IconoTipo tipo={m.tipo} className="transition-transform duration-rapido group-hover:-translate-y-0.5" />
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
        {rubros.length > 0 && (
          <ul aria-label="Rubros" className="mt-2 flex min-w-0 flex-wrap gap-1.5 overflow-hidden [max-height:1.75rem]">
            {/* recorte: los dos primeros rubros; el resto, en la ficha */}
            {rubros.slice(0, 2).map((r) => (
              <li key={r} className="min-w-0 max-w-full truncate rounded-md bg-paperDeep px-2 py-0.5 text-rotulo text-inkSoft">
                {r}
              </li>
            ))}
            {rubros.length > 2 && <li className="rounded-md px-1 py-0.5 text-rotulo text-mute">+{numero(rubros.length - 2)}</li>}
          </ul>
        )}
      </div>
      <div className="col-start-2 lg:col-start-auto">
        <CierreMenor cierra={m.cierra} alinear="fin" sinRotulo />
      </div>
      <ChevronRight size={16} aria-hidden className="hidden text-mute transition-transform duration-rapido group-hover:translate-x-0.5 group-hover:text-granate lg:block" />
    </Link>
  );
}
