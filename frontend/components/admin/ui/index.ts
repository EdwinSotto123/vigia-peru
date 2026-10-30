/**
 * Kit de UI del panel admin: las piezas con las que se arma cada página, para
 * que todas se lean igual (mismos radios, rellenos, etiquetas y colores de
 * estado). Referencia visual: app/admin/procesamientos.
 *
 *   import { PageSection, StatCard, StatGrid, DataTable, … } from "@/components/admin/ui";
 *
 * Sólo reciben ReactNode y datos, salvo los callbacks explícitos (onClick,
 * onCambiar, onFila, onReintentar, celda): esos componentes se usan desde
 * client components, nunca con una función pasada desde un server component.
 *
 * Cómo se arma una página (rediseño del 2026-10-30, «mucho scroll, texto libre, nada de orden»):
 *   · Arriba, lo que pide una decisión o resume el estado: una fila de StatCard (StatGrid), sin caja que la envuelva.
 *   · Si la página tiene más de un bloque grande, Pestanas + PanelPestana (`usePestana`, en la URL): una sección a la
 *     vez, no cuatro apiladas.
 *   · Toda explicación va en un ⓘ (`ayuda` de PageSection/Panel, `<Ayuda>` de components/patrones); la descripción,
 *     si hace falta, es UNA línea.
 *   · Listas: DataTable con `porPagina` (25) y `compactoMovil`; filtros en chips arriba; la acción principal es el
 *     clic en la fila y las demás van en `MenuFila` («⋯»), nunca dos botones por fila.
 *   · Nada de cajas dentro de cajas: una tarjeta de primer nivel por bloque.
 */

export { TONO, type Tone, type ClasesTono } from "./tono";
export { Badge, Punto } from "./Badge";
export { claseBoton, type VarianteBoton, type TamanoBoton } from "./boton";
export { Card, Panel } from "./Card";
export { PageSection } from "./PageSection";
export { StatCard, StatGrid } from "./StatCard";
export { DataTable, type Columna } from "./DataTable";
export { Chip, FilterChips, flechasRadio, type OpcionChip } from "./FilterChips";
export { EmptyState } from "./EmptyState";
export { Aviso, ErrorBanner, explicarError, mensajeError } from "./ErrorBanner";
export { SkeletonBloque, SkeletonStats, SkeletonFilas, SkeletonTabla, SkeletonPanel } from "./Skeleton";
export { KeyValue, SinDato, type ParClave } from "./KeyValue";
export { Expandable } from "./Expandable";
export { Pestanas, PanelPestana, usePestana, type PestanaPanel } from "./Pestanas";
export { MenuFila, type AccionMenu } from "./MenuFila";
export { BarraProgreso } from "./BarraProgreso";
export { fmtNum, hace, fmtDia, fmtFechaHora, fmtBytes, pct, plural, humanizar } from "./formato";
export * from "./estados";
export { leerAccion, actorCorto, CATEGORIA_BITACORA, type CategoriaBitacora, type EntradaBitacora, type AccionLegible } from "./bitacora";
