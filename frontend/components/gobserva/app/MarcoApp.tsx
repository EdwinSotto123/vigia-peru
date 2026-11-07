import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { BotonModo } from "@/components/ui/BotonModo";
import { CORREO_GOBSERVA, PRODUCTOS, rutaEn, type Producto } from "@/lib/gobserva";
import { MarcaGobserva } from "../MarcaGobserva";
import { MenuCuenta } from "../cuenta/MenuCuenta";
import { ProveedorApp } from "./contexto";
import { BarraApp, LateralApp } from "./NavApp";

/**
 * El marco de la app de un producto de Gobserva, para quien entró (2026-11-07, al estilo de LicitaLAB): barra lateral
 * fija con Inicio, Para ti, Oportunidades, Contratos menores, Seguimiento, Calendario, Mercado, Obras y Alertas, y la
 * cuenta abajo; en el celular, una barra de cuatro secciones abajo y «Más». Sin la cabecera ni el pie para visitantes:
 * una franja arriba con el modo y tu cuenta, y una línea al final con las fuentes.
 *
 * MarcoProducto lo elige cuando la marca de sesión (COOKIE_SESION) está puesta. Server-safe.
 */
export function MarcoApp({
  producto, base, fuentes, children,
}: {
  producto: Producto;
  base: string;
  fuentes: { nombre: string; url: string }[];
  children: ReactNode;
}) {
  const p = PRODUCTOS[producto];
  return (
    <ProveedorApp>
      <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[15.5rem_minmax(0,1fr)]">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-paper focus:px-4 focus:py-2 focus:text-dato focus:font-semibold focus:text-ink focus:ring-2 focus:ring-granate"
        >
          Saltar al contenido
        </a>

        {/* La barra lateral, fija a la altura de la pantalla (desde lg). */}
        <aside className="hidden border-r border-line bg-paperSoft lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:px-3 lg:py-4">
          <Link href={rutaEn(base, "/cuenta")} aria-label={`${p.titulo}, inicio de tu cuenta`} className="mb-5 inline-flex rounded-lg px-2 py-1 transition-opacity duration-rapido hover:opacity-85">
            <MarcaGobserva producto={producto} tamano="sm" />
          </Link>
          <Suspense>
            <LateralApp producto={producto} base={base} />
          </Suspense>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-col">
          <header className="sticky top-0 z-30 border-b border-line bg-paper/90 backdrop-blur-xl">
            <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
              <Link href={rutaEn(base, "/cuenta")} aria-label={`${p.titulo}, inicio de tu cuenta`} className="min-w-0 rounded-lg lg:hidden">
                <MarcaGobserva producto={producto} tamano="sm" />
              </Link>
              <span className="hidden lg:block" />
              <div className="flex shrink-0 items-center gap-2">
                <BotonModo />
                <MenuCuenta base={base} compacto />
              </div>
            </div>
          </header>

          <main id="contenido" tabIndex={-1} className="flex-1 pb-24 focus:outline-none lg:pb-0">
            {children}
          </main>

          <footer className="hidden border-t border-line px-8 py-5 lg:block">
            <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-meta text-mute">
              <span>Datos públicos del Estado peruano, con su fuente oficial:</span>
              {fuentes.map((f) => (
                <a key={f.url} href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:text-ink hover:underline">
                  {f.nombre}
                  <ArrowUpRight size={12} aria-hidden />
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </a>
              ))}
              <a href={`mailto:${CORREO_GOBSERVA}`} className="ml-auto font-mono underline-offset-2 hover:text-ink hover:underline">{CORREO_GOBSERVA}</a>
            </p>
          </footer>
        </div>

        <Suspense>
          <BarraApp producto={producto} base={base} />
        </Suspense>
      </div>
    </ProveedorApp>
  );
}
