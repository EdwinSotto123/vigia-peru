import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { fechaCorta } from "@/lib/formato";

/**
 * La tabla de todo listado (§14.1). Las columnas se declaran una vez y la cabecera
 * y cada fila comparten la misma rejilla (variables CSS por breakpoint): antes cada
 * listado tenía su propia tabla, con su propia altura de fila, su propio estilo de
 * cabecera y su propio chip de estado.
 *
 * Anatomía de una fila, siempre igual:
 *   estado (chip) · qué es (título 1 línea + meta) · datos (números a la derecha) · fecha · ›
 *
 * Una fila es UNA acción: `href` (va a su página) o `detalle` (abre el panel lateral).
 * Por eso sus celdas no llevan enlaces ni botones propios (serían un control dentro
 * de otro). Semántica de lista (`ul`): cada fila se lee entera por su contenido.
 *
 * Server-safe: columnas y filas son datos + ReactNode ya armados.
 */

type Desde = "md" | "lg" | "xl";

export interface Columna {
  clave: string;
  titulo: string;
  /** Pista de la rejilla: "minmax(0,1fr)", "120px"… */
  ancho: string;
  alinear?: "izq" | "der";
  /** Desde qué ancho se muestra. Sin valor: siempre (también en el celular). */
  desde?: Desde;
  /** `<Ayuda/>` junto al título de la columna: qué mide, cómo se calcula. */
  ayuda?: ReactNode;
  /**
   * Con `desde`: debajo de ese ancho la celda no desaparece, se apila bajo la primera
   * columna visible (el chip de estado bajo el título en el celular, en vez de una
   * columna de 170 px que dejaba el título en 114).
   */
  apilar?: boolean;
}

export interface Fila {
  id: string;
  celdas: Record<string, ReactNode>;
  href?: string;
  /** `href` a otro sitio (SEACE, OECE): se abre en otra pestaña y la fila lo dice. */
  externo?: boolean;
  detalle?: { titulo: string; etiqueta?: string; descripcion?: ReactNode; contenido: ReactNode; pie?: ReactNode };
  /** Marca de "elegida" o "en curso": barra granate a la izquierda. */
  resaltada?: boolean;
}

const ORDEN: (Desde | undefined)[] = [undefined, "md", "lg", "xl"];
const visibleEn = (c: Columna, bp: Desde | undefined) => ORDEN.indexOf(c.desde) <= ORDEN.indexOf(bp);

// Clases literales (Tailwind sólo genera lo que ve escrito entero en el código).
const OCULTA: Record<Desde, string> = { md: "hidden md:flex", lg: "hidden lg:flex", xl: "hidden xl:flex" };
const OCULTA_BLOQUE: Record<Desde, string> = { md: "hidden md:block", lg: "hidden lg:block", xl: "hidden xl:block" };
/** Lo apilado bajo la primera columna se ve sólo HASTA el ancho en que la columna aparece. */
const MOSTRAR_HASTA: Record<Desde, string> = { md: "md:hidden", lg: "lg:hidden", xl: "xl:hidden" };

/** Las cuatro rejillas (base, md, lg, xl) como variables CSS: la clase es fija, la pista no. */
function rejilla(columnas: Columna[], conAccion: boolean): CSSProperties {
  const t = (bp: Desde | undefined) =>
    [...columnas.filter((c) => visibleEn(c, bp)).map((c) => c.ancho), ...(conAccion ? ["16px"] : [])].join(" ");
  return { "--t-base": t(undefined), "--t-md": t("md"), "--t-lg": t("lg"), "--t-xl": t("xl") } as CSSProperties;
}

const GRID = "grid grid-cols-[var(--t-base)] md:grid-cols-[var(--t-md)] lg:grid-cols-[var(--t-lg)] xl:grid-cols-[var(--t-xl)] items-center gap-x-4";

/**
 * `medida="contenedor"`: los mismos cortes, pero por el ancho de la TABLA (container
 * queries) y no de la pantalla. Para tablas dentro de un panel lateral o de una columna
 * angosta, donde un `lg` de pantalla dejaba entrar columnas que no caben. md = 36rem,
 * lg = 48rem, xl = 64rem de ancho de tabla. Clases literales, como las de arriba.
 */
const GRID_C =
  "grid grid-cols-[var(--t-base)] [@container(min-width:36rem)]:grid-cols-[var(--t-md)] [@container(min-width:48rem)]:grid-cols-[var(--t-lg)] [@container(min-width:64rem)]:grid-cols-[var(--t-xl)] items-center gap-x-4";
