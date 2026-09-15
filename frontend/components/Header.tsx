"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart } from "lucide-react";
import { Logo } from "./Logo";
import { UserMenu } from "./auth/UserMenu";
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

/** Navegación pública. El orden es el recorrido del producto: mapa → financiar → ver en vivo → aliados → denunciar. */
const NAV = [
  { href: "/app/mapa", label: "Mapa" },
  { href: "/auditoria", label: "Auditoría en vivo" },
  { href: "/aliados", label: "Aliados" },
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
                active={pathname === n.href || pathname.startsWith(`${n.href}/`)}
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          <UserMenu />
          {showNav && (
            <Link
              href="/financiar"
              className="hidden items-center gap-1.5 rounded-full bg-amber px-4 py-2 text-sm font-semibold text-coal transition-all hover:scale-[1.03] sm:inline-flex"
            >
              <Heart size={14} className="fill-rust text-rust" /> Financiar una auditoría
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
        "rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-paperSoft hover:text-ink",
        active ? "text-ink" : "text-mute",
      )}
    >
      {children}
    </Link>
  );
}
