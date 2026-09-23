"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Heart, Menu, X } from "lucide-react";
import { Marca } from "./Marca";
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

/** Foco visible compartido: la navegación entera se podía recorrer con Tab sin ver dónde estabas. */
const ANILLO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50 focus-visible:ring-offset-2 focus-visible:ring-offset-paper";

type Tema = "claro" | "oscuro";

/**
 * El header tiene vida, pero toda motivada:
 *
 *  - Cambia de tono con lo que tiene debajo. Las secciones oscuras se marcan con
 *    `data-tema="oscuro"`; mientras una de ellas pasa bajo el header, el header
 *    se vuelve vidrio oscuro. Un header blanco flotando sobre una sección negra
 *    se lee como una tapa pegada encima, no como parte de la página.
 *  - Una píldora se desliza al ítem que está bajo el cursor: dice "esto se puede
 *    tocar" con un solo elemento en vez de seis fondos que parpadean.
 *  - "Auditoría en vivo" lleva un punto que late SÓLO si hay contratos
 *    leyéndose de verdad (`/financiamiento/procesamientos/resumen`). Sin
 *    análisis en curso no hay punto: un "en vivo" que late sobre nada miente.
 *  - En la portada, una línea de progreso: es una historia larga y así se sabe
 *    cuánto falta.
 *  - El corazón del botón late una vez al pasar el cursor.
 *
 * El scroll se lee en un solo `requestAnimationFrame` y la barra se escribe
 * directo en el DOM: nada de esto re-renderiza el header por cuadro. El tema
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
      // Lo que está justo debajo del borde inferior del header, en el centro.
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
        oscuro ? "border-paper/10 bg-ink/80" : "border-line bg-paper/80",
      )}
    >
      <div className={cn("container-page flex h-16 items-center justify-between gap-6", isLanding && "max-w-[1400px]")}>
        <Link
          href="/"
          aria-label="Vigía Perú, ir al inicio"
          className={cn(
            "flex shrink-0 items-center rounded-lg transition-opacity duration-rapido hover:opacity-80",
            ANILLO,
          )}
        >
          <Marca tono={oscuro ? "oscuro" : "claro"} />
        </Link>

        {showNav && <NavDeslizante pathname={pathname} oscuro={oscuro} leyendo={leyendo} />}

        <div className="flex items-center gap-2">
          {!isAuth && <BuscarGlobal variant="boton" />}
          <UserMenu />
          {showNav && (
            <Link
              href="/app/financiar"
              className="group hidden items-center gap-1.5 whitespace-nowrap rounded-full bg-heroViolet px-4 py-2 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper active:translate-y-0 sm:inline-flex"
            >
              <Heart size={14} className="fill-paper text-paper group-hover:animate-latir" /> Financiar una auditoría
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
                "inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors lg:hidden",
                oscuro ? "border-paper/20 bg-paper/10 text-paper hover:bg-paper/20" : "border-line bg-paperSoft text-ink hover:bg-paperDeep",
              )}
            >
              {mobileOpen ? <X size={17} /> : <Menu size={17} />}
            </button>
          )}
        </div>
      </div>

      {/* Cuánto de la historia se leyó. Sólo en la portada: en el resto de las
          páginas no hay un relato que recorrer. */}
      {isLanding && (
        <div aria-hidden className="absolute inset-x-0 bottom-[-1px] h-[2px] overflow-hidden">
          <div
            ref={barra}
            className="h-full origin-left bg-gradient-to-r from-heroViolet via-heroViolet to-heroGreen"
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

/** El punto que late cuando hay lecturas en curso. Con movimiento reducido, queda fijo. */
function PuntoVivo({ n }: { n: number }) {
  return (
    <>
      <span aria-hidden className="relative ml-1.5 inline-flex h-2 w-2 translate-y-[-1px]">
        <span className="absolute inset-0 animate-ping rounded-full bg-heroGreen opacity-60" />
        <span className="relative h-2 w-2 rounded-full bg-heroGreen" />
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
 * menú se desvanece. El subrayado verde queda para la página activa.
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
          oscuro ? "bg-paper/10" : "bg-paperDeep",
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
              "relative z-10 inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-2 text-sm font-medium transition-colors duration-rapido xl:px-3",
              "after:absolute after:bottom-0.5 after:left-3 after:right-3 after:h-[2px] after:origin-center after:rounded-full after:bg-heroGreen after:transition-transform after:duration-normal",
              active ? "after:scale-x-100" : "after:scale-x-0",
              oscuro
                ? active ? "text-paper" : "text-paper/75 hover:text-paper"
                : active ? "text-ink" : "text-inkSoft hover:text-ink",
              ANILLO,
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

/** Drawer mobile a pantalla completa: mismos items de NAV + el CTA de financiar. Este bug
 * (0 navegación alcanzable bajo md:) afectaba a TODAS las rutas públicas, no solo "/" —
 * por eso la estructura es site-wide, y el acento de color (heroViolet/heroGreen) también:
 * ya no varía por ruta.
 *
 * Se monta vía createPortal(..., document.body): el <header> de arriba lleva
 * backdrop-blur-xl, y cualquier ancestro con filter/backdrop-filter se vuelve
 * "containing block" de sus descendientes position:fixed (spec CSS, no bug de Tailwind) —
 * sin portal, este overlay "fixed inset-0" se resuelve contra la caja del header (390×64)
 * en vez del viewport, y el resto de la página queda visible/clicable detrás del menú.
 * Es seguro sin document !== undefined: `open` arranca en false (useState) tanto en SSR
 * como en la primera hidratación — el `if (!open) return null` de abajo corta antes de
 * llegar a createPortal, así que solo se ejecuta tras un clic real del usuario (cliente). */
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
      <button aria-label="Cerrar menú" tabIndex={-1} className="animate-fadeIn absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        id="mobile-nav-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
        tabIndex={-1}
        className="animate-slideUp absolute inset-x-0 top-16 max-h-[calc(100vh-4rem)] overflow-y-auto rounded-b-3xl border-b border-line bg-paper p-4 shadow-paper focus:outline-none"
      >
        <nav className="flex flex-col gap-1">
          {NAV.map((n, i) => {
            const active = esActivo(pathname, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                // Los ítems entran en cascada, 30 ms uno detrás del otro: el menú
                // se despliega en vez de aparecer de golpe.
                style={{ animationDelay: `${i * 30}ms` }}
                className={cn(
                  "animate-fadeInUp flex items-center rounded-xl px-4 py-3 text-base font-medium transition-colors",
                  active
                    ? "bg-paperDeep text-heroViolet"
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
          className="group mt-3 flex items-center justify-center gap-2 rounded-full bg-heroViolet px-4 py-3 text-sm font-semibold text-paper shadow-card"
        >
          <Heart size={15} className="fill-paper text-paper group-hover:animate-latir" /> Financiar una auditoría
        </Link>
      </div>
    </div>,
    document.body,
  );
}
