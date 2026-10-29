"use client";

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";

/**
 * Pestañas dentro de una página (DESIGN_SYSTEM.md §14.3): en vez de apilar cinco
 * secciones que obligan a bajar y bajar, cada una es una pestaña y se cambia con un clic
 * sin salir de la página.
 *
 * - Todo el contenido llega ya armado del servidor (ReactNode) y se muestra una pestaña a
 *   la vez: cambiar es instantáneo, sin pedir nada.
 * - La pestaña va a la URL (`?seccion=`) con `history.replaceState`: el enlace comparte la
 *   vista exacta ("mira las señales de este aliado") sin recargar ni ensuciar el historial.
 *   La inicial la decide el servidor (`activa`), así no hace falta `useSearchParams`.
 * - Accesible como el patrón de pestañas de WAI-ARIA: `tablist`/`tab`/`tabpanel`, flechas,
 *   Inicio y Fin; en el celular la barra se desliza en una sola fila.
 * - Cada pestaña se monta la primera vez que se abre (la inicial, en el servidor): una
 *   página con siete pestañas pesadas no dibuja las siete al cargar. Visitada, queda montada.
 * - `fija`: la barra queda pegada arriba al bajar (las fichas: entidad, empresa, persona…).
 * - Un botón fuera de la barra ("Ver las señales") cambia de pestaña con `irAPestana()`.
 * - La barra es una franja con superficie (no texto gris sobre el fondo: "parecía texto suelto"), la activa rellena en
 *   granate suave. Si no entra (9 pestañas a 1366 px, o el celular), se difumina en el borde y aparecen flechas: ninguna
 *   pestaña queda fuera de alcance del mouse. La activa siempre a la vista.
 * - `variante="segunda"`: pestañas DENTRO de una pestaña (En qué gasta, la traza): píldora más chica, para que no se
 *   confunda con la barra de la ficha.
 * - Cada panel sabe su nombre: `CabeceraPestana` lo usa como su título (h2), sin repetirlo en cada página.
 */

const EVENTO = "vigia:pestana";
/** Lo que avisa Pestanas cada vez que cambia la pestaña abierta (lo escucha la ruta de navegación, Migas). */
export const EVENTO_ACTIVA = "vigia:pestana-activa";

/** Cambia de pestaña desde cualquier botón de la página: `irAPestana("senales")`. */
export function irAPestana(clave: string, param = "seccion") {
  window.dispatchEvent(new CustomEvent(EVENTO, { detail: { clave, param } }));
}

export interface Pestana {
  clave: string;
  etiqueta: string;
  /** Conteo al lado del nombre. `null` = sin dato: no se muestra un 0. */
  conteo?: number | null;
  /** Ícono a la izquierda del nombre (un `<Icono size={15} aria-hidden />` ya armado). */
  icono?: ReactNode;
  /** El título del panel abierto (el h2 de su `CabeceraPestana`). Por defecto, `etiqueta`. */
  titulo?: string;
  contenido: ReactNode;
}

/** El panel en que está una `CabeceraPestana`: su nombre es el título de la cabecera (h2; h3 en `variante="segunda"`). */
const PanelActual = createContext<{ titulo: string; nivel: 2 | 3 } | null>(null);

/** `useLayoutEffect` sin el aviso del render en el servidor. */
const useEfectoDeMedida = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type Desborde = { izq: boolean; der: boolean };

// Clases literales (Tailwind sólo genera lo que ve escrito entero). Difumina el borde por donde hay más pestañas.
const MASCARA: Record<string, string> = {
  "true-true": "[mask-image:linear-gradient(to_right,transparent,black_2.5rem,black_calc(100%-2.5rem),transparent)]",
  "true-false": "[mask-image:linear-gradient(to_right,transparent,black_2.5rem)]",
  "false-true": "[mask-image:linear-gradient(to_right,black_calc(100%-2.5rem),transparent)]",
  "false-false": "",
};

