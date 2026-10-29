import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ICONO_NIVEL } from "@/components/ui/Severidad";
import { IconoBandera } from "@/components/ui/IconoBandera";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

/** Una bandera de la ficha: su nombre entero, cuántos casos la sostienen y dónde está la evidencia. */
export interface BanderaFicha {
  tipo: string;
  severidad: "alta" | "media" | "baja";
  /** El nombre, entero («Posible nepotismo»): nunca recortado. */
  nombre: string;
  /** Cuántos casos la sostienen (parientes, contratos, informes), si se cuentan. */
  n?: number | null;
  /** Lo que se encontró, en una oración: va al `title` y al lector de pantalla. */
  explica?: string;
  /** La evidencia: la pestaña de la ficha con su filtro. Sin ella, la bandera no es enlace. */
  href?: string | null;
}

// Los tres canales de la severidad (color, forma y palabra), como `Severidad`; la palabra, para el lector de pantalla.
const ESTILO = {
  alta: { clase: "border-crimson/30 bg-crimson-soft text-crimsonTexto hover:border-crimson/70", Icono: ICONO_NIVEL.alta, palabra: "Bandera grave" },
  media: { clase: "border-amber/30 bg-amber-soft text-amberTexto hover:border-amber/70", Icono: ICONO_NIVEL.media, palabra: "Bandera media" },
  baja: { clase: "border-mute/20 bg-line text-inkSoft hover:border-mute/50", Icono: ICONO_NIVEL.baja, palabra: "Bandera leve" },
} as const;
const RANGO = { alta: 0, media: 1, baja: 2 } as const;

/**
 * Las banderas de una ficha, fijas bajo su título: se ven en todas las pestañas (el nepotismo de una entidad ya no se
 * queda en su Inicio ni en una columna de sus locadores) y cada una lleva a su evidencia. Las graves primero; dentro de
 * la misma severidad, el orden en que llegan (quien las arma pone primero lo que más pesa). Hasta `max` a la vista y
 * «y N más», que abre las demás ahí mismo, cada una con su enlace (antes llevaba a una pestaña: la de antecedentes de
 * la empresa no tiene todas sus banderas y la entidad no tiene pestaña de señales). Sin banderas no ocupa lugar.
 * Server-safe: el `<details>` se abre sin JavaScript.
 */
export function BanderasFicha({
  banderas,
  etiqueta,
  max = 4,
  className,
}: {
  banderas: BanderaFicha[];
  /** El nombre de la lista para el lector de pantalla («Banderas de esta entidad»). */
  etiqueta: string;
  max?: number;
  className?: string;
}) {
  if (!banderas.length) return null;
  const orden = banderas
    .map((b, i) => ({ b, i }))
    .sort((x, y) => RANGO[x.b.severidad] - RANGO[y.b.severidad] || x.i - y.i)
    .map(({ b }) => b);
  const vista = orden.slice(0, max);
  const resto = orden.length - vista.length;
  return (
    <ul className={cn("flex flex-wrap items-center gap-2", className)} aria-label={etiqueta}>
      {vista.map((b) => <Chip key={b.tipo} b={b} />)}
      {resto > 0 && (
        // Abiertas, las demás ocupan su propio renglón (no estiran el de las cuatro primeras).
        <li className="has-[details[open]]:basis-full">
          <details className="group">
            <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 px-1 text-meta font-semibold text-granate underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">y {resto} más</span>
              <span className="hidden group-open:inline">Ver menos</span>
              <ChevronDown size={14} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="mt-2 flex flex-wrap items-center gap-2" aria-label={`${etiqueta}: las otras ${resto}`}>
              {orden.slice(max).map((b) => <Chip key={b.tipo} b={b} />)}
            </ul>
          </details>
        </li>
      )}
    </ul>
  );
}

function Chip({ b }: { b: BanderaFicha }) {
  const e = ESTILO[b.severidad];
  const contenido = (
    <>
      <e.Icono size={14} className="shrink-0" aria-hidden />
      <span className="sr-only">{e.palabra}: </span>
      {/* El ícono del tipo, después del de severidad y más tenue: qué clase de hecho es (un aporte, un pariente…). */}
      <IconoBandera tipo={b.tipo} size={13} className="opacity-70" />
      <span>{b.nombre}</span>
      {b.n != null && b.n > 0 && <span className="font-mono tabular-nums">{numero(b.n)}</span>}
      {b.href && <ChevronRight size={14} className="-mr-1 shrink-0 opacity-70" aria-hidden />}
    </>
  );
  const clase = cn("inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-meta font-semibold leading-tight transition-colors", e.clase);
  return (
    <li title={b.explica}>
      {b.href ? (
        <Link href={b.href} prefetch={false} className={clase}>
          {contenido}
          {b.explica && <span className="sr-only">. {b.explica}</span>}
        </Link>
      ) : (
        <span className={clase}>{contenido}</span>
      )}
    </li>
  );
}
