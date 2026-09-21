"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Heart, Menu, X } from "lucide-react";
import { Logo } from "./Logo";
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

export function Header() {
  const pathname = usePathname() || "/";
  const isDashboard = DASHBOARD_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAuth = pathname === "/login" || pathname === "/signup";
  const showNav = !isDashboard && !isAuth;
  // La landing usa su propia paleta (morado/verde, ver tailwind.config heroViolet/heroGreen)
  // — el resto del sitio sigue con la cálida (amber). El nav es compartido, así que solo
  // en "/" toma esos dos colores; en cualquier otra ruta se ve exactamente igual que siempre.
  const isLanding = pathname === "/";
  const [mobileOpen, setMobileOpen] = useState(false);

  // Cambiar de ruta (clic en un link del propio drawer, o navegación por otra vía) cierra
  // el menú — evita que quede abierto tapando la página nueva.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/80 backdrop-blur-xl">
      <div className={cn("container-page flex h-16 items-center justify-between gap-6", isLanding && "max-w-[1600px]")}>
        <Link href="/" aria-label="Vigía Perú · Inicio" className="flex shrink-0 items-center">
          <Logo height={30} priority />
        </Link>

        {showNav && (
          <nav className="hidden items-center gap-0.5 lg:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.href}
                href={n.href}
                active={pathname === n.href || (n.href !== "/" && pathname.startsWith(`${n.href}/`))}
                accent={isLanding}
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
              className={cn(
                "hidden items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper active:translate-y-0 sm:inline-flex",
                isLanding ? "bg-heroViolet text-paper" : "bg-amber text-coal",
              )}
            >
              <Heart size={14} className={isLanding ? "fill-paper text-paper" : "fill-rust text-rust"} /> Financiar una auditoría
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

      {showNav && <MobileNavPanel open={mobileOpen} onClose={() => setMobileOpen(false)} isLanding={isLanding} pathname={pathname} />}
    </header>
  );
}

function NavLink({
  href,
  active,
  accent,
  children,
}: {
  href: string;
  active?: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-paperSoft hover:text-ink",
        "after:absolute after:bottom-0.5 after:left-3 after:right-3 after:h-[2px] after:rounded-full after:transition-transform",
        accent ? "after:bg-heroGreen" : "after:bg-clay",
        active ? "text-ink after:scale-x-100" : "text-mute after:scale-x-0 hover:after:scale-x-100",
      )}
    >
      {children}
    </Link>
  );
}

/** Drawer mobile a pantalla completa: mismos items de NAV + el CTA de financiar. Este bug
 * (0 navegación alcanzable bajo md:) afectaba a TODAS las rutas públicas, no solo "/" —
 * por eso la estructura es site-wide; solo el acento de color sigue el patrón existente
 * `isLanding` (igual que el nav de escritorio de arriba), nunca el morado/verde fuera de "/".
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
  isLanding,
  pathname,
}: {
  open: boolean;
  onClose: () => void;
  isLanding: boolean;
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
                    ? cn("bg-paperDeep", isLanding ? "text-heroViolet" : "text-clay")
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
          className={cn(
            "mt-3 flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold shadow-card",
            isLanding ? "bg-heroViolet text-paper" : "bg-amber text-coal",
          )}
        >
          <Heart size={15} className={isLanding ? "fill-paper text-paper" : "fill-rust text-rust"} /> Financiar una auditoría
        </Link>
      </div>
    </div>,
    document.body,
  );
}
