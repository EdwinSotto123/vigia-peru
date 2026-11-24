import Link from "next/link";
import { cookies, headers } from "next/headers";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { BotonModo } from "@/components/ui/BotonModo";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { COOKIE_SESION, CORREO_GOBSERVA, PRODUCTOS, PRODUCTOS_APP_ABIERTA, PRODUCTOS_CON_APP, PRODUCTOS_SIN_CUENTA, otrosProductos, rutaEn, type Producto, APP_EN_CONSTRUCCION } from "@/lib/gobserva";
import { cn } from "@/lib/utils";
import { MarcaGobserva } from "./MarcaGobserva";
import { MarcoApp } from "./app/MarcoApp";
import { MenuCuenta } from "./cuenta/MenuCuenta";
import { MenuProducto, RielProducto, type EnlaceProducto } from "./NavProducto";
import { ProgresoNavegacion } from "./ProgresoNavegacion";

export type { EnlaceProducto };

/**
 * El marco de un producto de Gobserva (empleo, licitaciones): cabecera pegada arriba con la marca «gobserva_ <producto>»,
 * su menú, el botón de día y noche y la acción principal; el contenido; y el pie con los demás productos, las fuentes y
 * el contacto. Nada de la cabecera ni del menú de Vigía: es otra marca (Vigía sigue gratis, aparte). Server-safe.
 *
 * `base`: la raíz del producto en este host (lib/gobserva-servidor.ts → baseProducto): los enlaces se arman con ella.
 *
 * Con la sesión abierta (la marca COOKIE_SESION) y si el producto tiene app (NavApp: Empleo, Licitaciones), o si su app
 * es abierta (Salud), el marco es el de la app (MarcoApp: barra lateral, sin la cabecera ni el pie para visitantes).
 * Menos en las páginas de LANDING (RUTAS_LANDING: la portada, los planes, el MCP), que se ven siempre con este marco y
 * su botón para entrar a la app (2026-11-22, el usuario: «falta landing page… debe haber un botón de entrar»). La ruta
 * la pone el middleware en `x-gobserva-ruta`; sin ella, como antes.
 */
