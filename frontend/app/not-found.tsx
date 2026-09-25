import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileSearch, Flag, Home, MapPin } from "lucide-react";
import { FranjaTextil, Llamita, Marca } from "@/components/marca";
import { BuscarGlobal } from "@/components/BuscarGlobal";
import { SaltarAlContenido } from "@/components/sitio/SaltarAlContenido";

export const metadata: Metadata = {
  title: "Página no encontrada",
  robots: { index: false },
};

/**
 * 404 del sitio entero (DESIGN_SYSTEM.md §14, estados de sistema): la llamita,
 * qué pasó y a dónde ir. Antes Next mostraba su página por defecto, en inglés
 * ("404 | This page could not be found"), sin forma de seguir. Acá se puede
 * buscar directo o tomar uno de los caminos principales.
 *
 * Este límite vive en la raíz: reemplaza a la cabecera y al pie de los layouts,
 * así que trae su propia firma con la franja textil.
 *
 * Server component: a BuscarGlobal sólo le pasa strings, nunca funciones.
 */
const CAMINOS = [
  { href: "/app/mapa", label: "Mapa", hint: "Elige tu región", icon: MapPin },
  { href: "/app/contratos", label: "Contratos", hint: "Todo el SEACE, contrato a contrato", icon: FileSearch },
  { href: "/app/hallazgos", label: "Señales", hint: "Con norma y evidencia", icon: Flag },
  { href: "/", label: "Inicio", hint: "Qué es Vigía Perú", icon: Home },
] as const;

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <SaltarAlContenido />
      <header className="border-b border-line bg-paper">
        <FranjaTextil alto={4} />
        <div className="container-page flex h-[60px] items-center">
          <Link href="/" aria-label="Vigía Perú, ir al inicio" className="rounded-lg transition-opacity duration-rapido hover:opacity-80">
            <Marca />
          </Link>
        </div>
      </header>

      <main
        id="contenido"
        tabIndex={-1}
        className="container-page flex flex-1 flex-col items-center py-14 text-center focus:outline-none sm:py-20"
      >
        <Llamita className="w-14 text-granate" />
        <h1 className="mt-6 text-balance font-display text-[30px] font-bold leading-tight tracking-tight text-ink sm:text-4xl">
          No encontramos esta página
        </h1>
        <p className="mt-3 max-w-[52ch] text-pretty text-[15px] leading-relaxed text-inkSoft">
          Puede que el enlace esté mal escrito o que la página ya no exista. Busca un contrato, una entidad o tu
          región, o sigue por uno de estos caminos.
        </p>

        <div className="mt-8 w-full max-w-md">
          <BuscarGlobal className="py-3 text-sm" />
        </div>

        <nav aria-label="Caminos principales" className="mt-10 w-full max-w-2xl">
          <ul className="grid gap-3 sm:grid-cols-2">
            {CAMINOS.map(({ href, label, hint, icon: Icono }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="group flex items-center gap-3 rounded-2xl border border-line bg-paper p-4 text-left transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paperSoft text-inkSoft transition-colors duration-rapido group-hover:bg-paper group-hover:text-granate">
                    <Icono size={16} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-ink">{label}</span>
                    <span className="block text-[13px] text-mute">{hint}</span>
                  </span>
                  <ArrowRight
                    size={15}
                    aria-hidden
                    className="shrink-0 text-mute transition-transform duration-rapido group-hover:translate-x-0.5 group-hover:text-granate"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <p className="mt-10 text-xs text-mute">Error 404: la dirección no corresponde a ninguna página de Vigía Perú.</p>
      </main>
    </div>
  );
}
