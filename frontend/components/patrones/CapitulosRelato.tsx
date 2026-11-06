"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * El relato de una ficha en CAPÍTULOS QUE SE LEEN DE A UNO (pedido del usuario del 2026-11-05: «divídelo por subsecciones,
 * menos scroll»). Antes los cinco capítulos iban uno debajo del otro: la ficha medía de 3 400 a 4 900 px y lo que estaba
 * en el capítulo 4 quedaba a cuatro pantallas. Ahora:
 *
 * - Una barra con los capítulos numerados (1 Qué pasó, 2 Por qué llama la atención…), con el conteo de cada uno y el color
 *   de su señal más grave. Se ve uno a la vez; desde md la barra queda pegada arriba (debajo de las pestañas de la ficha).
 * - Al pie de cada capítulo, «Siguiente: 3. Quién ganó»: la historia se sigue en orden sin buscar dónde seguía.
 * - Todo llega armado del servidor y queda en la página (oculto con `hidden`): las anclas siguen andando. Un enlace a algo
 *   que está en otro capítulo (el chip «Único postor» de la cronología lleva a su tarjeta en «Por qué llama la atención»,
 *   la frase lleva a «Qué proceso paga») abre ese capítulo y baja hasta él. Al imprimir salen todos.
 * - El capítulo va a la URL (`?cap=`, con `history.replaceState`): el enlace comparte el capítulo abierto. Las claves son
 *   únicas en la página, así que dos relatos (la historia y la red del proveedor) comparten el parámetro sin pisarse.
 * - Pestañas de WAI-ARIA: `tablist`/`tab`/`tabpanel`, flechas, Inicio y Fin.
 */

type Tono = "alta" | "media" | "baja";

export interface CapituloRelato {
  /** Clave en la URL y ancla del capítulo (`#relato-por-que`): única en la página. */
  id: string;
  /** Corto, para la barra: «Qué pasó», «Por qué llama la atención». */
  titulo: string;
  /** El título del capítulo abierto si dice más que el de la barra («Quién ganó y con quién compite»). Sin él, el h2 es el
   * de la barra, sólo para el lector de pantalla (la barra ya lo muestra justo encima). */
  tituloLargo?: ReactNode;
  /** Una línea que dice qué se va a leer. */
  bajada?: ReactNode;
  /** Un enlace a la derecha del título («Ver los 274 publicados»). */
  accion?: ReactNode;
  /** Cuántas cosas trae (señales, postores). `null` o sin él: no se muestra. */
  conteo?: number | null;
  /** La señal más grave del capítulo: pinta el conteo. */
  tono?: Tono;
  contenido: ReactNode;
}

const CONTEO_TONO: Record<Tono | "neutro", string> = {
  alta: "bg-crimson-soft text-crimsonTexto",
  media: "bg-amber-soft text-amberTexto",
  baja: "bg-paperDeep text-inkSoft",
  neutro: "bg-paperDeep text-inkSoft",
};

