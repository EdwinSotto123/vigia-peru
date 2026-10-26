"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";

/**
 * El detalle de las filas de una tabla en UN panel compartido (§14.4; DIRECCION.md, "tres profundidades": lista →
 * panel lateral anclado → página propia). Antes cada fila tenía su propio panel modal: para ver la fila siguiente había
 * que cerrar, ubicarla y volver a abrir, y el fondo quedaba inerte.
 *
 * - En escritorio (≥ 1024 px) el panel se ANCLA a la derecha y NO es modal: la lista sigue visible y se puede tocar
 *   otra fila sin cerrar (el panel cambia de contenido). Anterior y siguiente en la cabecera ("3 de 25"), también con
 *   Alt+↑ y Alt+↓; Escape cierra y el foco vuelve a la fila. La fila abierta queda marcada.
 * - En el celular es la hoja de siempre (`Panel`, modal: tapa la pantalla entera), con el mismo anterior/siguiente.
 * - El contenido llega ya armado del servidor (ReactNode por fila) y sólo se dibuja el de la fila abierta, con `key`
 *   por fila: el estado de una (su página, su búsqueda) no pasa a la siguiente.
 */

export interface DetalleFila {
  id: string;
  titulo: string;
  /** Qué anuncia la fila al lector de pantalla. Por defecto: "Ver detalle de {título}". */
  etiqueta?: string;
  descripcion?: ReactNode;
  contenido: ReactNode;
  pie?: ReactNode;
  /** La ruta de su ficha: sin `pie`, el panel lleva "Abrir la ficha" (vista previa). */
  ficha?: string;
}

/** El pie del panel: el que trae la fila, o "Abrir la ficha" si es una vista previa. */
const pieDe = (d: DetalleFila) =>
  d.pie ?? (d.ficha ? <EnlaceAccion href={d.ficha} flecha>Abrir la ficha</EnlaceAccion> : undefined);

interface Contexto {
  /** Identifica las filas de ESTA tabla (una página puede tener varias tablas con detalle). */
  grupo: string;
  abierto: string | null;
  abrir: (id: string, origen: HTMLElement) => void;
}

const Ctx = createContext<Contexto | null>(null);

/** Desde qué ancho el panel se ancla al costado (lg de Tailwind). */
const ANCLADO = "(min-width: 1024px)";

