import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileSearch, Flag, Home, MapPin } from "lucide-react";
import { Marca } from "@/components/Marca";
import { BuscarGlobal } from "@/components/BuscarGlobal";

export const metadata: Metadata = {
  title: "Página no encontrada",
  robots: { index: false },
};

/**
 * 404 del sitio entero. Antes Next mostraba su página por defecto, en inglés
 * ("404 | This page could not be found"), sin forma de seguir. Acá se puede
 * buscar directo o tomar una de las puertas principales.
 *
 * Server component: a BuscarGlobal sólo le pasa strings, nunca funciones.
 */
const PUERTAS = [
  { href: "/app/mapa", label: "Mapa", hint: "Elige tu región", icon: MapPin },
  { href: "/app/contratos", label: "Contratos", hint: "Todo el SEACE, contrato a contrato", icon: FileSearch },
  { href: "/app/hallazgos", label: "Señales", hint: "Con norma y evidencia", icon: Flag },
  { href: "/", label: "Inicio", hint: "Qué es Vigía Perú", icon: Home },
] as const;

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-paperSoft">
      <header className="container-page flex h-16 items-center">
        <Link href="/" aria-label="Vigía Perú, ir al inicio" className="rounded-lg transition-opacity duration-rapido hover:opacity-80">
          <Marca />
        </Link>
      </header>

      <main id="contenido" className="container-page flex flex-1 flex-col items-center justify-center py-16 text-center">
        <p className="font-mono text-sm font-semibold tracking-widest text-heroViolet">404</p>
        <h1 className="mt-3 text-balance font-serif text-4xl font-bold leading-tight text-ink sm:text-5xl">
          No encontramos esta página
        </h1>
        <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-inkSoft">
          Puede que el enlace esté mal escrito o que la página ya no exista. Busca un contrato, una entidad o tu
          región, o sigue por una de estas puertas.
        </p>

        <div className="mt-8 w-full max-w-md">
          <BuscarGlobal className="py-3 text-sm shadow-card" />
        </div>

        <ul className="mt-10 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
          {PUERTAS.map(({ href, label, hint, icon: Icono }) => (
            <li key={href}>
              <Link
                href={href}
                className="group flex items-center gap-3 rounded-2xl border border-line bg-paper p-4 text-left transition-colors duration-rapido hover:border-heroViolet/40 hover:bg-heroViolet-soft"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paperDeep text-heroViolet transition-colors group-hover:bg-paper">
                  <Icono size={16} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{label}</span>
                  <span className="block text-[12px] text-mute">{hint}</span>
                </span>
                <ArrowRight
                  size={15}
                  aria-hidden
                  className="shrink-0 text-mute transition-transform duration-rapido group-hover:translate-x-0.5 group-hover:text-heroViolet"
                />
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
