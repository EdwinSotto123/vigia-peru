"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart } from "lucide-react";
import { Logo } from "./Logo";
import { UserMenu } from "./auth/UserMenu";

/** Rutas donde el Header pasa a modo "dashboard": minimal, porque el sidebar manda. */
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

const NAV = [
  { href: "/#como", label: "Cómo funciona" },
  { href: "/#detecta", label: "Detecta" },
  { href: "/#plataforma", label: "Plataforma" },
  { href: "/#organizacion", label: "Quiénes somos" },
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
              <NavLink key={n.href} href={n.href}>
                {n.label}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2">
          {showNav && (
            <Link
              href="/donar"
              className="hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-mute transition-colors hover:bg-paperSoft hover:text-rust sm:inline-flex"
            >
              <Heart size={14} className="text-rust" /> Donar
            </Link>
          )}
          <UserMenu />
          {showNav && (
            <Link
              href="/app"
              className="hidden rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper transition-all hover:scale-[1.03] hover:bg-coal sm:inline-flex"
            >
              Ver el mapa →
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg px-3 py-2 text-sm font-medium text-mute transition-colors hover:bg-paperSoft hover:text-ink"
    >
      {children}
    </Link>
  );
}
