"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import useSWR from "swr";
import {
  ArrowUpRight, Bell, BellPlus, Bot, BriefcaseBusiness, CalendarDays, Inbox, LifeBuoy, ChartNoAxesColumn, ChevronsUpDown, CreditCard, GraduationCap, HardHat, House, KanbanSquare, Loader2, LogOut, Menu,
  Sparkles, Timer, UserRound, X, Hospital, Stethoscope, Pill, MapPin, Map as IconoMapa, Gavel, TriangleAlert, History, Database, Bookmark, LogIn, UserPlus,
} from "lucide-react";
import { CORREO_GOBSERVA, PRODUCTOS_APP_ABIERTA, rutaEn, urlCanonica, type Producto } from "@/lib/gobserva";
import { cn } from "@/lib/utils";
import { BotonModo } from "@/components/ui/BotonModo";
import { useMe, useSesion } from "../cuenta/comun";
import { cargarUsoMcp } from "@/lib/gobserva-cuenta";

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
  /** Otras pestañas de /cuenta en las que también se marca (Postulaciones, en el calendario; Avisos, en tus alertas). */
  tabs?: string[];
  /** Se marca sólo en esa ruta exacta (el inicio de Salud, «/», no se marca en todas las páginas). */
  exacta?: boolean;
}

/** Un grupo de la barra lateral: lo de hoy (sin nombre), lo que se busca y lo que se organiza. */
interface GrupoApp {
  titulo?: string;
  items: ItemApp[];
}

