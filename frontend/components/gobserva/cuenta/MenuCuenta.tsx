"use client";

import Link from "next/link";
import { LogIn, UserRound } from "lucide-react";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";
import { useSesion } from "./comun";

/**
 * La cuenta en la cabecera de un producto: «Entrar» sin sesión y la inicial con «Mi cuenta» con ella. No carga Firebase
 * (AuthProvider lo trae sólo si hay una sesión guardada) ni pide nada a la API: es parte de todas las páginas.
 *
 * `compacto` (el celular): la inicial sola, y «Entrar» sólo con su ícono salvo con `entrarConTexto`, cuando la marca del
 * producto es corta y la palabra entra (desde 360 px).
 */
export function MenuCuenta({ base, compacto = false, entrarConTexto = false }: { base: string; compacto?: boolean; entrarConTexto?: boolean }) {
  const { user, loading, conCuenta } = useSesion();
  if (loading) return <span aria-hidden className={cn("inline-block h-10 animate-pulse rounded-full bg-paperDeep", compacto ? "w-10" : "w-24")} />;
  if (!conCuenta || !user) {
    return (
      <Link
        href={rutaEn(base, "/entrar")}
        className={cn(
          "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50",
          compacto && !entrarConTexto && "px-3",
        )}
      >
        <LogIn size={16} aria-hidden />
        <span className={cn(compacto && (entrarConTexto ? "max-[359px]:sr-only" : "sr-only"))}>Entrar</span>
      </Link>
    );
  }
  const inicial = (user.displayName || user.email || "?").trim().charAt(0).toUpperCase();
  return (
    <Link
      href={rutaEn(base, "/cuenta")}
      className="inline-flex min-h-10 items-center gap-2 rounded-full border border-line bg-paper py-1 pl-1 pr-3 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
    >
      <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-granate text-meta font-bold text-paper">
        {inicial || <UserRound size={15} />}
      </span>
      <span className={cn(compacto && "sr-only")}>Mi cuenta</span>
    </Link>
  );
}
