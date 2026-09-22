"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Heart, Menu, X } from "lucide-react";
import { Marca } from "./Marca";
import { UserMenu } from "./auth/UserMenu";
import { BuscarGlobal } from "./BuscarGlobal";
import { cn } from "@/lib/utils";

/**
 * Rutas donde el Header pasa a modo "dashboard": minimal, porque el sidebar manda.
 * Las rutas públicas nuevas (/auditoria, /aliados, /aliado, /financiar, /impacto)
 * NO van acá: llevan el header completo.
 */
const DASHBOARD_PATHS = [
  "/app",
  "/region",
  "/entidad",
  "/convocatoria",
  "/alerta",
  "/reporte",
  "/noticia",
  "/preguntas",
];

/** Navegación pública. El orden es el recorrido del producto: inicio → mapa → financiar → ver en vivo → aliados → denunciar. */
const NAV = [
  { href: "/", label: "Inicio" },
  { href: "/app/mapa", label: "Mapa" },
  { href: "/app/auditoria", label: "Auditoría en vivo" },
  { href: "/app/aliados", label: "Aliados" },
  { href: "/reporte/nuevo", label: "Denunciar" },
  { href: "/preguntas", label: "FAQ" },
];

/** Foco visible compartido: la navegación entera se podía recorrer con Tab sin ver dónde estabas. */
const ANILLO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

export function Header() {
  const pathname = usePathname() || "/";
  const isDashboard = DASHBOARD_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAuth = pathname === "/login" || pathname === "/signup";
  const showNav = !isDashboard && !isAuth;
  // heroViolet/heroGreen ya no son "solo del landing" — son el acento del sitio entero.
  // isLanding se queda solo para el ancho del contenedor (max-w-[1600px]).
  const isLanding = pathname === "/";
  const [mobileOpen, setMobileOpen] = useState(false);

  // Cambiar de ruta (clic en un link del propio drawer, o navegación por otra vía) cierra
  // el menú — evita que quede abierto tapando la página nueva.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/80 backdrop-blur-xl">
      <div className={cn("container-page flex h-16 items-center justify-between gap-6", isLanding && "max-w-[1600px]")}>
        <Link
          href="/"
          aria-label="Vigía Perú, ir al inicio"
          className={cn(
            "flex shrink-0 items-center rounded-lg transition-opacity duration-rapido hover:opacity-80",
            ANILLO,
          )}
        >
          <Marca />
        </Link>

        {showNav && (
          <nav className="hidden items-center gap-0.5 lg:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.href}
                href={n.href}
                active={pathname === n.href || (n.href !== "/" && pathname.startsWith(`${n.href}/`))}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          {!isAuth && <BuscarGlobal variant="boton" />}
          <UserMenu />
          {showNav && (
            <Link
              href="/app/financiar"
              className="hidden items-center gap-1.5 rounded-full bg-heroViolet px-4 py-2 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper active:translate-y-0 sm:inline-flex"
            >
              <Heart size={14} className="fill-paper text-paper" /> Financiar una auditoría
            </Link>
          )}
          {showNav && (
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-panel"
              aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-paperSoft text-ink transition-colors hover:bg-paperDeep lg:hidden"
            >
              {mobileOpen ? <X size={17} /> : <Menu size={17} />}
            </button>
          )}
        </div>
      </div>

      {showNav && <MobileNavPanel open={mobileOpen} onClose={() => setMobileOpen(false)} pathname={pathname} />}
    </header>
  );
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-rapido hover:bg-paperSoft hover:text-ink",
        // El subrayado crece desde el centro, no desde el borde izquierdo: con
        // `scale-x` sin origen declarado Tailwind usa el centro, pero el origen
        // por defecto del navegador para el resto de la transición no estaba
        // fijado y el trazo entraba de costado.
        "after:absolute after:bottom-0.5 after:left-3 after:right-3 after:h-[2px] after:origin-center after:rounded-full after:bg-heroGreen after:transition-transform after:duration-normal",
        active ? "text-ink after:scale-x-100" : "text-inkSoft after:scale-x-0 hover:after:scale-x-100",
        ANILLO,
      )}
    >
      {children}
    </Link>
  );
}

/** Drawer mobile a pantalla completa: mismos items de NAV + el CTA de financiar. Este bug
 * (0 navegación alcanzable bajo md:) afectaba a TODAS las rutas públicas, no solo "/" —
 * por eso la estructura es site-wide, y el acento de color (heroViolet/heroGreen) también:
 * ya no varía por ruta.
 *
 * Se monta vía createPortal(..., document.body): el <header> de arriba lleva
 * backdrop-blur-xl, y cualquier ancestro con filter/backdrop-filter se vuelve
 * "containing block" de sus descendientes position:fixed (spec CSS, no bug de Tailwind) —
 * sin portal, este overlay "fixed inset-0" se resuelve contra la caja del header (390×64)
 * en vez del viewport, y el resto de la página queda visible/clicable detrás del menú.
 * Es seguro sin document !== undefined: `open` arranca en false (useState) tanto en SSR
 * como en la primera hidratación — el `if (!open) return null` de abajo corta antes de
 * llegar a createPortal, así que solo se ejecuta tras un clic real del usuario (cliente). */
function MobileNavPanel({
  open,
  onClose,
  pathname,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 lg:hidden">
      <button aria-label="Cerrar menú" tabIndex={-1} className="animate-fadeIn absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        id="mobile-nav-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
        tabIndex={-1}
        className="animate-slideUp absolute inset-x-0 top-16 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-b-3xl border-b border-line bg-paper p-4 shadow-paper focus:outline-none"
      >
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => {
            const active = pathname === n.href || (n.href !== "/" && pathname.startsWith(`${n.href}/`));
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-xl px-4 py-3 text-base font-medium transition-colors",
                  active
                    ? "bg-paperDeep text-heroViolet"
                    : "text-mute hover:bg-paperSoft hover:text-ink",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/app/financiar"
          className="mt-3 flex items-center justify-center gap-2 rounded-full bg-heroViolet px-4 py-3 text-sm font-semibold text-paper shadow-card"
        >
          <Heart size={15} className="fill-paper text-paper" /> Financiar una auditoría
        </Link>
      </div>
    </div>,
    document.body,
  );
}