/** La app de cada producto: Licitaciones y Empleo (2026-11-07) y Gobserva Salud, abierta (2026-11-21). */
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
          { ruta: "/app/asistente", etiqueta: "Asistente", Icono: Bot },
          { ruta: "/app/menores", etiqueta: "Contratos menores", Icono: Timer, tambien: ["/menor/", "/app/menor/"] },
          { ruta: "/app/mercado", etiqueta: "Mercado", Icono: ChartNoAxesColumn },
          { ruta: urlCanonica("obras", "/"), etiqueta: "Obras", Icono: HardHat },
        ],
      },
      {
        titulo: "Organizar",
        items: [
          { ruta: "/cuenta?tab=seguimiento", etiqueta: "Seguimiento", Icono: KanbanSquare, abajo: true, corto: "Tablero" },
          { ruta: "/cuenta?tab=calendario", etiqueta: "Calendario", Icono: CalendarDays },
          { ruta: "/app/notificaciones", etiqueta: "Notificaciones", Icono: Bell },
          { ruta: "/cuenta?tab=alertas", etiqueta: "Mis alertas", Icono: BellPlus },
        ],
      },
    ],
    cuenta: [
      { ruta: "/cuenta?tab=pagos", etiqueta: "Plan y pagos", Icono: CreditCard },
      { ruta: "/cuenta?tab=perfil", etiqueta: "Perfil", Icono: UserRound },
    ],
  },
  // Empleo, ordenado (2026-11-08, el usuario: «falta ordenar mejor; Para ti puede ser un botón de filtro»): de ocho entradas
  // a cinco. «Para ti» es el filtro de Plazas; el calendario es una vista de Postulaciones; tus alertas, una de Avisos.
  empleo: {
    grupos: [
      {
        items: [
          { ruta: "/cuenta", etiqueta: "Inicio", Icono: House, abajo: true },
          { ruta: "/app/plazas", etiqueta: "Plazas", Icono: BriefcaseBusiness, abajo: true, tambien: ["/app/plaza/", "/app/para-ti"] },
          // Las prácticas de Talento Perú (2026-11-08): para estudiantes y egresados; en el celular, dentro de «Más».
          { ruta: "/app/practicas", etiqueta: "Prácticas", Icono: GraduationCap, tambien: ["/app/practica/"] },
          { ruta: "/app/asistente", etiqueta: "Asistente", Icono: Bot, abajo: true },
        ],
      },
      {
        titulo: "Lo tuyo",
        items: [
          { ruta: "/cuenta?tab=seguimiento", etiqueta: "Postulaciones", Icono: KanbanSquare, abajo: true, corto: "Tablero", tabs: ["calendario"] },
          { ruta: "/app/notificaciones", etiqueta: "Avisos", Icono: Bell, tabs: ["alertas"] },
        ],
      },
    ],
    cuenta: [
      { ruta: "/cuenta?tab=pagos", etiqueta: "Plan y pagos", Icono: CreditCard },
      { ruta: "/cuenta?tab=perfil", etiqueta: "Perfil", Icono: UserRound },
    ],
  },
  // Gobserva Salud (2026-11-21, el usuario: «tipo panel lateral, orden de app, verificación de medicamentos»): lo que se
  // verifica (el establecimiento, el médico, el medicamento) va junto y en la barra de abajo; lo demás se explora.
  salud: {
    grupos: [
      {
        // Tres grupos y la cuenta abajo: entra entero en una pantalla de 768 px de alto sin deslizar la barra.
        items: [
          { ruta: "/", etiqueta: "Inicio", Icono: House, abajo: true, exacta: true },
          { ruta: "/cuenta", etiqueta: "Mis guardados", Icono: Bookmark },
          { ruta: "/asistente", etiqueta: "Asistente", Icono: Bot },
        ],
      },
      {
        titulo: "Verificar",
        items: [
          { ruta: "/establecimientos", etiqueta: "Establecimientos", Icono: Hospital, abajo: true, corto: "Clínicas", tambien: ["/establecimiento/", "/buscar"] },
          { ruta: "/medico", etiqueta: "Médicos", Icono: Stethoscope, abajo: true },
          { ruta: "/medicamentos", etiqueta: "Medicamentos", Icono: Pill, abajo: true, corto: "Medicinas", tambien: ["/medicamento/"] },
        ],
      },
      {
        titulo: "Explorar",
        items: [
          { ruta: "/cerca", etiqueta: "Cerca de mí", Icono: MapPin },
          { ruta: "/mapa", etiqueta: "Mapa", Icono: IconoMapa },
          { ruta: "/alertas", etiqueta: "Alertas de DIGEMID", Icono: TriangleAlert },
          { ruta: "/sanciones", etiqueta: "Sanciones de SUSALUD", Icono: Gavel },
          { ruta: "/cambios", etiqueta: "Cambios en RENIPRESS", Icono: History },
          { ruta: "/fuentes", etiqueta: "De dónde salen los datos", Icono: Database },
        ],
      },
    ],
    cuenta: [],
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

function esActual(u: { camino: string; tab: string | null } | null, href: string, tambien: string[] = [], tabs: string[] = [], exacta = false): boolean {
  if (!u || externa(href)) return false;
  if (exacta) return u.camino.replace(/\/+$/, "") === href.split("?")[0].replace(/\/+$/, "");
  if (tambien.some((t) => u.camino.includes(t))) return true;
  if (tabs.length && u.camino.endsWith("/cuenta") && tabs.includes(u.tab ?? "")) return true;
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
    // 36 px en la barra lateral (mouse): entra entera en una laptop de 768 px de alto; en la hoja del celular, 48 px.
    grande ? "min-h-12" : "min-h-9",
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

/**
 * El plan en la barra lateral: con un plan de pago, los créditos del mes (del asistente y el MCP) que quedan; con el
 * gratis, los guardados y el paso a uno de pago. Cada cifra dice qué cuenta.
 */
function PlanLateral({ producto, base }: { producto: Producto; base: string }) {
  const { me } = useMe(producto);
  const pagado = !!me?.producto?.plan;
  const mcp = useSWR(pagado ? ["gobserva-mcp", producto] : null, () => cargarUsoMcp(producto), { revalidateOnFocus: false });
  if (!me) return <span aria-hidden className="block h-[5.5rem] animate-pulse rounded-xl bg-ink/[0.05]" />;
  const lim = me.producto?.limites;
  const usados = me.producto?.usados ?? { alertas: 0, guardados: 0 };
  const conCreditos = pagado && mcp.data && mcp.data.creditos > 0;
  const etiqueta = conCreditos ? "Créditos del mes" : "Guardados";
  const valor = conCreditos ? Math.max(0, mcp.data!.creditos - mcp.data!.usados) : usados.guardados;
  const tope = conCreditos ? mcp.data!.creditos : lim?.guardados ?? 0;
  const pct = tope > 0 ? Math.min(100, Math.round((valor / tope) * 100)) : 0;
  const alerta = conCreditos ? pct <= 10 : pct >= 100;
  return (
    <div className="rounded-xl border border-line bg-lienzo/70 p-3">
      <p className="text-meta font-bold text-ink">Plan {me.producto?.nombrePlan ?? "Gratis"}</p>
      {(conCreditos || lim) && (
        <>
          <p className="mt-1.5 flex items-baseline justify-between gap-2 text-rotulo text-mute">
            <span>{conCreditos ? "Te quedan" : etiqueta}</span>
            <span className="tabular-nums">
              <b className="font-semibold text-ink">{valor.toLocaleString("es-PE")}</b> de {tope.toLocaleString("es-PE")}
              {conCreditos && <span className="sr-only"> créditos este mes</span>}
            </span>
          </p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/10" role="progressbar" aria-valuenow={valor} aria-valuemin={0} aria-valuemax={tope} aria-label={conCreditos ? "Créditos que te quedan este mes" : "Guardados de tu plan"}>
            <div className={cn("h-full rounded-full", alerta ? "bg-crimson" : "bg-granate")} style={{ width: `${pct}%` }} />
          </div>
        </>
      )}
      {pagado ? (
        <Link href={rutaEn(base, "/cuenta?tab=pagos#uso")} className="mt-2.5 inline-flex min-h-8 items-center text-meta font-semibold text-granate underline-offset-4 hover:underline">
          Tu plan y tu uso
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

/**
 * Al pie de la barra lateral de un producto abierto (Gobserva Salud): todo se ve sin cuenta y la cuenta es gratis. Sin
 * sesión, la invitación a crearla (para guardar); con sesión, quién entró, sus guardados y salir. Sin plan ni pagos.
 */
function PieAbierto({ base }: { base: string }) {
  const { user, loading, conCuenta } = useSesion();
  if (loading) return <span aria-hidden className="block h-[5.5rem] animate-pulse rounded-xl bg-ink/[0.05]" />;
  if (conCuenta && user) {
    const correo = user.email ?? "";
    const nombre = user.displayName || correo.split("@")[0] || "Tu cuenta";
    return (
      <div className="space-y-0.5">
        <Link href={rutaEn(base, "/cuenta")} className="flex w-full items-center gap-3 rounded-lg p-2 transition-colors duration-rapido hover:bg-ink/[0.045]">
          <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-granate font-display text-dato font-bold text-paper">
            {nombre.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-dato font-semibold text-ink">{nombre}</span>
            <span className="block truncate text-rotulo text-mute">{correo}</span>
          </span>
        </Link>
        <Salir />
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-line bg-lienzo/70 p-3">
      <p className="text-meta font-bold text-ink">Tu cuenta, gratis</p>
      <p className="mt-0.5 text-rotulo leading-snug text-mute">Guarda lo que verificas y te marcamos lo nuevo.</p>
      <div className="mt-2 flex gap-1.5">
        <Link
          href={rutaEn(base, "/entrar?crear=1")}
          className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-granate px-2 text-meta font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
        >
          <UserPlus size={14} aria-hidden /> Crear
        </Link>
        <Link href={rutaEn(base, "/entrar")} className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line px-2 text-meta font-semibold text-ink hover:border-granate/50">
          <LogIn size={14} aria-hidden /> Entrar
        </Link>
      </div>
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
      <nav aria-label="Secciones de la app" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {app.grupos.map((g, i) => (
          <div key={g.titulo ?? i} className={cn(i > 0 && "mt-4")}>
            {g.titulo && <p className="mb-1 px-3 text-rotulo font-semibold text-mute">{g.titulo}</p>}
            <ul className="space-y-0.5">
              {g.items.map((item) => (
                <li key={item.ruta}>
                  <Enlace item={item} base={base} actual={esActual(u, rutaEn(base, item.ruta), item.tambien, item.tabs, item.exacta)} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="shrink-0 space-y-2 border-t border-line p-3">
        {PRODUCTOS_APP_ABIERTA.includes(producto) ? (
          // La ayuda va en el pie de cada página (el correo), no aquí: la barra entra entera en una pantalla.
          <PieAbierto base={base} />
        ) : (
          <>
            <PlanLateral producto={producto} base={base} />
            <UsuarioLateral producto={producto} base={base} items={app.cuenta} />
          </>
        )}
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
  const abierta = PRODUCTOS_APP_ABIERTA.includes(producto);
  const { conCuenta } = useSesion();
  const gruposMas = [
    ...app.grupos.map((g) => ({ titulo: g.titulo, items: g.items.filter((i) => !i.abajo) })).filter((g) => g.items.length > 0),
    ...(app.cuenta.length ? [{ titulo: "Tu cuenta", items: app.cuenta }] : []),
  ];
  const enResto = gruposMas.some((g) => g.items.some((i) => esActual(u, rutaEn(base, i.ruta), i.tambien, i.tabs, i.exacta)));

  return (
    <>
      <nav aria-label="Secciones de la app" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-caja/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <ul className="grid grid-cols-5">
          {abajo.map((item) => {
            const href = rutaEn(base, item.ruta);
            const actual = esActual(u, href, item.tambien, item.tabs, item.exacta);
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
              <div className="flex items-center gap-1">
                <span className="min-[400px]:hidden">
                  <BotonModo />
                </span>
                <button type="button" onClick={() => setMas(false)} aria-label="Cerrar" className="grid h-11 w-11 place-items-center rounded-full text-inkSoft hover:bg-ink/[0.045]">
                  <X size={20} aria-hidden />
                </button>
              </div>
            </div>
            {gruposMas.map((g) => (
              <div key={g.titulo ?? "hoy"} className="mt-3">
                {g.titulo && <p className="mb-1 px-3 text-rotulo font-semibold text-mute">{g.titulo}</p>}
                <ul className="space-y-0.5">
                  {g.items.map((item) => (
                    <li key={item.ruta}>
                      <Enlace item={item} base={base} actual={esActual(u, rutaEn(base, item.ruta), item.tambien, item.tabs, item.exacta)} grande onClick={() => setMas(false)} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="mt-2 border-t border-line pt-2">
              <Ayuda className="min-h-12" />
              {(!abierta || conCuenta) && <Salir className="min-h-12" />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
