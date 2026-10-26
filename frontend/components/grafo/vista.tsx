"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Network, TableProperties } from "lucide-react";
import { baseApiNavegador } from "@/lib/api-client";
import { TablaSkeleton, type Columna } from "@/components/listado";
import { EstadoError } from "@/components/patrones";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/**
 * Lo que comparten las vistas del mapa de poder que se cargan al abrirlas (Entidades, Territorio, Gobierno Nacional,
 * Instituciones): antes el servidor hacía las cinco consultas aunque nadie abriera los árboles; ahora cada pestaña pide
 * lo suyo la primera vez que se abre (`Pestanas` la monta recién entonces) y lo conserva al volver.
 */

export interface Carga<T> {
  datos: T | null;
  cargando: boolean;
  error: boolean;
  reintentar: () => void;
}

/** Pide `ruta` a la API desde el navegador (la CDN cachea estas respuestas una hora). */
export function usePoder<T>(ruta: string): Carga<T> {
  const [estado, setEstado] = useState<{ datos: T | null; cargando: boolean; error: boolean }>({ datos: null, cargando: true, error: false });
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    let vivo = true;
    setEstado((e) => ({ ...e, cargando: true, error: false }));
    fetch(`${baseApiNavegador()}${ruta}`)
      .then((r) => (r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => {
        if (vivo) setEstado({ datos: d, cargando: false, error: false });
      })
      .catch(() => {
        if (vivo) setEstado({ datos: null, cargando: false, error: true });
      });
    return () => {
      vivo = false;
    };
  }, [ruta, intento]);
  const reintentar = useCallback(() => setIntento((i) => i + 1), []);
  return { ...estado, reintentar };
}

/** Mientras llega: la forma de la tabla. Si falla: qué pasó y reintentar. Con datos, el contenido. */
export function EstadoCarga<T>({ carga, columnas, children }: { carga: Carga<T>; columnas: Columna[]; children: (datos: T) => ReactNode }) {
  if (carga.cargando && !carga.datos) return <TablaSkeleton columnas={columnas} filas={8} />;
  if (carga.error || !carga.datos) {
    return (
      <EstadoError
        titulo="No pudimos cargar esta vista"
        conLlamita={false}
        accion={
          <Button variant="secondary" onClick={carga.reintentar}>
            Reintentar
          </Button>
        }
      />
    );
  }
  return <>{children(carga.datos)}</>;
}

/**
 * Tabla o red: la tabla es la vista de todos (y la única en el celular); la red, una ayuda para ver la forma, sólo
 * desde lg, donde su letra se puede leer. Dos píldoras con estado (`aria-pressed`), no pestañas: no cambian de página.
 */
export function SelectorVista({ red, onCambio, etiquetaRed = "Ver como red" }: { red: boolean; onCambio: (red: boolean) => void; etiquetaRed?: string }) {
  const boton = (activo: boolean, onClick: () => void, icono: ReactNode, texto: string) => (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 text-meta font-medium transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
        activo ? "bg-paper font-semibold text-granate shadow-[0_1px_2px_rgb(var(--ink)/0.08)]" : "text-inkSoft hover:text-ink",
      )}
    >
      {icono}
      {texto}
    </button>
  );
  return (
    <div role="group" aria-label="Cómo ver esta lista" className="hidden w-fit items-center gap-1 rounded-full border border-line bg-paperSoft p-1 lg:inline-flex">
      {boton(!red, () => onCambio(false), <TableProperties size={15} aria-hidden />, "Tabla")}
      {boton(red, () => onCambio(true), <Network size={15} aria-hidden />, etiquetaRed)}
    </div>
  );
}

/**
 * Tabla y red en el mismo lugar: debajo de lg siempre la tabla (aunque se haya elegido la red en una pantalla ancha);
 * desde lg, la elegida. La red se monta recién cuando se pide.
 */
export function TablaORed({ red, tabla, grafo }: { red: boolean; tabla: ReactNode; grafo: ReactNode }) {
  return (
    <>
      <div className={red ? "lg:hidden" : undefined}>{tabla}</div>
      {red && <div className="hidden lg:block">{grafo}</div>}
    </>
  );
}

/** El ancho en píxeles de un elemento, al día con su tamaño (para dibujar un SVG en píxeles reales). */
export function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setAncho(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((es) => {
      const w = es[0]?.contentRect.width;
      if (w) setAncho(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, ancho] as const;
}

/**
 * El tamaño de letra en unidades del viewBox para que se lea a `px` píxeles en pantalla: antes la letra iba en
 * unidades de un lienzo de 1,000 a 1,200 dibujado en ~700 px, y salía de 4.5 a 6 px. Sin medida todavía, una estimación
 * con el ancho más chico en que se muestra la red (lg).
 */
export const letraEnUnidades = (px: number, anchoPx: number, vb: number) => (px * vb) / (anchoPx > 0 ? anchoPx : 640);
