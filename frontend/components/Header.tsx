"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart } from "lucide-react";
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

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/80 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center justify-between gap-6">
        <Link href="/" aria-label="Vigía Perú · Inicio" className="flex shrink-0 items-center">
          <Logo height={30} priority />
        </Link>

        {showNav && (
          <nav className="hidden items-center gap-0.5 md:flex">
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
                "hidden items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all hover:scale-[1.03] sm:inline-flex",
                isLanding ? "bg-heroViolet text-paper" : "bg-amber text-coal",
              )}
            >
              <Heart size={14} className={isLanding ? "fill-paper text-paper" : "fill-rust text-rust"} /> Financiar una auditoría
            </Link>
          )}
        </div>
      </div>
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
        "after:absolute after:bottom-0.5 after:left-3 after:right-3 after:h-[2px] after:scale-x-0 after:rounded-full after:transition-transform",
        active ? "text-ink after:scale-x-100" : "text-mute",
        active && (accent ? "after:bg-heroGreen" : "after:bg-clay"),
      )}
    >
      {children}
    </Link>
  );
}
