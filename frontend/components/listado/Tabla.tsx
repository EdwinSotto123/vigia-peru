import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Partes, hayDato } from "@/components/ui/Partes";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { fechaCorta } from "@/lib/formato";
import { BotonFila, ProveedorDetalle } from "./DetalleFilas";

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
 * Los `detalle` de una tabla comparten UN panel (`ProveedorDetalle`): en escritorio queda
 * anclado al costado sin tapar la lista, con anterior/siguiente; en el celular, la hoja.
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
   * columna de 170 px que dejaba el título en 114). `"con-rotulo"`: apilada con su
   * nombre delante ("Valor S/ 1.2 M"): para un número o una fecha, que solos no dicen qué son.
   */
  apilar?: boolean | "con-rotulo";
  /** El nombre corto para el rótulo apilado ("Antecedentes" en vez de "Antecedentes del ganador"). */
  corto?: string;
}

export interface Fila {
  /** Único en la tabla. Va al DOM (`data-fila`, para el anterior/siguiente del panel): nunca un dato personal (un DNI, un
   *  RUC 10 sin tapar). Los del API ya llegan como ref (publicar()); un índice o un código de ficha también sirven. */
  id: string;
  celdas: Record<string, ReactNode>;
  href?: string;
  /** `href` a otro sitio (SEACE, OECE): se abre en otra pestaña y la fila lo dice. */
  externo?: boolean;
  /**
   * El panel lateral de la fila. Con `ficha` (la ruta de su página propia) es una VISTA PREVIA: la lista no se pierde y
   * el pie lleva "Abrir la ficha" (si no se le da otro `pie`). Para listas de objetos con ficha pesada (entidades,
   * empresas, personas): mirar varias seguidas sin ir y volver.
   */
  detalle?: { titulo: string; etiqueta?: string; descripcion?: ReactNode; contenido: ReactNode; pie?: ReactNode; ficha?: string };
  /** Marca de "elegida" o "en curso": barra granate a la izquierda. */
  resaltada?: boolean;
  /**
   * El texto en que busca el buscador de `TablaPaginada` (las celdas son nodos, no texto): lo que se ve en la fila y
   * se puede buscar (qué es, entidad, lugar, código…). Nunca el nombre de una persona natural (docs/PRIVACIDAD.md).
   */
  buscable?: string;
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
type Densidad = "normal" | "compacta";
const clases = (m: Medida) =>
  m === "contenedor"
    ? { grid: GRID_C, oculta: OCULTA_C, bloque: OCULTA_BLOQUE_C, hasta: MOSTRAR_HASTA_C }
    : { grid: GRID, oculta: OCULTA, bloque: OCULTA_BLOQUE, hasta: MOSTRAR_HASTA };

export interface GrupoFilas {
  clave: string;
  /** Rótulo del grupo con su conteo en pastilla: "En espera" + `<CuentaGrupo>47</CuentaGrupo>`. */
  titulo: ReactNode;
  filas: Fila[];
}

export function Tabla({
  columnas,
  filas,
  grupos,
  etiqueta,
  medida = "pantalla",
  densidad = "normal",
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
  /**
   * `compacta`: filas de ~40 px con el título y su contexto en UNA línea (listas largas de pocas
   * columnas: zonas, entidades, partidos). Por defecto, las filas de 60 px de siempre.
   */
  densidad?: Densidad;
  className?: string;
}) {
  const k = clases(medida);
  const todas = grupos ? grupos.flatMap((g) => g.filas) : filas ?? [];
  const conAccion = todas.some((f) => f.href || f.detalle);
  const estilo = rejilla(columnas, conAccion);
  const detalles = todas.flatMap((f) => (f.detalle ? [{ id: f.id, ...f.detalle }] : []));
  const tabla = (
    // `overflow-clip` y no `overflow-hidden`: recorta las esquinas igual pero no crea un
    // contenedor de scroll, así los rótulos de grupo (`sticky`) se quedan fijos al bajar.
    <div
      className={cn(
        "overflow-clip rounded-2xl border border-line bg-paper",
        // Dentro de una tarjeta, sólo el filete de arriba: la tabla es parte de la tarjeta, no otra caja adentro.
        "[.tarjeta_&]:rounded-none [.tarjeta_&]:border-x-0 [.tarjeta_&]:border-b-0 [.tarjeta_&]:bg-transparent",
        medida === "contenedor" && "[container-type:inline-size]",
        className,
      )}
      style={estilo}
    >
      <div className={cn(k.grid, "border-b border-line bg-paperSoft px-4 text-rotulo font-medium text-mute", densidad === "compacta" ? "py-1.5" : "py-2.5")}>
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
            {/* No `top-0`: el layout baja todo `.sticky.top-0` en el celular. Bajo una barra de pestañas fija, debajo de
                ella (`--alto-barra-fija` lo pone `Pestanas fija`): si no, el rótulo del grupo quedaba tapado. */}
            <h3 className="sticky top-[var(--alto-barra-fija,0px)] z-[1] border-b border-line/70 bg-paperSoft/95 px-4 py-2 text-cuerpo font-semibold text-inkSoft backdrop-blur">
              {g.titulo}
            </h3>
            <ul>
              {g.filas.map((f) => (
                <li key={f.id} className="border-b border-line/70 last:border-b-0">
                  <FilaTabla fila={f} columnas={columnas} conAccion={conAccion} medida={medida} densidad={densidad} />
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <ul aria-label={etiqueta}>
          {todas.map((f) => (
            <li key={f.id} className="border-b border-line/70 last:border-b-0">
              <FilaTabla fila={f} columnas={columnas} conAccion={conAccion} medida={medida} densidad={densidad} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return detalles.length > 0 ? (
    <ProveedorDetalle detalles={detalles} nombre={etiqueta}>
      {tabla}
    </ProveedorDetalle>
  ) : (
    tabla
  );
}

const FILA =
  "min-h-[60px] px-4 py-3 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate";

const FILA_COMPACTA =
  "min-h-[42px] px-4 py-1.5 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate";

function FilaTabla({
  fila,
  columnas,
  conAccion,
  medida,
  densidad,
}: {
  fila: Fila;
  columnas: Columna[];
  conAccion: boolean;
  medida: Medida;
  densidad: Densidad;
}) {
  const k = clases(medida);
  const apiladas = columnas.filter((c) => c.apilar && c.desde);
  // Lo apilado va en UNA línea (chip, cifra y fecha juntos), no un renglón por dato. La línea se ve mientras se vea
  // alguno: hasta el ancho de la columna que aparece más tarde.
  const ultima = apiladas.reduce<Desde | undefined>((m, c) => (ORDEN.indexOf(c.desde) > ORDEN.indexOf(m) ? c.desde : m), undefined);
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
              <span className={cn("mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1", ultima && k.hasta[ultima])}>
                {apiladas.map((a) => (
                  <span key={a.clave} className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5", k.hasta[a.desde!])}>
                    {a.apilar === "con-rotulo" && <span className="shrink-0 text-rotulo text-mute">{a.corto ?? a.titulo}</span>}
                    {fila.celdas[a.clave] ?? <span className="text-meta text-mute">Sin dato</span>}
                  </span>
                ))}
              </span>
            </span>
          ) : (
            fila.celdas[c.clave] ?? <span className="text-meta text-mute">Sin dato</span>
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
  const clase = cn(k.grid, densidad === "compacta" ? FILA_COMPACTA : FILA, "group w-full", fila.resaltada && "bg-granate-50 shadow-[inset_3px_0_0_0_theme(colors.granate.DEFAULT)]");
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
      <BotonFila id={fila.id} etiqueta={d.etiqueta} className={clase}>
        {celdas}
      </BotonFila>
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
  dosLineas = false,
  enLinea = false,
}: {
  titulo: ReactNode;
  textoCompleto?: string;
  /** La línea de contexto. Un arreglo son datos distintos (entidad, zona…): van separados por aire (`Partes`). */
  meta?: ReactNode;
  className?: string;
  /** Una línea más (3 en móvil, 2 en escritorio): cuando el título ES el dato (qué se compra) y la columna es angosta. */
  dosLineas?: boolean;
  /**
   * Título y contexto en UNA línea desde `sm` (el título manda y el contexto se recorta): la fila de una
   * tabla `compacta`. En el celular se apilan como siempre, para no partir el nombre.
   */
  enLinea?: boolean;
}) {
  const tooltip = textoCompleto ?? (typeof titulo === "string" ? titulo : undefined);
  const lineaMeta = Array.isArray(meta) ? (meta.some(hayDato) ? <Partes partes={meta} /> : null) : meta;
  if (enLinea) {
    return (
      <span className={cn("block w-full min-w-0 sm:flex sm:items-baseline sm:gap-x-3", className)}>
        <span className="line-clamp-2 text-dato font-semibold leading-snug text-ink sm:line-clamp-1 sm:shrink-0 sm:max-w-[70%]" title={tooltip}>
          {titulo}
        </span>
        {lineaMeta && <span className="mt-0.5 block truncate text-meta text-mute sm:mt-0 sm:min-w-0">{lineaMeta}</span>}
      </span>
    );
  }
  return (
    <span className={cn("block w-full min-w-0", className)}>
      <span className={cn("text-dato font-semibold leading-snug text-ink", dosLineas ? "line-clamp-3 lg:line-clamp-2" : "line-clamp-2 lg:line-clamp-1")} title={tooltip}>
        {titulo}
      </span>
      {lineaMeta && <span className="mt-0.5 block truncate text-meta text-mute">{lineaMeta}</span>}
    </span>
  );
}

/**
 * Una barra proporcional pequeña dentro de una fila: cuánto pesa este valor frente al mayor de la lista.
 * Es dato (no adorno): llena el hueco entre el nombre y las cifras y deja comparar de un vistazo.
 * `parte` (0 a 1) es el largo de la barra; `resumen` es lo que dice a quien no la ve ("812 de 812 en cola").
 */
export function CeldaBarra({ parte, resumen, className }: { parte: number; resumen: string; className?: string }) {
  const p = Math.min(1, Math.max(0, Number.isFinite(parte) ? parte : 0));
  return (
    <span role="img" aria-label={resumen} className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-paperDeep", className)}>
      <span className="block h-full rounded-full bg-granate/70" style={{ width: `${p > 0 ? Math.max(3, p * 100) : 0}%` }} />
    </span>
  );
}

/** El conteo de un rótulo de grupo, en su propia pastilla: "En espera [47]". */
export function CuentaGrupo({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("rounded-full bg-paperDeep px-1.5 text-rotulo font-semibold tabular-nums text-ink", className)}>{children}</span>
  );
}

/** Un número comparable: a la derecha, tabular, con una línea opcional debajo. */
export function CeldaNumero({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <span className="block text-right">
      <span className="block font-mono text-meta tabular-nums text-ink">{children}</span>
      {sub && <span className="block text-rotulo tabular-nums text-mute">{sub}</span>}
    </span>
  );
}

/** Texto secundario de una columna (entidad, zona, tipo): una línea. */
export function CeldaTexto({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <span className="block w-full min-w-0">
      <span className="block truncate text-meta text-inkSoft">{children}</span>
      {sub && <span className="block truncate text-rotulo text-mute">{sub}</span>}
    </span>
  );
}

export function CeldaFecha({ fecha }: { fecha: string | null | undefined }) {
  return <span className="text-meta tabular-nums text-mute">{fecha ? fechaCorta(fecha) : "Sin fecha"}</span>;
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
