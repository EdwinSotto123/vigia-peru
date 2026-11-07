import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { BotonModo } from "@/components/ui/BotonModo";
import { CORREO_GOBSERVA, PRODUCTOS, otrosProductos, rutaEn, type Producto } from "@/lib/gobserva";
import { MarcaGobserva } from "../MarcaGobserva";
import { MenuCuenta } from "../cuenta/MenuCuenta";
import { ProveedorApp } from "./contexto";
import { BarraApp, LateralApp } from "./NavApp";

/**
 * El marco de la app de un producto de Gobserva, para quien entró (2026-11-07). Tres piezas con los tokens de la app
 * (globals.css: --lienzo, --caja):
 *
 *  - la barra lateral (desde lg), en su propia columna de alto completo: la marca arriba, a la altura de la cabecera; las
 *    secciones en grupos (lo de hoy, Buscar, Organizar); tu plan y tu cuenta abajo. En el celular, una barra de cuatro
 *    secciones abajo y «Más».
 *  - la cabecera pegada arriba: el buscador de oportunidades (desde md), el modo y tu cuenta.
 *  - el lienzo gris, donde cada página apoya sus cajas (app/Caja.tsx), y el pie con el producto, las fuentes oficiales y
 *    el contacto.
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
      <div className="min-h-screen bg-lienzo lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-caja focus:px-4 focus:py-2 focus:text-dato focus:font-semibold focus:text-ink focus:ring-2 focus:ring-granate"
        >
          Saltar al contenido
        </a>

        {/* La barra lateral: la columna llega hasta abajo y su contenido queda fijo a la altura de la pantalla. */}
        <aside aria-label="Navegación de la app" className="hidden border-r border-line bg-caja lg:block">
          <div className="sticky top-0 flex h-screen flex-col">
            <div className="flex h-16 shrink-0 items-center border-b border-line px-5">
              <Link href={rutaEn(base, "/cuenta")} aria-label={`${p.titulo}, inicio de tu cuenta`} className="inline-flex rounded-lg transition-opacity duration-rapido hover:opacity-85">
                <MarcaGobserva producto={producto} tamano="sm" />
              </Link>
            </div>
            <Suspense>
              <LateralApp producto={producto} base={base} />
            </Suspense>
          </div>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-col">
          <header className="sticky top-0 z-30 border-b border-line bg-caja/90 backdrop-blur-xl">
            <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
              <Link href={rutaEn(base, "/cuenta")} aria-label={`${p.titulo}, inicio de tu cuenta`} className="min-w-0 rounded-lg lg:hidden">
                <MarcaGobserva producto={producto} tamano="sm" />
              </Link>
              {/* Buscar oportunidades desde cualquier página: un formulario GET, sin JavaScript. */}
              <form role="search" action={rutaEn(base, "/oportunidades")} className="relative hidden w-full max-w-md md:block">
                <label htmlFor="app-buscar" className="sr-only">Buscar oportunidades</label>
                <Search size={17} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
                <input
                  id="app-buscar"
                  name="q"
                  type="search"
                  placeholder="Busca lo que vendes: tóner, cemento, consultoría…"
                  className="h-10 w-full rounded-lg border border-line bg-lienzo/70 pl-10 pr-3 text-dato text-ink placeholder:text-mute transition-colors duration-rapido focus:border-granate focus:bg-caja focus:outline-none focus:ring-2 focus:ring-granate/30"
                />
              </form>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <BotonModo />
                <span className="lg:hidden">
                  <MenuCuenta base={base} compacto />
                </span>
              </div>
            </div>
          </header>

          <main id="contenido" tabIndex={-1} className="flex-1 focus:outline-none">
            {children}
          </main>

          <PieApp producto={producto} base={base} fuentes={fuentes} />
        </div>

        <Suspense>
          <BarraApp producto={producto} base={base} />
        </Suspense>
      </div>
    </ProveedorApp>
  );
}

const ENLACE_PIE = "inline-flex min-h-8 items-center gap-1 text-dato text-inkSoft underline-offset-4 transition-colors duration-rapido hover:text-ink hover:underline";

/** El pie de la app: qué es el producto, sus otras piezas, de dónde salen los datos y cómo escribirnos. */
function PieApp({ producto, base, fuentes }: { producto: Producto; base: string; fuentes: { nombre: string; url: string }[] }) {
  const p = PRODUCTOS[producto];
  const otros = otrosProductos(producto);
  return (
    <footer className="border-t border-line bg-caja pb-[calc(env(safe-area-inset-bottom)+4.5rem)] lg:pb-0">
      <div className="mx-auto grid w-full max-w-[84rem] grid-cols-2 gap-x-6 gap-y-8 px-4 py-8 sm:px-6 lg:grid-cols-[1.3fr_1fr_1.2fr_1fr] lg:px-8">
        <div className="col-span-2 space-y-3 lg:col-span-1">
          <MarcaGobserva producto={producto} tamano="sm" />
          <p className="max-w-[38ch] text-meta leading-relaxed text-inkSoft">
            {p.lema} Ordenamos datos públicos y enlazamos siempre a la fuente oficial.
          </p>
        </div>
        <nav aria-labelledby="pie-producto">
          <p id="pie-producto" className="text-meta font-bold text-ink">{p.titulo}</p>
          <ul className="mt-2">
            <li><Link href={rutaEn(base, "/planes")} className={ENLACE_PIE}>Planes y precios</Link></li>
            <li><Link href={rutaEn(base, "/?portada#mcp")} className={ENLACE_PIE}>API y MCP</Link></li>
            {otros.map((o) => (
              <li key={o.clave}>
                <a href={`https://${o.host}`} className={ENLACE_PIE}>{o.titulo}</a>
              </li>
            ))}
            <li><a href="https://vigia.gobserva.cloud" className={ENLACE_PIE}>Vigía, la vigilancia cívica</a></li>
          </ul>
        </nav>
        <nav aria-labelledby="pie-fuentes">
          <p id="pie-fuentes" className="text-meta font-bold text-ink">Fuentes oficiales</p>
          <ul className="mt-2">
            {fuentes.map((f) => (
              <li key={f.url}>
                <a href={f.url} target="_blank" rel="noopener noreferrer" className={ENLACE_PIE}>
                  {f.nombre}
                  <ArrowUpRight size={13} aria-hidden className="shrink-0" />
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="col-span-2 sm:col-span-1">
          <p className="text-meta font-bold text-ink">Ayuda</p>
          <a href={`mailto:${CORREO_GOBSERVA}`} className={`${ENLACE_PIE} mt-2 font-mono`}>{CORREO_GOBSERVA}</a>
          <p className="mt-2 max-w-[34ch] text-meta leading-relaxed text-mute">
            Gobserva no es una entidad del Estado ni intermedia postulaciones ni contrataciones.
          </p>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto w-full max-w-[84rem] px-4 py-4 text-meta text-mute sm:px-6 lg:px-8">
          © {new Date().getFullYear()} Gobserva. Datos públicos del Estado peruano.
        </p>
      </div>
    </footer>
  );
}
