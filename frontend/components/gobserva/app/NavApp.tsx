"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowUpRight, Bell, CalendarDays, Inbox, LifeBuoy, ChartNoAxesColumn, ChevronsUpDown, CreditCard, HardHat, House, KanbanSquare, Loader2, LogOut, Menu, Search,
  Sparkles, Timer, UserRound, X,
} from "lucide-react";
import { CORREO_GOBSERVA, rutaEn, urlCanonica, type Producto } from "@/lib/gobserva";
import { cn } from "@/lib/utils";
import { useMe, useSesion } from "../cuenta/comun";

interface ItemApp {
  /** Ruta dentro del producto ("/oportunidades", "/cuenta?tab=para-ti") o URL absoluta (otro producto). */
  ruta: string;
  etiqueta: string;
  Icono: typeof House;
  /** En la barra de abajo del celular (las cuatro de todos los días); las demás van en «Más». */
  abajo?: boolean;
  /** El nombre en la barra de abajo, si el completo no entra a 390 px. */
  corto?: string;
  /** Otras rutas en las que también se marca (el detalle de un proceso marca la bandeja). */
  tambien?: string[];
}

/** Un grupo de la barra lateral: lo de hoy (sin nombre), lo que se busca y lo que se organiza. */
interface GrupoApp {
  titulo?: string;
  items: ItemApp[];
}

