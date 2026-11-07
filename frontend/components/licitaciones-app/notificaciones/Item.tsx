"use client";

import Link from "next/link";
import { BellRing, CalendarClock } from "lucide-react";
import { rutaEn } from "@/lib/gobserva";
import { fechaHoraLima } from "@/lib/licitaciones-app/formato";
import type { Notificacion } from "@/lib/licitaciones-app/notificaciones";
import { cn } from "@/lib/utils";

/**
 * Una notificación: su ícono (plazo o alerta), qué pasó, de qué proceso y cuándo; sin leer, con su punto. Al abrirla se
 * marca leída. Con `completa`, una alerta muestra sus primeras oportunidades, cada una abre su ficha.
 */
export function ItemNotificacion({ n, base, leida, marcar, completa = false }: { n: Notificacion; base: string; leida: boolean; marcar: () => void; completa?: boolean }) {
  const Icono = n.tipo === "vence" ? CalendarClock : BellRing;
  return (
    <div className={cn("relative flex gap-3 px-4 py-3.5 transition-colors duration-rapido sm:px-5", !leida && "bg-granate-50/50")}>
      <span
        aria-hidden
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-xl",
          n.urgente ? "bg-crimson-soft text-crimsonTexto" : n.tipo === "vence" ? "bg-amber-soft text-amberTexto" : "bg-granate-50 text-granate",
        )}
      >
        <Icono size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <Link href={rutaEn(base, n.href)} onClick={marcar} className="block after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-granate">
          <span className={cn("block text-dato leading-snug", leida ? "font-medium text-ink" : "font-bold text-ink", n.urgente && "text-crimsonTexto")}>{n.titulo}</span>
          <span className="mt-0.5 line-clamp-2 block text-meta leading-snug text-inkSoft">{n.texto}</span>
        </Link>
        <p className="mt-1 text-rotulo text-mute">{n.tipo === "vence" ? `Plazo: ${fechaHoraLima(n.fecha)}` : `Llegó el ${fechaHoraLima(n.fecha)}`}</p>
        {completa && n.items && n.items.length > 0 && (
          <ul className="relative z-10 mt-2 space-y-1">
            {n.items.map((x) => (
              <li key={x.enlace}>
                <a href={x.enlace} onClick={marcar} className="line-clamp-1 text-meta font-medium text-granate underline-offset-4 hover:underline">
                  {x.titulo}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!leida && <span aria-label="Sin leer" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-granate" />}
    </div>
  );
}
