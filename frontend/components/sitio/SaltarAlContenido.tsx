/**
 * "Saltar al contenido" (DESIGN_SYSTEM.md §13): el primer elemento enfocable de
 * cada layout. Invisible hasta que recibe foco con el teclado; entonces aparece
 * como una píldora granate arriba a la izquierda y lleva a `#contenido`.
 *
 * Vivía copiado en el layout público y en el del dashboard, con las mismas
 * catorce clases: un cambio en uno no llegaba al otro.
 */
export function SaltarAlContenido() {
  return (
    <a
      href="#contenido"
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-full focus:bg-granate focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-paper focus:shadow-dialog"
    >
      Saltar al contenido
    </a>
  );
}