export function Pestanas({
  pestanas,
  activa,
  param = "seccion",
  etiqueta,
  fija = false,
  variante = "pagina",
  className,
}: {
  pestanas: Pestana[];
  /** La clave activa al cargar (del `searchParams` del servidor). */
  activa?: string;
  param?: string;
  /** Nombre de la barra para el lector de pantalla: "Secciones del perfil". */
  etiqueta: string;
  /** La barra queda fija arriba al bajar (páginas largas). */
  fija?: boolean;
  /** `segunda`: pestañas dentro de otra pestaña (más chicas, en píldora). */
  variante?: "pagina" | "segunda";
  className?: string;
}) {
  const inicial = pestanas.some((p) => p.clave === activa) ? activa! : pestanas[0]?.clave;
  const [actual, setActual] = useState(inicial);
  const [visitadas, setVisitadas] = useState<Set<string | undefined>>(() => new Set([inicial]));
  const id = useId();
  const botones = useRef<(HTMLButtonElement | null)[]>([]);

  // `destino`: la URL entera del enlace que la abrió (con sus filtros). Una pestaña que se pide al abrirla
  // (PestanaAPedido) pide la URL de la barra: sin esto pedía la suya sin los filtros del enlace y, por ser el último
  // pedido, ganaba (la oficina del organigrama abría la planilla entera, sin `lofi`).
  const elegir = (clave: string, enfocar = false, destino?: URL) => {
    setActual(clave);
    setVisitadas((v) => (v.has(clave) ? v : new Set(v).add(clave)));
    try {
      const url = destino ?? new URL(window.location.href);
      if (!destino) {
        if (clave === pestanas[0]?.clave) url.searchParams.delete(param);
        else url.searchParams.set(param, clave);
      }
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* sin URL no se comparte la vista, pero la pestaña cambia igual */
    }
    if (enfocar) botones.current[pestanas.findIndex((p) => p.clave === clave)]?.focus();
    window.dispatchEvent(new CustomEvent(EVENTO_ACTIVA, { detail: { param, clave } }));
  };

  // Un enlace de esta misma página a una pestaña (`?seccion=contratos&…`, una cifra de arriba) cuando el servidor ya
  // tenía esa: el `key` de la página no cambia y Next reusa el árbol que ya tiene, así que la barra ni se entera. Se
  // abre al hacer clic (en captura: antes de que el enlace de Next lo cancele). Sólo una clave explícita y válida.
  useEffect(() => {
    const alClic = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self")) return;
      let url: URL;
      try {
        url = new URL(a.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin || url.pathname !== window.location.pathname) return;
      const pedida = url.searchParams.get(param);
      if (pedida && pedida !== actual && pestanas.some((p) => p.clave === pedida)) elegir(pedida, false, url);
    };
    document.addEventListener("click", alClic, true);
    return () => document.removeEventListener("click", alClic, true);
  });

  // `irAPestana()` desde cualquier botón de la página.
  useEffect(() => {
    const alPedir = (e: Event) => {
      const d = (e as CustomEvent<{ clave: string; param: string }>).detail;
      if (d?.param === param && pestanas.some((p) => p.clave === d.clave)) elegir(d.clave, true);
    };
    window.addEventListener(EVENTO, alPedir);
    return () => window.removeEventListener(EVENTO, alPedir);
  });

  const alTeclado = (e: React.KeyboardEvent, i: number) => {
    const n = pestanas.length;
    const destino =
      e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (destino < 0) return;
    e.preventDefault();
    elegir(pestanas[destino].clave, true);
  };

  // ¿Quedan pestañas fuera de la franja, a la izquierda o a la derecha?
  const riel = useRef<HTMLDivElement>(null);
  const [desborde, setDesborde] = useState<Desborde>({ izq: false, der: false });
  const medir = useCallback(() => {
    const r = riel.current;
    if (!r) return;
    const izq = r.scrollLeft > 2;
    const der = r.scrollLeft + r.clientWidth < r.scrollWidth - 2;
    setDesborde((d) => (d.izq === izq && d.der === der ? d : { izq, der }));
  }, []);
  useEffect(() => {
    const r = riel.current;
    if (!r) return;
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(r);
    return () => ro.disconnect();
  }, [medir]);
  // La activa, siempre a la vista dentro de la franja (sin mover la página: nada de scrollIntoView).
  useEfectoDeMedida(() => {
    const r = riel.current;
    const b = botones.current[pestanas.findIndex((p) => p.clave === actual)];
    if (!r || !b) return;
    const margen = 40;
    if (b.offsetLeft - margen < r.scrollLeft) r.scrollLeft = Math.max(0, b.offsetLeft - margen);
    else if (b.offsetLeft + b.offsetWidth + margen > r.scrollLeft + r.clientWidth) r.scrollLeft = b.offsetLeft + b.offsetWidth + margen - r.clientWidth;
    medir();
  }, [actual, pestanas, medir]);
  const correr = (lado: -1 | 1) => riel.current?.scrollBy({ left: lado * riel.current.clientWidth * 0.7, behavior: "smooth" });

  const segunda = variante === "segunda";

  return (
    // Con la barra fija, lo que se pega arriba dentro de la pestaña (rótulos de grupo de una Tabla) va debajo de ella:
    // `--alto-barra-fija` es su alto (en el celular, más la barra del sitio de 3 rem).
    <div className={cn(fija && !segunda && "[--alto-barra-fija:6.5rem] md:[--alto-barra-fija:3.5rem]", className)}>
      <div className={cn("relative", fija && !segunda && "sticky top-0 z-barra")}>
        <div
          ref={riel}
          role="tablist"
          aria-label={etiqueta}
          onScroll={medir}
          className={cn(
            "flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            segunda
              ? "w-fit max-w-full gap-1 rounded-full border border-line bg-paperSoft p-1"
              : "gap-1 rounded-2xl border border-line bg-paper p-1 shadow-[0_1px_2px_rgb(var(--ink)/0.04)]",
            MASCARA[`${desborde.izq}-${desborde.der}`],
          )}
        >
          {pestanas.map((p, i) => {
            const sel = p.clave === actual;
            return (
              <button
                key={p.clave}
                ref={(el) => {
                  botones.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${p.clave}`}
                aria-selected={sel}
                aria-controls={`${id}-panel-${p.clave}`}
                tabIndex={sel ? 0 : -1}
                onClick={() => elegir(p.clave)}
                onKeyDown={(e) => alTeclado(e, i)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 whitespace-nowrap font-medium transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate",
                  segunda ? "min-h-[36px] rounded-full px-3 text-meta" : "min-h-[44px] rounded-xl px-3.5 text-dato",
                  sel
                    ? segunda
                      ? "bg-paper font-semibold text-granate shadow-[0_1px_2px_rgb(var(--ink)/0.08)]"
                      : "bg-granate-50 font-semibold text-granate"
                    : "text-inkSoft hover:bg-paperSoft hover:text-ink",
                )}
              >
                {p.icono}
                {p.etiqueta}
                {p.conteo != null && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-rotulo font-semibold tabular-nums",
                      sel ? "bg-granate text-paper" : "bg-paperDeep text-inkSoft",
                    )}
                  >
                    {numero(p.conteo)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* Flechas sólo para el mouse: con el teclado, las flechas del teclado ya recorren las pestañas. */}
        {!segunda && desborde.izq && (
          <FlechaRiel lado="izq" onClick={() => correr(-1)} />
        )}
        {!segunda && desborde.der && (
          <FlechaRiel lado="der" onClick={() => correr(1)} />
        )}
      </div>
      {pestanas.map((p) => (
        <div
          key={p.clave}
          role="tabpanel"
          id={`${id}-panel-${p.clave}`}
          aria-labelledby={`${id}-tab-${p.clave}`}
          hidden={p.clave !== actual}
          tabIndex={0}
          className={cn(segunda ? "pt-4" : "pt-5", "focus-visible:outline-none")}
        >
          <PanelActual.Provider value={{ titulo: p.titulo ?? p.etiqueta, nivel: segunda ? 3 : 2 }}>{visitadas.has(p.clave) ? p.contenido : null}</PanelActual.Provider>
        </div>
      ))}
    </div>
  );
}

function FlechaRiel({ lado, onClick }: { lado: "izq" | "der"; onClick: () => void }) {
  const Icono = lado === "izq" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      aria-label={lado === "izq" ? "Ver las pestañas anteriores" : "Ver más pestañas"}
      onClick={onClick}
      className={cn(
        "absolute top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-paper text-inkSoft shadow-[0_1px_3px_rgb(var(--ink)/0.12)] transition-colors duration-rapido hover:text-ink sm:inline-flex",
        lado === "izq" ? "left-1" : "right-1",
      )}
    >
      <Icono size={16} />
    </button>
  );
}

/**
 * La cabecera de una pestaña abierta: su título (h2, el nombre de la pestaña salvo que se pase `titulo`), qué muestra en
 * una línea, la ⓘ y las acciones a la derecha. Antes era una caja de texto sin título ("textos sueltos sin títulos"), y
 * bajo el h1 de la ficha no había ningún h2.
 */
export function CabeceraPestana({ titulo, children, ayuda, acciones }: { titulo?: ReactNode; children?: ReactNode; ayuda?: ReactNode; acciones?: ReactNode }) {
  const panel = useContext(PanelActual);
  const nombre = titulo ?? panel?.titulo;
  const Titulo = panel?.nivel === 3 ? "h3" : "h2";
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        {nombre ? (
          <div className="flex items-center gap-1.5">
            <Titulo className={cn("font-display font-bold leading-tight text-ink text-balance", Titulo === "h3" ? "text-bloque" : "text-seccion")}>{nombre}</Titulo>
            {ayuda}
          </div>
        ) : null}
        {children && (
          <p className={cn("max-w-[80ch] text-dato leading-snug text-inkSoft text-pretty", nombre && "mt-1")}>
            {children}
            {!nombre && ayuda ? <> {ayuda}</> : null}
          </p>
        )}
      </div>
      {acciones && <div className="flex shrink-0 flex-wrap items-center gap-2">{acciones}</div>}
    </div>
  );
}