export function CapitulosRelato({
  capitulos,
  etiqueta = "Capítulos",
  activa,
  url = true,
  nivel = 2,
  className,
}: {
  capitulos: CapituloRelato[];
  etiqueta?: string;
  /** El capítulo abierto al cargar (si el servidor lo sabe). Si no, el de `?cap=` o el del `#ancla`, al montar. */
  activa?: string;
  /** `false` en un panel lateral: el capítulo no va a la URL de la lista. */
  url?: boolean;
  /** El nivel del título de cada capítulo: 3 dentro de un panel que ya tiene su h2. */
  nivel?: 2 | 3;
  className?: string;
}) {
  const inicial = capitulos.some((c) => c.id === activa) ? activa! : capitulos[0]?.id;
  const [actual, setActual] = useState(inicial);
  const uid = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  const ids = capitulos.map((c) => c.id).join("|");

  /** El capítulo (de ESTE relato) en que está un elemento de la página, o null. */
  const capituloDe = (el: Element | null): string | null => {
    const panel = el?.closest<HTMLElement>("[data-relato-panel]");
    return panel && panel.dataset.relato === uid ? (panel.dataset.relatoPanel ?? null) : null;
  };

  /** Lleva la vista al principio del relato si quedó arriba de la pantalla (se leía el final de un capítulo largo). */
  const subir = (siempre: boolean) => {
    const r = raiz.current;
    if (!r) return;
    if (siempre || r.getBoundingClientRect().top < 0) r.scrollIntoView({ block: "start" });
  };

  const elegir = (id: string, { enfocar = false, alPrincipio = false }: { enfocar?: boolean; alPrincipio?: boolean } = {}) => {
    setActual(id);
    if (url) {
      try {
        const u = new URL(window.location.href);
        if (id === capitulos[0]?.id) {
          // Sólo se borra el parámetro si era de este relato (otro relato de la página puede tener el suyo).
          if (capitulos.some((c) => c.id === u.searchParams.get("cap"))) u.searchParams.delete("cap");
        } else u.searchParams.set("cap", id);
        u.hash = "";
        window.history.replaceState(window.history.state, "", u);
      } catch {
        /* sin URL no se comparte el capítulo, pero cambia igual */
      }
    }
    if (enfocar) botones.current[capitulos.findIndex((c) => c.id === id)]?.focus();
    requestAnimationFrame(() => subir(alPrincipio));
  };

  /** Abre el capítulo que contiene `destino` y baja hasta él. */
  const irA = (destino: HTMLElement, hash: string) => {
    const cap = capituloDe(destino);
    if (!cap) return false;
    setActual(cap);
    requestAnimationFrame(() => {
      destino.scrollIntoView({ block: "start" });
      try {
        const u = new URL(window.location.href);
        if (url) {
          if (cap === capitulos[0]?.id) u.searchParams.delete("cap");
          else u.searchParams.set("cap", cap);
        }
        u.hash = hash;
        window.history.replaceState(window.history.state, "", u);
      } catch {
        /* nada */
      }
    });
    return true;
  };

  // Al montar: el capítulo de la URL (`?cap=`) o el que tiene el `#ancla` pedido.
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const destino = hash ? document.getElementById(decodeURIComponent(hash)) : null;
    if (destino && capituloDe(destino)) {
      irA(destino, hash);
      return;
    }
    if (!url) return;
    const pedido = new URLSearchParams(window.location.search).get("cap");
    if (pedido && pedido !== actual && capitulos.some((c) => c.id === pedido)) setActual(pedido);
    // Sólo al montar (y si cambian los capítulos).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  // Un enlace a un ancla que está en un capítulo cerrado: se abre el capítulo antes de que el navegador busque el ancla
  // (en captura; oculto, el navegador no baja a nada).
  useEffect(() => {
    const alClic = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href*='#']") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self")) return;
      let u: URL;
      try {
        u = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (u.origin !== window.location.origin || u.pathname !== window.location.pathname || !u.hash) return;
      const hash = u.hash.slice(1);
      const destino = document.getElementById(decodeURIComponent(hash));
      if (!destino) return;
      const cap = capituloDe(destino);
      if (!cap || cap === actual) return;
      e.preventDefault();
      e.stopPropagation();
      irA(destino, hash);
    };
    document.addEventListener("click", alClic, true);
    return () => document.removeEventListener("click", alClic, true);
  });

  const alTeclado = (e: React.KeyboardEvent, i: number) => {
    const n = capitulos.length;
    const destino =
      e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (destino < 0) return;
    e.preventDefault();
    elegir(capitulos[destino].id, { enfocar: true });
  };

  if (capitulos.length === 0) return null;
  const Titulo = nivel === 3 ? "h3" : "h2";

  return (
    <div ref={raiz} className={cn("scroll-mt-[calc(var(--alto-barra-fija,0px)+0.5rem)]", className)}>
      {/* Desde md, pegada arriba (debajo de la barra de pestañas de la ficha, si la hay): se cambia de capítulo sin subir. */}
      <div className="relative z-[5] md:sticky md:top-[calc(var(--alto-barra-fija,0px)+0.5rem)]">
        <div
          role="tablist"
          aria-label={etiqueta}
          className="flex gap-1 overflow-x-auto rounded-2xl border border-line bg-paper p-1 shadow-[0_1px_2px_rgb(var(--ink)/0.06)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {capitulos.map((c, i) => {
            const sel = c.id === actual;
            return (
              <button
                key={c.id}
                ref={(el) => {
                  botones.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${c.id}`}
                aria-selected={sel}
                aria-controls={c.id}
                tabIndex={sel ? 0 : -1}
                onClick={() => elegir(c.id)}
                onKeyDown={(e) => alTeclado(e, i)}
                className={cn(
                  "inline-flex min-h-[40px] shrink-0 items-center gap-2 whitespace-nowrap rounded-xl pl-1.5 pr-3 text-meta transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate",
                  sel ? "bg-granate-50 font-semibold text-granate" : "font-medium text-inkSoft hover:bg-paperSoft hover:text-ink",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-rotulo font-bold tabular-nums",
                    sel ? "bg-granate text-paper" : "bg-paperDeep text-inkSoft",
                  )}
                >
                  {i + 1}
                </span>
                {c.titulo}
                {c.conteo != null && c.conteo > 0 && (
                  <span className={cn("rounded-full px-1.5 text-rotulo font-semibold tabular-nums", CONTEO_TONO[c.tono ?? "neutro"])}>{numero(c.conteo)}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {capitulos.map((c, i) => {
        const sel = c.id === actual;
        const antes = capitulos[i - 1];
        const despues = capitulos[i + 1];
        return (
          <section
            key={c.id}
            id={c.id}
            role="tabpanel"
            aria-labelledby={`${uid}-titulo-${c.id}`}
            data-relato={uid}
            data-relato-panel={c.id}
            hidden={!sel}
            className="scroll-mt-[calc(var(--alto-barra-fija,0px)+4.5rem)] pt-4 print:!block"
          >
            <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-1", (c.tituloLargo || c.bajada || c.accion) && "mb-3")}>
              <div className="min-w-0">
                <Titulo
                  id={`${uid}-titulo-${c.id}`}
                  className={c.tituloLargo ? "font-display text-bloque font-bold leading-tight text-ink text-balance" : "sr-only"}
                >
                  <span className="sr-only">{`Capítulo ${i + 1}: `}</span>
                  {c.tituloLargo ?? c.titulo}
                </Titulo>
                {c.bajada && <p className={cn("max-w-prose text-meta leading-snug text-inkSoft text-pretty", c.tituloLargo && "mt-0.5")}>{c.bajada}</p>}
              </div>
              {c.accion && <div className="shrink-0">{c.accion}</div>}
            </div>

            {c.contenido}

            {/* El paso siguiente de la historia (y volver al anterior), sin subir a buscar la barra. */}
            {(antes || despues) && (
              <nav aria-label="Seguir leyendo" className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 print:hidden">
                {antes ? (
                  <button
                    type="button"
                    onClick={() => elegir(antes.id, { alPrincipio: true })}
                    className="inline-flex min-h-[40px] items-center gap-1 rounded-full px-2.5 text-meta font-medium text-inkSoft transition-colors duration-rapido hover:bg-paperSoft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                  >
                    <ChevronLeft size={16} aria-hidden />
                    <span className="sr-only">Capítulo anterior: </span>
                    {antes.titulo}
                  </button>
                ) : (
                  <span />
                )}
                {despues && (
                  <button
                    type="button"
                    onClick={() => elegir(despues.id, { alPrincipio: true })}
                    className="ml-auto inline-flex min-h-[40px] max-w-full items-center gap-2 rounded-full border border-line bg-paper pl-4 pr-3 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                  >
                    <span className="font-normal text-inkSoft">Sigue:</span>
                    <span className="truncate">
                      {i + 2}. {despues.titulo}
                    </span>
                    {despues.conteo != null && despues.conteo > 0 && (
                      <span className={cn("rounded-full px-1.5 text-rotulo font-semibold tabular-nums", CONTEO_TONO[despues.tono ?? "neutro"])}>{numero(despues.conteo)}</span>
                    )}
                    <ChevronRight size={16} className="shrink-0 text-granate" aria-hidden />
                  </button>
                )}
              </nav>
            )}
          </section>
        );
      })}
    </div>
  );
}
