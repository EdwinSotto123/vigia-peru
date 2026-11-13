"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Crown, Heart, Menu, X } from "lucide-react";
import { FranjaTextil, Marca } from "@/components/marca";
import { UserMenu } from "./auth/UserMenu";
import { BuscarGlobal } from "./BuscarGlobal";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { cn } from "@/lib/utils";
import { LinkIntencion } from "@/components/ui/LinkIntencion";
import { BotonModo } from "@/components/ui/BotonModo";

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

/**
 * Navegación pública. El orden es el recorrido del producto: inicio → mapa → los datos (contratos con los cruces de su
 * ganador, señales de los leídos) → ver en vivo → partidos → aliados → denunciar. Financiar es el botón de la derecha.
 *
 * Qué enlaces entran en la barra se MIDE (`useEnlacesQueEntran`): antes se decidía por el ancho de la pantalla (`xl`,
 * `2xl`), pero la fila no crece más allá de `container-page` (1280 px), así que desde 2xl entraban los nueve enlaces y
 * «Apoyar la vigilancia» entero en el mismo espacio y «Preguntas» quedaba encima del botón de día y noche (el dueño,
 * 2026-11-01: «se sobreponen unos sobre otros»). `prioridad`: el orden en que se quedan en la barra cuando no entran
 * todos (1 se queda siempre); los que no entran van al menú ☰. `desde`: la regla vieja, sólo para lo que pinta el
 * servidor antes de medir (con `nunca`, sólo si la medida dice que entra).
 */
