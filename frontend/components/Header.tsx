"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Heart, Menu, X } from "lucide-react";
import { FranjaTextil, Marca } from "@/components/marca";
import { UserMenu } from "./auth/UserMenu";
import { BuscarGlobal } from "./BuscarGlobal";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { cn } from "@/lib/utils";

/**
 * Rutas donde el Header pasa a modo "dashboard": minimal, porque el sidebar manda.
 * Las rutas públicas nuevas (/auditoria, /aliados, /aliado, /financiar, /impacto)
 * NO van acá: llevan el header completo.
 */
const DASHBOARD_PATHS = [
  "/app",
  "/region",
  "/entidad",
  "/convocatoria",
  "/alerta",
  "/reporte",
  "/noticia",
  "/preguntas",
];

/** Navegación pública. El orden es el recorrido del producto: inicio → mapa → financiar → ver en vivo → aliados → denunciar. */
const NAV = [
  { href: "/", label: "Inicio" },
  { href: "/app/mapa", label: "Mapa" },
  { href: "/app/auditoria", label: "Auditoría en vivo", vivo: true },
  { href: "/app/aliados", label: "Aliados" },
  { href: "/reporte/nuevo", label: "Denunciar" },
  { href: "/preguntas", label: "FAQ" },
];

type Tema = "claro" | "oscuro";

/**
 * La cabecera del sitio (DESIGN_SYSTEM.md §2, §6 y §13). Arriba, la franja textil
 * de 4 px: la firma del sitio. Debajo, la firma (isotipo + "Vigía Perú"), la
 * navegación y las acciones. La franja y la fila suman 64 px, lo mismo que medía
 * la cabecera antes: los `scroll-mt-16` de la portada y el menú móvil (`top-16`)
 * siguen calzando.
 *
 * Tiene vida, pero toda motivada:
 *
 *  - Cambia de tono con lo que tiene debajo. Las secciones oscuras se marcan con
 *    `data-tema="oscuro"`; mientras una de ellas pasa bajo la cabecera, ésta se
 *    vuelve vidrio oscuro con `sobre-oscuro` (foco en maíz) y acentos maíz. Una
 *    cabecera blanca flotando sobre una sección negra se lee como una tapa pegada
 *    encima, no como parte de la página.
 *  - Una píldora se desliza al ítem que está bajo el cursor: dice "esto se puede
 *    tocar" con un solo elemento en vez de seis fondos que parpadean. La página
 *    activa va en granate con su subrayado (maíz sobre oscuro).
 *  - "Auditoría en vivo" lleva un punto verde que late SÓLO si hay contratos
 *    leyéndose de verdad (`/financiamiento/procesamientos/resumen`). Sin
 *    análisis en curso no hay punto: un "en vivo" que late sobre nada miente.
 *  - En la portada, una línea de progreso: es una historia larga y así se sabe
 *    cuánto falta.
 *
 * El scroll se lee en un solo `requestAnimationFrame` y la barra se escribe
 * directo en el DOM: nada de esto re-renderiza la cabecera por cuadro. El tema
 * sólo re-renderiza cuando cambia.
 */
