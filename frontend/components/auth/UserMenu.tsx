"use client";

/**
 * Menú de usuario — el ÚNICO lugar de la interfaz con las acciones de cuenta.
 *   · con sesión: Mi impacto · Configuración · Salir
 *   · sin sesión: "Entrar" (y crear cuenta)
 * Se usa en la cabecera pública y en el pie del sidebar del dashboard (`variant="sidebar"`).
 *
 * Firebase no se importa acá de forma estática (la cabecera está en todas las páginas):
 * "Salir" lo pide con `import()`, y a esa altura ya está cargado porque hay sesión. Los
 * enlaces a /login van sin prefetch: prefetchear la ruta bajaba el JS de Firebase en la
 * portada para cualquier visitante (auditoría A14).
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { LogIn, LogOut, User as UserIcon, ChevronDown, Heart, Settings } from "lucide-react";
import { useAuth } from "./AuthProvider";
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
    return <div className={cn("rounded-full bg-line/60 motion-safe:animate-pulse", variant === "sidebar" ? "h-10 w-full rounded-xl" : "h-9 w-9 sm:w-20")} aria-hidden />;
  }

  const next = pathname.startsWith("/login") || pathname.startsWith("/signup") ? "" : `?next=${encodeURIComponent(pathname)}`;

  // Sobre una sección oscura la cabecera se vuelve vidrio oscuro: el botón la acompaña.
  const sobreCabeceraOscura =
    "group-data-[tema-header=oscuro]/header:border-paper/20 group-data-[tema-header=oscuro]/header:bg-paper/10 group-data-[tema-header=oscuro]/header:text-paper group-data-[tema-header=oscuro]/header:hover:bg-paper/20";

  if (!user) {
    return variant === "sidebar" ? (
      <Link href={`/login${next}`} prefetch={false} className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-[13px] font-medium text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50">
        <LogIn size={14} aria-hidden /> Entrar
      </Link>
    ) : (
      // En el celular sólo el ícono: con el texto, la cabecera no entraba en 360 px.
      <Link
        href={`/login${next}`}
        prefetch={false}
        aria-label="Entrar"
        className={cn(
          "inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full border border-line bg-paperSoft px-2.5 text-sm font-medium text-ink transition-colors duration-rapido hover:bg-paperDeep sm:px-3.5",
          sobreCabeceraOscura,
        )}
      >
        <LogIn size={14} aria-hidden /> <span className="hidden sm:inline">Entrar</span>
      </Link>
    );
  }

  const salir = async () => {
    const { signOut } = await import("@/lib/auth");
    await signOut();
    setOpen(false);
    if (pathname.startsWith("/app/mi-impacto") || pathname.startsWith("/app/configuracion")) router.push("/app/mapa");
  };

  // El menú es blanco aunque la cabecera esté oscura: su foco vuelve a granate
  // (dentro de `sobre-oscuro` el anillo global pasa a maíz, ilegible sobre blanco).
  const itemMenu =
    "flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-ink transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-granate";

  const menu = open && (
    <div
      role="menu"
      aria-label="Cuenta"
      className={cn(
        "z-50 w-60 rounded-2xl border border-line bg-paper p-1.5 text-ink shadow-pop motion-safe:animate-slideUp",
        variant === "sidebar" ? "absolute bottom-full left-0 mb-2 w-full" : "absolute right-0 mt-2 origin-top-right",
      )}
    >
      <div className="border-b border-line px-3 py-2">
        <div className="text-[11px] text-mute">Sesión activa</div>
        <div className="truncate font-mono text-sm font-medium text-ink">{userId}</div>
      </div>
      {ITEMS.map((it) => {
        const actual = pathname.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            role="menuitem"
            aria-current={actual ? "page" : undefined}
            onClick={() => setOpen(false)}
            className={cn(itemMenu, actual && "bg-granate-50 text-granate")}
          >
            <it.icon size={14} className="shrink-0 text-granate" aria-hidden />
            <span className="leading-tight">
              <span className={cn("block", actual && "font-semibold")}>{it.label}</span>
              <span className="block text-[11px] text-mute">{it.hint}</span>
            </span>
          </Link>
        );
      })}
      <button type="button" role="menuitem" onClick={salir} className={itemMenu}>
        <LogOut size={14} className="shrink-0 text-mute" aria-hidden /> Salir
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
            ? "flex min-h-10 w-full items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2 text-left text-sm text-ink transition-colors duration-rapido hover:bg-paperDeep"
            : cn(
                "inline-flex h-9 items-center gap-2 rounded-full border border-line bg-paperSoft pl-1.5 pr-1.5 text-sm font-medium text-ink transition-colors duration-rapido hover:bg-paperDeep sm:pr-3",
                sobreCabeceraOscura,
              ),
          open && "bg-paperDeep",
        )}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-granate text-paper"><UserIcon size={12} aria-hidden /></span>
        <span className={cn("truncate font-mono text-xs", variant === "sidebar" ? "flex-1" : "hidden max-w-[120px] sm:inline")}>{userId}</span>
        <ChevronDown
          size={13}
          aria-hidden
          className={cn(
            "shrink-0 text-mute transition-transform duration-rapido",
            variant === "header" && "hidden group-data-[tema-header=oscuro]/header:text-paper/75 sm:block",
            open && "rotate-180",
          )}
        />
      </button>
      {menu}
    </div>
  );
}
