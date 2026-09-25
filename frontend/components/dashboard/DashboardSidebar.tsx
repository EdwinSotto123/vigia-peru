"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MapPin,
  FileText,
  Sparkles,
  ArrowRight,
  Flag,
  Building2,
  Camera,
  Menu,
  X,
  Lock,
  Home,
  Activity,
  FileSearch,
  Heart,
  HelpCircle,
  Crown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { UserMenu } from "@/components/auth/UserMenu";
import { BuscarGlobal } from "@/components/BuscarGlobal";
import { FranjaTextil, Marca } from "@/components/marca";
import { FLAGS } from "@/lib/flags";

type Item = {
  href: string;
  label: string;
  icon: React.ReactNode;
  hint?: string;
  /** Si está true: requiere sesión. Si no, también es público. */
  requiresAuth?: boolean;
  /** Destaca el item como acción núcleo (borde granate y flecha). */
  featured?: boolean;
  /** Dorado: el reconocimiento a los aliados (ícono en maíz). Sólo "Aliados". */
  dorado?: boolean;
  match?: (path: string) => boolean;
};

type Section = { title?: string; items: Item[] };

/**
 * Navegación pública del dashboard.
 *
 * Antes sólo el mapa era puerta de entrada: entidades, hallazgos y denuncias
 * existían como rutas pero no estaban en la barra, y había que descubrirlas
 * haciendo clic en una región. Eso dejaba 2.121 entidades y 94 señales
 * escondidas detrás de una adivinanza, y hacía que el `match` del mapa tuviera
 * que absorber media aplicación — con el efecto de que, estando dentro de un
 * dossier, la navegación decía "Mapa".
 *
 * Ahora cada objeto del producto tiene su puerta y cada ruta marca activo donde
 * corresponde. El análisis a demanda sigue viviendo en /admin/analisis.
 */
const SECTIONS: Section[] = [
  {
    title: "Explorar",
    items: [
      {
        href: "/app/mapa",
        label: "Mapa",
        icon: <MapPin size={16} />,
        hint: "Elige tu región",
        // El match ya no se traga media aplicación. Antes absorbía entidades,
        // alertas, denuncias y convocatoria, así que estando dentro de un
        // dossier la navegación decía "Mapa" — el usuario no podía saber dónde
        // estaba. Ahora el mapa se marca activo solo cuando es el mapa.
        match: (p) => p === "/app" || p.startsWith("/app/mapa") || p.startsWith("/region"),
      },
      {
        href: "/app/hallazgos",
        label: "Señales",
        icon: <Flag size={16} />,
        hint: "Señales con norma y evidencia",
        match: (p) =>
          p.startsWith("/app/hallazgos") || p.startsWith("/app/alertas") || p.startsWith("/alerta"),
      },
      {
        href: "/app/contratos",
        label: "Contratos",
        icon: <FileSearch size={16} />,
        hint: "Todo el SEACE, contrato a contrato",
        // El dossier de un contrato ES un contrato: /app/convocatoria/[id] y
        // /convocatoria/[id] marcan activo acá, no en "Mapa".
        match: (p) =>
          p.startsWith("/app/contratos") ||
          p.startsWith("/app/convocatoria") ||
          p.startsWith("/convocatoria"),
      },
      {
        href: "/app/entidades",
        label: "Entidades",
        icon: <Building2 size={16} />,
        hint: "Quién contrata, y cuánto",
        // Existía la ruta pero no la entrada: sólo se llegaba desde el panel de
        // una zona. 2.121 entidades escondidas detrás de un clic en el mapa.
        match: (p) => p.startsWith("/app/entidades") || p.startsWith("/entidad"),
      },
      {
        href: "/app/auditoria",
        label: "Auditoría en vivo",
        icon: <Activity size={16} />,
        hint: "Cola → procesando → listo",
        match: (p) => p.startsWith("/app/auditoria"),
      },
      {
        href: "/app/denuncias",
        label: "Denuncias",
        icon: <Camera size={16} />,
        hint: "Lo que reporta la gente",
        match: (p) => p.startsWith("/app/denuncias"),
      },
      {
        href: "/app/aliados",
        label: "Aliados",
        icon: <Crown size={15} />,
        hint: "El ranking de quienes financian",
        dorado: true,
        match: (p) => p.startsWith("/app/aliados") || p.startsWith("/aliado/"),
      },
    ],
  },
  {
    title: "Acción",
    items: [
      {
        href: "/app/financiar",
        label: "Financiar",
        icon: <Heart size={16} />,
        hint: "Capacidad de auditoría",
        featured: true,
        match: (p) => p.startsWith("/app/financiar") || p.startsWith("/impacto"),
      },
      {
        href: "/reporte/nuevo",
        label: "Denunciar",
        icon: <FileText size={16} />,
        hint: "Foto y ubicación, públicas",
        match: (p) => p.startsWith("/reporte"),
      },
      ...(FLAGS.editorial
        ? [
            {
              href: "/noticia",
              label: "Generador con IA",
              icon: <Sparkles size={16} />,
              hint: "Borrador editorial",
              requiresAuth: true,
              match: (p: string) => p.startsWith("/noticia"),
            } satisfies Item,
          ]
        : []),
    ],
  },
];