function useAnclado() {
  const [anclado, setAnclado] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(ANCLADO);
    const f = () => setAnclado(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return anclado;
}

export function ProveedorDetalle({ detalles, nombre, children }: { detalles: DetalleFila[]; nombre: string; children: ReactNode }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const origen = useRef<HTMLElement | null>(null);
  const grupo = useId();
  const anclado = useAnclado();
  const i = abierto == null ? -1 : detalles.findIndex((d) => d.id === abierto);
  const actual = i >= 0 ? detalles[i] : null;

  // La fila abierta ya no está (cambió el filtro o la página): el panel se cierra solo.
  useEffect(() => {
    if (abierto != null && i < 0) setAbierto(null);
  }, [abierto, i]);

  const abrir = useCallback((id: string, el: HTMLElement) => {
    origen.current = el;
    setAbierto(id);
  }, []);

  const cerrar = useCallback(() => {
    setAbierto(null);
    // Al cerrar, el foco vuelve a la fila que lo abrió (o a la última que se vio, si se navegó con anterior/siguiente).
    window.requestAnimationFrame(() => origen.current?.focus({ preventScroll: true }));
  }, []);

  const ir = useCallback(
    (paso: number) => {
      const j = i + paso;
      if (i < 0 || j < 0 || j >= detalles.length) return;
      const id = detalles[j].id;
      setAbierto(id);
      // La fila nueva a la vista en la lista, para no perder dónde se está.
      const fila = document.querySelector<HTMLElement>(`[data-detalle="${CSS.escape(grupo)}"][data-fila="${CSS.escape(id)}"]`);
      if (fila) {
        origen.current = fila;
        fila.scrollIntoView({ block: "nearest" });
      }
    },
    [i, detalles, grupo],
  );

  const cabecera =
    actual && detalles.length > 1 ? (
      <span className="flex shrink-0 items-center gap-0.5">
        <span className="mr-1 text-meta tabular-nums text-mute" aria-live="polite">
          {numero(i + 1)} de {numero(detalles.length)}
        </span>
        <BotonPaso etiqueta="Anterior" atajo="Alt+ArrowUp" desactivado={i <= 0} onClick={() => ir(-1)}>
          <ChevronUp size={16} aria-hidden />
        </BotonPaso>
        <BotonPaso etiqueta="Siguiente" atajo="Alt+ArrowDown" desactivado={i >= detalles.length - 1} onClick={() => ir(1)}>
          <ChevronDown size={16} aria-hidden />
        </BotonPaso>
      </span>
    ) : null;

  // Alt+↑ / Alt+↓ cambian de fila con el panel abierto (en escritorio y en el celular con teclado).
  useEffect(() => {
    if (!actual) return;
    const alTeclado = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      e.preventDefault();
      ir(e.key === "ArrowUp" ? -1 : 1);
    };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [actual, ir]);

  return (
    // Sin envoltorio: un <div> de más rompería el `space-y-*` del padre (el margen caería en él y no en la tabla).
    <Ctx.Provider value={{ grupo, abierto, abrir }}>
      {children}
      {anclado ? (
        actual && (
          <PanelAnclado clave={actual.id} titulo={actual.titulo} descripcion={actual.descripcion} cabecera={cabecera} pie={pieDe(actual)} onCerrar={cerrar} nombre={nombre}>
            <div key={actual.id}>{actual.contenido}</div>
          </PanelAnclado>
        )
      ) : (
        <Panel
          abierto={actual != null}
          onCerrar={cerrar}
          titulo={actual?.titulo ?? nombre}
          descripcion={actual?.descripcion}
          acciones={cabecera}
          pie={actual ? pieDe(actual) : undefined}
          ancho="lg"
        >
          {actual && <div key={actual.id}>{actual.contenido}</div>}
        </Panel>
      )}
    </Ctx.Provider>
  );
}

/** La fila que abre el panel: un botón de la fila entera, marcado mientras su detalle está abierto. */
export function BotonFila({ id, etiqueta, className, children }: { id: string; etiqueta: string; className?: string; children: ReactNode }) {
  const c = useContext(Ctx);
  if (!c) throw new Error("BotonFila fuera de <ProveedorDetalle>");
  const sel = c.abierto === id;
  return (
    <button
      type="button"
      data-detalle={c.grupo}
      data-fila={id}
      onClick={(e) => c.abrir(id, e.currentTarget)}
      aria-haspopup="dialog"
      aria-expanded={sel}
      aria-current={sel || undefined}
      aria-label={etiqueta}
      className={cn("cursor-pointer", className, sel && "bg-granate-50 shadow-[inset_3px_0_0_0_theme(colors.granate.DEFAULT)] hover:bg-granate-50")}
    >
      {children}
    </button>
  );
}

function BotonPaso({ etiqueta, atajo, desactivado, onClick, children }: { etiqueta: string; atajo: string; desactivado: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={desactivado}
      aria-label={`${etiqueta} (Alt + flecha)`}
      aria-keyshortcuts={atajo}
      title={etiqueta}
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-inkSoft transition-colors duration-rapido hover:bg-paperDeep hover:text-ink disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/**
 * El panel anclado del escritorio: fijo a la derecha, fuera de la tabla (portal al body: ningún `overflow` ni
 * `container-type` de un ancestro lo recorta ni lo vuelve relativo). No es modal: la página de atrás se sigue usando.
 */
function PanelAnclado({
  clave,
  titulo,
  descripcion,
  cabecera,
  pie,
  onCerrar,
  nombre,
  children,
}: {
  /** La fila abierta: al cambiar, el panel vuelve arriba y el foco va a su título. */
  clave: string;
  titulo: string;
  descripcion?: ReactNode;
  cabecera?: ReactNode;
  pie?: ReactNode;
  onCerrar: () => void;
  nombre: string;
  children: ReactNode;
}) {
  const titulo$ = useRef<HTMLHeadingElement>(null);
  const cuerpo = useRef<HTMLDivElement>(null);
  const [entrando, setEntrando] = useState(true);

  useEffect(() => {
    const t = window.requestAnimationFrame(() => setEntrando(false));
    return () => window.cancelAnimationFrame(t);
  }, []);

  // Cada fila nueva: arriba del todo y el foco en su título (el lector de pantalla anuncia qué se abrió).
  useEffect(() => {
    cuerpo.current?.scrollTo({ top: 0 });
    titulo$.current?.focus({ preventScroll: true });
  }, [clave]);

  // Escape cierra, salvo que lo esté usando otra capa encima (un globo de ayuda, un diálogo modal).
  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      try {
        if (document.querySelector("dialog[open], :popover-open")) return;
      } catch {
        /* `:popover-open` sin soporte: se cierra igual */
      }
      onCerrar();
    };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [onCerrar]);

  return createPortal(
    <aside
      role="dialog"
      aria-modal="false"
      aria-label={`${titulo} (${nombre})`}
      className={cn(
        "fixed inset-y-0 right-0 z-panel flex w-[min(36rem,46vw)] flex-col border-l border-line bg-paper text-ink shadow-drawer",
        "transition-transform duration-panel ease-salida",
        entrando ? "translate-x-full" : "translate-x-0",
      )}
    >
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-paperSoft px-5 py-3.5">
        <div className="min-w-0">
          <h2 ref={titulo$} tabIndex={-1} className="truncate font-display text-bloque font-bold leading-tight text-ink focus:outline-none" title={titulo}>
            {titulo}
          </h2>
          {descripcion && <div className="mt-0.5 text-meta leading-snug text-mute">{descripcion}</div>}
        </div>
        <span className="-mr-1 flex shrink-0 items-center gap-1">
          {cabecera}
          <button
            type="button"
            onClick={onCerrar}
            aria-label={`Cerrar ${titulo}`}
            title="Cerrar (Esc)"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        </span>
      </header>
      <div ref={cuerpo} className="scrollbar-warm min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {children}
      </div>
      {pie && <footer className="shrink-0 border-t border-line bg-paperSoft px-5 py-3">{pie}</footer>}
    </aside>,
    document.body,
  );
}
