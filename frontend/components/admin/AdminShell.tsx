"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Receipt, Users, Wallet, ScrollText, LogOut, ExternalLink, ShieldCheck, UserRound, FlaskConical, Grid3x3, Database, Activity, Eye, KeyRound, Lock } from "lucide-react";
import { FranjaTextil, Marca } from "@/components/marca";
import { precargarAdmin } from "@/lib/useAdmin";
import { useSesionEquipo } from "@/lib/useEquipo";
import { puedeVerSeccion, ROLES } from "@/lib/permisos";
import { cn } from "@/lib/utils";
import { StatCard } from "@/components/admin/ui/StatCard";
import { EmptyState } from "@/components/admin/ui/EmptyState";
import { SkeletonPanel } from "@/components/admin/ui/Skeleton";
import { claseBoton } from "@/components/admin/ui/boton";
import type { Tone } from "@/components/admin/ui/tono";

/**
 * Navegación del panel, agrupada por para qué se entra. `precargar` son las
 * rutas del API que pide cada página (las mismas claves que su useAdmin): se
 * bajan al pasar el mouse o enfocar el enlace, así la página abre con datos.
 */
interface ItemNav { href: string; label: string; icon: typeof Eye; exact?: boolean; precargar?: string[] }

const NAV: { grupo: string; items: ItemNav[] }[] = [
  {
    grupo: "Operación",
    items: [
      { href: "/admin", label: "Resumen", icon: LayoutDashboard, exact: true, precargar: ["/resumen", "/operacion", "/log"] },
      { href: "/admin/revision", label: "Revisión humana", icon: Eye, precargar: ["/revision?estado=revision"] },
      { href: "/admin/procesamientos", label: "Procesamiento", icon: Activity, precargar: ["/procesamientos", "/operacion", "/pedidos"] },
      { href: "/admin/clasificacion", label: "Clasificación", icon: Grid3x3, precargar: ["/clasificacion/resumen", "/config/procesamiento"] },
      { href: "/admin/cobertura", label: "Cobertura", icon: Database, precargar: ["/cobertura", "/cobertura/progreso"] },
      { href: "/admin/analisis", label: "Análisis a demanda", icon: FlaskConical },
    ],
  },
  {
    grupo: "Financiamiento",
    items: [
      { href: "/admin/contribuciones", label: "Contribuciones", icon: Receipt, precargar: ["/contribuciones?estado=pendiente_pago&q="] },
      { href: "/admin/financiadores", label: "Financiadores", icon: Users, precargar: ["/financiadores"] },
      { href: "/admin/pagos", label: "Medios de pago", icon: Wallet, precargar: ["/config/pagos"] },
    ],
  },
  {
    grupo: "Registro",
    items: [
      { href: "/admin/bitacora", label: "Bitácora", icon: ScrollText, precargar: ["/log"] },
      { href: "/admin/equipo", label: "Equipo", icon: KeyRound, precargar: ["/equipo"] },
    ],
  },
];


// Una precarga por ruta cada 30 s como mucho (lo cuida precargarAdmin): pasar el mouse diez veces
// no son diez requests.
function precargar(paths: string[] | undefined) {
  for (const p of paths ?? []) precargarAdmin(p);
}