/** El drawer móvil y el `inert` sólo aplican bajo `md` (768 px): arriba, la barra es fija y siempre visible. */
const ESCRITORIO = "(min-width: 768px)";

export function DashboardSidebar() {
  const pathname = usePathname() || "";
  const { user, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const faqActiva = pathname === "/preguntas" || pathname.startsWith("/preguntas/");

  /** Al cerrar a mano (botón, velo, Escape) el foco vuelve al botón "Menú". */
  const volverFoco = useRef(false);
  const cerrar = useCallback(() => {
    volverFoco.current = true;
    setOpen(false);
  }, []);

  // Cambiar de ruta cierra el drawer (un clic en un link, o cualquier otra navegación).
  useEffect(() => { setOpen(false); }, [pathname]);

  // En móvil, la barra cerrada está fuera de pantalla pero seguía en el orden de
  // tabulación: Tab recorría una docena de links invisibles antes de llegar al
  // contenido. `inert` la saca del foco y del árbol de accesibilidad mientras
  // está cerrada. Abierta, lo inerte es lo de atrás (contenido y barra superior),
  // así el foco no se escapa detrás del velo. En escritorio nunca hay nada inerte.
  // (React 18 no conoce la prop `inert`: el atributo se pone a mano.)
  useEffect(() => {
    const mq = window.matchMedia(ESCRITORIO);
    const aplicar = () => {
      const movil = !mq.matches;
      const aside = asideRef.current;
      if (aside) {
        if (movil && !open) aside.setAttribute("inert", "");
        else aside.removeAttribute("inert");
      }
      for (const id of ["contenido", "barra-movil"]) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (movil && open) el.setAttribute("inert", "");
        else el.removeAttribute("inert");
      }
    };
    aplicar();
    // El botón "Menú" vive en la barra superior, que estuvo inerte mientras el
    // drawer estaba abierto: el foco se devuelve recién después de liberarla.
    if (!open && volverFoco.current) {
      volverFoco.current = false;
      toggleRef.current?.focus();
    }
    mq.addEventListener("change", aplicar);
    return () => {
      mq.removeEventListener("change", aplicar);
      document.getElementById("contenido")?.removeAttribute("inert");
      document.getElementById("barra-movil")?.removeAttribute("inert");
    };
  }, [open]);

  // Drawer abierto: foco adentro, Escape cierra y el documento no scrollea detrás.
  useEffect(() => {
    if (!open) return;
    cerrarRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Si hay un diálogo modal encima (la búsqueda), el Escape es suyo.
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) cerrar();
    };
    document.addEventListener("keydown", onKey);
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      html.style.overflow = prev;
    };
  }, [open, cerrar]);

  return (
    <>
      {/* Barra superior móvil. Reemplaza a la píldora flotante "Navegación", que
          tapaba contenido real en varias páginas (el botón de ubicación de
          /reporte/nuevo, las pistas del mapa, las pestañas del dossier).
          Franja textil de 4 px + fila de 44 px = los 3 rem que el layout del
          dashboard descuenta a los `sticky` de cada página. */}
      <div
        id="barra-movil"
        className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur md:hidden"
      >
        <FranjaTextil alto={4} />
        <div className="flex h-11 items-center gap-2 px-3">
          <button
            ref={toggleRef}
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="menu-lateral"
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-paperSoft px-3 text-[13px] font-medium text-ink transition-colors duration-rapido hover:bg-paperDeep"
          >
            <Menu size={15} aria-hidden /> Menú
          </button>
          <Link href="/" aria-label="Vigía Perú, ir al inicio" className="ml-1 rounded-lg">
            <Marca tamano="sm" />
          </Link>
          <div className="ml-auto">
            {/* La barra lateral ya escucha Ctrl+K: esta instancia sólo pone el botón. */}
            <BuscarGlobal variant="boton" atajo={false} />
          </div>
        </div>
      </div>

      {open && (
        <div
          aria-hidden
          onClick={() => cerrar()}
          className="fixed inset-0 z-40 bg-ink/40 motion-safe:animate-fadeIn md:hidden"
        />
      )}

      <aside
        ref={asideRef}
        id="menu-lateral"
        aria-label="Navegación del sitio"
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 -translate-x-full flex-col border-r border-line bg-paperSoft transition-transform duration-panel ease-salida",
          "md:sticky md:top-0 md:z-10 md:h-screen md:translate-x-0",
          open && "translate-x-0 shadow-drawer",
        )}
      >
        {/* La firma del sitio, como en la cabecera pública (DESIGN_SYSTEM.md §6). */}
        <FranjaTextil alto={4} className="shrink-0" />
        {/* Un clic en cualquier link del drawer lo cierra, incluso si lleva a la
            página en la que ya estás (ahí la ruta no cambia). */}
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4"
          onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}
        >
          {/* La marca lleva al inicio: "Mapa" ya tiene su propia entrada abajo.
              La misma firma que la cabecera, el pie y el panel de admin; antes
              iba dentro de una tarjeta y al lado de un escudo que no es de Vigía. */}
          <div className="mb-5 flex items-center justify-between gap-2">
            <Link
              href="/"
              aria-label="Vigía Perú, ir al inicio"
              className="rounded-lg py-1 transition-opacity duration-rapido hover:opacity-80"
            >
              <Marca />
            </Link>
            <button
              ref={cerrarRef}
              type="button"
              onClick={() => cerrar()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink md:hidden"
              aria-label="Cerrar menú"
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          {/* Búsqueda global (Ctrl+K) */}
          <div className="mb-5">
            <BuscarGlobal />
          </div>

          {/* Nav agrupado */}
          <nav aria-label="Secciones" className="flex flex-col gap-5">
            {SECTIONS.map((section, i) => {
              const idTitulo = `menu-lateral-seccion-${i}`;
              return (
                <div
                  key={i}
                  role="group"
                  aria-labelledby={section.title ? idTitulo : undefined}
                  className="flex flex-col gap-0.5"
                >
                  {section.title && (
                    <p id={idTitulo} className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-mute">
                      {section.title}
                    </p>
                  )}
                  {section.items.map((item) => {
                    const active = item.match
                      ? item.match(pathname)
                      : pathname === item.href.split("#")[0];
                    const locked = item.requiresAuth && !user;
                    return (
                      <SidebarLink
                        key={item.href}
                        href={item.href}
                        active={active}
                        locked={locked}
                        featured={item.featured}
                        dorado={item.dorado}
                        icon={item.icon}
                        hint={item.hint}
                      >
                        {item.label}
                      </SidebarLink>
                    );
                  })}
                </div>
              );
            })}
          </nav>

          {/* Pie de la barra */}
          <div className="mt-auto space-y-2 pt-6">
            {FLAGS.editorial && !loading && !user && (
              <div className="rounded-2xl border border-amber/40 bg-amber-soft/50 p-3">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amberTexto">
                  <Lock size={12} aria-hidden /> Acceso limitado
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink">
                  Algunas secciones (como el generador con IA) requieren cuenta para
                  evitar abusos.
                </p>
                <Link
                  href="/signup"
                  className="mt-2 inline-flex min-h-8 w-full items-center justify-center gap-1.5 rounded-full bg-granate px-3 py-1.5 text-xs font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
                >
                  Crear cuenta gratis
                </Link>
              </div>
            )}
            {/* Un solo menú de usuario: Mi impacto, Configuración y Salir (o Entrar). */}
            <UserMenu variant="sidebar" />
            <div className="flex flex-col">
              <Link
                href="/preguntas"
                aria-current={faqActiva ? "page" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-2 rounded-xl px-3 py-2 text-[13px] transition-colors duration-rapido",
                  faqActiva ? "bg-granate-50 font-semibold text-granate" : "text-mute hover:bg-paper hover:text-ink",
                )}
              >
                <HelpCircle size={14} aria-hidden /> Preguntas frecuentes
              </Link>
              <Link
                href="/"
                className="flex min-h-9 items-center gap-2 rounded-xl px-3 py-2 text-[13px] text-mute transition-colors duration-rapido hover:bg-paper hover:text-ink"
              >
                <Home size={14} aria-hidden /> Inicio
              </Link>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

