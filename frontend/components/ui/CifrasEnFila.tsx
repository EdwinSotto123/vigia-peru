import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Franja de cifras: 1 a 4 indicadores en UNA fila baja, sin una caja con borde por cifra.
 *
 * Reemplaza la cuadrícula de tarjetas de KPI (dos líneas de texto dentro de cajas de 270 x 110 px,
 * 60 % vacías). Cada cifra es: número grande, a su lado lo que ES (una línea) y debajo su contexto
 * pequeño. Entre cifras, un filete fino; sin fondo, sin borde, sin altura mínima: la fila mide lo
 * que mide su texto (unos 48 px). En móvil baja a 2 por fila con un filete a la izquierda.
 *
 * Server-safe (sin estado): `href` usa <Link>, y `ayuda` recibe un <Ayuda/> ya armado.
 *
 * Props de cada cifra (`Cifra`):
 *   valor     ya formateado ("18,393", "S/ 1.3 M"). `null` = sin dato: se dice "Sin dato", no se inventa un 0.
 *   etiqueta  qué es, en pocas palabras ("contratos leídos").
 *   contexto  denominador, fuente o fecha, en tercer nivel ("de 18,393 publicados").
 *   ayuda     <Ayuda/> junto a la etiqueta (el ⓘ).
 *   tono      "neutro" | "alta" | "media" | "positivo": solo severidad y lo positivo colorean el número.
 *   href      la cifra entera es el enlace a su lista filtrada.
 *   marca     clase de relleno de un punto junto a la etiqueta (une la cifra con su tramo en `pie`).
 * Props de la franja: `chico` (tamaño discreto: cifras de apoyo que no son el foco de la página), `items` (máx. 4), `pie` (una barra opcional debajo, p. ej. el reparto), `className` y `apilado`
 * (el número arriba y la etiqueta debajo en todos los anchos: para una columna angosta, p. ej. una ficha con barra lateral).
 */

export interface Cifra {
  valor: ReactNode | null;
  etiqueta: string;
  contexto?: ReactNode;
  ayuda?: ReactNode;
  tono?: "neutro" | "alta" | "media" | "positivo";
  href?: string;
  marca?: string;
}

const TONO: Record<NonNullable<Cifra["tono"]>, string> = {
  neutro: "text-[rgb(var(--acento-cifra))]",
  alta: "text-rust",
  media: "text-amberTexto",
  positivo: "text-mossTexto",
};

/** Un valor con letras ("12 mar. 2025", "hace 3 h") va más chico: a 26 px partía en dos líneas. */
const tieneLetras = (v: ReactNode | null) => typeof v === "string" && /[a-zá-ú]/i.test(v.replace(/^S\//, ""));

export function CifrasEnFila({ items, pie, className, apilado = false, chico = false }: { items: Cifra[]; pie?: ReactNode; className?: string; apilado?: boolean; chico?: boolean }) {
  const visibles = items.slice(0, 4);
  const fila = (
    <dl className={cn("grid grid-cols-2 gap-x-4 gap-y-3", apilado ? "sm:grid-cols-4" : "sm:flex sm:flex-wrap sm:gap-y-3")}>
      {visibles.map((it) => (
        <div
          key={it.etiqueta}
          className={cn(
            // Móvil: filete a la izquierda. Desde sm: filete entre cifras; la primera sin filete.
            "relative grid min-w-0 grid-cols-1 gap-y-0.5 border-l-2 border-line pl-3",
            apilado
              ? "sm:border-l sm:pl-4 sm:first:border-l-0 sm:first:pl-0"
              : "sm:grid-cols-[auto_1fr] sm:items-center sm:gap-x-3 sm:gap-y-0 sm:min-w-[9.5rem] sm:flex-1 sm:border-l sm:pl-4 sm:first:border-l-0 sm:first:pl-0",
            it.href && "rounded-md transition-colors duration-rapido hover:bg-paperSoft focus-within:ring-2 focus-within:ring-granate",
          )}
        >
          <dt
            className={cn(
              "order-2 flex min-w-0 items-center gap-1 font-medium leading-tight text-inkSoft", chico ? "text-[12px]" : "text-[13px]",
              !apilado && "sm:order-none sm:col-start-2 sm:row-start-1",
              // Sin contexto la etiqueta se centra junto al número.
              !apilado && (it.contexto != null ? "sm:self-end" : "sm:row-span-2 sm:self-center"),
            )}
          >
            {it.marca && <span className={cn("mr-0.5 h-2 w-2 shrink-0 rounded-full", it.marca)} aria-hidden />}
            <span className="min-w-0">{it.etiqueta}</span>
            {/* El ⓘ queda por encima del enlace estirado para poder tocarlo. */}
            {it.ayuda && <span className="relative z-[1] shrink-0">{it.ayuda}</span>}
          </dt>
          <dd
            className={cn(
              "order-1 font-display font-bold leading-none tracking-tight tabular-nums",
              !apilado && "sm:order-none sm:col-start-1 sm:row-span-2 sm:row-start-1 sm:self-center",
              tieneLetras(it.valor) ? (chico ? "text-[15px]" : "text-[19px]") : chico ? "text-[18px]" : "text-[26px]",
              TONO[it.tono ?? "neutro"],
            )}
          >
            {it.valor == null ? (
              <span className="text-[16px] font-semibold text-mute">Sin dato</span>
            ) : it.href ? (
              // Sin prefetch: el enlace de una cifra filtra el listado; se pide al hacer clic.
              <Link href={it.href} prefetch={false} className="after:absolute after:inset-0 focus-visible:outline-none">
                {it.valor}
              </Link>
            ) : (
              it.valor
            )}
          </dd>
          {it.contexto != null && (
            <dd className={cn("order-3 leading-tight text-mute tabular-nums", chico ? "text-[11px]" : "text-[12px]", !apilado && "sm:order-none sm:col-start-2 sm:row-start-2 sm:self-start")}>{it.contexto}</dd>
          )}
        </div>
      ))}
    </dl>
  );
  if (!pie) return <div className={className}>{fila}</div>;
  return (
    <div className={cn("space-y-2.5", className)}>
      {fila}
      <div>{pie}</div>
    </div>
  );
}

/** La misma franja mientras llegan los datos: números en esqueleto, nunca un 0 provisional. */
export function CifrasEnFilaSkeleton({ n = 4, className }: { n?: number; className?: string }) {
  const k = Math.min(4, Math.max(1, n));
  return (
    <div className={cn("grid grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-wrap", className)} aria-hidden>
      {Array.from({ length: k }).map((_, i) => (
        <div key={i} className="flex min-w-0 items-center gap-3 border-l-2 border-line pl-3 sm:min-w-[11rem] sm:flex-1 sm:border-l sm:pl-5 sm:first:border-l-0 sm:first:pl-0">
          <Skeleton className="h-7 w-14" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}