const NAV: { href: string; label: string; vivo?: boolean; dorado?: boolean; desde?: "xl" | "nunca"; prioridad: number }[] = [
  { href: "/", label: "Inicio", prioridad: 1 },
  { href: "/app/mapa", label: "Mapa", prioridad: 2 },
  { href: "/app/contratos", label: "Contratos", prioridad: 3 },
  { href: "/app/hallazgos", label: "Señales", prioridad: 4 },
  { href: "/app/auditoria", label: "Auditoría en vivo", vivo: true, desde: "xl", prioridad: 6 },
  { href: "/app/partidos", label: "Partidos", desde: "xl", prioridad: 7 },
  // Dorado: el reconocimiento público a quienes financian la lectura (el ranking).
  { href: "/app/apoyar?seccion=aliados", label: "Aliados", dorado: true, prioridad: 5 },
  { href: "/reporte/nuevo", label: "Denunciar", desde: "nunca", prioridad: 8 },
  { href: "/preguntas", label: "Preguntas", desde: "nunca", prioridad: 9 },
];
const MOSTRAR: Record<"siempre" | "xl" | "nunca", string> = { siempre: "inline-flex", xl: "hidden xl:inline-flex", nunca: "hidden" };
const POR_PRIORIDAD = [...NAV].sort((a, b) => a.prioridad - b.prioridad);
/** Las clases que fijan el ancho de un enlace de la barra: las mismas en la barra y en la fila que se mide. */
const CAJA_ENLACE = "min-h-11 xl:min-h-9 items-center whitespace-nowrap rounded-full px-2.5 py-2 text-dato leading-5 font-medium xl:px-3";
/** El `gap-0.5` de la barra, en px. */
const ENTRE_ENLACES = 2;

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
  // Los enlaces que entran en la barra (null: todavía sin medir). Los que no, en el menú ☰, que entonces se ve en
  // cualquier ancho; antes de medir, también (el servidor no sabe cuánto mide la pantalla).
  const [entran, setEntran] = useState<Set<string> | null>(null);
  const conMenu = entran === null || entran.size < NAV.length;

  // Cambiar de ruta (clic en un link del propio drawer, o navegación por otra vía) cierra
  // el menú — evita que quede abierto tapando la página nueva.
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  useEffect(() => {
    let cuadro = 0;
    const leer = () => {
      cuadro = 0;
      // El borde de abajo en la pantalla, no el alto: arriba de todo la cabecera no empieza en 0 (encima va el
      // cintillo de aliados, que se va al bajar).
      const alto = cabecera.current?.getBoundingClientRect().bottom ?? 64;
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
          aria-label="Vigía Perú, by Gobserva, ir al inicio"
          className="flex shrink-0 items-center rounded-lg transition-opacity duration-rapido hover:opacity-80"
        >
          <Marca tono={oscuro ? "oscuro" : "claro"} firma />
        </Link>

        {showNav && <NavDeslizante pathname={pathname} oscuro={oscuro} leyendo={leyendo} entran={entran} alMedir={setEntran} />}

        <div className="flex shrink-0 items-center gap-2">
          <BotonModo className={oscuro ? "border-paper/15 bg-transparent text-paper hover:bg-paper/10" : undefined} />
          {!isAuth && <BuscarGlobal variant="boton" />}
          {/* En /login y /signup el botón "Entrar" llevaba a la misma página. */}
          {!isAuth && <UserMenu />}
          {showNav && (
            <Link
              href="/app/apoyar"
              className={cn(
                "group hidden min-h-11 lg:min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full px-4 py-2 text-dato leading-5 font-semibold transition-colors duration-rapido sm:inline-flex",
                // Sobre oscuro, el botón primario se invierte: papel con texto granate (Button "oscuro").
                oscuro ? "bg-maiz text-ink hover:bg-maiz/85" : "bg-granate text-paper hover:bg-granate-deep",
              )}
            >
              <Heart
                size={14}
                aria-hidden
                className={cn("motion-safe:group-hover:animate-latir", oscuro ? "fill-ink text-ink" : "fill-paper text-paper")}
              />
              {/* Con el botón de modo día / noche, el texto completo sólo entra desde 2xl. */}
              Apoyar<span className="hidden 2xl:inline"> la vigilancia</span>
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
                // En el celular siempre; en escritorio, mientras algún enlace no entre en la barra (los que no entran están aquí).
                "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-colors duration-rapido",
                !conMenu && "lg:hidden",
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
function NavDeslizante({
  pathname,
  oscuro,
  leyendo,
  entran,
  alMedir,
}: {
  pathname: string;
  oscuro: boolean;
  leyendo: number | null;
  entran: Set<string> | null;
  alMedir: (entran: Set<string>) => void;
}) {
  const lista = useRef<HTMLElement>(null);
  const regla = useRef<HTMLSpanElement>(null);
  useEnlacesQueEntran(lista, regla, alMedir);
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
      // Ocupa lo que dejan la marca y los botones, y recorta lo que no entra: un enlace nunca se pinta encima de un botón
      // (antes de medir, el servidor pinta según el ancho y puede sobrar algo). Centrada mientras entra todo (`safe`).
      className="relative hidden min-w-0 flex-1 items-center justify-[safe_center] gap-0.5 overflow-hidden lg:flex"
      onMouseLeave={() => setPildora((p) => ({ ...p, visible: false, deslizar: false }))}
    >
      {/* Todos los enlaces, invisibles y fuera del flujo: de aquí sale el ancho de cada uno para decidir cuáles entran. */}
      <span ref={regla} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex w-max gap-0.5">
        {NAV.map((n) => (
          <span key={n.href} data-href={n.href} className={cn("inline-flex", CAJA_ENLACE)}>
            <ContenidoEnlace n={n} leyendo={leyendo} />
          </span>
        ))}
      </span>
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
          <LinkIntencion
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            onMouseEnter={(e) => mover(e.currentTarget)}
            onFocus={(e) => mover(e.currentTarget)}
            className={cn(
              "group relative z-10 shrink-0 transition-colors duration-rapido",
              CAJA_ENLACE,
              entran ? (entran.has(n.href) ? "inline-flex" : "hidden") : MOSTRAR[n.desde ?? "siempre"],
              "after:absolute after:bottom-0.5 after:left-3 after:right-3 after:h-[2px] after:origin-center after:rounded-full after:transition-transform after:duration-normal",
              active ? "after:scale-x-100" : "after:scale-x-0",
              oscuro
                ? cn("after:bg-maiz", active ? "text-paper" : "text-paper/75 hover:text-paper")
                : cn("after:bg-granate", active ? "text-granate" : "text-inkSoft hover:text-ink"),
            )}
          >
            <ContenidoEnlace n={n} leyendo={leyendo} />
          </LinkIntencion>
        );
      })}
    </nav>
  );
}

