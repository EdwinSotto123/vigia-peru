"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowUpRight, Bell, CalendarDays, ChartNoAxesColumn, CreditCard, HardHat, House, KanbanSquare, Loader2, LogOut, Menu, Search, Sparkles, Timer,
  UserRound, X,
} from "lucide-react";
import { rutaEn, urlCanonica, type Producto } from "@/lib/gobserva";
import { cn } from "@/lib/utils";

interface ItemApp {
  /** Ruta dentro del producto ("/oportunidades", "/cuenta?tab=para-ti") o URL absoluta (otro producto). */
  ruta: string;
  etiqueta: string;
  Icono: typeof House;
  /** En la barra de abajo del celular (las cuatro de todos los días); las demás van en «Más». */
  abajo?: boolean;
  /** El nombre en la barra de abajo, si el completo no entra a 390 px. */
  corto?: string;
}

/** La app de cada producto: lo de todos los días arriba y la cuenta abajo. Sólo Licitaciones tiene app por ahora. */
const APP: Partial<Record<Producto, { principal: ItemApp[]; cuenta: ItemApp[] }>> = {
  licitaciones: {
    principal: [
      { ruta: "/cuenta", etiqueta: "Inicio", Icono: House, abajo: true },
      { ruta: "/cuenta?tab=para-ti", etiqueta: "Para ti", Icono: Sparkles, abajo: true },
      { ruta: "/oportunidades", etiqueta: "Oportunidades", Icono: Search, abajo: true, corto: "Buscar" },
      { ruta: "/menores", etiqueta: "Contratos menores", Icono: Timer },
      { ruta: "/cuenta?tab=seguimiento", etiqueta: "Seguimiento", Icono: KanbanSquare, abajo: true, corto: "Tablero" },
      { ruta: "/cuenta?tab=calendario", etiqueta: "Calendario", Icono: CalendarDays },
      { ruta: "/mercado", etiqueta: "Mercado", Icono: ChartNoAxesColumn },
      { ruta: urlCanonica("obras", "/"), etiqueta: "Obras", Icono: HardHat },
      { ruta: "/cuenta?tab=alertas", etiqueta: "Alertas", Icono: Bell },
    ],
    cuenta: [
      { ruta: "/cuenta?tab=pagos", etiqueta: "Plan y pagos", Icono: CreditCard },
      { ruta: "/cuenta?tab=perfil", etiqueta: "Perfil", Icono: UserRound },
    ],
  },
};

const externa = (ruta: string) => /^https?:\/\//.test(ruta);

/**
 * Dónde está el navegador (camino y ?tab=), recién al montar: en el servidor la ruta es la reescrita
 * («/licitaciones/cuenta») y en el subdominio se ve «/cuenta». Antes de montar no se marca nada.
 */
function useUbicacion(): { camino: string; tab: string | null } | null {
  const pathname = usePathname();
  const sp = useSearchParams();
  const [u, setU] = useState<{ camino: string; tab: string | null } | null>(null);
  useEffect(() => setU({ camino: window.location.pathname, tab: sp.get("tab") }), [pathname, sp]);
  return u;
}

function esActual(u: { camino: string; tab: string | null } | null, href: string): boolean {
  if (!u || externa(href)) return false;
  const [camino, query] = href.split("?");
  const tab = new URLSearchParams(query ?? "").get("tab");
  if (camino.endsWith("/cuenta")) {
    // «Guardados» (los enlaces viejos y el de la ficha) es el tablero de Seguimiento.
    const actual = u.tab === "guardados" ? "seguimiento" : u.tab;
    return u.camino === camino && (actual ?? null) === (tab ?? null);
  }
  return u.camino === camino || u.camino.startsWith(`${camino}/`);
}

function Enlace({ item, base, actual, compacto = false, onClick }: { item: ItemApp; base: string; actual: boolean; compacto?: boolean; onClick?: () => void }) {
  const href = externa(item.ruta) ? item.ruta : rutaEn(base, item.ruta);
  const { Icono } = item;
  const clase = cn(
    "group flex min-h-11 items-center gap-3 rounded-xl px-3 text-dato font-semibold transition-colors duration-rapido",
    actual ? "bg-granate-50 text-ink" : "text-inkSoft hover:bg-paperSoft hover:text-ink",
    compacto && "min-h-12",
  );
  const contenido = (
    <>
      <Icono size={18} aria-hidden className={cn("shrink-0", actual ? "text-granate" : "text-mute group-hover:text-ink")} />
      <span className="min-w-0 flex-1 truncate">{item.etiqueta}</span>
      {externa(item.ruta) && <ArrowUpRight size={14} aria-hidden className="shrink-0 text-mute" />}
    </>
  );
  if (externa(item.ruta)) {
    return (
      <a href={href} className={clase} onClick={onClick}>
        {contenido}
      </a>
    );
  }
  return (
    <Link href={href} aria-current={actual ? "page" : undefined} className={clase} onClick={onClick}>
      {contenido}
    </Link>
  );
}

