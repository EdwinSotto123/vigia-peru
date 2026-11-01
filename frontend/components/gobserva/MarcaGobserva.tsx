import { cn } from "@/lib/utils";
import { PRODUCTOS, type Producto } from "@/lib/gobserva";

/**
 * La marca de los productos de Gobserva: la lupa con nodos y «gobserva_» en la letra de la marca (JetBrains Mono, como
 * «vigía_»), y al lado el nombre del producto en su placa («empleo», «licitaciones»). Colores por variable (globals.css,
 * --marca-*): lima sobre carbón de noche, verde sobre claro de día. Server-safe.
 */
export function MarcaGobserva({ producto, tamano = "md", className }: { producto?: Producto; tamano?: "sm" | "md" | "lg"; className?: string }) {
  const p = producto ? PRODUCTOS[producto] : null;
  const texto = tamano === "lg" ? "text-cifra" : tamano === "sm" ? "text-cuerpo" : "text-bloque";
  const iso = tamano === "lg" ? 34 : tamano === "sm" ? 20 : 26;
  return (
    <span role="img" aria-label={p ? p.titulo : "Gobserva"} className={cn("inline-flex items-center gap-2 leading-none", className)}>
      <IsotipoGobserva tamano={iso} />
      <span aria-hidden className={cn("font-mono font-bold tracking-[-0.06em] text-[rgb(var(--marca-texto))]", texto)}>
        gobserva<span className="cursor-parpadeo text-[rgb(var(--marca-acento))]">_</span>
      </span>
      {p && (
        <span aria-hidden className="rounded-md border border-granate/30 bg-granate-50 px-1.5 py-0.5 font-mono text-meta font-semibold leading-none text-granate">
          {p.nombre}
        </span>
      )}
    </span>
  );
}

/** La lupa de Gobserva: el lente con tres nodos unidos (lo que se mira y lo que se cruza) y su mango. */
export function IsotipoGobserva({ tamano = 26, className }: { tamano?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={tamano} height={tamano} aria-hidden className={cn("shrink-0 text-[rgb(var(--marca-acento))]", className)}>
      <circle cx="13.5" cy="13.5" r="9" fill="none" stroke="currentColor" strokeWidth="3" />
      <line x1="20.5" y1="20.5" x2="28" y2="28" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" />
      <g className="text-[rgb(var(--marca-texto))]" stroke="currentColor" strokeWidth="1.2" fill="currentColor">
        <line x1="10" y1="11" x2="16.5" y2="10" />
        <line x1="10" y1="11" x2="13.5" y2="16.5" />
        <line x1="16.5" y1="10" x2="13.5" y2="16.5" />
        <circle cx="10" cy="11" r="1.7" stroke="none" />
        <circle cx="16.5" cy="10" r="1.5" stroke="none" />
        <circle cx="13.5" cy="16.5" r="1.6" stroke="none" />
      </g>
    </svg>
  );
}
