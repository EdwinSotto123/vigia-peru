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
    // El informe ahora también se dibuja en el servidor, donde un límite de error no atrapa
    // nada: sin este Suspense, una sección con un dato raro tiraba la página entera con un 500.
    // Con él, el servidor deja la sección vacía y el navegador la vuelve a dibujar; si ahí
    // también falla, la atrapa este límite, como siempre.
    if (!this.state.error) return <React.Suspense fallback={null}>{this.props.children}</React.Suspense>;
    return (
      <div role="alert" className="flex items-start gap-3 rounded-2xl border border-line bg-paperSoft p-4 text-[13px] text-inkSoft">
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
          className="inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-full border border-line bg-paper px-3 py-1 text-[12px] font-medium text-ink hover:bg-paperDeep"
        >
          <RotateCcw size={12} aria-hidden /> Reintentar
        </button>
      </div>
    );
  }
}
