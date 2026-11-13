"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BellOff, BellPlus, CalendarClock, CheckCheck, Inbox, RotateCcw } from "lucide-react";
import { Caja, ESPACIO_CAJAS } from "@/components/gobserva/app/Caja";
import { Notificaciones as AvisosDispositivo } from "@/components/gobserva/cuenta/Notificaciones";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { useNotificaciones } from "@/lib/licitaciones-app/useNotificaciones";
import { useProductoApp } from "@/components/gobserva/app/contexto";
import { cn } from "@/lib/utils";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { ItemNotificacion } from "./Item";

const FILTROS = [
  { clave: "todas", etiqueta: "Todas" },
  { clave: "vence", etiqueta: "Vencimientos" },
  { clave: "alertas", etiqueta: "Alertas" },
] as const;

/**
 * El centro de notificaciones: todas, sólo vencimientos o sólo lo de tus alertas (en la URL: ?ver=), marcar todas como
 * leídas, y al costado cómo te avisamos (tus alertas y las notificaciones en este dispositivo).
 */
export function Centro({ base }: { base: string }) {
  const sp = useSearchParams();
  const router = useRouter();
  const ver = (FILTROS.find((f) => f.clave === sp.get("ver"))?.clave ?? "todas") as (typeof FILTROS)[number]["clave"];
  const { lista, leidas, noLeidas, marcar, marcarTodas, cargando, error, reintentar } = useNotificaciones();
  const producto = useProductoApp() ?? "licitaciones";
  const vista = lista.filter((n) => ver === "todas" || (ver === "vence" ? n.tipo === "vence" : n.tipo === "alerta"));
  const cuantas = (c: string) => lista.filter((n) => c === "todas" || (c === "vence" ? n.tipo === "vence" : n.tipo === "alerta")).length;

  return (
    <div className={cn("grid items-start", ESPACIO_CAJAS, "xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]")}>
      <Caja
        id="notificaciones"
        titulo={lista.length === 0 ? "Sin notificaciones" : noLeidas ? `${noLeidas} sin leer` : "Todo leído"}
        accion={
          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" aria-label="Qué mostrar" className="inline-flex gap-1 rounded-lg bg-ink/[0.06] p-1">
              {FILTROS.map((f) => (
                <button
                  key={f.clave}
                  type="button"
                  role="tab"
                  aria-selected={ver === f.clave}
                  onClick={() => router.replace(`${window.location.pathname}${f.clave === "todas" ? "" : `?ver=${f.clave}`}`, { scroll: false })}
                  className={cn(
                    "min-h-8 rounded-md px-3 text-meta font-semibold transition-colors duration-rapido",
                    ver === f.clave ? "bg-caja text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink",
                  )}
                >
                  {f.etiqueta} <span className="tabular-nums text-mute">{cuantas(f.clave)}</span>
                </button>
              ))}
            </div>
            {noLeidas > 0 && (
              <button type="button" onClick={marcarTodas} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-meta font-semibold text-granate hover:bg-granate-50">
                <CheckCheck size={15} aria-hidden /> Marcar todas como leídas
              </button>
            )}
          </div>
        }
        relleno={false}
      >
        {cargando ? (
          <div className="space-y-3 p-4 sm:p-5" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span key={i} className="block h-14 animate-pulse rounded-lg bg-ink/[0.06]" />
            ))}
          </div>
        ) : error ? (
          <EstadoError
            titulo="No pudimos traer tus notificaciones"
            texto="Suele ser momentáneo."
            acciones={
              <button type="button" onClick={reintentar} className={claseAccion("secundario")}>
                <RotateCcw size={15} aria-hidden /> Volver a intentar
              </button>
            }
          />
        ) : vista.length === 0 ? (
          <EstadoVacio
            Icono={ver === "vence" ? CalendarClock : ver === "alertas" ? Inbox : BellOff}
            titulo={ver === "vence" ? "Ningún plazo vence en los próximos 3 días" : ver === "alertas" ? "Tus alertas no trajeron nada nuevo todavía" : "Nada nuevo por ahora"}
            texto={
              ver === "alertas"
                ? `Cuando una alerta encuentre ${producto === "empleo" ? "plazas" : "oportunidades"} nuevas, llegan aquí y a tu correo.`
                : producto === "empleo"
                  ? "Guarda plazas y te avisamos aquí cuando falten pocos días para que cierre su postulación."
                  : "Sigue procesos desde la bandeja y te avisamos aquí cuando se acerque su fin de consultas, su cierre o su buena pro."
            }
            acciones={
              <>
                <Link href={rutaEn(base, producto === "empleo" ? "/app/plazas" : "/app/bandeja")} className={claseAccion("primario")}>
                  {producto === "empleo" ? "Buscar plazas" : "Ir a la bandeja"}
                </Link>
                <Link href={rutaEn(base, "/cuenta?tab=alertas")} className={claseAccion("secundario")}>
                  <BellPlus size={15} aria-hidden /> Crear una alerta
                </Link>
              </>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {vista.map((n) => (
              <li key={n.id}>
                <ItemNotificacion n={n} base={base} leida={leidas.has(n.id)} marcar={() => marcar(n.id)} completa />
              </li>
            ))}
          </ul>
        )}
      </Caja>

      <div className={cn("grid content-start", ESPACIO_CAJAS)}>
        <Caja id="como" titulo="Cómo te avisamos">
          <ul className="space-y-3 text-dato text-inkSoft">
            <li className="flex gap-3">
              <CalendarClock size={18} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
              <span>
                <b className="font-semibold text-ink">Vencimientos.</b>{" "}
                {producto === "empleo"
                  ? "Tres días antes de que cierre la postulación de una plaza que guardaste."
                  : "Tres días antes del fin de consultas, del cierre de una cotización o de la buena pro de lo que sigues."}
              </span>
            </li>
            <li className="flex gap-3">
              <BellPlus size={18} aria-hidden className="mt-0.5 shrink-0 text-granate" />
              <span>
                <b className="font-semibold text-ink">Alertas.</b> Lo nuevo que calza con tus búsquedas, en tu correo y aquí.{" "}
                <Link href={rutaEn(base, "/cuenta?tab=alertas")} className="font-semibold text-granate underline-offset-4 hover:underline">
                  Ver mis alertas
                </Link>
              </span>
            </li>
          </ul>
        </Caja>
        <AvisosDispositivo producto={producto} />
      </div>
    </div>
  );
}
