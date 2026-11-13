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
    <>
      {/* Abajo de lg, chips bajo el título. */}
      <ul className={cn("flex flex-wrap items-center gap-2 lg:hidden", className)} aria-label={etiqueta}>
        {vista.map((b) => <Chip key={`${b.tipo}|${b.nombre}`} b={b} />)}
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
                {orden.slice(max).map((b) => <Chip key={`${b.tipo}|${b.nombre}`} b={b} />)}
              </ul>
            </details>
          </li>
        )}
      </ul>
      <Significados orden={orden} className="lg:hidden" />
      <Panel orden={orden} etiqueta={etiqueta} max={max} />
    </>
  );
}

/**
 * Desde lg, las banderas en un panel a la derecha del título (EncabezadoPagina le da esa columna): cuántas hay y su
 * reparto por gravedad en una barra fina (con su palabra al lado: el color nunca va solo), y una fila por bandera con
 * su nombre entero, cuántos casos y la flecha a su evidencia. Cuatro a la vista (lo que mide el título a su lado); las demás, plegadas debajo.
 */
function Panel({ orden, etiqueta, max }: { orden: BanderaFicha[]; etiqueta: string; max: number }) {
  const cuenta = { alta: 0, media: 0, baja: 0 };
  for (const b of orden) cuenta[b.severidad] += 1;
  const partes = (["alta", "media", "baja"] as const).filter((s) => cuenta[s] > 0);
  const palabra = { alta: ["grave", "graves"], media: ["media", "medias"], baja: ["leve", "leves"] } as const;
  const resumen = partes.map((s) => `${numero(cuenta[s])} ${palabra[s][cuenta[s] === 1 ? 0 : 1]}`).join(", ");
  const resto = orden.slice(max);
  return (
    <section aria-label={etiqueta} className="hidden rounded-xl border border-line bg-paper/85 p-3 shadow-sm lg:block">
      <div className="flex items-baseline justify-between gap-3 px-1.5">
        <p className="text-meta font-semibold text-ink">{etiqueta}</p>
        <p className="shrink-0 text-rotulo text-inkSoft">{resumen}</p>
      </div>
      {partes.length > 1 && (
        <div className="mx-1.5 mt-2 flex h-1.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
          {partes.map((s) => (
            <span key={s} className={cn("h-full", BARRA[s])} style={{ width: `${(100 * cuenta[s]) / orden.length}%` }} />
          ))}
        </div>
      )}
      <ul className="mt-2 divide-y divide-line/70">
        {orden.slice(0, max).map((b) => <Fila key={`${b.tipo}|${b.nombre}`} b={b} />)}
      </ul>
      {resto.length > 0 && (
        <details className="group">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1 border-t border-line/70 px-1.5 pt-1 text-meta font-semibold text-granate hover:underline [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Ver las otras {resto.length}</span>
            <span className="hidden group-open:inline">Ver menos</span>
            <ChevronDown size={14} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="max-h-72 divide-y divide-line/70 overflow-y-auto overscroll-contain" aria-label={`${etiqueta}: las otras ${resto.length}`}>
            {resto.map((b) => <Fila key={`${b.tipo}|${b.nombre}`} b={b} />)}
          </ul>
        </details>
      )}
      <Significados orden={orden} className="border-t border-line/70 px-1.5 pt-1" />
    </section>
  );
}

/**
 * Qué significa cada bandera, a la vista con un toque. Antes la explicación sólo estaba en el `title`, que no existe en
 * una pantalla táctil ni con teclado (auditoría de producto del 2026-11-12, hallazgo 11). Sin JavaScript: `<details>`.
 */
function Significados({ orden, className }: { orden: BanderaFicha[]; className?: string }) {
  const con = orden.filter((b) => b.explica);
  if (!con.length) return null;
  return (
    <details className={cn("group", className)}>
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1 text-meta font-semibold text-granate underline-offset-2 hover:underline [&::-webkit-details-marker]:hidden">
        Qué significa cada una
        <ChevronDown size={14} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <dl className="mt-1.5 max-h-80 space-y-2 overflow-y-auto overscroll-contain pb-1">
        {con.map((b) => (
          <div key={`${b.tipo}|${b.nombre}`}>
            <dt className="text-meta font-semibold text-ink">{b.nombre}</dt>
            <dd className="text-meta leading-relaxed text-inkSoft">{b.explica}</dd>
          </div>
        ))}
        <div className="text-meta text-inkSoft">
          Una bandera es un indicio para revisar, no una acusación.{" "}
          <Link href="/metodologia" prefetch={false} className="font-medium text-ink underline underline-offset-2 hover:text-granate">
            Cómo se calculan
          </Link>
        </div>
      </dl>
    </details>
  );
}

const BARRA = { alta: "bg-crimson", media: "bg-amber", baja: "bg-mute/50" } as const;
const ICONO_COLOR = { alta: "text-crimsonTexto", media: "text-amberTexto", baja: "text-mute" } as const;

function Fila({ b }: { b: BanderaFicha }) {
  const e = ESTILO[b.severidad];
  const contenido = (
    <>
      <e.Icono size={14} className={cn("shrink-0", ICONO_COLOR[b.severidad])} aria-hidden />
      <span className="sr-only">{e.palabra}: </span>
      <IconoBandera tipo={b.tipo} size={13} className="shrink-0 text-mute" />
      <span className="min-w-0 flex-1 leading-snug text-ink">{b.nombre}</span>
      {b.n != null && b.n > 0 && <span className="shrink-0 font-mono text-rotulo font-semibold tabular-nums text-inkSoft">{numero(b.n)}</span>}
      {b.href && <ChevronRight size={14} className="shrink-0 text-mute transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />}
    </>
  );
  const clase = "flex min-h-8 items-center gap-2 rounded-lg px-1.5 py-1 text-meta";
  return (
    <li title={b.explica}>
      {b.href ? (
        <Link href={b.href} prefetch={false} className={cn(clase, "group transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate")}>
          {contenido}
          {b.explica && <span className="sr-only">. {b.explica}</span>}
        </Link>
      ) : (
        <span className={clase}>{contenido}</span>
      )}
    </li>
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
