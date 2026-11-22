import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { Search } from "lucide-react";
import { BotonModo } from "@/components/ui/BotonModo";
import { CORREO_GOBSERVA, PRODUCTOS, PRODUCTOS_APP_ABIERTA, rutaEn, type Producto } from "@/lib/gobserva";
import { MarcaGobserva } from "../MarcaGobserva";
import { MenuCuenta } from "../cuenta/MenuCuenta";
import { ProveedorApp } from "./contexto";
import { ProveedorAvisos } from "@/components/gobserva/ui/Avisos";
import { BarraApp, LateralApp } from "./NavApp";
import { OcultarEnRutas } from "./OcultarEnRutas";

/** Las páginas de Salud con su propio buscador (el de la barra de arriba sobra ahí). */
const RUTAS_CON_BUSCADOR_SALUD = String.raw`^(/salud)?/?$|/(buscar|establecimientos|sanciones|medicamentos|alertas)$`;
import { Campana } from "@/components/licitaciones-app/notificaciones/Campana";

/**
 * El marco de la app de un producto de Gobserva, para quien entró (2026-11-07). Tres piezas con los tokens de la app
 * (globals.css: --lienzo, --caja):
 *
 *  - la barra lateral (desde lg), en su propia columna de alto completo: la marca arriba, a la altura de la cabecera; las
 *    secciones en grupos (lo de hoy, Buscar, Organizar); tu plan y tu cuenta abajo. En el celular, una barra de cuatro
 *    secciones abajo y «Más».
 *  - la cabecera pegada arriba: el buscador de oportunidades (desde md), el modo y tu cuenta.
 *  - el lienzo gris, donde cada página apoya sus cajas (app/Caja.tsx). Sin pie (2026-11-07, el usuario: el pie de la
 *    portada «no va dentro de la app»): la ayuda está en el menú de tu cuenta y cada dato enlaza a su fuente oficial donde
 *    se muestra.
 *
 * MarcoProducto lo elige cuando la marca de sesión (COOKIE_SESION) está puesta, y siempre en los productos abiertos
 * (PRODUCTOS_APP_ABIERTA, Gobserva Salud): ahí no hay plan ni campana, la marca lleva al inicio y abajo queda una línea
 * con lo que Gobserva es y no es. Server-safe.
 */

/** El buscador de la cabecera de cada app: a dónde va y qué se escribe. */
const BUSCADOR: Partial<Record<Producto, { accion: string; etiqueta: string; ejemplo: string }>> = {
  empleo: { accion: "/app/plazas", etiqueta: "Buscar plazas", ejemplo: "Busca tu puesto: contador, enfermera, chofer…" },
  licitaciones: { accion: "/app/bandeja", etiqueta: "Buscar oportunidades", ejemplo: "Busca lo que vendes: tóner, cemento, consultoría…" },
  salud: { accion: "/buscar", etiqueta: "Buscar en Gobserva Salud", ejemplo: "Clínica, colegiatura o medicina…" },
};
export function MarcoApp({
  producto, base, children,
}: {
  producto: Producto;
  base: string;
  children: ReactNode;
}) {
  const p = PRODUCTOS[producto];
  const abierta = PRODUCTOS_APP_ABIERTA.includes(producto);
  const buscador = BUSCADOR[producto] ?? BUSCADOR.licitaciones!;
  const inicio = rutaEn(base, abierta ? "/" : "/cuenta");
  return (
    <ProveedorApp producto={producto}>
      <ProveedorAvisos>
      <div data-producto={producto} className="min-h-screen bg-lienzo lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
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
              <Link href={inicio} aria-label={abierta ? `${p.titulo}, inicio` : `${p.titulo}, inicio de tu cuenta`} className="inline-flex rounded-lg transition-opacity duration-rapido hover:opacity-85">
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
              <Link href={inicio} aria-label={abierta ? `${p.titulo}, inicio` : `${p.titulo}, inicio de tu cuenta`} className="shrink-0 rounded-lg lg:hidden">
                <MarcaGobserva producto={producto} tamano="sm" />
              </Link>
              {/* Buscar desde cualquier página: un formulario GET, sin JavaScript. En Salud no va en las páginas que ya tienen
                  su buscador (la portada, buscar, clínicas, sanciones, medicamentos y alertas): dos cajas a la vez confundían. */}
              {producto === "salud" ? (
                <OcultarEnRutas patron={RUTAS_CON_BUSCADOR_SALUD}>
                <form role="search" action={rutaEn(base, buscador.accion)} className="relative hidden min-w-0 flex-1 md:block lg:max-w-md">
                  <label htmlFor="app-buscar" className="sr-only">{buscador.etiqueta}</label>
                  <Search size={17} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
                  <input
                    id="app-buscar"
                    name="q"
                    type="search"
                    placeholder={buscador.ejemplo}
                    className="h-10 w-full rounded-lg border border-line bg-lienzo/70 pl-10 pr-3 text-dato text-ink placeholder:text-mute transition-colors duration-rapido focus:border-granate focus:bg-caja focus:outline-none focus:ring-2 focus:ring-granate/30"
                  />
                </form>
                </OcultarEnRutas>
              ) : (
                <form role="search" action={rutaEn(base, buscador.accion)} className="relative hidden min-w-0 flex-1 md:block lg:max-w-md">
                  <label htmlFor="app-buscar" className="sr-only">{buscador.etiqueta}</label>
                  <Search size={17} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
                  <input
                    id="app-buscar"
                    name="q"
                    type="search"
                    placeholder={buscador.ejemplo}
                    className="h-10 w-full rounded-lg border border-line bg-lienzo/70 pl-10 pr-3 text-dato text-ink placeholder:text-mute transition-colors duration-rapido focus:border-granate focus:bg-caja focus:outline-none focus:ring-2 focus:ring-granate/30"
                  />
                </form>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-2">
                {!abierta && (
                  <Suspense>
                    <Campana base={base} />
                  </Suspense>
                )}
                {/* Bajo 400 px no entran la marca, la campana, el modo y la cuenta: el modo va en «Más». */}
                <span className="hidden min-[400px]:block">
                  <BotonModo />
                </span>
                <span className="lg:hidden">
                  <MenuCuenta base={base} compacto />
                </span>
              </div>
            </div>
          </header>

          {/* En el celular, el aire de abajo para la barra de la app (fija). */}
          <main id="contenido" tabIndex={-1} className="flex-1 pb-[calc(env(safe-area-inset-bottom)+4.5rem)] focus:outline-none lg:pb-0">
            {children}
            {abierta && (
              <footer className="border-t border-line px-4 py-5 sm:px-6 lg:px-8">
                <p className="max-w-[90ch] text-meta leading-relaxed text-mute">
                  {p.titulo} es gratis y abierto. Gobserva no es una entidad del Estado: ordena datos públicos y enlaza siempre a la
                  fuente oficial.{" "}
                  <Link href={rutaEn(base, "/fuentes")} className="font-semibold text-inkSoft underline underline-offset-2 hover:text-ink">
                    De dónde sale cada dato
                  </Link>
                  {". Escríbenos a "}
                  <a href={`mailto:${CORREO_GOBSERVA}`} className="font-mono text-inkSoft underline underline-offset-2 hover:text-ink">
                    {CORREO_GOBSERVA}
                  </a>
                  .
                </p>
              </footer>
            )}
          </main>
        </div>

        <Suspense>
          <BarraApp producto={producto} base={base} />
        </Suspense>
      </div>
      </ProveedorAvisos>
    </ProveedorApp>
  );
}