/** La app de cada producto. Sólo Licitaciones tiene app por ahora. */
const APP: Partial<Record<Producto, { grupos: GrupoApp[]; cuenta: ItemApp[] }>> = {
  licitaciones: {
    grupos: [
      {
        items: [
          { ruta: "/cuenta", etiqueta: "Inicio", Icono: House, abajo: true },
          { ruta: "/cuenta?tab=para-ti", etiqueta: "Para ti", Icono: Sparkles, abajo: true },
        ],
      },
      {
        titulo: "Buscar",
        items: [
          { ruta: "/app/bandeja", etiqueta: "Bandeja", Icono: Inbox, abajo: true, tambien: ["/app/oportunidad/"] },
          { ruta: "/oportunidades", etiqueta: "Oportunidades", Icono: Search },
          { ruta: "/menores", etiqueta: "Contratos menores", Icono: Timer },
          { ruta: "/mercado", etiqueta: "Mercado", Icono: ChartNoAxesColumn },
          { ruta: urlCanonica("obras", "/"), etiqueta: "Obras", Icono: HardHat },
        ],
      },
      {
        titulo: "Organizar",
        items: [
          { ruta: "/cuenta?tab=seguimiento", etiqueta: "Seguimiento", Icono: KanbanSquare, abajo: true, corto: "Tablero" },
          { ruta: "/cuenta?tab=calendario", etiqueta: "Calendario", Icono: CalendarDays },
          { ruta: "/cuenta?tab=alertas", etiqueta: "Alertas", Icono: Bell },
        ],
      },
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

function esActual(u: { camino: string; tab: string | null } | null, href: string, tambien: string[] = []): boolean {
  if (!u || externa(href)) return false;
  if (tambien.some((t) => u.camino.includes(t))) return true;
  const [camino, query] = href.split("?");
  const tab = new URLSearchParams(query ?? "").get("tab");
  if (camino.endsWith("/cuenta")) {
    // «Guardados» (los enlaces viejos y el de la ficha) es el tablero de Seguimiento.
    const actual = u.tab === "guardados" ? "seguimiento" : u.tab;
    return u.camino === camino && (actual ?? null) === (tab ?? null);
  }
  return u.camino === camino || u.camino.startsWith(`${camino}/`);
}

function Enlace({ item, base, actual, grande = false, onClick }: { item: ItemApp; base: string; actual: boolean; grande?: boolean; onClick?: () => void }) {
  const href = externa(item.ruta) ? item.ruta : rutaEn(base, item.ruta);
  const { Icono } = item;
  const clase = cn(
    "group flex items-center gap-3 rounded-lg px-3 text-dato transition-colors duration-rapido",
    grande ? "min-h-12" : "min-h-10",
    actual ? "bg-granate-50 font-semibold text-ink" : "font-medium text-inkSoft hover:bg-ink/[0.045] hover:text-ink",
  );
  const contenido = (
    <>
      <Icono size={18} aria-hidden className={cn("shrink-0", actual ? "text-granate" : "text-mute group-hover:text-ink")} />
      <span className="min-w-0 flex-1 truncate">{item.etiqueta}</span>
      {externa(item.ruta) && (
        <>
          <ArrowUpRight size={14} aria-hidden className="shrink-0 text-mute" />
          <span className="sr-only"> (otro sitio de Gobserva)</span>
        </>
      )}
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

async function cerrarSesion() {
  const { salir } = await import("@/lib/gobserva-auth");
  await salir();
  window.location.assign("/");
}

function Salir({ className }: { className?: string }) {
  const [saliendo, setSaliendo] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        setSaliendo(true);
        void cerrarSesion().finally(() => setSaliendo(false));
      }}
      disabled={saliendo}
      className={cn("flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-dato font-medium text-inkSoft transition-colors duration-rapido hover:bg-ink/[0.045] hover:text-ink", className)}
    >
      {saliendo ? <Loader2 size={18} aria-hidden className="animate-spin" /> : <LogOut size={18} aria-hidden className="text-mute" />}
      Salir
    </button>
  );
}

/** Escribirnos: el correo de ayuda (lo que antes estaba en el pie). */
function Ayuda({ className }: { className?: string }) {
  return (
    <a
      href={`mailto:${CORREO_GOBSERVA}`}
      className={cn("flex min-h-10 w-full items-center gap-3 rounded-lg px-3 text-dato font-medium text-inkSoft transition-colors duration-rapido hover:bg-ink/[0.045] hover:text-ink", className)}
    >
      <LifeBuoy size={18} aria-hidden className="text-mute" />
      Ayuda: escríbenos
    </a>
  );
}

/** El plan en la barra lateral: cuánto usas y, si es el gratis, el paso a uno de pago. */
function PlanLateral({ producto, base }: { producto: Producto; base: string }) {
  const { me } = useMe(producto);
  if (!me) return <span aria-hidden className="block h-[5.5rem] animate-pulse rounded-xl bg-ink/[0.05]" />;
  const lim = me.producto?.limites;
  const usados = me.producto?.usados ?? { alertas: 0, guardados: 0 };
  const pagado = !!me.producto?.plan;
  const pct = lim && lim.guardados > 0 ? Math.min(100, Math.round((usados.guardados / lim.guardados) * 100)) : 0;
  return (
    <div className="rounded-xl border border-line bg-lienzo/70 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-meta font-bold text-ink">Plan {me.producto?.nombrePlan ?? "Gratis"}</p>
        {lim && (
          <p className="text-rotulo tabular-nums text-mute">
            {usados.guardados} de {lim.guardados}
            <span className="sr-only"> guardados</span>
          </p>
        )}
      </div>
      {lim && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={usados.guardados} aria-valuemin={0} aria-valuemax={lim.guardados} aria-label="Guardados de tu plan">
          <div className={cn("h-full rounded-full", pct >= 100 ? "bg-crimson" : "bg-granate")} style={{ width: `${pct}%` }} />
        </div>
      )}
      {pagado ? (
        <Link href={rutaEn(base, "/cuenta?tab=pagos")} className="mt-2.5 inline-flex min-h-8 items-center text-meta font-semibold text-granate underline-offset-4 hover:underline">
          Ver tu plan y tus recibos
        </Link>
      ) : (
        <Link
          href={rutaEn(base, "/planes")}
          className="mt-3 flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-granate px-3 text-meta font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
        >
          <Sparkles size={14} aria-hidden /> Mejorar el plan
        </Link>
      )}
    </div>
  );
}

/** Quién eres, al pie de la barra lateral: tu nombre y correo, y un menú con tu perfil, tu plan y salir. */
function UsuarioLateral({ producto, base, items }: { producto: Producto; base: string; items: ItemApp[] }) {
  const { user } = useSesion();
  const { me } = useMe(producto);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setAbierto(false);
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    window.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      window.removeEventListener("keydown", tecla);
    };
  }, [abierto]);
  const correo = me?.cuenta.email ?? user?.email ?? "";
  const nombre = me?.cuenta.nombre || user?.displayName || correo.split("@")[0] || "Tu cuenta";
  const inicial = nombre.trim().charAt(0).toUpperCase() || "?";
  return (
    <div ref={caja} className="relative">
      {abierto && (
        <div id="menu-usuario" className="absolute inset-x-0 bottom-full mb-2 rounded-xl border border-line bg-caja p-1.5 shadow-pop motion-safe:animate-fadeIn">
          <ul>
            {items.map((item) => (
              <li key={item.ruta}>
                <Enlace item={item} base={base} actual={false} onClick={() => setAbierto(false)} />
              </li>
            ))}
            <li>
              <Ayuda />
            </li>
            <li className="mt-1 border-t border-line pt-1">
              <Salir />
            </li>
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={() => setAbierto((a) => !a)}
        aria-expanded={abierto}
        aria-controls="menu-usuario"
        className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors duration-rapido hover:bg-ink/[0.045]"
      >
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-granate font-display text-dato font-bold text-paper">
          {inicial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-dato font-semibold text-ink">{nombre}</span>
          <span className="block truncate text-rotulo text-mute">{correo}</span>
        </span>
        <ChevronsUpDown size={16} aria-hidden className="shrink-0 text-mute" />
        <span className="sr-only">Abrir el menú de tu cuenta</span>
      </button>
    </div>
  );
}

/** La barra lateral de la app (desde lg): los tres grupos y, abajo, tu plan y tu cuenta. */
export function LateralApp({ producto, base }: { producto: Producto; base: string }) {
  const app = APP[producto];
  const u = useUbicacion();
  if (!app) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label="Secciones de la app" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {app.grupos.map((g, i) => (
          <div key={g.titulo ?? i} className={cn(i > 0 && "mt-5")}>
            {g.titulo && <p className="mb-1 px-3 text-rotulo font-semibold text-mute">{g.titulo}</p>}
            <ul className="space-y-0.5">
              {g.items.map((item) => (
                <li key={item.ruta}>
                  <Enlace item={item} base={base} actual={esActual(u, rutaEn(base, item.ruta), item.tambien)} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 space-y-2 border-t border-line p-3">
        <PlanLateral producto={producto} base={base} />
        <UsuarioLateral producto={producto} base={base} items={app.cuenta} />
      </div>
    </div>
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
  const todos = app.grupos.flatMap((g) => g.items);
  const abajo = todos.filter((i) => i.abajo);
  const gruposMas = [
    ...app.grupos.map((g) => ({ titulo: g.titulo, items: g.items.filter((i) => !i.abajo) })).filter((g) => g.items.length > 0),
    { titulo: "Tu cuenta", items: app.cuenta },
  ];
  const enResto = gruposMas.some((g) => g.items.some((i) => esActual(u, rutaEn(base, i.ruta))));

  return (
    <>
      <nav aria-label="Secciones de la app" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-caja/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
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
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t border-line bg-caja px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 shadow-[0_-8px_30px_rgb(0_0_0/0.18)]">
            <span aria-hidden className="mx-auto block h-1.5 w-10 rounded-full bg-ink/15" />
            <div className="mt-3 flex items-center justify-between">
              <p id="app-mas-t" className="font-display text-bloque font-bold text-ink">Más</p>
              <button type="button" onClick={() => setMas(false)} aria-label="Cerrar" className="grid h-11 w-11 place-items-center rounded-full text-inkSoft hover:bg-ink/[0.045]">
                <X size={20} aria-hidden />
              </button>
            </div>
            {gruposMas.map((g) => (
              <div key={g.titulo ?? "hoy"} className="mt-3">
                {g.titulo && <p className="mb-1 px-3 text-rotulo font-semibold text-mute">{g.titulo}</p>}
                <ul className="space-y-0.5">
                  {g.items.map((item) => (
                    <li key={item.ruta}>
                      <Enlace item={item} base={base} actual={esActual(u, rutaEn(base, item.ruta), item.tambien)} grande onClick={() => setMas(false)} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="mt-2 border-t border-line pt-2">
              <Ayuda className="min-h-12" />
              <Salir className="min-h-12" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
