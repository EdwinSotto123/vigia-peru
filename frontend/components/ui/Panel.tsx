"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export type PanelPosicion = "lateral" | "centro" | "hoja";

/**
 * Overlay base del producto. Un solo `<dialog>` nativo detrás de las tres
 * posiciones, porque nativo nos regala tres cosas que a mano salen mal:
 *
 *  1. **Top layer.** El diálogo se pinta fuera del árbol de apilamiento, así
 *     que ningún `overflow:hidden` ni `transform` de un ancestro lo recorta.
 *     Es exactamente el bug que mata a los dropdowns hechos con `absolute`
 *     dentro de un panel con scroll — y este producto está lleno de paneles
 *     con scroll.
 *  2. **Foco atrapado + Escape + inert del fondo**, sin una línea de JS.
 *  3. **Scroll lock** del documento, también gratis.
 *
 * Lo único que hay que poner a mano es la animación, porque `display` no se
 * puede transicionar: se abre inmediatamente y se cierra con un estado
 * `saliendo` que espera a que termine la transición antes de `close()`.
 *
 * Nota de arquitectura: `children` y `pie` son ReactNode, nunca funciones.
 * Un Server Component puede renderizar el detalle completo y pasarlo aquí
 * como prop; pasar una función en su lugar compila y rompe solo en
 * producción. Ya pasó dos veces en este repo.
 */
export function Panel({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  posicion = "lateral",
  ancho = "md",
  pie,
  children,
  className,
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: string;
  /** Línea de contexto bajo el título. Es lo que evita que el panel se sienta desconectado de donde saliste. */
  descripcion?: React.ReactNode;
  posicion?: PanelPosicion;
  ancho?: "sm" | "md" | "lg" | "xl";
  pie?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [saliendo, setSaliendo] = useState(false);
  // Montaje perezoso del contenido. Una lista de 50 contratos con <Revelar> en
  // cada fila renderizaba 50 paneles completos —miles de nodos— aunque el
  // usuario no abriera ninguno. `display:none` no cuesta layout ni pintado,
  // pero sí costaba construirlo, y la escena de uso dominante del producto es
  // un celular de gama baja con datos móviles.
  //
  // Una vez abierto queda montado: reabrir el mismo panel no debe perder el
  // scroll ni el estado de lo que haya adentro.
  const [yaAbierto, setYaAbierto] = useState(false);
  if (abierto && !yaAbierto) setYaAbierto(true);

  const cerrarConAnimacion = useCallback(() => {
    const d = ref.current;
    if (!d) return onCerrar();
    // prefers-reduced-motion deja la transición en 0.01ms (globals.css),
    // así que este timeout se vuelve imperceptible por sí solo.
    setSaliendo(true);
    window.setTimeout(onCerrar, 200);
  }, [onCerrar]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) {
      // `saliendo` se limpia al ABRIR, no al terminar de cerrar. Si se limpiara
      // junto con onCerrar(), el panel volvería a su posición de reposo en el
      // mismo commit en que se oculta: un destello de un frame con el panel
      // otra vez entero antes de desaparecer.
      setSaliendo(false);
      d.showModal();
    }
    if (!abierto && d.open) d.close();
  }, [abierto]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // Escape lo dispara el navegador como evento `cancel`: lo interceptamos
    // para que salga con la misma animación que el botón de cerrar.
    const onCancel = (e: Event) => {
      e.preventDefault();
      cerrarConAnimacion();
    };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, [cerrarConAnimacion]);

  const anchos = {
    sm: "sm:max-w-sm",
    md: "sm:max-w-md",
    lg: "sm:max-w-2xl",
    xl: "sm:max-w-4xl",
  }[ancho];

  // En móvil, un panel lateral es una hoja que sube desde abajo: el pulgar
  // llega al borde inferior, no al lateral derecho.
  const layout =
    posicion === "centro"
      ? "m-auto w-[calc(100vw-2rem)] max-h-[85dvh] rounded-3xl"
      : posicion === "hoja"
        ? "mt-auto mb-0 w-full max-h-[85dvh] rounded-t-3xl"
        : "mt-auto mb-0 w-full max-h-[88dvh] rounded-t-3xl sm:mr-0 sm:ml-auto sm:my-0 sm:h-dvh sm:max-h-none sm:rounded-none sm:rounded-l-3xl";

  const entrada =
    posicion === "centro"
      ? saliendo
        ? "opacity-0 scale-[0.98]"
        : "opacity-100 scale-100"
      : posicion === "hoja"
        ? saliendo
          ? "translate-y-full"
          : "translate-y-0"
        : saliendo
          ? "translate-y-full sm:translate-y-0 sm:translate-x-full"
          : "translate-y-0 sm:translate-x-0";

  return (
    <dialog
      ref={ref}
      aria-label={titulo}
      onClick={(e) => {
        // Clic en el backdrop: el target es el propio <dialog> solo cuando
        // el clic cayó fuera del contenido.
        if (e.target === ref.current) cerrarConAnimacion();
      }}
      className={cn(
        "flex flex-col overflow-hidden border border-line bg-paper text-ink shadow-dialog",
        "transition-all duration-panel ease-salida",
        posicion === "lateral" && "shadow-drawer",
        layout,
        anchos,
        entrada,
        className,
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-line bg-paperSoft px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate font-serif text-lg font-bold leading-tight text-ink">{titulo}</h2>
          {descripcion && <div className="mt-0.5 text-[13px] leading-snug text-mute">{descripcion}</div>}
        </div>
        <button
          type="button"
          onClick={cerrarConAnimacion}
          aria-label={`Cerrar ${titulo}`}
          className="-mr-1 -mt-1 shrink-0 rounded-xl p-2 text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink"
        >
          <X size={16} />
        </button>
      </header>

      <div className="scrollbar-warm min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {yaAbierto ? children : null}
      </div>

      {pie && yaAbierto && <footer className="shrink-0 border-t border-line bg-paperSoft px-5 py-3">{pie}</footer>}
    </dialog>
  );
}