function Salir({ className }: { className?: string }) {
  const [saliendo, setSaliendo] = useState(false);
  async function salir() {
    setSaliendo(true);
    const { salir: cerrar } = await import("@/lib/gobserva-auth");
    await cerrar().finally(() => setSaliendo(false));
    window.location.assign("/");
  }
  return (
    <button
      type="button"
      onClick={() => void salir()}
      disabled={saliendo}
      className={cn("flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-dato font-semibold text-inkSoft transition-colors duration-rapido hover:bg-paperSoft hover:text-ink", className)}
    >
      {saliendo ? <Loader2 size={18} aria-hidden className="animate-spin" /> : <LogOut size={18} aria-hidden className="text-mute" />}
      Salir
    </button>
  );
}

/** La barra lateral de la app (desde lg): lo de todos los días y, abajo, la cuenta. */
export function LateralApp({ producto, base }: { producto: Producto; base: string }) {
  const app = APP[producto];
  const u = useUbicacion();
  if (!app) return null;
  return (
    <nav aria-label="Secciones de la app" className="flex min-h-0 flex-1 flex-col">
      <ul className="space-y-0.5">
        {app.principal.map((item) => (
          <li key={item.ruta}>
            <Enlace item={item} base={base} actual={esActual(u, rutaEn(base, item.ruta))} />
          </li>
        ))}
      </ul>
      <ul className="mt-auto space-y-0.5 border-t border-line pt-3">
        {app.cuenta.map((item) => (
          <li key={item.ruta}>
            <Enlace item={item} base={base} actual={esActual(u, rutaEn(base, item.ruta))} />
          </li>
        ))}
        <li>
          <Salir />
        </li>
      </ul>
    </nav>
  );
}

/**
 * La barra de abajo en el celular: las cuatro secciones de todos los días y «Más» con el resto (una hoja que sube).
 * Queda fija abajo, al alcance del pulgar; el contenido deja su alto libre (pb en MarcoApp).
 */
export function BarraApp({ producto, base }: { producto: Producto; base: string }) {
  const app = APP[producto];
  const u = useUbicacion();
  const [mas, setMas] = useState(false);
  useEffect(() => {
    if (!mas) return;
    const cerrar = (e: KeyboardEvent) => e.key === "Escape" && setMas(false);
    window.addEventListener("keydown", cerrar);
    return () => window.removeEventListener("keydown", cerrar);
  }, [mas]);
  useEffect(() => setMas(false), [u?.camino, u?.tab]);
  if (!app) return null;
  const abajo = app.principal.filter((i) => i.abajo);
  const resto = [...app.principal.filter((i) => !i.abajo), ...app.cuenta];
  const enResto = resto.some((i) => esActual(u, rutaEn(base, i.ruta)));

  return (
    <>
      <nav aria-label="Secciones de la app" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <ul className="grid grid-cols-5">
          {abajo.map((item) => {
            const href = rutaEn(base, item.ruta);
            const actual = esActual(u, href);
            const { Icono } = item;
            return (
              <li key={item.ruta}>
                <Link
                  href={href}
                  aria-current={actual ? "page" : undefined}
                  className={cn("flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-micro font-semibold min-[380px]:text-rotulo", actual ? "text-ink" : "text-mute")}
                >
                  <span className={cn("grid h-7 w-12 place-items-center rounded-full transition-colors duration-rapido", actual && "bg-granate-50")}>
                    <Icono size={19} aria-hidden className={actual ? "text-granate" : ""} />
                  </span>
                  <span className="max-w-full truncate">{item.corto ?? item.etiqueta}</span>
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMas(true)}
              aria-expanded={mas}
              aria-controls="app-mas"
              className={cn("flex min-h-14 w-full flex-col items-center justify-center gap-1 px-1 text-micro font-semibold min-[380px]:text-rotulo", enResto ? "text-ink" : "text-mute")}
            >
              <span className={cn("grid h-7 w-12 place-items-center rounded-full", enResto && "bg-granate-50")}>
                <Menu size={19} aria-hidden className={enResto ? "text-granate" : ""} />
              </span>
              Más
            </button>
          </li>
        </ul>
      </nav>

      {mas && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-labelledby="app-mas-t" id="app-mas">
          <button type="button" aria-label="Cerrar" onClick={() => setMas(false)} className="absolute inset-0 bg-ink/40 motion-safe:animate-fadeIn" />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-line bg-paper px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 shadow-[0_-8px_30px_rgb(0_0_0/0.18)]">
            <span aria-hidden className="mx-auto block h-1.5 w-10 rounded-full bg-ink/15" />
            <div className="mt-3 flex items-center justify-between">
              <p id="app-mas-t" className="font-display text-bloque font-bold text-ink">Más</p>
              <button type="button" onClick={() => setMas(false)} aria-label="Cerrar" className="grid h-11 w-11 place-items-center rounded-full text-inkSoft hover:bg-paperSoft">
                <X size={20} aria-hidden />
              </button>
            </div>
            <ul className="mt-2 space-y-0.5">
              {resto.map((item) => (
                <li key={item.ruta}>
                  <Enlace item={item} base={base} actual={esActual(u, rutaEn(base, item.ruta))} compacto onClick={() => setMas(false)} />
                </li>
              ))}
              <li className="border-t border-line pt-1">
                <Salir className="min-h-12" />
              </li>
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
