"use client";

/**
 * Menú de usuario — el ÚNICO lugar de la interfaz con las acciones de cuenta.
 *   · con sesión: Mi impacto · Configuración · Salir
 *   · sin sesión: "Entrar" (y crear cuenta)
 * Se usa en la cabecera pública y en el pie del sidebar del dashboard (`variant="sidebar"`).
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { LogIn, LogOut, User as UserIcon, ChevronDown, Heart, Settings } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { signOut } from "@/lib/auth";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/app/mi-impacto", label: "Mi impacto", hint: "Aportes, denuncias y zonas", icon: Heart },
  { href: "/app/configuracion", label: "Configuración", hint: "Perfil, visibilidad, datos", icon: Settings },
];

export function UserMenu({ variant = "header" }: { variant?: "header" | "sidebar" }) {
  const { user, userId, loading } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname() || "/";
  const router = useRouter();

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, []);

  if (loading) {
    return <div className={cn("animate-pulse rounded-full bg-line/50", variant === "sidebar" ? "h-10 w-full rounded-xl" : "h-9 w-20")} aria-hidden />;
  }

  const next = pathname.startsWith("/login") || pathname.startsWith("/signup") ? "" : `?next=${encodeURIComponent(pathname)}`;

  if (!user) {
    return variant === "sidebar" ? (
      <Link href={`/login${next}`} className="flex items-center justify-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-xs font-medium text-ink hover:bg-paperDeep">
        <LogIn size={13} aria-hidden /> Entrar
      </Link>
    ) : (
      <Link href={`/login${next}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paperSoft px-3.5 py-2 text-sm font-medium text-ink transition-colors duration-300 hover:bg-paperDeep group-data-[tema-header=oscuro]/header:border-paper/20 group-data-[tema-header=oscuro]/header:bg-paper/10 group-data-[tema-header=oscuro]/header:text-paper group-data-[tema-header=oscuro]/header:hover:bg-paper/20">
        <LogIn size={14} aria-hidden /> Entrar
      </Link>
    );
  }

  const salir = async () => {
    await signOut();
    setOpen(false);
    if (pathname.startsWith("/app/mi-impacto") || pathname.startsWith("/app/configuracion")) router.push("/app/mapa");
  };

  const menu = open && (
    <div
      role="menu"
      aria-label="Cuenta"
      className={cn(
        "z-50 w-60 animate-slideUp rounded-2xl border border-line bg-paperSoft p-1.5 shadow-paper",
        variant === "sidebar" ? "absolute bottom-full left-0 mb-2 w-full" : "absolute right-0 mt-2 origin-top-right",
      )}
    >
      <div className="border-b border-line px-3 py-2">
        <div className="text-[10px] uppercase tracking-widest text-mute">Sesión activa</div>
        <div className="truncate font-mono text-sm font-medium text-ink">{userId}</div>
      </div>
      {ITEMS.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          role="menuitem"
          onClick={() => setOpen(false)}
          className={cn("flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-ink hover:bg-paper", pathname.startsWith(it.href) && "bg-paper")}
        >
          <it.icon size={14} className="text-heroViolet" aria-hidden />
          <span className="leading-tight">
            <span className="block">{it.label}</span>
            <span className="block text-[10px] text-mute">{it.hint}</span>
          </span>
        </Link>
      ))}
      <button type="button" role="menuitem" onClick={salir} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-ink hover:bg-paper">
        <LogOut size={14} className="text-rust" aria-hidden /> Salir
      </button>
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Cuenta de ${userId ?? "usuario"}`}
        className={cn(
          variant === "sidebar"
            ? "flex w-full items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2 text-left text-sm text-ink hover:bg-paperDeep"
            : "inline-flex items-center gap-2 rounded-full border border-line bg-paperSoft px-3 py-1.5 text-sm font-medium text-ink hover:bg-paperDeep",
          open && "bg-paperDeep",
        )}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-heroViolet text-paper"><UserIcon size={12} aria-hidden /></span>
        <span className={cn("truncate font-mono text-xs", variant === "sidebar" ? "flex-1" : "hidden max-w-[120px] sm:inline")}>{userId}</span>
        <ChevronDown size={13} className={cn("shrink-0 text-mute transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {menu}
    </div>
  );
}