/**
 * Un ítem de la barra. Un solo código visual para "estás aquí": fondo granate
 * suave, texto granate y el ícono en su caja granate llena. Ningún otro ítem
 * tiene la caja llena, así que el lugar actual se encuentra de un vistazo.
 * "Financiar" (featured) se destaca con borde y flecha, no con relleno: el
 * relleno completo lo gana sólo cuando es la página activa.
 */
function SidebarLink({
  href,
  active,
  locked,
  featured,
  dorado,
  icon,
  children,
  hint,
}: {
  href: string;
  active?: boolean;
  locked?: boolean;
  featured?: boolean;
  dorado?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex min-h-11 items-center justify-between gap-2 rounded-xl border px-2.5 py-1.5 text-sm transition-colors duration-rapido",
        featured
          ? active
            ? "border-granate bg-granate text-paper"
            : "border-granate/30 bg-paper text-granate hover:border-granate/50 hover:bg-granate-50"
          : active
          ? "border-granate/15 bg-granate-50 text-granate"
          : "border-transparent text-inkSoft hover:bg-paper hover:text-ink",
      )}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          aria-hidden
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-rapido",
            featured
              ? active
                ? "bg-paper/15 text-paper"
                : "bg-granate-soft text-granate"
              : dorado
              ? "bg-maiz text-ink shadow-[0_0_0_2px_theme(colors.maiz.soft)]"
              : active
              ? "bg-granate text-paper"
              : "bg-paperDeep text-mute group-hover:bg-granate-50 group-hover:text-granate",
          )}
        >
          {icon}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className={cn("truncate", active || featured ? "font-semibold" : "font-medium")}>
            {children}
          </span>
          {hint && (
            <span
              className={cn(
                "truncate text-[11px]",
                featured && active ? "text-paper/80" : active || featured ? "text-granate/80" : "text-mute",
              )}
            >
              {hint}
            </span>
          )}
        </span>
      </span>
      {locked ? (
        <>
          <Lock size={12} className="shrink-0 text-mute" aria-hidden />
          <span className="sr-only">(requiere cuenta)</span>
        </>
      ) : featured ? (
        // Antes esto era un punto con animate-ping permanente. Un pulso que no
        // para no comunica nada: no hay ningún estado que esté cambiando, sólo
        // un item de navegación pidiendo atención para siempre. El destaque de
        // "Financiar" ya lo cargan el borde granate y el peso del texto.
        <ArrowRight size={14} className="shrink-0 opacity-70" aria-hidden />
      ) : null}
    </Link>
  );
}