const esActivo = (pathname: string, { href, exact }: ItemNav) => (exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

export function AdminShell({ children, title, subtitle, actions }: { children: React.ReactNode; title: string; subtitle?: string; actions?: React.ReactNode }) {
  const pathname = usePathname();
  // Quién está en el panel y con qué perfil (lib/useEquipo.ts: una consulta por sesión).
  const { sesion, rol } = useSesionEquipo();
  const correo = sesion?.correo ?? null;
  // Hasta saber el perfil se muestra lo mínimo (lo del revisor): un revisor nunca ve aparecer y
  // desaparecer las secciones de admin; a un admin le aparecen las suyas un instante después.
  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((it) => puedeVerSeccion(rol ?? "revisor", it.href)) })).filter((g) => g.items.length);
  const todos = nav.flatMap((g) => g.items);
  const soloAdmin = !puedeVerSeccion("revisor", pathname);
  const contenido = !soloAdmin ? children
    : !rol ? <SkeletonPanel lineas={4} />
    : puedeVerSeccion(rol, pathname) ? children
    : <SinAcceso />;

  // En el teléfono la barra de secciones scrollea de costado: centra la activa para que se vea dónde estás.
  const navMovil = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = navMovil.current;
    const activo = nav?.querySelector<HTMLElement>("[aria-current=page]");
    if (nav && activo) nav.scrollLeft = activo.offsetLeft - nav.clientWidth / 2 + activo.clientWidth / 2;
  }, [pathname]);

  // Navegación completa, no del router: vacía la caché de SWR (sesión, perfil y datos ya bajados),
  // así quien entre después en el mismo navegador no ve ni un instante lo de la persona anterior.
  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    window.location.assign("/admin/login");
  }

  // Mientras no se sabe el perfil, "equipo": a un revisor ya no le parpadea "admin".
  const etiquetaRol = rol === "revisor" ? "Revisor" : rol === "admin" ? "Admin" : "Equipo";

  return (
    // Neutro con lima (2026-10-13): la página es carbón, la barra lateral y las tarjetas un escalón más claro
    // (paperSoft), como en el sitio público. El lima marca la sección activa, la acción principal y el foco.
    <div data-intencion="admin" className="flex min-h-screen bg-paper">
      <a
        href="#contenido-admin"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-overlay focus:rounded-full focus:bg-granate focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-paper"
      >
        Saltar al contenido
      </a>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-line bg-paperSoft lg:flex">
        {/* La firma del sitio (DESIGN_SYSTEM.md §6), como en la barra lateral pública. */}
        <FranjaTextil alto={4} className="shrink-0" />
        <div className="flex items-center justify-between gap-2 px-5 py-4">
          <Link href="/admin" className="rounded-lg transition-opacity duration-rapido hover:opacity-80" aria-label="Resumen del panel">
            <Marca tamano="sm" />
          </Link>
          <EtiquetaRol>{etiquetaRol}</EtiquetaRol>
        </div>
        <nav aria-label="Secciones del panel" className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
          {nav.map((g) => (
            <div key={g.grupo}>
              <p className="flex items-center gap-2 px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-mute/70" />
                {g.grupo}
              </p>
              <ul className="space-y-0.5">
                {g.items.map((it) => {
                  const active = esActivo(pathname, it);
                  const Icon = it.icon;
                  return (
                    <li key={it.href}>
                      <Link
                        href={it.href}
                        aria-current={active ? "page" : undefined}
                        onMouseEnter={() => precargar(it.precargar)}
                        onFocus={() => precargar(it.precargar)}
                        className={cn(
                          "group flex min-h-10 items-center gap-2.5 rounded-xl border px-2 py-1.5 text-[13.5px] transition-colors duration-rapido",
                          active
                            ? "border-granate/25 bg-granate-50 font-semibold text-ink"
                            : "border-transparent font-medium text-inkSoft hover:bg-paperDeep/70 hover:text-ink",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-rapido",
                            active ? "bg-granate text-paper" : "bg-paperDeep text-inkSoft group-hover:text-ink",
                          )}
                        >
                          <Icon size={15} />
                        </span>
                        {it.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="space-y-0.5 border-t border-line p-3 text-[13px]">
          {correo && (
            <p className="flex items-center gap-2.5 px-2 pb-2 pt-1" title={rol ? `${ROLES[rol].nombre}: ${ROLES[rol].descripcion}` : "Sesión iniciada"}>
              <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-line bg-paperDeep text-inkSoft">
                <UserRound size={14} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] text-ink">{correo}</span>
                {rol && <span className="block text-[11.5px] text-mute">{ROLES[rol].nombre}</span>}
              </span>
            </p>
          )}
          <Link href="/app/financiar" target="_blank" className={CLASE_PIE_BARRA}>
            <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center"><ExternalLink size={15} /></span>
            Ver sitio público
          </Link>
          <button type="button" onClick={logout} className={cn(CLASE_PIE_BARRA, "w-full")}>
            <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center"><LogOut size={15} /></span>
            Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* En escritorio la cabecera queda fija; en el teléfono solo la fila de secciones (la cabecera entera tapaba media pantalla). */}
        <header className="border-b border-line bg-paper/90 backdrop-blur lg:sticky lg:top-0 lg:z-barra">
          {/* En el teléfono no hay barra lateral: la marca y el perfil van arriba del título. */}
          <div className="flex items-center justify-between gap-2 px-4 pt-3 sm:px-6 lg:hidden">
            <Link href="/admin" className="rounded-lg" aria-label="Resumen del panel">
              <Marca tamano="sm" />
            </Link>
            <EtiquetaRol>{etiquetaRol}</EtiquetaRol>
          </div>
          <div className={cn(ANCHO, "flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3.5")}>
            <div className="min-w-0">
              <h1 className="font-display text-[22px] font-bold leading-tight tracking-tight text-ink text-balance">{title}</h1>
              {subtitle && <p className="mt-0.5 text-[13px] leading-snug text-mute text-pretty">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        </header>
        {/* Secciones en el teléfono y la tablet: una fila que scrollea de costado dentro de sí misma. */}
        <div className="sticky top-0 z-barra border-b border-line bg-paper/95 backdrop-blur lg:hidden">
          <nav ref={navMovil} aria-label="Secciones del panel" className="flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {todos.map((it) => {
              const active = esActivo(pathname, it);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  onFocus={() => precargar(it.precargar)}
                  className={cn(
                    "inline-flex min-h-[34px] items-center whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors duration-rapido",
                    active ? "border-granate bg-granate text-paper" : "border-line text-inkSoft hover:bg-paperSoft hover:text-ink",
                  )}
                >
                  {it.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <main id="contenido-admin" className={cn(ANCHO, "py-5 sm:py-6")}>
          {contenido}
        </main>
        <footer className={cn(ANCHO, "flex flex-wrap items-center gap-x-4 gap-y-2 pb-6 text-[12px] text-mute")}>
          <span className="flex items-center gap-2">
            <ShieldCheck size={13} aria-hidden /> Panel interno. Cada acción queda en la bitácora con tu correo.
          </span>
          {/* En el teléfono no hay barra lateral: la sesión y la salida viven acá. */}
          <span className="flex items-center gap-3 lg:hidden">
            {correo && <span className="truncate">{correo}{rol ? ` (${ROLES[rol].nombre})` : ""}</span>}
            <button type="button" onClick={logout} className="inline-flex items-center gap-1 font-medium text-ink underline-offset-4 hover:underline">
              <LogOut size={12} aria-hidden /> Cerrar sesión
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
}

/** Ancho y márgenes del contenido del panel: los de una página del sitio (`Pagina`), alineado a la izquierda. */
const ANCHO = "w-full max-w-[1600px] px-4 sm:px-6 lg:px-8";

const CLASE_PIE_BARRA =
  "flex min-h-9 items-center gap-2.5 rounded-xl px-2 py-1 text-left font-medium text-inkSoft transition-colors duration-rapido hover:bg-paperDeep/70 hover:text-ink";

/** El perfil de quien está en el panel, en una píldora neutra (antes ámbar, el color de "por validar"). */
function EtiquetaRol({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-paperEdge bg-paperDeep px-2.5 py-0.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-inkSoft">
      {children}
    </span>
  );
}

/** Un revisor que llega por enlace a una sección de admin: se le dice, sin pedir nada al API. */
function SinAcceso() {
  return (
    <EmptyState
      icono={<Lock size={18} aria-hidden />}
      titulo="Esta sección es sólo para administradores"
      descripcion="Tu perfil de revisor cubre la revisión de alertas, el procesamiento, la cobertura y la bitácora. Aportes, pagos, configuración y equipo los maneja un administrador."
      accion={<Link href="/admin" className={claseBoton("secundario")}>Ir al resumen</Link>}
    />
  );
}

/** KPI de la versión anterior del panel. Nuevo código: `StatCard` de components/admin/ui. */
export function Kpi({ label, value, hint, tone = "ink" }: { label: string; value: string | number; hint?: string; tone?: "ink" | "amber" | "moss" | "rust" }) {
  const tono: Tone = { ink: "neutral", amber: "warn", moss: "ok", rust: "danger" }[tone] as Tone;
  return <StatCard etiqueta={label} valor={value} pista={hint} tono={tono} />;
}

/** Píldora con clases a mano (la usan páginas que todavía no migraron). Nuevo código: `Badge` con `tono` de components/admin/ui. */
export function Badge({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium", cls)}>{children}</span>;
}
