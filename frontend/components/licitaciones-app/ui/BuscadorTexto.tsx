"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";

/**
 * El buscador de una lista: busca mientras escribes (con una pausa de 400 ms), con Enter al toque, y Escape lo vacía. Si
 * la URL cambia por otro lado (el botón Atrás, una búsqueda guardada), el campo la sigue.
 */
export function BuscadorTexto({ id, q, buscar, pendiente, placeholder, etiqueta }: { id: string; q: string; buscar: (q: string) => void; pendiente: boolean; placeholder: string; etiqueta: string }) {
  const [texto, setTexto] = useState(q);
  const ultimo = useRef(q);

  useEffect(() => {
    setTexto(q);
    ultimo.current = q;
  }, [q]);

  useEffect(() => {
    const t = texto.trim();
    if (t === ultimo.current) return;
    const h = setTimeout(() => {
      ultimo.current = t;
      buscar(t);
    }, 400);
    return () => clearTimeout(h);
  }, [texto, buscar]);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const t = texto.trim();
        if (t === ultimo.current) return;
        ultimo.current = t;
        buscar(t);
      }}
      className="relative min-w-0 flex-1"
    >
      <label htmlFor={id} className="sr-only">{etiqueta}</label>
      {pendiente ? (
        <Loader2 size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 animate-spin text-mute" />
      ) : (
        <Search size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
      )}
      <input
        id={id}
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
        placeholder={placeholder}
        className="h-11 w-full rounded-lg border border-line bg-caja pl-11 pr-11 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato [&::-webkit-search-cancel-button]:hidden"
      />
      {texto && (
        <button type="button" onClick={() => setTexto("")} aria-label="Borrar la búsqueda" className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-mute hover:bg-ink/[0.06] hover:text-ink">
          <X size={16} aria-hidden />
        </button>
      )}
    </form>
  );
}
