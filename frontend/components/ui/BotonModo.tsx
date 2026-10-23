"use client";

import { Moon, Sun } from "lucide-react";
import { cambiarModo, useModo } from "@/lib/modo";
import { cn } from "@/lib/utils";

/**
 * Botón de modo día / noche. Muestra a qué modo se pasa (sol de noche, luna de día) y lo dice con palabras al lector
 * de pantalla. `conTexto`: con la palabra al lado (menú del celular, barra lateral).
 */
export function BotonModo({ className, conTexto = false }: { className?: string; conTexto?: boolean }) {
  const modo = useModo();
  const destino = modo === "dia" ? "noche" : "dia";
  const texto = destino === "dia" ? "Modo día" : "Modo noche";
  const Icono = destino === "dia" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => cambiarModo(destino)}
      aria-label={`Cambiar a ${texto.toLowerCase()}`}
      title={`Cambiar a ${texto.toLowerCase()}`}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full border border-line bg-paper text-ink transition-colors duration-rapido hover:bg-paperDeep",
        conTexto ? "min-h-10 px-3.5 text-dato font-medium" : "h-10 w-10",
        className,
      )}
    >
      <Icono size={16} aria-hidden />
      {conTexto && <span>{texto}</span>}
    </button>
  );
}