const RUTAS_LANDING = ["/", "/planes", "/mcp"];
export function MarcoProducto({
  producto,
  base,
  menu,
  accion,
  fuentes,
  children,
}: {
  producto: Producto;
  base: string;
  menu: EnlaceProducto[];
  /** La acción de la cabecera («Planes», «Recibir alertas»). */
  accion: EnlaceProducto;
  /** De dónde salen los datos, para el pie: «Autoridad Nacional del Servicio Civil (SERVIR)». */
  fuentes: { nombre: string; url: string }[];
  children: ReactNode;
}) {
  // Salud se ve como app para todos (PRODUCTOS_APP_ABIERTA); Empleo y Licitaciones, sólo con la sesión abierta.
  const ruta = headers().get("x-gobserva-ruta")?.split("?")[0] ?? null;
  const landing = ruta != null && RUTAS_LANDING.includes(ruta.replace(/\/+$/, "") || "/");
  // Con la app en construcción (lib/gobserva.ts), Empleo y Licitaciones se ven siempre con el marco de la portada.
  const conApp = !APP_EN_CONSTRUCCION && PRODUCTOS_CON_APP.includes(producto) && cookies().get(COOKIE_SESION)?.value === "1";
  if (!landing && (PRODUCTOS_APP_ABIERTA.includes(producto) || conApp)) {
    return (
      <MarcoApp producto={producto} base={base}>
        {children}
      </MarcoApp>
    );
  }
  const p = PRODUCTOS[producto];
  const otros = otrosProductos(producto);
  // Con la sesión abierta, una acción para crear la cuenta («Crear cuenta», «Recibir alertas» → /entrar) sobra: la
  // cabecera ya dice «Mi cuenta».
  const conSesion = cookies().get(COOKIE_SESION)?.value === "1";
  const accionVisible = conSesion && accion.ruta.startsWith("/entrar") ? null : accion;
  // Un menú de seis secciones o más (Licitaciones, Salud) no entra junto a la marca hasta los 1280 px (medido a 1024).
  const largo = menu.length > 5;
  return (
    <div data-producto={producto} className="flex min-h-screen flex-col">
      <ProgresoNavegacion />
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-paper focus:px-4 focus:py-2 focus:text-dato focus:font-semibold focus:text-ink focus:ring-2 focus:ring-granate"
      >
        Saltar al contenido
      </a>
      <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-xl">
        <div className="container-page flex h-16 items-center justify-between gap-3">
          <Link href={rutaEn(base, "/")} aria-label={`${p.titulo}, inicio`} className="min-w-0 shrink-0 rounded-lg transition-opacity duration-rapido hover:opacity-85">
            <MarcaGobserva producto={producto} tamano="sm" className="sm:hidden" />
            <MarcaGobserva producto={producto} className="hidden sm:inline-flex" />
          </Link>
          <MenuProducto base={base} menu={menu} titulo={p.titulo} largo={largo} />
          <div className="flex shrink-0 items-center gap-2">
            <BotonModo />
            {/* Gobserva Salud es abierto: sin cuenta, no hay «Entrar». */}
            {!PRODUCTOS_SIN_CUENTA.includes(producto) && (
              <>
                <span className="sm:hidden">
                  {/* «Entrar» con su palabra cuando la marca es corta (empleo, obras); con «licitaciones» no entra a 390 px. */}
                  <MenuCuenta base={base} compacto entrarConTexto={p.nombre.length <= 6} />
                </span>
                <span className="hidden sm:inline-flex">
                  <MenuCuenta base={base} />
                </span>
              </>
            )}
            {/* En el celular no entra junto a la marca: va primera en la fila del menú, abajo. */}
            {accionVisible && (
              <Link href={rutaEn(base, accionVisible.ruta)} className={claseAccion("primario", "hidden whitespace-nowrap sm:inline-flex")}>
                {accionVisible.etiqueta}
              </Link>
            )}
          </div>
        </div>
        {/* En el celular, el menú en una fila que se desliza (son pocas secciones) y se esconde al bajar. */}
        <RielProducto base={base} menu={menu} accion={accionVisible} titulo={p.titulo} largo={largo} />
      </header>
      <div aria-hidden className={cn("h-11", largo ? "xl:hidden" : "lg:hidden")} />

      <main id="contenido" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>

      <footer className="sobre-oscuro mt-16 bg-ink text-paper">
        <div className="container-page grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div className="space-y-3">
            <MarcaGobserva producto={producto} />
            <p className="max-w-[40ch] text-dato leading-relaxed text-paper/75">
              {p.lema} Un producto de Gobserva: lo de todos, a la vista de todos.
            </p>
          </div>
          <div>
            <p className="text-dato font-semibold text-paper">Productos</p>
            <ul className="mt-3 space-y-2 text-dato">
              {otros.map((o) => (
                <li key={o.clave}>
                  <a href={`https://${o.host}`} className="text-paper/85 underline-offset-2 hover:text-paper hover:underline">
                    {o.titulo}
                  </a>
                </li>
              ))}
              <li>
                <a href="https://vigia.gobserva.cloud" className="text-paper/85 underline-offset-2 hover:text-paper hover:underline">
                  Vigía, la vigilancia cívica (gratis)
                </a>
              </li>
              <li>
                <a href="https://gobserva.cloud" className="text-paper/85 underline-offset-2 hover:text-paper hover:underline">
                  Gobserva
                </a>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-dato font-semibold text-paper">De dónde salen los datos</p>
            <ul className="mt-3 space-y-2 text-dato">
              {fuentes.map((f) => (
                <li key={f.url}>
                  <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-paper/85 underline-offset-2 hover:text-paper hover:underline">
                    {/* La flecha sigue al texto (en un nombre de dos líneas va al final, no suelta a la derecha). */}
                    {f.nombre}
                    <ArrowUpRight size={13} aria-hidden className="ml-1 inline align-middle" />
                    <span className="sr-only"> (se abre en otra pestaña)</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-dato font-semibold text-paper">Contacto</p>
            <a href={`mailto:${CORREO_GOBSERVA}`} className="mt-3 inline-flex min-h-11 items-center font-mono text-dato text-paper/85 underline-offset-2 hover:text-paper hover:underline">
              {CORREO_GOBSERVA}
            </a>
            <p className="mt-3 text-meta leading-relaxed text-paper/60">
              Gobserva no es una entidad del Estado ni intermedia postulaciones ni contrataciones: ordena datos públicos y
              enlaza siempre a la fuente oficial.
            </p>
          </div>
        </div>
        <div className="border-t border-paper/10">
          <p className={cn("container-page py-4 text-meta text-paper/55")}>© {new Date().getFullYear()} Gobserva. Datos públicos del Estado peruano.</p>
        </div>
      </footer>
    </div>
  );
}
