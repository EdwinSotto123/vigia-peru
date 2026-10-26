import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Las cifras de cabecera de una vista: 1 a 4 tarjetas iguales, cada una con lo que ES arriba (una línea), el número
 * grande y su contexto pequeño debajo (DESIGN_SYSTEM.md §10.7: número, qué es, contexto).
 *
 * Historia: primero eran cajas de 270 x 110 px con dos líneas de texto (60 % vacías); después una franja sin cajas,
 * con la etiqueta AL LADO del número, que en 4 columnas partía "personas contratadas con 16,268,389 órdenes de
 * servicio" en cuatro renglones apretados. Ahora la tarjeta apila sus tres niveles y mide lo que mide su texto; las
 * tarjetas llenan la fila según cuántas son (2, 3 o 4 columnas; una sola ocupa un cuarto). En el celular, 2 por fila.
 *
 * Server-safe (sin estado): `href` usa <Link>, y `ayuda` recibe un <Ayuda/> ya armado.
 *
 * Props de cada cifra (`Cifra`):
 *   valor     ya formateado ("18,393", "S/ 1.3 M"). `null` = sin dato: se dice "Sin dato", no se inventa un 0.
 *   etiqueta  qué es, en pocas palabras ("contratos leídos").
 *   contexto  denominador, fuente o fecha, en tercer nivel ("de 18,393 publicados").
 *   ayuda     <Ayuda/> junto a la etiqueta (el ⓘ).
 *   tono      "neutro" | "alta" | "media" | "positivo": solo severidad y lo positivo colorean el número.
 *   href      la tarjeta entera es el enlace a su lista filtrada.
 *   marca     clase de relleno de un punto junto a la etiqueta (une la cifra con su tramo en `pie`).
 * Props del grupo: `chico` (cifras de apoyo que no son el foco de la página), `items` (máx. 4), `pie` (una barra
 * opcional debajo, p. ej. el reparto), `className` y `apilado` (dos por fila en todos los anchos: para una columna
 * angosta, p. ej. una ficha con barra lateral).
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
    // En el celular van de a 2 por fila: con un total impar, la última a todo el ancho (no media fila con un hueco al lado).
    <dl className={cn("grid grid-cols-2 gap-2.5 max-sm:[&>div:last-child:nth-child(odd)]:col-span-2", !apilado && COLUMNAS[visibles.length])}>
      {visibles.map((it) => (
        <div
          key={it.etiqueta}
          className={cn(
            // Dentro de una tarjeta, placa suave sin borde (una tarjeta dentro de otra era ruido).
            "relative flex min-w-0 flex-col rounded-2xl border border-line bg-paper [.tarjeta_&]:border-0 [.tarjeta_&]:bg-paperSoft",
            chico ? "gap-1 px-3 py-2.5" : "gap-1.5 px-4 py-3.5",
            it.href && "transition-colors duration-rapido hover:border-granate/40 hover:bg-paperSoft focus-within:ring-2 focus-within:ring-granate",
          )}
        >
          <dt className={cn("flex min-w-0 items-center gap-1 font-medium leading-tight text-inkSoft", chico ? "text-rotulo" : "text-meta")}>
            {it.marca && <span className={cn("mr-0.5 h-2 w-2 shrink-0 rounded-full", it.marca)} aria-hidden />}
            <span className="min-w-0">{it.etiqueta}</span>
            {/* El ⓘ queda por encima del enlace estirado para poder tocarlo. */}
            {it.ayuda && <span className="relative z-[1] shrink-0">{it.ayuda}</span>}
          </dt>
          <dd
            className={cn(
              "font-display font-bold leading-none tracking-tight tabular-nums",
              tieneLetras(it.valor) ? (chico ? "text-cuerpo" : "text-bloque") : chico ? "text-bloque" : "text-cifra",
              TONO[it.tono ?? "neutro"],
            )}
          >
            {it.valor == null ? (
              <span className="text-destacado font-semibold text-mute">Sin dato</span>
            ) : it.href ? (
              // Sin prefetch: el enlace de una cifra filtra el listado; se pide al hacer clic.
              <Link href={it.href} prefetch={false} className="after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none">
                {it.valor}
              </Link>
            ) : (
              it.valor
            )}
          </dd>
          {it.contexto != null && (
            <dd className={cn("leading-snug text-mute tabular-nums", chico ? "text-micro" : "text-rotulo")}>{it.contexto}</dd>
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

/** Columnas desde `sm` según cuántas cifras hay: llenan la fila (clases literales para Tailwind). */
const COLUMNAS: Record<number, string> = {
  1: "sm:grid-cols-2 sm:gap-3 lg:grid-cols-4",
  2: "sm:gap-3",
  3: "sm:grid-cols-3 sm:gap-3",
  4: "sm:gap-3 lg:grid-cols-4",
};

/** Las mismas tarjetas mientras llegan los datos: números en esqueleto, nunca un 0 provisional. */
export function CifrasEnFilaSkeleton({ n = 4, className }: { n?: number; className?: string }) {
  const k = Math.min(4, Math.max(1, n));
  return (
    <div className={cn("grid grid-cols-2 gap-2.5", COLUMNAS[k], className)} aria-hidden>
      {Array.from({ length: k }).map((_, i) => (
        <div key={i} className="flex min-w-0 flex-col gap-2 rounded-2xl border border-line bg-paper px-4 py-3.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}
