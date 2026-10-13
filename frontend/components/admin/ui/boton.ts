import { cn } from "@/lib/utils";

/**
 * Clases de botón del panel, para <button> y para <Link>: un mismo botón se ve
 * igual sea acción o navegación. Son las píldoras del sitio público (Button,
 * EnlaceAccion): `primario` en lima es LA acción de la pantalla (una por vista),
 * `secundario` con borde para todo lo demás, `fantasma` para lo terciario.
 * `xs` va dentro de filas de tabla, `sm` en la cabecera y en las secciones, `md`
 * en formularios y diálogos.
 *
 *   <button className={claseBoton("primario")}>Guardar</button>
 *   <Link className={claseBoton("secundario", "xs")} href="…">Traza</Link>
 */
export type VarianteBoton = "primario" | "secundario" | "exito" | "peligro" | "marca" | "fantasma";
export type TamanoBoton = "xs" | "sm" | "md";

const VARIANTE: Record<VarianteBoton, string> = {
  primario: "bg-granate font-semibold text-paper hover:bg-granate-deep",
  secundario: "border border-line bg-paper font-medium text-ink hover:border-paperEdge hover:bg-paperSoft",
  exito: "bg-moss font-semibold text-paper hover:bg-moss/90",
  peligro: "border border-rust/40 bg-paper font-medium text-crimsonTexto hover:border-rust/60 hover:bg-crimson-soft",
  // Lo que se hace a nombre de Vigía (procesar un lote propio): el mismo lima que la acción principal.
  marca: "bg-granate font-semibold text-paper hover:bg-granate-deep",
  fantasma: "font-medium text-inkSoft hover:bg-paperSoft hover:text-ink",
};

const TAMANO: Record<TamanoBoton, string> = {
  xs: "min-h-[28px] gap-1 rounded-full px-2.5 text-[12px]",
  sm: "min-h-[34px] gap-1.5 rounded-full px-3.5 text-[13px]",
  md: "min-h-[40px] gap-2 rounded-full px-5 text-sm",
};

export function claseBoton(variante: VarianteBoton = "secundario", tamano: TamanoBoton = "sm", extra?: string) {
  return cn(
    "inline-flex items-center justify-center whitespace-nowrap transition-colors duration-rapido active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50",
    VARIANTE[variante],
    TAMANO[tamano],
    extra,
  );
}
