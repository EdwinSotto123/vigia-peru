"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  MapPin,
  Building2,
  FileText,
  Sparkles,
  HelpCircle,
  Search,
  ScanSearch,
  ArrowLeft,
  Menu,
  X,
  Lock,
  Home,
  AlertTriangle,
  MessageSquareWarning,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { signOut } from "@/lib/auth";
import { LogOut, Shield } from "lucide-react";

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

const SECTIONS: Section[] = [
  {
    items: [
      {
        href: "/app",
        label: "Inicio",
        icon: <LayoutDashboard size={16} />,
        hint: "Resumen del país",
        match: (p) => p === "/app",
      },
      {
        href: "/app/convocatoria",
        label: "Analizar contrato",
        icon: <ScanSearch size={16} />,
        hint: "Pipeline agéntico · a demanda",
        featured: true,
        match: (p) =>
          p.startsWith("/app/convocatoria") || p.startsWith("/convocatoria"),
      },
    ],
  },
  {
    title: "Explorar",
    items: [
      {
        href: "/app/mapa",
        label: "Mapa",
        icon: <MapPin size={16} />,
        hint: "Choropleth Perú",
        match: (p) => p.startsWith("/app/mapa") || p.startsWith("/region"),
      },
      {
        href: "/app/entidades",
        label: "Entidades",
        icon: <Building2 size={16} />,
        hint: "Ranking riesgo",
        match: (p) =>
          p.startsWith("/app/entidades") || p.startsWith("/entidad"),
      },
      {
        href: "/app/alertas",
        label: "Alertas",
        icon: <AlertTriangle size={16} />,
        hint: "Top del mes",
        match: (p) => p.startsWith("/app/alertas") || p.startsWith("/alerta"),
      },
      {
        href: "/app/denuncias",
        label: "Denuncias",
        icon: <MessageSquareWarning size={16} />,
        hint: "Ciudadanas · libre",
        match: (p) => p.startsWith("/app/denuncias"),
      },
    ],
  },
  {
    title: "Acción",
    items: [
      {
        href: "/reporte/nuevo",
        label: "Denunciar",
        icon: <FileText size={16} />,
        hint: "Foto + geo · público",
        match: (p) => p.startsWith("/reporte"),
      },
      {
        href: "/noticia",
        label: "IA · Generador",
        icon: <Sparkles size={16} />,
        hint: "Borrador editorial",
        requiresAuth: true,
        match: (p) => p.startsWith("/noticia"),
      },
    ],
  },
];

export function DashboardSidebar() {
  const pathname = usePathname() || "";
  const { user, userId, loading } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-30 inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 py-2 text-xs font-medium text-ink shadow-card md:hidden"
      >
        <Menu size={14} /> Navegación
      </button>

      {open && (
        <button
          aria-label="Cerrar"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-ink/40 md:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 -translate-x-full border-r border-line bg-paperSoft transition-transform",
          "md:sticky md:top-0 md:z-10 md:h-screen md:translate-x-0",
          open && "translate-x-0",
        )}
      >
        <div className="flex h-full flex-col overflow-y-auto p-4">
          {/* Header del sidebar */}
          <div className="mb-3 flex items-center justify-between">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-mute hover:text-ink"
            >
              <ArrowLeft size={12} /> Landing
            </Link>
            <button
              onClick={() => setOpen(false)}
              className="rounded-full p-1 text-mute hover:bg-paperDeep md:hidden"
              aria-label="Cerrar menú"
            >
              <X size={14} />
            </button>
          </div>

          <Link
            href="/app"
            className="mb-4 flex items-center gap-2.5 rounded-2xl border border-line bg-paper p-3 transition-colors hover:bg-paperDeep"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-paper">
              <Shield size={16} strokeWidth={2.5} />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-serif text-base font-bold text-ink">
                Vigía <span className="text-rust">Perú</span>
              </span>
              <span className="text-[9px] uppercase tracking-widest text-mute">
                Centro de mando
              </span>
            </span>
          </Link>

          {/* Nav agrupado */}
          <nav className="flex flex-col gap-5">
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
                      onClick={() => setOpen(false)}
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
            {!loading && !user && (
              <div className="rounded-2xl border border-amber/40 bg-amber-soft/50 p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-clay">
                  <Lock size={11} /> Acceso limitado
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink">
                  Algunas secciones (como el generador IA) requieren cuenta para
                  evitar abuso de APIs.
                </p>
                <Link
                  href="/signup"
                  className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[11px] font-semibold text-paper hover:bg-coal"
                >
                  Crear cuenta gratis
                </Link>
              </div>
            )}
            {user && (
              <div className="rounded-2xl border border-line bg-paper p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-moss">
                      Sesión activa
                    </div>
                    <div className="mt-0.5 truncate font-mono text-xs font-medium text-ink">
                      {userId}
                    </div>
                  </div>
                  <button
                    onClick={() => signOut()}
                    title="Cerrar sesión"
                    className="shrink-0 rounded-lg border border-line bg-paperSoft p-1.5 text-rust hover:bg-paperDeep"
                  >
                    <LogOut size={13} />
                  </button>
                </div>
              </div>
            )}
            {!user && !loading && (
              <Link
                href="/login"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-xs font-medium text-ink hover:bg-paperDeep"
              >
                Iniciar sesión
              </Link>
            )}
            <Link
              href="/"
              className="flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] text-mute hover:bg-paperDeep hover:text-ink"
            >
              <Home size={12} /> Volver a la landing
            </Link>
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
  onClick,
}: {
  href: string;
  active?: boolean;
  locked?: boolean;
  featured?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  hint?: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "group relative flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition-colors",
        featured
          ? active
            ? "border-rust bg-rust text-paper shadow-card"
            : "border-rust/40 bg-crimson-soft text-ink hover:bg-rust/15"
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
                : "bg-rust text-paper"
              : active
              ? "bg-ink text-paper"
              : "bg-paperDeep text-clay group-hover:bg-paper",
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
                featured ? (active ? "text-paper/80" : "text-rust/80") : "text-mute",
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
        <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
          <span
            className={cn(
              "absolute inset-0 animate-ping rounded-full opacity-75",
              active ? "bg-paper" : "bg-rust",
            )}
          />
          <span
            className={cn(
              "relative h-2 w-2 rounded-full",
              active ? "bg-paper" : "bg-rust",
            )}
          />
        </span>
      ) : null}
    </Link>
  );
}