export function Header() {
  const pathname = usePathname() || "/";
  const isDashboard = DASHBOARD_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isAuth = pathname === "/login" || pathname === "/signup";
  const showNav = !isDashboard && !isAuth;
  const isLanding = pathname === "/";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [tema, setTema] = useState<Tema>("claro");
  const leyendo = useLeyendoAhora(showNav);
  const barra = useRef<HTMLDivElement>(null);
  const cabecera = useRef<HTMLElement>(null);

  // Cambiar de ruta (clic en un link del propio drawer, o navegación por otra vía) cierra
  // el menú — evita que quede abierto tapando la página nueva.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    let cuadro = 0;
    const leer = () => {
      cuadro = 0;
      const alto = cabecera.current?.offsetHeight ?? 64;
      // Lo que está justo debajo del borde inferior de la cabecera, en el centro.
      const bajo = document
        .elementsFromPoint(window.innerWidth / 2, alto + 2)
        .find((el) => !cabecera.current?.contains(el));
      const marcado = bajo?.closest<HTMLElement>("[data-tema]")?.dataset.tema;
      setTema(marcado === "oscuro" ? "oscuro" : "claro");
      if (barra.current) {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        barra.current.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`;
      }
    };
    const pedir = () => { if (!cuadro) cuadro = requestAnimationFrame(leer); };
    leer();
    window.addEventListener("scroll", pedir, { passive: true });
    window.addEventListener("resize", pedir);
    return () => {
      window.removeEventListener("scroll", pedir);
      window.removeEventListener("resize", pedir);
      if (cuadro) cancelAnimationFrame(cuadro);
    };
  }, [pathname]);

  const oscuro = tema === "oscuro" && !mobileOpen;

  return (
    <header
      ref={cabecera}
      data-tema-header={oscuro ? "oscuro" : "claro"}
      className={cn(
        "group/header sticky top-0 z-40 border-b backdrop-blur-xl transition-colors duration-300",
        oscuro ? "sobre-oscuro border-paper/10 bg-ink/85" : "border-line bg-paper/90",
      )}
    >
      <FranjaTextil alto={4} />
      <div className={cn("container-page flex h-[60px] items-center justify-between gap-3 sm:gap-6", isLanding && "max-w-[1400px]")}>
        <Link
          href="/"
          aria-label="Vigía Perú, ir al inicio"
          className="flex shrink-0 items-center rounded-lg transition-opacity duration-rapido hover:opacity-80"
        >
          <Marca tono={oscuro ? "oscuro" : "claro"} />
        </Link>

        {showNav && <NavDeslizante pathname={pathname} oscuro={oscuro} leyendo={leyendo} />}

        <div className="flex items-center gap-2">
          {!isAuth && <BuscarGlobal variant="boton" />}
          {/* En /login y /signup el botón "Entrar" llevaba a la misma página. */}
          {!isAuth && <UserMenu />}
          {showNav && (
            <Link
              href="/app/financiar"
              className={cn(
                "group hidden min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition-colors duration-rapido sm:inline-flex",
                // Sobre oscuro, el botón primario se invierte: papel con texto granate (Button "oscuro").
                oscuro ? "bg-paper text-granate hover:bg-maiz-soft" : "bg-granate text-paper hover:bg-granate-deep",
              )}
            >
              <Heart
                size={14}
                aria-hidden
                className={cn("motion-safe:group-hover:animate-latir", oscuro ? "fill-granate text-granate" : "fill-paper text-paper")}
              />
              Financiar una auditoría
            </Link>
          )}
          {showNav && (
            <button
              type="button"
              onClick={() => setMobileOpen((v) => !v)}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav-panel"
              aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
              className={cn(
                "inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors duration-rapido lg:hidden",
                oscuro ? "border-paper/20 bg-paper/10 text-paper hover:bg-paper/20" : "border-line bg-paperSoft text-ink hover:bg-paperDeep",
              )}
            >
              {mobileOpen ? <X size={17} aria-hidden /> : <Menu size={17} aria-hidden />}
            </button>
          )}
        </div>
      </div>

      {/* Cuánto de la historia se leyó. Sólo en la portada: en el resto de las
          páginas no hay un relato que recorrer. Granate sobre claro, maíz sobre oscuro. */}
      {isLanding && (
        <div aria-hidden className="absolute inset-x-0 bottom-[-1px] h-[2px] overflow-hidden">
          <div
            ref={barra}
            className={cn("h-full origin-left transition-colors duration-300", oscuro ? "bg-maiz" : "bg-granate")}
            style={{ transform: "scaleX(0)" }}
          />
        </div>
      )}

      {showNav && (
        <MobileNavPanel open={mobileOpen} onClose={() => setMobileOpen(false)} pathname={pathname} leyendo={leyendo} />
      )}
    </header>
  );
}

/**
 * Cuántos contratos se están leyendo ahora mismo. `null` mientras no se sabe:
 * sin dato no se dibuja nada, ni un cero. Se vuelve a preguntar cada minuto y
 * sólo mientras la pestaña está a la vista.
 */
function useLeyendoAhora(activo: boolean): number | null {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    const preguntar = () => {
      if (document.visibilityState !== "visible") return;
      fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos/resumen`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { porEstado?: Record<string, number> } | null) => {
          if (vivo && j?.porEstado) setN(j.porEstado.procesando ?? 0);
        })
        .catch(() => {});
    };
    preguntar();
    const t = window.setInterval(preguntar, 60_000);
    return () => {
      vivo = false;
      window.clearInterval(t);
    };
  }, [activo]);
  return n;
}

/**
 * El punto que late cuando hay lecturas en curso. "En vivo" es un estado
 * positivo: va en musgo (DESIGN_SYSTEM.md §3.7), no en maíz. Con movimiento
 * reducido, queda fijo.
 */
function PuntoVivo({ n }: { n: number }) {
  return (
    <>
      <span aria-hidden className="relative ml-1.5 inline-flex h-2 w-2 translate-y-[-1px]">
        <span className="absolute inset-0 rounded-full bg-moss opacity-60 motion-safe:animate-ping" />
        <span className="relative h-2 w-2 rounded-full bg-moss" />
      </span>
      <span className="sr-only">
        ({n} {n === 1 ? "contrato leyéndose" : "contratos leyéndose"} ahora)
      </span>
    </>
  );
}

const esActivo = (pathname: string, href: string) =>
  pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

/**
 * La navegación de escritorio con su píldora. La píldora es UN elemento que se
 * mueve (transform + width), no un fondo por ítem: así se desliza en vez de
 * parpadear. Entra sin deslizarse desde cero la primera vez, y al salir del
 * menú se desvanece. El subrayado queda para la página activa.
 */
