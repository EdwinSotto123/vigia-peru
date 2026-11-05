"use client";

import type { MouseEvent as ClicReact, ReactNode } from "react";

/**
 * La fila de una `Tabla` con enlaces propios en sus celdas (`Fila.enlaces`: el código del proceso, verde, a su ficha).
 *
 * Su acción (el enlace o el botón de la fila) es una capa vacía que la cubre entera, PRIMERA en el DOM y DEBAJO de las
 * celdas: el tabulador pasa por la fila y después por sus enlaces, y el fondo de elegida de la capa (el del panel
 * abierto) se ve a través de las celdas. Antes las celdas no tomaban el puntero (`pointer-events-none`) para que el clic
 * cayera en la capa, y con eso se perdían los `title` de lo que llevan adentro: el detalle del chip de estado, la lista
 * de antecedentes, el «posible error de carga» (auditoría del 2026-11-05). Ahora las celdas toman el puntero (su `title`
 * se ve al pasar) y el clic que cae en ellas se le pasa a la capa, salvo que sea en un control propio de la celda (un
 * enlace, un botón, un ⓘ) o al terminar de seleccionar texto (quien arrastra para copiar un código no quería abrir la
 * fila). Con Ctrl, Cmd o Mayús el clic se pasa con la tecla: un enlace se abre en otra pestaña, como al tocar la capa.
 * El teclado no pasa por aquí: Enter en la capa es su propio clic.
 */

/** Lo que dentro de una fila es un control con su propio clic: tocarlo no abre la fila. */
const CONTROL = "a[href], button, input, select, textarea, label, summary, [role='button'], [role='link'], [tabindex]:not([tabindex='-1'])";

export function FilaConEnlaces({ accion, className, children }: { accion: ReactNode; className?: string; children: ReactNode }) {
  const alClic = (e: ClicReact<HTMLDivElement>) => {
    if (e.defaultPrevented || e.button !== 0) return;
    const fila = e.currentTarget;
    // La capa es lo primero que se dibuja aquí (abajo): su elemento es el primer hijo de la fila.
    const capa = fila.firstElementChild;
    if (!(capa instanceof HTMLElement)) return;
    // Un control de la celda, o la capa misma (el clic en el aire entre celdas ya le llegó solo). Sólo los de ADENTRO de
    // la fila: una tabla dentro de un contenedor con `tabindex` (un carrusel) también tiene un «control» más arriba.
    const control = e.target instanceof Element ? e.target.closest(CONTROL) : null;
    if (control && fila.contains(control)) return;
    const seleccion = window.getSelection();
    if (seleccion && !seleccion.isCollapsed && seleccion.anchorNode && fila.contains(seleccion.anchorNode)) return;
    capa.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, view: window, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey }),
    );
  };
  return (
    <div className={className} onClick={alClic}>
      {accion}
      {children}
    </div>
  );
}
