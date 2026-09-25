"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Receipt, Users, Wallet, ScrollText, LogOut, ExternalLink, ShieldCheck, UserRound, FlaskConical, Grid3x3, Database, Activity, Eye, KeyRound, Lock } from "lucide-react";
import { Marca } from "@/components/marca";
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

  return (
    <div className="flex min-h-screen bg-paperDeep">
      <a href="#contenido-admin" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-overlay focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-paper">
        Saltar al contenido
      </a>
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-line bg-ink text-paper lg:flex">
        <div className="flex items-center gap-2 border-b border-paper/10 px-5 py-4">
          <Marca tono="oscuro" tamano="sm" />
          {/* Mientras no se sabe el perfil, "equipo": a un revisor ya no le parpadea "admin". */}
          <span className="rounded bg-amber px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink">{rol === "revisor" ? "revisor" : rol === "admin" ? "admin" : "equipo"}</span>
        </div>
        <nav aria-label="Secciones del panel" className="flex-1 space-y-4 overflow-y-auto p-3">
          {nav.map((g) => (
            <div key={g.grupo}>
              <p className="px-3 pb-1 text-[10.5px] font-semibold uppercase tracking-wide text-paper/55">{g.grupo}</p>
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
                          "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors duration-rapido",
                          active
                            ? "bg-paper/10 font-medium text-paper before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-maiz"
                            : "text-paper/70 hover:bg-paper/5 hover:text-paper",
                        )}
                      >
                        <Icon size={16} aria-hidden /> {it.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
        <div className="space-y-1 border-t border-paper/10 p-3 text-sm">
          {correo && (
            <p className="flex items-center gap-2.5 px-3 pb-2 pt-1 text-[12px] text-paper/70" title={rol ? `${ROLES[rol].nombre}: ${ROLES[rol].descripcion}` : "Sesión iniciada"}>
              <UserRound size={15} className="shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block truncate">{correo}</span>
                {rol && <span className="block text-[11px] text-paper/55">{ROLES[rol].nombre}</span>}
              </span>
            </p>
          )}
          <Link href="/app/financiar" target="_blank" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-paper/70 hover:bg-paper/5 hover:text-paper">
            <ExternalLink size={16} aria-hidden /> Ver sitio público
          </Link>
          <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-paper/70 hover:bg-paper/5 hover:text-paper">
            <LogOut size={16} aria-hidden /> Cerrar sesión
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* En escritorio la cabecera queda fija; en el teléfono solo la fila de secciones (la cabecera entera tapaba media pantalla). */}
        <header className="border-b border-line bg-paper/95 backdrop-blur lg:sticky lg:top-0 lg:z-barra">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold text-ink">{title}</h1>
              {subtitle && <p className="text-xs text-mute">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        </header>
        {/* Secciones en el teléfono y la tablet: una fila que scrollea de costado dentro de sí misma. */}
        <div className="sticky top-0 z-barra border-b border-line bg-paper/95 backdrop-blur lg:hidden">
          <nav ref={navMovil} aria-label="Secciones del panel" className="flex gap-1 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {todos.map((it) => {
              const active = esActivo(pathname, it);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-current={active ? "page" : undefined}
                  onFocus={() => precargar(it.precargar)}
                  className={cn("whitespace-nowrap rounded-full px-3 py-1 text-xs transition-colors", active ? "bg-ink font-medium text-paper" : "text-inkSoft hover:bg-paperDeep hover:text-ink")}
                >
                  {it.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <main id="contenido-admin" className="p-4 sm:p-6">
          {contenido}
        </main>
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-6 text-[11px] text-inkSoft sm:px-6">
          <span className="flex items-center gap-2">
            <ShieldCheck size={12} aria-hidden /> Panel interno. Cada acción queda en la bitácora con tu correo.
          </span>
          {/* En el teléfono no hay barra lateral: la sesión y la salida viven acá. */}
          <span className="flex items-center gap-3 lg:hidden">
            {correo && <span className="truncate">{correo}{rol ? ` (${ROLES[rol].nombre})` : ""}</span>}
            <button onClick={logout} className="inline-flex items-center gap-1 font-medium text-ink underline-offset-4 hover:underline">
              <LogOut size={12} aria-hidden /> Cerrar sesión
            </button>
          </span>
        </footer>
      </div>
    </div>
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