const OCULTA_C: Record<Desde, string> = {
  md: "hidden [@container(min-width:36rem)]:flex",
  lg: "hidden [@container(min-width:48rem)]:flex",
  xl: "hidden [@container(min-width:64rem)]:flex",
};
const OCULTA_BLOQUE_C: Record<Desde, string> = {
  md: "hidden [@container(min-width:36rem)]:block",
  lg: "hidden [@container(min-width:48rem)]:block",
  xl: "hidden [@container(min-width:64rem)]:block",
};
const MOSTRAR_HASTA_C: Record<Desde, string> = {
  md: "[@container(min-width:36rem)]:hidden",
  lg: "[@container(min-width:48rem)]:hidden",
  xl: "[@container(min-width:64rem)]:hidden",
};

type Medida = "pantalla" | "contenedor";
const clases = (m: Medida) =>
  m === "contenedor"
    ? { grid: GRID_C, oculta: OCULTA_C, bloque: OCULTA_BLOQUE_C, hasta: MOSTRAR_HASTA_C }
    : { grid: GRID, oculta: OCULTA, bloque: OCULTA_BLOQUE, hasta: MOSTRAR_HASTA };

export interface GrupoFilas {
  clave: string;
  /** Rótulo del grupo con su conteo: "En espera · 47". */
  titulo: ReactNode;
  filas: Fila[];
}

