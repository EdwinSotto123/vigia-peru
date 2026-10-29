import Link from "next/link";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";

/**
 * Las vistas de un listado (§14.1): dos o tres poblaciones distintas del mismo
 * índice ("Publicadas" / "Financiados en revisión"). Es un cambio de modo, no un
 * filtro: va arriba de las cifras, como enlaces (funcionan sin JS, se abren en otra
 * pestaña) y con su conteo. `conteo: null` = todavía contando: hueco, nunca un 0.
 *
 * `variante="secundaria"`: lo que acota la vista elegida (el período, el nivel), debajo de la principal. El mismo
 * control sin el granate: pista gris y la elegida en blanco con su borde. Con tres barras granate iguales, una encima de
 * otra, no se sabía cuál mandaba (Partidos y gobiernos, 2026-10-29).
 */
export interface Vista {
  href: string;
  etiqueta: string;
  conteo?: number | null;
  activa: boolean;
}

export function Vistas({
  vistas,
  etiqueta,
  className,
  variante = "principal",
}: {
  vistas: Vista[];
  etiqueta: string;
  className?: string;
  /** `secundaria`: lo que acota la vista (período, nivel), sin el peso del granate. Por defecto, `principal`. */
  variante?: "principal" | "secundaria";
}) {
  const secundaria = variante === "secundaria";
  return (
    // Una sola fila siempre: si no entra en el celular, se desliza (partida en dos renglones
    // dentro de una píldora se leía como un error).
    <nav
      aria-label={etiqueta}
      className={cn(
        "inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-line p-1 [scrollbar-width:none] [&>a]:shrink-0 [&>a]:whitespace-nowrap",
        secundaria ? "bg-paperSoft" : "bg-paper",
        className,
      )}
    >
      {vistas.map((v) => (
        // Sin prefetch: cada vista es una consulta distinta al API (auditoría A14). Se pide al
        // hacer clic, no por estar a la vista.
        <Link
          key={v.href}
          href={v.href}
          prefetch={false}
          aria-current={v.activa ? "page" : undefined}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full transition-colors duration-rapido",
            secundaria
              ? // Un escalón abajo: letra de metadato y sin relleno de color; el borde (transparente en las otras) no mueve nada al elegir.
                cn(
                  "min-h-[36px] border px-2.5 py-1 text-meta sm:px-3",
                  v.activa ? "border-line bg-paper font-semibold text-ink" : "border-transparent font-medium text-inkSoft hover:bg-paper/70 hover:text-ink",
                )
              : cn(
                  "min-h-[40px] px-2.5 py-1.5 text-meta font-medium sm:gap-2 sm:px-4 sm:text-dato",
                  v.activa ? "bg-granate text-paper" : "text-inkSoft hover:bg-granate-50 hover:text-ink",
                ),
          )}
        >
          {v.etiqueta}
          {v.conteo === null ? (
            <span className="inline-block h-2.5 w-6 animate-shimmerSweep rounded bg-gradient-to-r from-paperDeep via-paper to-paperDeep bg-[length:200%_100%]" aria-hidden />
          ) : v.conteo !== undefined ? (
            <span className={cn("text-rotulo font-semibold tabular-nums", v.activa ? (secundaria ? "text-inkSoft" : "text-paper/85") : "text-mute")}>{numero(v.conteo)}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
