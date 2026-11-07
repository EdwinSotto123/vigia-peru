"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Los avisos breves de la app (toasts): confirman lo que hiciste («Lo sigues: está en tu tablero») o dicen qué falló, con
 * una acción cuando sirve («Ver tablero»). Se van solos a los 5 s, se cierran con su X y se leen en voz alta (aria-live).
 * En el celular salen sobre la barra de abajo.
 */
interface Aviso {
  id: number;
  tono: "ok" | "error";
  texto: string;
  accion?: { etiqueta: string; href: string };
}

const Contexto = createContext<(a: Omit<Aviso, "id">) => void>(() => undefined);

export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const quitar = useCallback((id: number) => setAvisos((xs) => xs.filter((x) => x.id !== id)), []);
  const avisar = useCallback((a: Omit<Aviso, "id">) => {
    const id = Date.now() + Math.random();
    setAvisos((xs) => [...xs.slice(-2), { ...a, id }]);
  }, []);
  return (
    <Contexto.Provider value={avisar}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-[80] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6 lg:bottom-6">
        {avisos.map((a) => (
          <Tostada key={a.id} a={a} quitar={quitar} />
        ))}
      </div>
    </Contexto.Provider>
  );
}

function Tostada({ a, quitar }: { a: Aviso; quitar: (id: number) => void }) {
  useEffect(() => {
    const h = setTimeout(() => quitar(a.id), 5000);
    return () => clearTimeout(h);
  }, [a.id, quitar]);
  const Icono = a.tono === "ok" ? CheckCircle2 : AlertTriangle;
  return (
    <div role={a.tono === "error" ? "alert" : "status"} className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-caja p-3.5 shadow-pop motion-safe:animate-slideUp sm:w-96">
      <Icono size={18} aria-hidden className={cn("mt-0.5 shrink-0", a.tono === "ok" ? "text-granate" : "text-crimsonTexto")} />
      <div className="min-w-0 flex-1">
        <p className="text-dato text-ink">{a.texto}</p>
        {a.accion && (
          <Link href={conBase(a.accion.href)} onClick={() => quitar(a.id)} className="mt-1 inline-flex text-dato font-semibold text-granate underline-offset-4 hover:underline">
            {a.accion.etiqueta}
          </Link>
        )}
      </div>
      <button type="button" onClick={() => quitar(a.id)} aria-label="Cerrar el aviso" className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-mute hover:bg-ink/[0.06] hover:text-ink">
        <X size={15} aria-hidden />
      </button>
    </div>
  );
}

/** En DEV los productos van por ruta (/licitaciones/…): el enlace de un aviso lleva ese prefijo si la página lo tiene. */
function conBase(href: string): string {
  if (!href.startsWith("/") || typeof window === "undefined") return href;
  const dev = window.location.pathname.startsWith("/licitaciones/") || window.location.pathname === "/licitaciones";
  return dev && !href.startsWith("/licitaciones") ? `/licitaciones${href}` : href;
}

export const useAvisos = () => useContext(Contexto);
