import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * Piezas chicas de Gobserva Empleo, todas server-safe: el buscador (un formulario GET que funciona sin JavaScript), una
 * cifra de cabecera, barras con enlace (regiones, niveles, entidades), la ruta de navegación, el paginador, el enlace
 * «ver las N» de una muestra y las preguntas frecuentes.
 */

/** El enlace al pie de una muestra («Ver las 1,986 que cierran esta semana»): píldora de 44 px, que se toca con el dedo. */
export const CLASE_VER_TODAS = cn(CLASE_ACCION_LISTA, "min-h-11 gap-1.5");

/** El buscador grande: lleva a la lista con lo escrito (`q`). */
export function Buscador({ accion, inicial, oscuro = false, className }: { accion: string; inicial?: string; oscuro?: boolean; className?: string }) {
  return (
    <form action={accion} method="get" role="search" className={cn("flex w-full min-w-0 gap-2", className)}>
      <label className="relative min-w-0 flex-1">
        <span className="sr-only">Buscar un puesto, una entidad o una ciudad</span>
        <Search size={18} aria-hidden className={cn("pointer-events-none absolute left-4 top-1/2 -translate-y-1/2", oscuro ? "text-paper/60" : "text-mute")} />
        <input
          name="q"
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          defaultValue={inicial}
          minLength={2}
          maxLength={80}
          placeholder="Enfermera, chofer, Cusco…"
          className={cn(
            "h-14 w-full rounded-2xl border pl-11 pr-4 text-destacado focus:outline-none focus:ring-2",
            oscuro
              ? "border-paper/20 bg-paper/10 text-paper placeholder:text-paper/60 focus:border-maiz focus:ring-maiz/40"
              : "border-line bg-paper text-ink placeholder:text-mute focus:border-granate focus:ring-granate/30",
          )}
        />
      </label>
      <button
        type="submit"
        className={cn(
          "inline-flex h-14 min-w-14 shrink-0 items-center justify-center gap-2 rounded-2xl px-4 text-cuerpo font-semibold transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 sm:px-5",
          oscuro ? "bg-maiz text-sobreMaiz hover:bg-maiz/85 focus-visible:ring-paper" : "bg-granate text-paper hover:bg-granate-deep focus-visible:ring-granate",
        )}
      >
        <Search size={18} aria-hidden className="sm:hidden" />
        <span className="max-sm:sr-only">Buscar plazas</span>
      </button>
    </form>
  );
}

/** Una cifra de cabecera: el número grande, qué es y su contexto. */
export function CifraEmpleo({ valor, etiqueta, contexto, icono, tono = "neutro" }: { valor: string; etiqueta: string; contexto?: ReactNode; icono?: ReactNode; tono?: "neutro" | "acento" | "urgente" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-line bg-paper px-4 py-4 sm:px-5">
      <p className="flex items-center gap-1.5 text-meta font-medium text-inkSoft">
        {icono}
        <span className="min-w-0">{etiqueta}</span>
      </p>
      <p className={cn("font-display text-cifra font-bold leading-none tracking-tight tabular-nums", tono === "acento" ? "text-granate" : tono === "urgente" ? "text-rust" : "text-ink")}>{valor}</p>
      {contexto && <p className="text-meta leading-snug text-mute">{contexto}</p>}
    </div>
  );
}

/**
 * Barras horizontales con enlace: una fila por valor (nombre, número, barra contra la mayor y un detalle opcional). Cada
 * fila mide al menos 44 px (se toca con el dedo) y el nombre puede ocupar dos líneas. `columnas`: desde tableta;
 * `columnasCelular={2}` también en el celular, para nombres cortos (las 25 regiones medían 1,700 px en una columna).
 */
