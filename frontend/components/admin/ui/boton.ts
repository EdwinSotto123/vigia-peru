import { cn } from "@/lib/utils";

/**
 * Clases de botón del panel, para <button> y para <Link>: un mismo botón se ve
 * igual sea acción o navegación. `xs` va dentro de filas de tabla, `sm` en la
 * cabecera de página y `md` en formularios.
 *
 *   <button className={claseBoton("primario")}>Guardar</button>
 *   <Link className={claseBoton("secundario", "xs")} href="…">Traza</Link>
 */
export type VarianteBoton = "primario" | "secundario" | "exito" | "peligro" | "marca" | "fantasma";
export type TamanoBoton = "xs" | "sm" | "md";

const VARIANTE: Record<VarianteBoton, string> = {
  primario: "bg-ink font-semibold text-paper hover:bg-ink/90",
  secundario: "border border-line bg-paper text-ink hover:bg-paperDeep",
  exito: "bg-moss font-semibold text-paper hover:bg-moss/90",
  peligro: "border border-rust/40 bg-paper text-rust hover:bg-crimson-soft",
  marca: "bg-heroViolet font-semibold text-paper hover:bg-heroViolet-deep",
  fantasma: "text-inkSoft hover:bg-paperDeep hover:text-ink",
};

const TAMANO: Record<TamanoBoton, string> = {
  xs: "gap-1 rounded-lg px-2 py-1 text-[11px]",
  sm: "gap-1.5 rounded-lg px-3 py-1.5 text-xs",
  md: "gap-1.5 rounded-xl px-4 py-2 text-sm",
};

export function claseBoton(variante: VarianteBoton = "secundario", tamano: TamanoBoton = "sm", extra?: string) {
  return cn(
    "inline-flex items-center justify-center whitespace-nowrap transition-colors duration-rapido disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTE[variante],
    TAMANO[tamano],
    extra,
  );
}
