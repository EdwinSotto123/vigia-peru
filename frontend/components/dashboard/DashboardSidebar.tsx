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
  Users,
  Heart,
  Shield,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { UserMenu } from "@/components/auth/UserMenu";
import { BuscarGlobal } from "@/components/BuscarGlobal";
import { Marca } from "@/components/Marca";
import { FLAGS } from "@/lib/flags";

type Item = {
  href: string;
  label: string;
  icon: React.ReactNode;
  hint?: string;
  /** Si está true: requiere sesión. Si no, también es público. */
  requiresAuth?: boolean;
  /** Destaca el item como acción núcleo (rojo + pulso). */
  featured?: boolean;
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
        icon: <Users size={16} />,
        hint: "Quienes financian la lectura",
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
          /reporte/nuevo, las pistas del mapa, las pestañas del dossier). */}
      <div
        id="barra-movil"
        className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-paper/90 px-3 backdrop-blur md:hidden"
      >
        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={open}
          aria-controls="menu-lateral"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-paperSoft px-3 text-xs font-medium text-ink transition-colors duration-rapido hover:bg-paperDeep"
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
          "fixed inset-y-0 left-0 z-50 w-64 -translate-x-full border-r border-line bg-paperSoft transition-transform duration-panel ease-salida",
          "md:sticky md:top-0 md:z-10 md:h-screen md:translate-x-0",
          open && "translate-x-0 shadow-drawer",
        )}
      >
        {/* Un clic en cualquier link del drawer lo cierra, incluso si lleva a la
            página en la que ya estás (ahí la ruta no cambia). */}
        <div
          className="flex h-full flex-col overflow-y-auto p-4"
          onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}
        >
          {/* La marca lleva al inicio: "Mapa" ya tiene su propia entrada abajo. */}
          <div className="mb-4 flex items-start gap-2">
            <Link
              href="/"
              aria-label="Vigía Perú, ir al inicio"
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-2xl border border-line bg-paper p-3 transition-colors hover:bg-paperDeep"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink text-paper">
                <Shield size={16} strokeWidth={2.5} aria-hidden />
              </span>
              {/* El mismo componente que usan el header, el pie y el panel de
                  admin: un solo lugar donde puede cambiar. */}
              <Marca tamano="sm" nota="Mapa de auditoría" />
            </Link>
            <button
              ref={cerrarRef}
              type="button"
              onClick={() => cerrar()}
              className="rounded-full p-1.5 text-mute transition-colors hover:bg-paperDeep hover:text-ink md:hidden"
              aria-label="Cerrar menú"
            >
              <X size={16} aria-hidden />
            </button>
          </div>

          {/* Búsqueda global (Ctrl+K) */}
          <div className="mb-4">
            <BuscarGlobal />
          </div>

          {/* Nav agrupado */}
          <nav aria-label="Secciones" className="flex flex-col gap-5">
            {SECTIONS.map((section, i) => (
              <div key={i} className="flex flex-col gap-1">
                {section.title && (
                  <div className="px-2 pb-1 text-[9px] font-bold uppercase tracking-widest text-mute">
                    {section.title}
                  </div>
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
                      icon={item.icon}
                      hint={item.hint}
                    >
                      {item.label}
                    </SidebarLink>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Footer */}
          <div className="mt-auto space-y-2 pt-6">
            {FLAGS.editorial && !loading && !user && (
              <div className="rounded-2xl border border-amber/40 bg-amber-soft/50 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-clayTexto">
                  <Lock size={11} aria-hidden /> Acceso limitado
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink">
                  Algunas secciones (como el generador IA) requieren cuenta para
                  evitar abuso de APIs.
                </p>
                <Link
                  href="/signup"
                  className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[11px] font-semibold text-paper transition-colors hover:bg-ink/90"
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
                  "flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] transition-colors",
                  faqActiva ? "bg-paper font-medium text-ink shadow-inset" : "text-mute hover:bg-paperDeep hover:text-ink",
                )}
              >
                <HelpCircle size={13} aria-hidden /> Preguntas frecuentes
              </Link>
              <Link
                href="/"
                className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] text-mute transition-colors hover:bg-paperDeep hover:text-ink"
              >
                <Home size={13} aria-hidden /> Inicio
              </Link>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}

function SidebarLink({
  href,
  active,
  locked,
  featured,
  icon,
  children,
  hint,
}: {
  href: string;
  active?: boolean;
  locked?: boolean;
  featured?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition-colors",
        featured
          ? active
            ? "border-heroViolet bg-heroViolet text-paper shadow-card"
            : "border-heroViolet/40 bg-heroViolet-soft text-ink hover:bg-heroViolet/15"
          : active
          ? "border-line bg-paper text-ink shadow-inset"
          : "border-transparent text-ink/80 hover:bg-paper hover:text-ink",
      )}
    >
      <span className="flex items-center gap-2.5">
        <span
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg",
            featured
              ? active
                ? "bg-paper/20 text-paper"
                : "bg-heroViolet text-paper"
              : active
              ? "bg-ink text-paper"
              : "bg-paperDeep text-heroViolet group-hover:bg-paper",
          )}
        >
          {icon}
        </span>
        <span className="flex flex-col leading-tight">
          <span className={cn("font-medium", featured && "font-semibold")}>
            {children}
          </span>
          {hint && (
            <span
              className={cn(
                "text-[10px]",
                featured ? (active ? "text-paper/80" : "text-heroViolet/80") : "text-mute",
              )}
            >
              {hint}
            </span>
          )}
        </span>
      </span>
      {locked ? (
        <Lock size={11} className="shrink-0 text-mute" />
      ) : featured ? (
        // Antes esto era un punto con animate-ping permanente. Un pulso que no
        // para no comunica nada: no hay ningún estado que esté cambiando, sólo
        // un item de navegación pidiendo atención para siempre. El destaque de
        // "Financiar" ya lo cargan el fondo violeta y el peso del texto.
        <ArrowRight size={13} className="shrink-0 opacity-60" aria-hidden />
      ) : null}
    </Link>
  );
}
