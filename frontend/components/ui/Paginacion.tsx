"use client";

/**
 * Control de paginación compartido: "N–M de TOTAL {nombre}" + anterior/siguiente.
 * Extraído de components/contratos/ContratosLista.tsx (única implementación previa,
 * duplicada en el resto de listas del sitio en vez de reusarla) para que /app/auditoria,
 * /app/entidades, /app/aliados, /app/denuncias y /app/alertas compartan la misma UX de
 * paginación en vez de cada una truncar su lista en silencio.
 *
 * `navegacion="url"`: la página vive en `?pagina=` — el link funciona sin JS.
 * `navegacion="interna"`: estado propio del cliente — `onChange(n)` dispara el fetch.
 *
 * Los enlaces van con `prefetch={false}`: prebajar la página siguiente de cada lista visible
 * era una consulta al API por paginador en cada vista, casi nunca usada.
 *
 * Dos formas de decirle a este componente cómo armar el link de cada página:
 *  - `href(n)`: una función ya armada por el llamador — solo válida si el llamador es OTRO
 *    client component (p.ej. ContratosLista). Un server component NO puede pasar una función
 *    como prop a un client component (React no puede serializarla) — varias páginas de este
 *    sitio son server components async y pisaron exactamente ese error en producción.
 *  - `hrefBase` + `query`: datos serializables (string/undefined) — Paginacion arma el href
 *    ELLA MISMA, porque acá adentro sí es seguro construir la función (ya estamos del lado
 *    cliente). Preferir esta forma cuando quien renderiza `<Paginacion>` es un server component.
 */

import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  actual: number;
  paginas: number;
  total: number;
  tam: number;
  navegacion: "url" | "interna";
  cargando: boolean;
  /** Sustantivo plural para "0 {nombre}" cuando total=0, p.ej. "contratos", "entidades". */
  nombre: string;
  /** Uso desde OTRO client component: función ya armada. */
  href?: (n: number) => string;
  onChange?: (n: number) => void;
  /** Uso directo desde un server component: solo datos, sin funciones. */
  hrefBase?: string;
  query?: Record<string, string | undefined>;
  /** Nombre del parámetro de página en la URL (`pagina` por defecto; el API de contratos usa `page`). */
  paramPagina?: string;
}

export function Paginacion({ actual, paginas, total, tam, navegacion, href, onChange, cargando, nombre, hrefBase, query, paramPagina = "pagina" }: Props) {
  const resolvedHref = href ?? ((n: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query ?? {})) if (v) params.set(k, v);
    if (n > 1) params.set(paramPagina, String(n));
    const qs = params.toString();
    return qs ? `${hrefBase ?? ""}?${qs}` : hrefBase ?? "";
  });
  const resolvedOnChange = onChange ?? (() => {});
  // Una URL como ?pagina=99 con 2 páginas daba "2.353–33 de 33". El rango, los
  // botones y el "N / M" se calculan siempre sobre una página que existe.
  const ultima = Math.max(1, paginas);
  const pagina = Math.min(Math.max(1, Math.floor(actual) || 1), ultima);
  const desde = total === 0 ? 0 : (pagina - 1) * tam + 1;
  const hasta = Math.min(total, pagina * tam);
  const btn = "inline-flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paper text-ink transition-colors hover:bg-paperDeep disabled:cursor-not-allowed disabled:opacity-40 aria-disabled:pointer-events-none aria-disabled:opacity-40";
  const prev = Math.max(1, pagina - 1);
  const next = Math.min(ultima, pagina + 1);
  return (
    <div className="flex items-center justify-between gap-2 text-[12px] text-mute">
      {/* Sin aria-live: varias páginas muestran dos paginadores (arriba y abajo) y el
          lector de pantalla anunciaba el mismo rango dos veces en cada cambio. */}
      <span className="font-mono tabular-nums">
        {cargando ? "cargando…" : total === 0 ? `0 ${nombre}` : `${desde.toLocaleString("es-PE")}–${hasta.toLocaleString("es-PE")} de ${total.toLocaleString("es-PE")}`}
      </span>
      <span className="inline-flex items-center gap-1.5">
        {navegacion === "url" ? (
          <Link href={resolvedHref(prev)} prefetch={false} aria-disabled={pagina <= 1} className={btn} aria-label="Página anterior" scroll={false}><ChevronLeft size={13} aria-hidden /></Link>
        ) : (
          <button type="button" disabled={pagina <= 1} onClick={() => resolvedOnChange(prev)} className={btn} aria-label="Página anterior"><ChevronLeft size={13} /></button>
        )}
        <span className="font-mono tabular-nums text-ink">{pagina}<span className="text-mute"> / {ultima}</span></span>
        {navegacion === "url" ? (
          <Link href={resolvedHref(next)} prefetch={false} aria-disabled={pagina >= ultima} className={btn} aria-label="Página siguiente" scroll={false}><ChevronRight size={13} aria-hidden /></Link>
        ) : (
          <button type="button" disabled={pagina >= ultima} onClick={() => resolvedOnChange(next)} className={btn} aria-label="Página siguiente"><ChevronRight size={13} /></button>
        )}
      </span>
    </div>
  );
}
