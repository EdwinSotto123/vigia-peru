import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Las cifras de cabecera de una vista (DESIGN_SYSTEM.md §14.1): 2 a 4, cada una con
 * el número grande, lo que ES justo debajo y su contexto (denominador, fuente,
 * fecha) en tercer nivel. Número → etiqueta → contexto: la jerarquía que una línea
 * de texto gris ("118 de 18,393 publicados leídos · 97 con dictamen") no tenía, y
 * la correspondencia texto-dato que se perdía cuando las cifras iban en una frase.
 *
 * Server-safe. `href` convierte la cifra en la entrada a su lista filtrada.
 */

export interface Indicador {
  /** Ya formateado con lib/formato ("18,393", "S/ 1.3 M"). `null` = sin dato: se dice, no se inventa un 0. */
  valor: ReactNode | null;
  /** Qué es, en pocas palabras: "contratos leídos", "señales altas". */
  etiqueta: string;
  /** El denominador, la fuente o la fecha: "de 18,393 publicados". */
  contexto?: ReactNode;
  /** `<Ayuda/>` ya armado, junto a la etiqueta. */
  ayuda?: ReactNode;
  /** Sólo severidad y lo positivo colorean el número; la marca nunca comunica riesgo. */
  tono?: "neutro" | "alta" | "media" | "positivo";
  href?: string;
  /**
   * Clase de relleno (token) de un punto junto a la etiqueta: la clave de color que une la
   * cifra con su tramo en la barra del `pie`. Sólo cuando hay esa barra.
   */
  marca?: string;
}

const TONO: Record<NonNullable<Indicador["tono"]>, string> = {
  neutro: "text-ink",
  alta: "text-rust",
  media: "text-amberTexto",
  positivo: "text-mossTexto",
};

const COLUMNAS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  // Con 3 en dos columnas (celular) la tercera ocupa la fila entera: sin celda vacía.
  3: "grid-cols-2 sm:grid-cols-3 [&>*:last-child]:col-span-2 sm:[&>*:last-child]:col-span-1",
  4: "grid-cols-2 lg:grid-cols-4",
};

export function Indicadores({
  items,
  pie,
  className,
}: {
  items: Indicador[];
  /**
   * Una fila a lo ancho, dentro de la misma tarjeta y debajo de las cifras: la barra que
   * muestra cómo se reparten (con `marca` en cada cifra). Fuera del <dl>: no es un par
   * término-definición.
   */
  pie?: ReactNode;
  className?: string;
}) {
  const n = Math.min(4, Math.max(1, items.length));
  const marco = "overflow-hidden rounded-2xl border border-line bg-line";
  const cifras = (
    <dl className={cn("grid gap-px bg-line", COLUMNAS[n], pie ? undefined : [marco, className])}>
      {items.slice(0, 4).map((it) => (
        // Con `href`, el enlace va en el número y se estira sobre la celda (after:inset-0):
        // un <a> no puede envolver <dt>/<dd> dentro de un <dl>.
        <div
          key={it.etiqueta}
          className={cn(
            "relative flex min-w-0 flex-col bg-paper px-4 py-3.5",
            it.href && "transition-colors duration-rapido hover:bg-paperSoft focus-within:ring-2 focus-within:ring-inset focus-within:ring-granate",
          )}
        >
          <dt className="order-2 mt-1.5 flex items-center gap-1 text-[13px] font-medium leading-snug text-inkSoft">
            {it.marca && <span className={cn("mr-0.5 h-2 w-2 shrink-0 rounded-full", it.marca)} aria-hidden />}
            {it.etiqueta}
            {/* El ⓘ queda por encima del enlace estirado para poder tocarlo. */}
            {it.ayuda && <span className="relative z-[1]">{it.ayuda}</span>}
          </dt>
          <dd
            className={cn(
              "order-1 font-display font-bold leading-none tracking-tight tabular-nums",
              // Un valor con letras ("12 mar. 2025", "hace 3 h") va más chico: a 26 px partía en
              // dos líneas en una celda de un cuarto de ancho. Los números conservan el tamaño.
              typeof it.valor === "string" && /[a-zá-ú]/i.test(it.valor.replace(/^S\//, "")) ? "text-[20px]" : "text-[26px]",
              TONO[it.tono ?? "neutro"],
            )}
          >
            {it.valor == null ? (
              <span className="text-[18px] font-semibold text-mute">Sin dato</span>
            ) : it.href ? (
              // Sin prefetch: el enlace de una cifra filtra el listado; se pide al hacer clic.
              <Link href={it.href} prefetch={false} className="after:absolute after:inset-0 focus-visible:outline-none">
                {it.valor}
              </Link>
            ) : (
              it.valor
            )}
          </dd>
          {it.contexto != null && <dd className="order-3 mt-0.5 text-[12px] leading-snug text-mute tabular-nums">{it.contexto}</dd>}
        </div>
      ))}
    </dl>
  );
  if (!pie) return cifras;
  return (
    <div className={cn(marco, className)}>
      {cifras}
      <div className="mt-px bg-paper px-4 py-3">{pie}</div>
    </div>
  );
}

/** La misma franja mientras llegan los datos: números en esqueleto, nunca un 0 provisional. */
export function IndicadoresSkeleton({ n = 4, className }: { n?: number; className?: string }) {
  const k = Math.min(4, Math.max(1, n));
  return (
    <div className={cn("grid gap-px overflow-hidden rounded-2xl border border-line bg-line", COLUMNAS[k], className)} aria-hidden>
      {Array.from({ length: k }).map((_, i) => (
        <div key={i} className="space-y-2 bg-paper px-4 py-3.5">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