export function BarrasEnlace({
  filas,
  etiqueta,
  columnas = 1,
  columnasCelular = 1,
}: {
  filas: { clave: string; nombre: string; n: number; href: string; detalle?: string }[];
  etiqueta: string;
  columnas?: 1 | 2;
  columnasCelular?: 1 | 2;
}) {
  const mayor = Math.max(1, ...filas.map((f) => f.n));
  return (
    <ul aria-label={etiqueta} className={cn("grid gap-y-1", columnasCelular === 2 ? "grid-cols-2 gap-x-4" : "grid-cols-1", columnas === 2 && "md:grid-cols-2 md:gap-x-8")}>
      {filas.map((f) => (
        <li key={f.clave} className="min-w-0">
          <Link
            href={f.href}
            className="-mx-2 flex min-h-11 flex-col justify-center rounded-xl px-2 py-1.5 transition-colors duration-rapido hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
          >
            <span className="flex items-baseline justify-between gap-2">
              <span className="line-clamp-2 min-w-0 text-dato font-medium leading-snug text-ink">{f.nombre}</span>
              <span className="shrink-0 font-mono text-dato font-semibold tabular-nums text-ink">{numero(f.n)}</span>
            </span>
            <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-paperDeep">
              <span className="block h-full rounded-full bg-granate/80" style={{ width: `${Math.max(2, (f.n / mayor) * 100)}%` }} />
            </span>
            {f.detalle && <span className="mt-0.5 block truncate text-rotulo text-mute">{f.detalle}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * La ruta arriba de una página: «Inicio › Plazas › Aviso 820317». Cada enlace tiene 44 px de alto para el dedo (con
 * margen negativo: la línea no crece). Sin datos estructurados (Migas los arma para Vigía, con su dominio).
 */
export function Ruta({ items }: { items: { etiqueta: string; href?: string }[] }) {
  return (
    <nav aria-label="Ruta de navegación">
      <ol className="flex flex-wrap items-center gap-x-1 text-meta">
        {items.map((m, i) => {
          const ultima = i === items.length - 1;
          return (
            <li key={`${i}-${m.etiqueta}`} className="inline-flex min-w-0 max-w-full items-center gap-1">
              {i > 0 && <ChevronRight size={13} aria-hidden className="shrink-0 text-mute" />}
              {m.href && !ultima ? (
                <Link href={m.href} className="-my-3 inline-flex min-h-11 items-center truncate px-0.5 text-inkSoft underline-offset-4 transition-colors duration-rapido hover:text-granate hover:underline">
                  {m.etiqueta}
                </Link>
              ) : (
                <span aria-current={ultima ? "page" : undefined} className="truncate px-0.5 text-mute">
                  {m.etiqueta}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Anterior, «página X de Y» y siguiente, como enlaces (la página va en la URL). En el celular, los botones son sólo la
 * flecha (con su nombre para el lector de pantalla) para que «Página 1 de 277» quepa en una línea.
 */
export function Paginador({ pagina, paginas, href }: { pagina: number; paginas: number; href: (p: number) => string }) {
  if (paginas <= 1) return null;
  const boton =
    "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-line bg-paper px-3 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:text-granate sm:px-4";
  return (
    <nav aria-label="Páginas de la lista" className="flex items-center justify-center gap-3">
      {pagina > 1 ? (
        <Link href={href(pagina - 1)} className={boton} scroll>
          <ChevronLeft size={16} aria-hidden />
          <span className="max-sm:sr-only">Anterior</span>
        </Link>
      ) : (
        <span className={cn(boton, "pointer-events-none opacity-40")} aria-hidden>
          <ChevronLeft size={16} />
          <span className="max-sm:hidden">Anterior</span>
        </span>
      )}
      <span className="whitespace-nowrap text-dato tabular-nums text-inkSoft">
        Página <b className="text-ink">{numero(pagina)}</b> de {numero(paginas)}
      </span>
      {pagina < paginas ? (
        <Link href={href(pagina + 1)} className={boton} scroll>
          <span className="max-sm:sr-only">Siguiente</span>
          <ChevronRight size={16} aria-hidden />
        </Link>
      ) : (
        <span className={cn(boton, "pointer-events-none opacity-40")} aria-hidden>
          <span className="max-sm:hidden">Siguiente</span>
          <ChevronRight size={16} />
        </span>
      )}
    </nav>
  );
}

/** Preguntas frecuentes, plegadas: cada una se abre sola. */
export function Preguntas({ items, id = "preguntas", titulo = "Preguntas frecuentes" }: { items: { p: string; r: ReactNode }[]; id?: string; titulo?: string }) {
  return (
    <section aria-labelledby={`${id}-t`} id={id} className="scroll-mt-20">
      <h2 id={`${id}-t`} className="font-display text-seccion font-bold leading-tight text-ink">
        {titulo}
      </h2>
      <div className="mt-5 divide-y divide-line rounded-2xl border border-line bg-paper">
        {items.map((it) => (
          <details key={it.p} className="group px-4 py-1 sm:px-5">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-2 text-cuerpo font-semibold text-ink [&::-webkit-details-marker]:hidden">
              {it.p}
              <ChevronRight size={18} aria-hidden className="shrink-0 text-mute transition-transform duration-rapido group-open:rotate-90" />
            </summary>
            <div className="max-w-[75ch] pb-4 text-dato leading-relaxed text-inkSoft">{it.r}</div>
          </details>
        ))}
      </div>
    </section>
  );
}
