import Link from "next/link";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";

/**
 * Las vistas de un listado (§14.1): dos o tres poblaciones distintas del mismo
 * índice ("Publicadas" / "Financiados en revisión"). Es un cambio de modo, no un
 * filtro: va arriba de las cifras, como enlaces (funcionan sin JS, se abren en otra
 * pestaña) y con su conteo. `conteo: null` = todavía contando: hueco, nunca un 0.
 */
export interface Vista {
  href: string;
  etiqueta: string;
  conteo?: number | null;
  activa: boolean;
}

export function Vistas({ vistas, etiqueta, className }: { vistas: Vista[]; etiqueta: string; className?: string }) {
  return (
    // Una sola fila siempre: si no entra en el celular, se desliza (partida en dos renglones
    // dentro de una píldora se leía como un error).
    <nav
      aria-label={etiqueta}
      className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-line bg-paper p-1 [scrollbar-width:none] [&>a]:shrink-0 [&>a]:whitespace-nowrap", className)}
    >
      {vistas.map((v) => (
        <Link
          key={v.href}
          href={v.href}
          aria-current={v.activa ? "page" : undefined}
          className={cn(
            "inline-flex min-h-[36px] items-center gap-2 rounded-full px-4 py-1.5 text-[14px] font-medium transition-colors duration-rapido",
            v.activa ? "bg-granate text-paper" : "text-inkSoft hover:bg-granate-50 hover:text-ink",
          )}
        >
          {v.etiqueta}
          {v.conteo === null ? (
            <span className="inline-block h-2.5 w-6 animate-shimmerSweep rounded bg-gradient-to-r from-paperDeep via-paper to-paperDeep bg-[length:200%_100%]" aria-hidden />
          ) : v.conteo !== undefined ? (
            <span className={cn("text-[12px] font-semibold tabular-nums", v.activa ? "text-paper/85" : "text-mute")}>{numero(v.conteo)}</span>
          ) : null}
        </Link>
      ))}
    </nav>
  );
}
