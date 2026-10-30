"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { usarFlotante } from "@/components/ui/Flotante";
import { cn } from "@/lib/utils";

export interface AccionMenu {
  etiqueta: string;
  icono?: React.ReactNode;
  /** Navega (con `externo`, en otra pestaña). Si no, `onClick`. */
  href?: string;
  externo?: boolean;
  onClick?: () => void;
  /** Borra, rechaza u oculta: va en rojo. */
  peligro?: boolean;
  deshabilitada?: boolean;
}

/**
 * Las acciones secundarias de una fila, en un menú «⋯». Antes cada fila de Procesamiento traía dos botones (Traza y
 * Re-analizar): 400 botones en una lista de 200 filas, y cada fila medía el doble. La acción principal es el clic en
 * la fila (abre el detalle o la ficha); las demás viven acá. Se abre en la capa superior, así que una tabla con
 * `overflow` no lo corta. Teclado: flechas, Inicio y Fin entre opciones; Esc cierra y devuelve el foco.
 */
export function MenuFila({ acciones, etiqueta = "Más acciones" }: { acciones: AccionMenu[]; etiqueta?: string }) {
  const [abierto, setAbierto] = useState(false);
  const id = useId();
  const { anclaRef, flotanteRef, pos } = usarFlotante(abierto, "abajo");

  useEffect(() => {
    if (!abierto) return;
    const onClic = (e: MouseEvent) => {
      const t = e.target as Node;
      if (flotanteRef.current?.contains(t) || anclaRef.current?.contains(t)) return;
      setAbierto(false);
    };
    // Al abrir, el foco va a la primera opción (como un menú nativo).
    const f = window.setTimeout(() => {
      flotanteRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
      document.addEventListener("mousedown", onClic);
    }, 0);
    return () => {
      window.clearTimeout(f);
      document.removeEventListener("mousedown", onClic);
    };
  }, [abierto, anclaRef, flotanteRef]);

  function cerrar(devolverFoco = false) {
    setAbierto(false);
    if (devolverFoco) (anclaRef.current as HTMLElement | null)?.focus();
  }

  function alTeclado(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      cerrar(e.key === "Escape");
      return;
    }
    const items = Array.from(flotanteRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const destino =
      e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (destino < 0) return;
    e.preventDefault();
    items[destino].focus();
  }

  const claseItem = (a: AccionMenu) =>
    cn(
      "flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-dato transition-colors duration-rapido focus-visible:bg-paperDeep focus-visible:outline-none",
      a.deshabilitada ? "cursor-not-allowed text-mute" : a.peligro ? "text-crimsonTexto hover:bg-crimson-soft" : "text-ink hover:bg-paperDeep",
    );

  return (
    <>
      <button
        type="button"
        ref={anclaRef as React.RefObject<HTMLButtonElement>}
        onClick={() => setAbierto((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls={abierto ? id : undefined}
        aria-label={etiqueta}
        title={etiqueta}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-inkSoft transition-colors duration-rapido hover:border-paperEdge hover:text-ink"
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      <span
        ref={flotanteRef}
        id={id}
        role="menu"
        aria-label={etiqueta}
        popover="manual"
        onKeyDown={alTeclado}
        style={pos ? { top: pos.top, left: pos.left } : { top: -9999, left: -9999 }}
        className={cn(
          "fixed z-overlay m-0 w-56 rounded-xl border border-line bg-paper p-1 text-ink shadow-pop transition-opacity duration-rapido",
          abierto && pos ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {acciones.map((a) =>
          a.href && !a.deshabilitada ? (
            <Link
              key={a.etiqueta}
              role="menuitem"
              tabIndex={-1}
              href={a.href}
              target={a.externo ? "_blank" : undefined}
              rel={a.externo ? "noopener noreferrer" : undefined}
              onClick={() => cerrar()}
              className={claseItem(a)}
            >
              {a.icono}
              {a.etiqueta}
            </Link>
          ) : (
            <button
              key={a.etiqueta}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-disabled={a.deshabilitada || undefined}
              onClick={() => {
                if (a.deshabilitada) return;
                cerrar();
                a.onClick?.();
              }}
              className={claseItem(a)}
            >
              {a.icono}
              {a.etiqueta}
            </button>
          ),
        )}
      </span>
    </>
  );
}
