"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Ficha contextual anclada a una zona del mapa.
 *
 * Sube al **top layer** con el atributo `popover` nativo, igual que
 * `components/ui/Flotante.tsx`. Es la única forma de que esto se vea: el
 * lienzo del mapa vive dentro de `.surface` con `overflow-hidden` y de un
 * contenedor con `transform` (el zoom del SVG), que recortan cualquier
 * `absolute` y rompen cualquier `fixed`.
 *
 * No se reutilizan `Tooltip`/`Popover` de Flotante porque ambos envuelven a su
 * hijo en un `<span>` / `<button>` HTML, y el ancla acá es un `<path>` dentro
 * de un `<svg>`: un elemento HTML dentro del SVG no renderiza. Lo que se
 * comparte es el mecanismo (top layer + posición medida contra el viewport),
 * no el componente.
 *
 * `aria-hidden`: las mismas cifras ya viajan en el `aria-label` del
 * departamento, que es un control enfocable. Duplicarlas acá haría que el
 * lector de pantalla las diga dos veces.
 */
export function FichaRegion({
  abierto,
  ancla,
  titulo,
  contexto,
  filas,
  pie,
}: {
  abierto: boolean;
  /** Rectángulo del elemento del SVG al que se ancla, en coordenadas de viewport. */
  ancla: DOMRect | null;
  titulo: string;
  contexto?: string;
  /**
   * Las cifras que deciden. `detalle` va en la misma línea y es la frase
   * completa ("de 1.586 ingresados"): el conector lo escribe quien arma la
   * fila, porque no toda cifra tiene un denominador.
   */
  filas: { etiqueta: string; valor: string; detalle?: string; tono?: string }[];
  /* `tono` sólo acepta clases que pasen 4,5:1 sobre `paper`: text-ink, text-rust
     (7,34) o text-moss (4,97). `text-amberTexto` da 3,47 y `text-clayTexto` 4,20: no. */
  pie?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const colocar = useCallback(() => {
    const el = ref.current;
    if (!el || !ancla) return setPos(null);
    const f = el.getBoundingClientRect();
    const m = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Al costado de la zona: el mapa del Perú es alto y angosto, así que a la
    // derecha casi siempre entra sin tapar la geografía que el usuario mira.
    let left = ancla.right + m;
    if (left + f.width > vw - m) left = ancla.left - f.width - m;
    if (left < m) left = Math.max(m, Math.min(ancla.left, vw - f.width - m));

    let top = ancla.top + ancla.height / 2 - f.height / 2;
    top = Math.max(m, Math.min(top, vh - f.height - m));

    setPos({ top, left });
  }, [ancla]);

  useLayoutEffect(() => {
    if (!abierto || !ancla) return setPos(null);
    colocar();
  }, [abierto, ancla, colocar]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.showPopover !== "function") return;
    try {
      if (abierto && !el.matches(":popover-open")) el.showPopover();
      if (!abierto && el.matches(":popover-open")) el.hidePopover();
    } catch {
      // Si el nodo todavía no está conectado, queda como `fixed` normal:
      // degradado correcto, no error.
    }
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    const onMover = () => colocar();
    window.addEventListener("scroll", onMover, true);
    window.addEventListener("resize", onMover);
    return () => {
      window.removeEventListener("scroll", onMover, true);
      window.removeEventListener("resize", onMover);
    };
  }, [abierto, colocar]);

  return (
    <div
      ref={ref}
      popover="manual"
      aria-hidden
      style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
      className={cn(
        "pointer-events-none fixed z-overlay m-0 w-60 rounded-2xl border border-line bg-paper p-0 text-ink shadow-pop",
        "transition-opacity duration-rapido ease-salida",
        abierto && pos ? "opacity-100" : "opacity-0",
      )}
    >
      <div className="border-b border-line bg-paperSoft px-3 py-2">
        <div className="font-serif text-[15px] font-bold leading-tight text-ink">{titulo}</div>
        {contexto && <div className="mt-0.5 text-[11px] leading-snug text-mute">{contexto}</div>}
      </div>
      <dl className="divide-y divide-line">
        {filas.map((f) => (
          <div key={f.etiqueta} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
            <dt className="shrink-0 text-[11px] text-mute">{f.etiqueta}</dt>
            <dd className="min-w-0 text-right">
              <span className={cn("font-mono text-[13px] font-semibold tabular-nums", f.tono ?? "text-ink")}>
                {f.valor}
              </span>
              {f.detalle && <span className="ml-1 text-[11px] text-mute">{f.detalle}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {pie && <div className="border-t border-line px-3 py-1.5 text-[11px] leading-snug text-mute">{pie}</div>}
    </div>
  );
}
