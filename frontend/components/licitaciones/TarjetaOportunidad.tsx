import Link from "next/link";
import { CalendarDays, ChevronRight, Layers } from "lucide-react";
import { Dato } from "@/components/ui/Dato";
import { numero } from "@/lib/formato";
import { haceDias, limpiar, nombreRegion, type Oportunidad } from "@/lib/licitaciones";
import { tituloNatural } from "@/lib/landing";
import { tildesEnTitulo } from "@/lib/tildes";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";
import { BarraValor, ChipNeutro, ChipTipo, IconoTipo, MontoCompacto, PlazoConsultas } from "./Piezas";

/**
 * Una convocatoria del SEACE como oportunidad, en dos formas (2026-11-02):
 *   - TarjetaOportunidad: la tarjeta de la portada (en rejilla).
 *   - FilaOportunidad: la fila de la lista, con el valor referencial y el plazo de consultas en sus columnas, alineados de
 *     una fila a otra para comparar de un vistazo (en el celular, los dos al pie de la fila).
 * Las dos dicen lo mismo: qué se compra (la línea que manda), quién compra y dónde, cuándo se convocó, el valor (o que no
 * se publicó) y cuántos días quedan para las consultas. Todo el bloque abre la ficha. Server-safe.
 */

const enlaceFicha = (base: string, o: Oportunidad) => rutaEn(base, `/oportunidad/${encodeURIComponent(o.ocid)}`);
const objeto = (o: Oportunidad) => limpiar(o.objeto) || "Convocatoria sin objeto registrado";
const entidad = (o: Oportunidad) => (o.entidad ? tituloNatural(o.entidad) : "Entidad sin nombre registrado");

/** El tipo y el procedimiento, en una línea que no se parte: el procedimiento largo se recorta. */
function Chips({ o }: { o: Oportunidad }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ChipTipo tipo={o.tipo} />
      {o.procedimiento && <ChipNeutro>{tildesEnTitulo(o.procedimiento)}</ChipNeutro>}
    </div>
  );
}

function Valor({ valor, max, alinear = "inicio" }: { valor: number | null; max?: number; alinear?: "inicio" | "fin" }) {
  return (
    <span className={cn("flex min-w-0 flex-col gap-1", alinear === "fin" && "lg:items-end lg:text-right")}>
      <span className="text-rotulo text-mute">Valor referencial</span>
      {valor ? (
        <>
          <MontoCompacto valor={valor} className="font-display text-seccion font-bold leading-none tabular-nums text-ink" unidad="text-dato" />
          <BarraValor valor={valor} max={max} className="mt-1 max-w-[9rem]" />
        </>
      ) : (
        <span className="text-meta leading-snug text-inkSoft">No publicado</span>
      )}
    </span>
  );
}

export function TarjetaOportunidad({ o, base, compacta = false, max }: { o: Oportunidad; base: string; compacta?: boolean; max?: number }) {
  return (
    <Link
      href={enlaceFicha(base, o)}
      className="gs-mira group flex h-full min-w-0 flex-col rounded-2xl border border-line bg-paper p-4 transition-[border-color,box-shadow,transform] duration-rapido hover:-translate-y-0.5 hover:border-granate/50 hover:shadow-[0_14px_40px_-24px_rgb(var(--granate)/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate sm:p-5"
    >
      <div className="flex min-w-0 items-center gap-3">
        <IconoTipo tipo={o.tipo} />
        <Chips o={o} />
      </div>
      <p className={cn("mt-3 font-display font-semibold leading-snug text-ink group-hover:text-granate", compacta ? "line-clamp-2 text-cuerpo" : "line-clamp-3 text-destacado")}>{objeto(o)}</p>
      <div className="mt-2.5 flex min-w-0 flex-col gap-1 text-meta text-inkSoft">
        <Dato tipo="entidad" className="block truncate">
          {entidad(o)}
        </Dato>
        <span className="flex flex-wrap gap-x-3 gap-y-1">
          <Dato tipo="lugar">{nombreRegion(o.region)}</Dato>
          <Dato icono={CalendarDays}>Convocada {haceDias(o.fecha)}</Dato>
          {o.items > 1 && <Dato icono={Layers}>{numero(o.items)} ítems</Dato>}
        </span>
      </div>
      <div className="mt-auto pt-4">
        <div className="grid grid-cols-2 items-end gap-3 border-t border-line pt-3.5">
          <Valor valor={o.valor} max={max} />
          <PlazoConsultas hasta={o.consultasHasta} />
        </div>
      </div>
    </Link>
  );
}

/**
 * La fila de la lista (2026-11-22, el usuario: «esto es texto plano»): el tipo en su ícono, el objeto, quién, dónde y
 * cuándo; el valor grande con su barra contra el mayor de la página (`max`) y el plazo de consultas en su pastilla, con un
 * punto que late si vence en dos días. Desde lg, valor y plazo en sus columnas alineadas de fila a fila.
 */
export function FilaOportunidad({ o, base, max }: { o: Oportunidad; base: string; max?: number }) {
  return (
    <Link
      href={enlaceFicha(base, o)}
      className="gs-mira group grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3.5 gap-y-3 px-4 py-4 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:px-5 lg:grid-cols-[2.75rem_minmax(0,1fr)_9.5rem_10.5rem_1rem] lg:items-center lg:gap-x-5"
    >
      <IconoTipo tipo={o.tipo} className="transition-transform duration-rapido group-hover:-translate-y-0.5" />
      <div className="min-w-0">
        <Chips o={o} />
        <p className="mt-2 line-clamp-2 font-display text-destacado font-semibold leading-snug text-ink group-hover:text-granate">{objeto(o)}</p>
        <p className="mt-1.5 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft">
          <Dato tipo="entidad" className="min-w-0 max-w-full truncate">
            {entidad(o)}
          </Dato>
          <Dato tipo="lugar">{nombreRegion(o.region)}</Dato>
          <Dato icono={CalendarDays}>Convocada {haceDias(o.fecha)}</Dato>
          {o.items > 1 && <Dato icono={Layers}>{numero(o.items)} ítems</Dato>}
        </p>
      </div>
      {/* Hasta lg, el valor y el plazo al pie de la fila; desde lg, en sus columnas (alineadas de fila a fila). */}
      <div className="col-span-2 grid grid-cols-2 items-end gap-3 border-t border-line pt-3 sm:grid-cols-[12rem_14rem] lg:contents">
        <Valor valor={o.valor} max={max} alinear="fin" />
        <PlazoConsultas hasta={o.consultasHasta} alinear="fin" />
      </div>
      <ChevronRight size={16} aria-hidden className="hidden text-mute transition-transform duration-rapido group-hover:translate-x-0.5 group-hover:text-granate lg:block" />
    </Link>
  );
}