/** Lo de adentro de un enlace de la barra: el nombre (Aliados, en su pastilla de maíz) y el punto «en vivo». */
function ContenidoEnlace({ n, leyendo }: { n: (typeof NAV)[number]; leyendo: number | null }) {
  return (
    <>
      {n.dorado ? (
        // Pastilla de maíz con texto tinta (legible sobre claro y sobre oscuro).
        <span className="-mx-1 inline-flex items-center gap-1 rounded-full bg-maiz px-2.5 py-1 font-semibold text-[rgb(var(--sobre-maiz))] shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)] transition-colors duration-rapido group-hover:bg-maiz/90">
          <Crown size={13} aria-hidden className="text-[rgb(var(--sobre-maiz))]" />
          {n.label}
        </span>
      ) : (
        n.label
      )}
      {n.vivo && leyendo != null && leyendo > 0 && <PuntoVivo n={leyendo} />}
    </>
  );
}

/**
 * Cuáles enlaces entran en la barra, por `prioridad`: el ancho de cada uno sale de la fila invisible (`regla`) y se
 * compara con el que le queda a la barra. Se vuelve a medir cuando cambia cualquiera de los dos (la ventana, la fuente
 * que termina de cargar, el «Entrar» que pasa a avatar, el punto «en vivo» que aparece). Uno que no entra deja fuera a
 * los de menor prioridad aunque sean más cortos: la barra no salta de un orden a otro según el ancho.
 */
function useEnlacesQueEntran(
  lista: React.RefObject<HTMLElement>,
  regla: React.RefObject<HTMLElement>,
  alMedir: (entran: Set<string>) => void,
) {
  useLayoutEffect(() => {
    const nav = lista.current;
    const fila = regla.current;
    if (!nav || !fila) return;
    let previa = "";
    const medir = () => {
      const anchos = new Map<string, number>();
      for (const el of Array.from(fila.children) as HTMLElement[]) anchos.set(el.dataset.href ?? "", el.offsetWidth);
      // Oculta (debajo de lg), la barra mide 0: no entra ninguno y todo queda en el menú.
      const disponible = nav.clientWidth;
      const entran = new Set<string>();
      let usado = 0;
      for (const n of POR_PRIORIDAD) {
        const w = (anchos.get(n.href) ?? 0) + (entran.size ? ENTRE_ENLACES : 0);
        if (usado + w > disponible) break;
        usado += w;
        entran.add(n.href);
      }
      const clave = [...entran].join("|");
      if (clave !== previa) {
        previa = clave;
        alMedir(entran);
      }
    };
    medir();
    const observador = new ResizeObserver(medir);
    observador.observe(nav);
    observador.observe(fila);
    return () => observador.disconnect();
  }, [lista, regla, alMedir]);
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
    // En cualquier ancho: en escritorio el ☰ se ve mientras algún enlace no entre en la barra.
    <div className="fixed inset-0 z-50">
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
              <LinkIntencion
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-12 items-center rounded-xl px-4 text-destacado leading-6 font-medium transition-colors duration-rapido",
                  "dorado" in n && n.dorado
                    ? "gap-2 bg-maiz-soft font-semibold text-ink hover:bg-maiz/40"
                    : active
                    ? "bg-granate-50 font-semibold text-granate"
                    : "text-inkSoft hover:bg-paperSoft hover:text-ink",
                )}
              >
                {"dorado" in n && n.dorado && <Crown size={16} aria-hidden className="text-medalla-oroOscuro" />}
                {n.label}
                {n.vivo && leyendo != null && leyendo > 0 && <PuntoVivo n={leyendo} />}
              </LinkIntencion>
            );
          })}
        </nav>
        <Link
          href="/app/apoyar"
          className="group mt-3 flex min-h-12 items-center justify-center gap-2 rounded-full bg-granate px-4 text-dato leading-5 font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
        >
          <Heart size={15} aria-hidden className="fill-paper text-paper motion-safe:group-hover:animate-latir" /> Ayúdanos a seguir vigilando
        </Link>
      </div>
    </div>,
    document.body,
  );
}
