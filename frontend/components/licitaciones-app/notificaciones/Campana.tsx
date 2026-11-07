"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Bell, BellOff, X } from "lucide-react";
import { rutaEn } from "@/lib/gobserva";
import { useNotificaciones } from "@/lib/licitaciones-app/useNotificaciones";
import { cn } from "@/lib/utils";
import { ItemNotificacion } from "./Item";

/**
 * La campana de la cabecera: cuántas notificaciones sin leer (en rojo si alguna vence hoy o mañana) y, al tocarla, las
 * últimas seis con «Marcar todas como leídas» y «Ver todas». En el celular, el panel sube como una hoja: va en un portal,
 * porque la cabecera tiene backdrop-blur y eso vuelve a un `fixed` relativo a ella (quedaba atrapado en su franja).
 */
export function Campana({ base }: { base: string }) {
  const { lista, leidas, noLeidas, marcar, marcarTodas, cargando } = useNotificaciones();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const urgente = lista.some((n) => n.urgente && !leidas.has(n.id));
  const ancho = useAncho();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node;
      if (caja.current?.contains(t) || panelRef.current?.contains(t)) return;
      setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAbierto(false);
        boton.current?.focus();
      }
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]);

  return (
    <div ref={caja} className="relative">
      <button
        ref={boton}
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        aria-controls="panel-notificaciones"
        aria-label={noLeidas ? `Notificaciones: ${noLeidas} sin leer` : "Notificaciones"}
        className="relative grid h-10 w-10 place-items-center rounded-full border border-line bg-caja text-inkSoft transition-colors duration-rapido hover:border-ink/20 hover:text-ink"
      >
        <Bell size={18} aria-hidden />
        {noLeidas > 0 && (
          <span aria-hidden className={cn("absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full px-1 text-micro font-bold tabular-nums text-paper ring-2 ring-caja", urgente ? "bg-crimson" : "bg-granate")}>
            {noLeidas > 9 ? "9+" : noLeidas}
          </span>
        )}
      </button>
      {abierto &&
        enPortal(
          !ancho,
          <>
          <span aria-hidden className="fixed inset-0 z-40 bg-ink/30 sm:hidden" />
          <div
            ref={panelRef}
            id="panel-notificaciones"
            role="dialog"
            aria-label="Notificaciones"
            className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] z-50 max-h-[75vh] overflow-hidden rounded-xl border border-line bg-caja shadow-pop motion-safe:animate-fadeIn sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[24rem]"
          >
            <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
              <p className="text-dato font-bold text-ink">Notificaciones</p>
              <div className="flex items-center gap-1">
                {noLeidas > 0 && (
                  <button type="button" onClick={marcarTodas} className="rounded-md px-2 py-1 text-meta font-semibold text-granate hover:bg-granate-50">
                    Marcar todas como leídas
                  </button>
                )}
                <button type="button" onClick={() => setAbierto(false)} aria-label="Cerrar" className="grid h-8 w-8 place-items-center rounded-md text-inkSoft hover:bg-ink/[0.06] sm:hidden">
                  <X size={16} aria-hidden />
                </button>
              </div>
            </div>
            <div className="max-h-[min(60vh,26rem)] overflow-y-auto">
              {cargando ? (
                <div className="space-y-2 p-4" aria-hidden>
                  <span className="block h-12 animate-pulse rounded-lg bg-ink/[0.06]" />
                  <span className="block h-12 animate-pulse rounded-lg bg-ink/[0.06]" />
                </div>
              ) : lista.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-8 text-center">
                  <BellOff size={22} aria-hidden className="text-mute" />
                  <p className="mt-2 text-dato font-semibold text-ink">Nada nuevo por ahora</p>
                  <p className="mt-1 text-meta text-inkSoft">Te avisamos aquí cuando venza un plazo de lo que sigues o tus alertas encuentren algo.</p>
                </div>
              ) : (
                <ul className="divide-y divide-line">
                  {/* recorte: las seis primeras; todas, con su filtro, en «Ver todas» (/app/notificaciones), que dice cuántas son. */}
                  {lista.slice(0, 6).map((n) => (
                    <li key={n.id} onClick={() => setAbierto(false)}>
                      <ItemNotificacion n={n} base={base} leida={leidas.has(n.id)} marcar={() => marcar(n.id)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-line bg-ink/[0.025] px-4 py-2.5">
              <Link href={rutaEn(base, "/app/notificaciones")} onClick={() => setAbierto(false)} className="text-dato font-semibold text-granate underline-offset-4 hover:underline">
                Ver todas{lista.length > 6 ? ` (${lista.length})` : ""}
              </Link>
              <Link href={rutaEn(base, "/cuenta?tab=alertas")} onClick={() => setAbierto(false)} className="text-meta font-medium text-inkSoft underline-offset-4 hover:text-ink hover:underline">
                Configurar mis alertas
              </Link>
            </div>
          </div>
          </>,
        )}
    </div>
  );
}

/** ¿Pantalla de sm para arriba? (El panel cuelga de la campana; abajo, hoja en un portal.) */
function useAncho(): boolean {
  const [ancho, setAncho] = useState(true);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 640px)");
    const f = () => setAncho(m.matches);
    f();
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return ancho;
}

const enPortal = (si: boolean, nodo: ReactNode) => (si && typeof document !== "undefined" ? createPortal(nodo, document.body) : nodo);
