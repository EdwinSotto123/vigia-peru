"use client";

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, IdCard, Search } from "lucide-react";
import { rutaEn } from "@/lib/gobserva";
import { rutaMedico } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

/**
 * El número de colegiatura del CMP y «Verificar»: lleva a /medico/<n>. Acepta lo que la persona copie («CMP 012345»,
 * «N.° 12345»): se quedan las cifras, sin ceros a la izquierda. No busca por nombre (lo dice la ayuda del campo).
 */
export function FormColegiatura({ base, inicial = "", className }: { base: string; inicial?: string; className?: string }) {
  const router = useRouter();
  const [valor, setValor] = useState(inicial);
  const [error, setError] = useState<string | null>(null);
  const [yendo, setYendo] = useState(false);
  const id = useId();

  function enviar(e: FormEvent) {
    e.preventDefault();
    const n = valor.replace(/\D/g, "").replace(/^0+/, "");
    if (!n) {
      setError(/\p{L}{3,}/u.test(valor) ? "Escribe el número, no el nombre: aquí no buscamos personas. En el CMP sí puedes buscar por apellidos." : "Escribe el número de colegiatura (sólo cifras).");
      return;
    }
    if (n.length > 7) {
      setError("Ese número es muy largo para una colegiatura. Revisa que no sea un DNI.");
      return;
    }
    setError(null);
    setYendo(true);
    // Si la página no cambia (el mismo número), el botón vuelve a estar listo.
    window.setTimeout(() => setYendo(false), 4000);
    router.push(rutaEn(base, rutaMedico(n)));
  }

  return (
    <form onSubmit={enviar} noValidate className={cn("min-w-0", className)} role="search" aria-label="Verificar una colegiatura del CMP">
      <label htmlFor={`${id}-n`} className="block text-dato font-semibold text-ink">
        Número de colegiatura (CMP)
      </label>
      <p id={`${id}-ayuda`} className="mt-0.5 text-meta text-inkSoft">
        Está en su sello y en sus recetas. No hace falta su nombre.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <IdCard size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
          <input
            id={`${id}-n`}
            name="colegiatura"
            value={valor}
            onChange={(e) => {
              setValor(e.target.value);
              if (error) setError(null);
            }}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={20}
            placeholder="Por ejemplo, 39054"
            aria-invalid={!!error}
            aria-describedby={`${id}-ayuda${error ? ` ${id}-error` : ""}`}
            className={cn(
              "h-12 w-full rounded-xl border bg-paper pl-11 pr-3 font-mono text-destacado tabular-nums text-ink placeholder:font-sans placeholder:text-mute focus:outline-none focus:ring-2 focus:ring-granate/30",
              error ? "border-crimson focus:border-crimson" : "border-line focus:border-granate",
            )}
          />
        </div>
        <button
          type="submit"
          disabled={yendo}
          className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-granate px-6 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-60"
        >
          <Search size={17} aria-hidden />
          {yendo ? "Abriendo…" : "Verificar"}
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 flex items-start gap-1.5 text-meta text-crimsonTexto">
          <CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}
    </form>
  );
}
