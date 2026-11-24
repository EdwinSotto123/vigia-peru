"use client";

import { useEffect } from "react";
import Link from "next/link";
import { LogIn, UserRound } from "lucide-react";
import { rutaEn, APP_EN_CONSTRUCCION } from "@/lib/gobserva";
import { cn } from "@/lib/utils";
import { marcarSesion, useSesion } from "./comun";

/**
 * La cuenta en la cabecera de un producto: «Entrar» sin sesión y la inicial con «Mi cuenta» con ella. No carga Firebase
 * (AuthProvider lo trae sólo si hay una sesión guardada) ni pide nada a la API: es parte de todas las páginas.
 *
 * `compacto` (el celular): la inicial sola, y «Entrar» sólo con su ícono salvo con `entrarConTexto`, cuando la marca del
 * producto es corta y la palabra entra (desde 360 px).
 */
export function MenuCuenta({ base, compacto = false, entrarConTexto = false }: { base: string; compacto?: boolean; entrarConTexto?: boolean }) {
  const { user, loading, conCuenta } = useSesion();
  // La marca para el middleware: con sesión, «Para ti» y las listas llevan a la app (está en todas las páginas del producto).
  useEffect(() => {
    if (loading) return;
    marcarSesion(conCuenta);
    // Dentro de la app sin sesión (venció, o era la cuenta de antes, cuando las apps compartían cuenta): a entrar, con
    // la vuelta a donde estaba.
    const camino = window.location.pathname;
    if (!conCuenta && /\/app\//.test(camino)) {
      const aqui = (base && camino.startsWith(base) ? camino.slice(base.length) : camino) + window.location.search;
      window.location.replace(rutaEn(base, `/entrar?next=${encodeURIComponent(aqui)}`));
    }
  }, [loading, conCuenta, base]);
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
      {/* En la landing es la puerta a la app (2026-11-22, «debe haber un botón de entrar»); con la app en construcción, a tu cuenta. */}
      <span className={cn(compacto && "sr-only")}>{APP_EN_CONSTRUCCION ? "Mi cuenta" : "Ir a la app"}</span>
    </Link>
  );
}