export function Tabla({
  columnas,
  filas,
  grupos,
  etiqueta,
  medida = "pantalla",
  className,
}: {
  columnas: Columna[];
  /** Las filas, o `grupos` para partirlas bajo un rótulo (en análisis / en espera / leídos). */
  filas?: Fila[];
  grupos?: GrupoFilas[];
  /** Nombre de la lista para el lector de pantalla: "Señales publicadas". */
  etiqueta: string;
  /** Los cortes de columnas por la pantalla (por defecto) o por el ancho de la tabla (dentro de un panel). */
  medida?: Medida;
  className?: string;
}) {
  const k = clases(medida);
  const todas = grupos ? grupos.flatMap((g) => g.filas) : filas ?? [];
  const conAccion = todas.some((f) => f.href || f.detalle);
  const estilo = rejilla(columnas, conAccion);
  return (
    // `overflow-clip` y no `overflow-hidden`: recorta las esquinas igual pero no crea un
    // contenedor de scroll, así los rótulos de grupo (`sticky`) se quedan fijos al bajar.
    <div
      className={cn("overflow-clip rounded-2xl border border-line bg-paper", medida === "contenedor" && "[container-type:inline-size]", className)}
      style={estilo}
    >
      <div className={cn(k.grid, "border-b border-line bg-paperSoft px-4 py-2.5 text-[12px] font-medium text-mute")}>
        {columnas.map((c) => (
          <span key={c.clave} className={cn("min-w-0 items-center gap-1", c.desde ? k.oculta[c.desde] : "flex", c.alinear === "der" && "justify-end")}>
            <span className="truncate">{c.titulo}</span>
            {c.ayuda}
          </span>
        ))}
        {conAccion && <span aria-hidden />}
      </div>
      {grupos ? (
        grupos.map((g) => (
          <section key={g.clave} aria-label={typeof g.titulo === "string" ? g.titulo : undefined} className="border-b border-line last:border-b-0">
            {/* `top-[0px]`, no `top-0`: el layout baja todo `.sticky.top-0` en el celular. */}
            <h3 className="sticky top-[0px] z-[1] border-b border-line/70 bg-paperSoft/95 px-4 py-2 text-[12.5px] font-semibold text-inkSoft backdrop-blur">
              {g.titulo}
            </h3>
            <ul>
              {g.filas.map((f) => (
                <li key={f.id} className="border-b border-line/70 last:border-b-0">
                  <FilaTabla fila={f} columnas={columnas} conAccion={conAccion} medida={medida} />
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <ul aria-label={etiqueta}>
          {todas.map((f) => (
            <li key={f.id} className="border-b border-line/70 last:border-b-0">
              <FilaTabla fila={f} columnas={columnas} conAccion={conAccion} medida={medida} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const FILA =
  "min-h-[60px] px-4 py-3 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate";

function FilaTabla({ fila, columnas, conAccion, medida }: { fila: Fila; columnas: Columna[]; conAccion: boolean; medida: Medida }) {
  const k = clases(medida);
  const apiladas = columnas.filter((c) => c.apilar && c.desde);
  // Lo apilado va bajo la primera columna que se ve en el celular (el título), aunque en
  // escritorio la columna apilada vaya antes (el chip de estado a la izquierda).
  const principal = columnas.findIndex((c) => !c.desde);
  const celdas = (
    <>
      {columnas.map((c, i) => (
        <span
          key={c.clave}
          className={cn("min-w-0 items-center", c.desde ? k.oculta[c.desde] : "flex", c.alinear === "der" && "justify-end text-right")}
        >
          {i === principal && apiladas.length > 0 ? (
            <span className="block w-full min-w-0">
              {fila.celdas[c.clave]}
              {apiladas.map((a) => (
                <span key={a.clave} className={cn("mt-1.5 flex flex-wrap items-center gap-1.5", k.hasta[a.desde!])}>
                  {fila.celdas[a.clave]}
                </span>
              ))}
            </span>
          ) : (
            fila.celdas[c.clave] ?? <span className="text-[13px] text-mute">Sin dato</span>
          )}
        </span>
      ))}
      {/* La columna existe si alguna fila se abre; la flecha, sólo en las que sí. */}
      {conAccion &&
        (fila.href || fila.detalle ? (
          <ChevronRight size={16} className="text-mute transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
        ) : (
          <span aria-hidden />
        ))}
    </>
  );
  const clase = cn(k.grid, FILA, "group w-full", fila.resaltada && "bg-granate-50 shadow-[inset_3px_0_0_0_theme(colors.granate.DEFAULT)]");
  if (fila.href && fila.externo) {
    return (
      <a href={fila.href} target="_blank" rel="noopener noreferrer" className={clase}>
        {celdas}
        <span className="sr-only"> (se abre en otra pestaña)</span>
      </a>
    );
  }
  if (fila.href) {
    return (
      <Link href={fila.href} className={clase}>
        {celdas}
      </Link>
    );
  }
  if (fila.detalle) {
    const d = fila.detalle;
    return (
      <Revelar titulo={d.titulo} etiqueta={d.etiqueta} descripcion={d.descripcion} detalle={d.contenido} pie={d.pie} ancho="lg" className={clase}>
        {celdas}
      </Revelar>
    );
  }
  return <div className={clase}>{celdas}</div>;
}

// ─── Celdas: las piezas de una fila (spans: una fila puede ser un <button>) ──────

/**
 * Qué es: título en 1 línea (2 en el celular) y una línea de contexto. El texto completo
 * va en `title`… salvo que el título lleve datos personales tapados (un nombre privado en
 * vidrio): ahí se pasa `titulo` como ReactNode y `textoCompleto` sin el dato, o nada.
 */
export function CeldaPrincipal({
  titulo,
  textoCompleto,
  meta,
  className,
}: {
  titulo: ReactNode;
  textoCompleto?: string;
  meta?: ReactNode;
  className?: string;
}) {
  const tooltip = textoCompleto ?? (typeof titulo === "string" ? titulo : undefined);
  return (
    <span className={cn("block w-full min-w-0", className)}>
      <span className="line-clamp-2 text-[14px] font-semibold leading-snug text-ink lg:line-clamp-1" title={tooltip}>
        {titulo}
      </span>
      {meta && <span className="mt-0.5 block truncate text-[12.5px] text-mute">{meta}</span>}
    </span>
  );
}

/** Un número comparable: a la derecha, tabular, con una línea opcional debajo. */
export function CeldaNumero({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <span className="block text-right">
      <span className="block font-mono text-[13px] tabular-nums text-ink">{children}</span>
      {sub && <span className="block text-[11.5px] tabular-nums text-mute">{sub}</span>}
    </span>
  );
}

/** Texto secundario de una columna (entidad, zona, tipo): una línea. */
export function CeldaTexto({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <span className="block w-full min-w-0">
      <span className="block truncate text-[13px] text-inkSoft">{children}</span>
      {sub && <span className="block truncate text-[11.5px] text-mute">{sub}</span>}
    </span>
  );
}

export function CeldaFecha({ fecha }: { fecha: string | null | undefined }) {
  return <span className="text-[13px] tabular-nums text-mute">{fecha ? fechaCorta(fecha) : "Sin fecha"}</span>;
}

/** Misma rejilla que la tabla real: nada salta cuando llegan los datos. */
export function TablaSkeleton({ columnas, filas = 8 }: { columnas: Columna[]; filas?: number }) {
  const estilo = rejilla(columnas, true);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper" style={estilo} aria-hidden>
      <div className={cn(GRID, "border-b border-line bg-paperSoft px-4 py-3")}>
        {columnas.map((c) => (
          <span key={c.clave} className={cn(c.desde && OCULTA_BLOQUE[c.desde])}>
            <Skeleton className="h-3 w-16" />
          </span>
        ))}
        <span />
      </div>
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className={cn(GRID, "min-h-[60px] border-b border-line/70 px-4 py-3 last:border-b-0")}>
          {columnas.map((c, j) => (
            <span key={c.clave} className={cn("min-w-0", c.desde && OCULTA_BLOQUE[c.desde])}>
              {j === 1 ? (
                <span className="block space-y-1.5">
                  <Skeleton className="h-3.5 w-4/5" />
                  <Skeleton className="h-3 w-1/2" />
                </span>
              ) : (
                <Skeleton className={cn("h-3.5", c.alinear === "der" ? "ml-auto w-16" : "w-20")} />
              )}
            </span>
          ))}
          <span />
        </div>
      ))}
    </div>
  );
}
