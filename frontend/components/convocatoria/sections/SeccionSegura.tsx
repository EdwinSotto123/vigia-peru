"use client";

/**
 * Límite de error por sección del dossier.
 *
 * Un campo que cambió de forma en el backend (la `evidencia` que pasó de texto
 * a lista) tiraba la pestaña entera y, con ella, la página: "Algo no cargó
 * bien" en 21 de 94 dossiers. Con esto, lo que falla es solo esa sección, y lo
 * dice en castellano; el resto del dossier se sigue leyendo.
 */

import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

type Props = { nombre: string; children: React.ReactNode };
type State = { error: Error | null };

export class SeccionSegura extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[vigia] la sección "${this.props.nombre}" no se pudo dibujar:`, error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="surface flex items-start gap-3 p-4 text-[13px] text-inkSoft">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">No pudimos mostrar {this.props.nombre}.</p>
          <p className="mt-0.5 text-[12px] text-mute">
            El resto del dossier sigue disponible. Si vuelve a pasar, el dato llegó con una forma que esta vista todavía no
            sabe leer.
          </p>
        </div>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-line bg-paper px-2.5 py-1 text-[12px] font-medium text-ink hover:bg-paperDeep"
        >
          <RotateCcw size={12} aria-hidden /> Reintentar
        </button>
      </div>
    );
  }
}
