"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { useLista } from "@/lib/licitaciones-app/useListaUrl";

/**
 * El buscador de la bandeja: busca mientras escribes (con una pausa de 400 ms), con Enter al toque, y Escape lo vacía.
 * Si la URL cambia por otro lado (el botón Atrás, una búsqueda guardada), el campo la sigue.
 */
export function Buscador() {
  const { filtros, ir, pendiente } = useLista();
  const [texto, setTexto] = useState(filtros.q);
  const ultimo = useRef(filtros.q);

  useEffect(() => {
    setTexto(filtros.q);
    ultimo.current = filtros.q;
  }, [filtros.q]);

  useEffect(() => {
    const t = texto.trim();
    if (t === ultimo.current) return;
    const h = setTimeout(() => {
      ultimo.current = t;
      ir({ q: t });
    }, 400);
    return () => clearTimeout(h);
  }, [texto, ir]);

  const ya = () => {
    const t = texto.trim();
    if (t === ultimo.current) return;
    ultimo.current = t;
    ir({ q: t });
  };

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        ya();
      }}
      className="relative min-w-0 flex-1"
    >
      <label htmlFor="bandeja-q" className="sr-only">Buscar en la bandeja</label>
      {pendiente ? (
        <Loader2 size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 animate-spin text-mute" />
      ) : (
        <Search size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
      )}
      <input
        id="bandeja-q"
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && texto) {
            e.preventDefault();
            setTexto("");
          }
        }}
        maxLength={120}
        placeholder="Busca por lo que vendes, la entidad, el código o el RUC"
        className="h-11 w-full rounded-lg border border-line bg-caja pl-11 pr-11 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato [&::-webkit-search-cancel-button]:hidden"
      />
      {texto && (
        <button
          type="button"
          onClick={() => setTexto("")}
          aria-label="Borrar la búsqueda"
          className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-mute hover:bg-ink/[0.06] hover:text-ink"
        >
          <X size={16} aria-hidden />
        </button>
      )}
    </form>
  );
}