function NavDeslizante({ pathname, oscuro, leyendo }: { pathname: string; oscuro: boolean; leyendo: number | null }) {
  const lista = useRef<HTMLElement>(null);
  const [pildora, setPildora] = useState<{ x: number; w: number; visible: boolean; deslizar: boolean }>({
    x: 0,
    w: 0,
    visible: false,
    deslizar: false,
  });

  const mover = useCallback((el: HTMLElement) => {
    setPildora((p) => ({ x: el.offsetLeft, w: el.offsetWidth, visible: true, deslizar: p.visible }));
  }, []);

  // Si cambia el ancho (fuente cargada, resize), la píldora visible se recoloca.
  useLayoutEffect(() => {
    const onResize = () => setPildora((p) => ({ ...p, visible: false }));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <nav
      ref={lista}
      aria-label="Principal"
      className="relative hidden items-center gap-0.5 lg:flex"
      onMouseLeave={() => setPildora((p) => ({ ...p, visible: false, deslizar: false }))}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-0 top-1/2 h-9 -translate-y-1/2 rounded-full",
          oscuro ? "bg-paper/10" : "bg-granate-50",
          pildora.deslizar ? "transition-[transform,width,opacity] duration-300 ease-out" : "transition-opacity duration-200",
          pildora.visible ? "opacity-100" : "opacity-0",
        )}
        style={{ width: pildora.w, transform: `translate3d(${pildora.x}px, -50%, 0)` }}
      />
      {NAV.map((n) => {
        const active = esActivo(pathname, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            onMouseEnter={(e) => mover(e.currentTarget)}
            onFocus={(e) => mover(e.currentTarget)}
            className={cn(
              "relative z-10 inline-flex min-h-9 items-center whitespace-nowrap rounded-full px-2.5 py-2 text-sm font-medium transition-colors duration-rapido xl:px-3",
              "after:absolute after:bottom-0.5 after:left-3 after:right-3 after:h-[2px] after:origin-center after:rounded-full after:transition-transform after:duration-normal",
              active ? "after:scale-x-100" : "after:scale-x-0",
              oscuro
                ? cn("after:bg-maiz", active ? "text-paper" : "text-paper/75 hover:text-paper")
                : cn("after:bg-granate", active ? "text-granate" : "text-inkSoft hover:text-ink"),
            )}
          >
            {n.label}
            {n.vivo && leyendo != null && leyendo > 0 && <PuntoVivo n={leyendo} />}
          </Link>
        );
      })}
    </nav>
  );
}

/** Drawer mobile: mismos items de NAV + el CTA de financiar. Este bug (0 navegación
 * alcanzable bajo md:) afectaba a TODAS las rutas públicas, no solo "/" — por eso la
 * estructura es site-wide.
 *
 * Se monta vía createPortal(..., document.body): el <header> de arriba lleva
 * backdrop-blur-xl, y cualquier ancestro con filter/backdrop-filter se vuelve
 * "containing block" de sus descendientes position:fixed (spec CSS, no bug de Tailwind) —
 * sin portal, este overlay "fixed inset-0" se resuelve contra la caja del header (390×64)
 * en vez del viewport, y el resto de la página queda visible/clicable detrás del menú.
 * Es seguro sin document !== undefined: `open` arranca en false (useState) tanto en SSR
 * como en la primera hidratación — el `if (!open) return null` de abajo corta antes de
 * llegar a createPortal, así que solo se ejecuta tras un clic real del usuario (cliente).
 *
 * Entra entero, sin cascada ítem por ítem: el usuario abrió el menú para ir a
 * algún lado, no para ver una coreografía (DESIGN_SYSTEM.md §8). */
function MobileNavPanel({
  open,
  onClose,
  pathname,
  leyendo,
}: {
  open: boolean;
  onClose: () => void;
  pathname: string;
  leyendo: number | null;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 lg:hidden">
      <button aria-label="Cerrar menú" tabIndex={-1} className="absolute inset-0 bg-ink/40 motion-safe:animate-fadeIn" onClick={onClose} />
      <div
        ref={panelRef}
        id="mobile-nav-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
        tabIndex={-1}
        className="absolute inset-x-0 top-16 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-b-2xl border-b border-line bg-paper px-4 pb-5 pt-3 shadow-dialog focus:outline-none motion-safe:animate-slideUp"
      >
        <nav aria-label="Principal" className="flex flex-col gap-1">
          {NAV.map((n) => {
            const active = esActivo(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-12 items-center rounded-xl px-4 text-base font-medium transition-colors duration-rapido",
                  active
                    ? "bg-granate-50 font-semibold text-granate"
                    : "text-inkSoft hover:bg-paperSoft hover:text-ink",
                )}
              >
                {n.label}
                {n.vivo && leyendo != null && leyendo > 0 && <PuntoVivo n={leyendo} />}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/app/financiar"
          className="group mt-3 flex min-h-12 items-center justify-center gap-2 rounded-full bg-granate px-4 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
        >
          <Heart size={15} aria-hidden className="fill-paper text-paper motion-safe:group-hover:animate-latir" /> Financiar una auditoría
        </Link>
      </div>
    </div>,
    document.body,
  );
}
