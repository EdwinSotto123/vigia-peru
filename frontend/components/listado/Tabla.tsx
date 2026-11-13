import { Fragment, isValidElement, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, CornerDownRight, Equal } from "lucide-react";
import { Partes, hayDato } from "@/components/ui/Partes";
import { Dato } from "@/components/ui/Dato";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { fechaConAnio } from "@/lib/formato";
import { BotonFila, ProveedorDetalle } from "./DetalleFilas";
import { FilaConEnlaces } from "./FilaConEnlaces";

/**
 * La tabla de todo listado (§14.1). Las columnas se declaran una vez y la cabecera
 * y cada fila comparten la misma rejilla (variables CSS por breakpoint): antes cada
 * listado tenía su propia tabla, con su propia altura de fila, su propio estilo de
 * cabecera y su propio chip de estado.
 *
 * Anatomía de una fila, siempre igual:
 *   estado (chip) | qué es (título 1 línea + meta) | datos (números a la derecha) | fecha | ›
 *
 * Una fila es UNA acción: `href` (va a su página) o `detalle` (abre el panel lateral). Por defecto la fila entera ES
 * ese enlace o botón, y sus celdas no llevan enlaces propios (serían un control dentro de otro). Con `enlaces` (pedido
 * del usuario del 2026-11-05: el código del proceso, verde, a su ficha) la acción pasa a una capa que cubre la fila, las
 * celdas van encima con su `title` a la vista y el clic en ellas se le pasa a la capa, salvo en sus `<a>`: ver
 * `FilaTabla` y `FilaConEnlaces`. Semántica de lista (`ul`).
 *
 * `colapsarIguales`: una columna que en la página dice lo mismo en todas las filas («Sin leer» en los 50 contratos) se
 * quita y lo dice UNA vez sobre la tabla; su ancho pasa a las columnas flexibles (el título). Ver `columnasQueDicenAlgo`.
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
   * Una celda sin dato («Sin dato», «Sin fecha», banderas vacías) no se apila: lo sigue diciendo en su columna. Una que
   * sólo vale en su columna (otra apilada ya lo dice) lleva `data-solo-columna` en su elemento de afuera.
   */
  apilar?: boolean | "con-rotulo";
  /** El nombre corto para el rótulo apilado ("Antecedentes" en vez de "Antecedentes del ganador"). */
  corto?: string;
  /**
   * Hasta qué ancho se muestra (sin incluirlo): una columna sólo del celular, que dice junto lo que desde ese ancho va
   * en varias columnas (el total que recibió una empresa, en vez de contratos y órdenes por separado). No se apila.
   */
  hasta?: Desde;
  /**
   * Con `colapsarIguales` en la tabla: qué se dice UNA vez sobre la tabla cuando esta columna se quita por decir lo mismo
   * en todas las filas de la página. `frases`: la frase para un texto común dado («Sin leer» → «Todos sin leer»);
   * `texto`: la de cualquier otro, con «{}» donde va ese texto («Estado de todos: {}»); `vacia`: la de todas sin dato.
   * Sin ellas, el nombre de la columna y lo común. `false`: esta columna nunca se quita. Sólo texto (cruza al cliente).
   */
  igual?: false | { frases?: Record<string, string>; texto?: string; vacia?: string };
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
  /**
   * Lo que dice cada celda en texto, por la clave de su columna, para que `colapsarIguales` sepa si una columna dice lo
   * mismo en toda la página sin comparar nodos de React (frágil). `null`: sin dato. Sin su texto, una celda vacía o de
   * texto suelto se reconoce sola; cualquier otra deja su columna siempre a la vista (ante la duda, no se quita nada).
   * Una celda con algo más que su texto (la bandera de «posible error de carga») va sin texto: así su columna se queda.
   */
  textos?: Record<string, string | null | undefined>;
  /**
   * La magnitud de sus celdas numéricas, por la clave de su columna (soles, cantidad): la tabla dibuja bajo el número
   * una barra medida contra el mayor de la página, para comparar las filas de un vistazo. Sólo magnitudes que se
   * pueden comparar entre filas (no un porcentaje ni un dato dudoso). Hace falta en dos filas o más.
   */
  magnitudes?: Record<string, number | null | undefined>;
  /**
   * Sus celdas llevan enlaces propios (el código del proceso a su ficha): la acción de la fila va en una capa debajo de
   * las celdas y cada `<a>` de una celda se puede tocar solo; el resto de la celda abre la fila. Ver `FilaConEnlaces`.
   */
  enlaces?: boolean;
  /** Qué anuncia la acción de una fila con `enlaces` al lector de pantalla (ya no se nombra por su contenido). */
  etiqueta?: string;
}

const ORDEN: (Desde | undefined)[] = [undefined, "md", "lg", "xl"];
const visibleEn = (c: Columna, bp: Desde | undefined) =>
  ORDEN.indexOf(c.desde) <= ORDEN.indexOf(bp) && (!c.hasta || ORDEN.indexOf(bp) < ORDEN.indexOf(c.hasta));
/** La columna del título: la primera que se ve en todo ancho. Nunca se quita ni se apila. */
const indicePrincipal = (columnas: Columna[]) => columnas.findIndex((c) => !c.desde && !c.hasta);

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

/** En qué anchos se ve una celda (o su cabecera): desde `desde` y, si la columna es sólo del celular, hasta `hasta`. */
const claseVisible = (c: Columna, k: ReturnType<typeof clases>) => cn(c.desde ? k.oculta[c.desde] : "flex", c.hasta && k.hasta[c.hasta]);

// ─── Columnas que dicen lo mismo en toda la página ───────────────────────────────

/**
 * Con menos filas, que digan lo mismo no dice nada (dos filas «Emitida» pueden ser casualidad) y quitar la columna
 * dejaría una tabla de una fila sin sus datos.
 */
const MIN_FILAS_IGUALES = 3;

/** La nota de una columna quitada: «Todos sin leer» (pedido del usuario del 2026-11-05). */
interface NotaIgual {
  clave: string;
  texto: string;
}

/**
 * El texto de una celda para compararla con las demás de su columna: el que declara la fila (`textos`), o el que se
 * reconoce solo (vacía → null, texto suelto → ese texto). `undefined`: no se sabe, y la columna se queda.
 */
function textoDeCelda(f: Fila, clave: string): string | null | undefined {
  const declarado = f.textos?.[clave];
  if (declarado !== undefined) return declarado === null ? null : declarado.trim() || null;
  const n = f.celdas[clave];
  if (celdaVacia(n)) return null;
  if (typeof n === "string" || typeof n === "number") return String(n).trim();
  return undefined;
}

/** «Sin leer» → «sin leer» dentro de una frase; una sigla («OECE») o una cifra quedan como están. */
const enMinuscula = (t: string) => (/^\p{Lu}\p{Ll}/u.test(t) ? t.charAt(0).toLocaleLowerCase("es") + t.slice(1) : t);
const conMayuscula = (t: string) => t.charAt(0).toLocaleUpperCase("es") + t.slice(1);

function fraseIgual(c: Columna, comun: string | null): string {
  const cfg: Exclude<Columna["igual"], false | undefined> = c.igual || {};
  if (comun == null) return cfg.vacia ?? `${c.titulo}: sin dato en todas las filas`;
  const frase = cfg.frases?.[comun];
  if (frase) return frase;
  return conMayuscula(cfg.texto ? cfg.texto.replace("{}", enMinuscula(comun)) : `${c.titulo}: ${enMinuscula(comun)}, en todas las filas`);
}

/**
 * Las columnas que en ESTA página dicen algo distinto de una fila a otra, y la nota de las que no: en /app/contratos
 * «Sin leer», «Sin ganador aún» y «Sin dato» se repetían en 50 filas y se comían el 40 % del ancho, con el objeto
 * recortado en dos palabras y filas de 85 px (auditoría del 2026-11-05). La del título nunca se quita; una columna se
 * quita sólo si se sabe el texto de todas sus celdas (`textoDeCelda`) y es el mismo. El orden de las demás no cambia.
 */
function columnasQueDicenAlgo(columnas: Columna[], filas: Fila[]): { columnas: Columna[]; notas: NotaIgual[] } {
  if (filas.length < MIN_FILAS_IGUALES) return { columnas, notas: [] };
  const principal = indicePrincipal(columnas);
  const notas: NotaIgual[] = [];
  const quedan = columnas.filter((c, i) => {
    if (i === principal || c.igual === false) return true;
    const textos = filas.map((f) => textoDeCelda(f, c.clave));
    if (textos.some((t) => t === undefined) || !textos.every((t) => t === textos[0])) return true;
    notas.push({ clave: c.clave, texto: fraseIgual(c, textos[0] ?? null) });
    return false;
  });
  return { columnas: quedan, notas };
}

export interface GrupoFilas {
  clave: string;
  /** Rótulo del grupo con su conteo en pastilla: "En espera" + `<CuentaGrupo>47</CuentaGrupo>`. */
  titulo: ReactNode;
  filas: Fila[];
  /** Con `jerarquia`: qué son las filas de adentro, sobre ellas («3 señales de este contrato»). */
  rotuloFilas?: ReactNode;
}

export function Tabla({
  columnas: todasLasColumnas,
  filas,
  grupos,
  etiqueta,
  medida = "pantalla",
  densidad = "normal",
  colapsarIguales = true,
  jerarquia = false,
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
  /**
   * Quita la columna que en estas filas dice lo mismo en todas (o nada en ninguna) y lo dice una vez sobre la tabla
   * («Todos sin leer»); su ancho pasa al título. Cabecera y celdas se van juntas. Ver `Columna.igual` y `Fila.textos`.
   */
  colapsarIguales?: boolean;
  /**
   * Con `grupos`: el rótulo del grupo es la cosa (un contrato) y sus filas son de ELLA (sus señales). Cada grupo va
   * separado del siguiente, con su rótulo en tinta sobre fondo claro, y las filas dentro, en una caja con sangría y una
   * raya a la izquierda. Sin esto, rótulo y filas se leían al mismo nivel (pedido del usuario del 2026-11-12).
   */
  jerarquia?: boolean;
  className?: string;
}) {
  const k = clases(medida);
  const todas = grupos ? grupos.flatMap((g) => g.filas) : filas ?? [];
  const maximos = maximosDe(todas);
  const { columnas, notas } = colapsarIguales ? columnasQueDicenAlgo(todasLasColumnas, todas) : { columnas: todasLasColumnas, notas: [] as NotaIgual[] };
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
      {/* Lo que las columnas quitadas decían en todas las filas, una vez y sobre la cabecera: es de esta página (la
          siguiente puede traer filas distintas y ahí la columna vuelve). */}
      {notas.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2 text-meta text-inkSoft">
          <span className="text-rotulo font-medium text-mute">En esta página</span>
          {/* El ícono «=» sin nombre: el rótulo de delante ya dice que vale para toda la página. */}
          {notas.map((n) => (
            <Dato key={n.clave} icono={Equal}>
              {n.texto}
            </Dato>
          ))}
        </p>
      )}
      <div className={cn(k.grid, "border-b border-line bg-paperSoft px-4 text-rotulo font-medium text-mute", densidad === "compacta" ? "py-1.5" : "py-2.5", jerarquia && "sr-only")}>
        {columnas.map((c) => (
          <span key={c.clave} className={cn("min-w-0 items-center gap-1", claseVisible(c, k), c.alinear === "der" && "justify-end")}>
            <span className="truncate">{c.titulo}</span>
            {c.ayuda}
          </span>
        ))}
        {conAccion && <span aria-hidden />}
      </div>
      {grupos ? (
        grupos.map((g) => (
          <section
            key={g.clave}
            aria-label={typeof g.titulo === "string" ? g.titulo : undefined}
            className={cn("last:border-b-0", jerarquia ? "border-b-8 border-paperSoft pb-3" : "border-b border-line")}
          >
            {/* No `top-0`: el layout baja todo `.sticky.top-0` en el celular. Bajo una barra de pestañas fija, debajo de
                ella (`--alto-barra-fija` lo pone `Pestanas fija`): si no, el rótulo del grupo quedaba tapado. Fuera de ellas,
                en el celular, debajo de la barra del sitio (3 rem); desde md la barra es la lateral y no tapa nada. */}
            <h3
              className={cn(
                "sticky top-[var(--alto-barra-fija,3rem)] z-[1] md:top-[var(--alto-barra-fija,0px)] px-4 backdrop-blur",
                jerarquia ? "bg-paper/95 pb-2 pt-3 text-destacado font-semibold text-ink" : "border-b border-line/70 bg-paperSoft/95 py-2 text-cuerpo font-semibold text-inkSoft",
              )}
            >
              {g.titulo}
            </h3>
            {jerarquia && g.rotuloFilas && (
              <p className="ml-4 flex items-center gap-1.5 pb-1.5 pl-3 text-rotulo font-semibold text-mute sm:ml-7">
                <CornerDownRight size={13} className="shrink-0" aria-hidden />
                {g.rotuloFilas}
              </p>
            )}
            <ul className={jerarquia ? "ml-4 mr-3 overflow-hidden rounded-xl border border-line border-l-[3px] border-l-granate/50 bg-paperSoft/50 sm:ml-7 sm:mr-4" : undefined}>
              {g.filas.map((f) => (
                <li key={f.id} className="border-b border-line/70 last:border-b-0">
                  <FilaTabla fila={f} columnas={columnas} conAccion={conAccion} medida={medida} densidad={densidad} maximos={maximos} />
                </li>
              ))}
            </ul>
          </section>
        ))
      ) : (
        <ul aria-label={etiqueta}>
          {todas.map((f) => (
            <li key={f.id} className="border-b border-line/70 last:border-b-0">
              <FilaTabla fila={f} columnas={columnas} conAccion={conAccion} medida={medida} densidad={densidad} maximos={maximos} />
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
  "min-h-[48px] px-4 py-2 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate";

const FILA_COMPACTA =
  "min-h-[42px] px-4 py-1.5 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate";

/**
 * Lo que dice una celda cuando no hay dato: el «Sin dato» de la tabla y de las listas, el de `CeldaFecha` y los de las
 * banderas vacías (`CrucesCelda`). Textos exactos: «Sin dato de monto» o «Ninguno» (un cero) sí dicen algo.
 */
const SIN_DATO = new Set(["Sin dato", "Sin fecha", "Sin ganador aún", "Sin antecedentes"]);

/**
 * ¿La celda no tiene nada que apilar? En el celular, «Valor Sin dato» y «Antecedentes Sin ganador aún» en cada fila de
 * contratos eran ruido (2026-10-29). Ante la duda tiene dato: un componente que no se conoce nunca cuenta como vacío.
 */
function celdaVacia(n: ReactNode): boolean {
  return n == null || n === false || n === true || n === "" || soloSinDato(n);
}

function soloSinDato(n: ReactNode): boolean {
  if (typeof n === "string") return SIN_DATO.has(n.trim());
  if (Array.isArray(n)) {
    // Los `cond && …` falsos no cuentan; lo demás, todo «sin dato» (y al menos uno).
    const xs = n.filter((x) => x != null && x !== false && x !== true && x !== "");
    return xs.length > 0 && xs.every(soloSinDato);
  }
  if (!isValidElement<Record<string, unknown>>(n)) return false;
  // Sólo se leen las props (un objeto común), nunca propiedades del tipo: en el servidor puede ser la referencia a un
  // componente cliente, que tira error al tocarla.
  const p = n.props;
  if (typeof n.type === "string" && p["data-solo-columna"] != null && p["data-solo-columna"] !== false) return true;
  if (n.type === CeldaFecha) return !p.fecha;
  // Las banderas sin ninguna (`CrucesCelda`): se reconocen por su lista `cruces`, sin importar el componente (traería a
  // toda tabla los íconos de todas las banderas).
  if (typeof n.type !== "string" && "cruces" in p) {
    const cruces = p.cruces;
    return cruces == null || (Array.isArray(cruces) && cruces.length === 0);
  }
  // Un envoltorio sin más (un span, un fragmento, `CeldaNumero` o `CeldaTexto` sin `sub`) con sólo «Sin dato» adentro. Una
  // celda que se arma en el servidor y cruza a un componente cliente llega así, ya convertida en spans.
  const envoltorio = typeof n.type === "string" || n.type === Fragment || n.type === CeldaNumero || n.type === CeldaTexto;
  return envoltorio && celdaVacia(p.sub as ReactNode) && p.children != null && soloSinDato(p.children as ReactNode);
}

/** El mayor de cada columna con `magnitudes` en la página (si lo declaran dos filas o más): contra él se mide la barra. */
function maximosDe(filas: Fila[]): Record<string, number> {
  const cuenta: Record<string, number> = {};
  const mayor: Record<string, number> = {};
  for (const f of filas)
    for (const [k, v] of Object.entries(f.magnitudes ?? {}))
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        cuenta[k] = (cuenta[k] ?? 0) + 1;
        mayor[k] = Math.max(mayor[k] ?? 0, v);
      }
  return Object.fromEntries(Object.entries(mayor).filter(([k]) => cuenta[k] >= 2));
}

function FilaTabla({
  fila,
  columnas,
  conAccion,
  medida,
  densidad,
  maximos,
}: {
  fila: Fila;
  columnas: Columna[];
  conAccion: boolean;
  medida: Medida;
  densidad: Densidad;
  maximos?: Record<string, number>;
}) {
  const k = clases(medida);
  // Sólo las que dicen algo en ESTA fila: una celda sin dato no se apila (en su columna, desde su ancho, sigue diciendo
  // «Sin dato»); y si ninguna dice nada, no hay línea.
  const apiladas = columnas.filter((c) => c.apilar && c.desde && !celdaVacia(fila.celdas[c.clave]));
  // Lo apilado va en UNA línea (chip, cifra y fecha juntos), no un renglón por dato. La línea se ve mientras se vea
  // alguno: hasta el ancho de la columna que aparece más tarde.
  const ultima = apiladas.reduce<Desde | undefined>((m, c) => (ORDEN.indexOf(c.desde) > ORDEN.indexOf(m) ? c.desde : m), undefined);
  // Lo apilado va bajo la primera columna que se ve en el celular (el título), aunque en
  // escritorio la columna apilada vaya antes (el chip de estado a la izquierda).
  const principal = indicePrincipal(columnas);
  // De lo apilado, los números y las fechas (hasta dos) van en la tira de celdas; lo demás (chips, banderas), en línea.
  const esPar = (c: Columna) => {
    const n = fila.celdas[c.clave];
    return c.apilar === "con-rotulo" && isValidElement(n) && (n.type === CeldaNumero || n.type === CeldaFecha);
  };
  const candidatas = apiladas.filter(esPar);
  const pares = candidatas.length <= 2 ? candidatas : [];
  const sueltas = apiladas.filter((c) => !pares.includes(c));
  const ultimaDe = (cs: Columna[]) => cs.reduce<Desde | undefined>((m, c) => (ORDEN.indexOf(c.desde) > ORDEN.indexOf(m) ? c.desde : m), undefined);
  // Con enlaces adentro, la acción de la fila es una capa por debajo (ver abajo): las celdas van encima (`z-[1]`) y SÍ
  // toman el puntero, para que su `title` se vea al pasar (con `pointer-events-none` se perdían el detalle del chip de
  // estado y la lista de antecedentes; auditoría del 2026-11-05). Su clic se lo pasa a la capa `FilaConEnlaces`.
  const capa = !!fila.enlaces && !!(fila.href || fila.detalle);
  const encima = capa && "relative z-[1]";
  const celdas = (
    <>
      {columnas.map((c, i) => (
        <span
          key={c.clave}
          className={cn("min-w-0 items-center", claseVisible(c, k), c.alinear === "der" && "justify-end text-right", encima)}
        >
          {i === principal && apiladas.length > 0 ? (
            <span className="block w-full min-w-0">
              {fila.celdas[c.clave]}
              {sueltas.length > 0 && (
                <span className={cn("mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1", ultimaDe(sueltas) && k.hasta[ultimaDe(sueltas)!])}>
                  {sueltas.map((a) => (
                    <span key={a.clave} className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5", k.hasta[a.desde!])}>
                      {a.apilar === "con-rotulo" && <span className="shrink-0 text-rotulo text-mute">{a.corto ?? a.titulo}</span>}
                      {fila.celdas[a.clave]}
                    </span>
                  ))}
                </span>
              )}
              {/* Los números y las fechas, en una tira con una celda por dato (rótulo a la izquierda, dato a la derecha):
                  antes iban como texto corrido tras los chips y no se distinguía el monto de la fecha. */}
              {pares.length > 0 && (
                <span className={cn("mt-2 grid grid-flow-col auto-cols-fr divide-x divide-line overflow-hidden rounded-lg border border-line bg-paperSoft/60", ultimaDe(pares) && k.hasta[ultimaDe(pares)!])}>
                  {pares.map((a) => (
                    <span key={a.clave} className={cn("flex min-w-0 flex-col px-2.5 py-1 [&_*]:text-left", k.hasta[a.desde!])}>
                      <span className="text-micro font-medium uppercase tracking-wide text-mute">{a.corto ?? a.titulo}</span>
                      <span className="min-w-0 whitespace-nowrap font-semibold">{fila.celdas[a.clave]}</span>
                    </span>
                  ))}
                </span>
              )}
            </span>
          ) : maximos?.[c.clave] && (fila.magnitudes?.[c.clave] ?? 0) > 0 ? (
            <span className="block w-full min-w-0">
              {fila.celdas[c.clave]}
              <CeldaBarra tono="neutro" parte={fila.magnitudes![c.clave]! / maximos[c.clave]} resumen={`${Math.round((100 * fila.magnitudes![c.clave]!) / maximos[c.clave])} % del mayor de esta página`} className="ml-auto mt-1 max-w-[7rem]" />
            </span>
          ) : (
            fila.celdas[c.clave] ?? <span className="text-meta text-mute">Sin dato</span>
          )}
        </span>
      ))}
      {/* La columna existe si alguna fila se abre; la flecha, sólo en las que sí. */}
      {conAccion &&
        (fila.href || fila.detalle ? (
          // La flecha no tiene `title` que mostrar: sin puntero, su clic cae directo en la capa (como el aire entre celdas).
          <ChevronRight size={16} className={cn("text-mute transition-transform duration-rapido group-hover:translate-x-0.5", encima, encima && "pointer-events-none")} aria-hidden />
        ) : (
          <span aria-hidden />
        ))}
    </>
  );
  const clase = cn(k.grid, densidad === "compacta" ? FILA_COMPACTA : FILA, "group w-full", fila.resaltada && "bg-granate-50 shadow-[inset_3px_0_0_0_theme(colors.granate.DEFAULT)]");
  if (capa) {
    // La fila es un `div` y su acción (enlace o botón) una capa vacía que la cubre entera, DEBAJO de las celdas: así su
    // fondo de elegida (el del panel abierto) se ve a través de ellas. No el «enlace estirado» por encima: taparía las
    // celdas con el fondo de elegida y se comería el `title` de todo lo que llevan. El clic en una celda le llega por
    // `FilaConEnlaces`; el del aire entre celdas, directo. La capa va primera: el tabulador pasa por la fila y después
    // por sus enlaces. Su nombre lo dice `etiqueta` (las celdas se leen aparte, como texto de la fila).
    const nombre = fila.etiqueta ?? fila.detalle?.etiqueta ?? (fila.detalle ? `Ver el detalle de ${fila.detalle.titulo}` : "Abrir");
    const accion = "absolute inset-0 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate";
    const capaAccion = fila.href ? (
      fila.externo ? (
        <a href={fila.href} target="_blank" rel="noopener noreferrer" className={accion}>
          <span className="sr-only">{nombre} (se abre en otra pestaña)</span>
        </a>
      ) : (
        <Link href={fila.href} className={accion}>
          <span className="sr-only">{nombre}</span>
        </Link>
      )
    ) : (
      <BotonFila id={fila.id} className={accion}>
        <span className="sr-only">{nombre}</span>
      </BotonFila>
    );
    return (
      // `isolate`: el `z-[1]` de las celdas queda dentro de la fila; si no, pasaba por encima del rótulo fijo de un grupo.
      // `cursor-pointer`: toda la fila se toca, también encima del texto de una celda.
      <FilaConEnlaces accion={capaAccion} className={cn(clase, "relative isolate cursor-pointer")}>
        {celdas}
      </FilaConEnlaces>
    );
  }
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
  metaEnVarias = false,
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
  /**
   * La línea de contexto en varias líneas si no cabe, en vez de recortarla: cuando cada dato importa (lo que un socio es
   * en el Estado: locador de cuántas entidades, autoridad, aportes), que en el celular se cortaba a la mitad.
   */
  metaEnVarias?: boolean;
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
      <span className={cn("text-dato font-semibold leading-snug text-ink", dosLineas ? "line-clamp-2" : "line-clamp-2 lg:line-clamp-1")} title={tooltip}>
        {titulo}
      </span>
      {lineaMeta && <span className={cn("mt-0.5 block text-meta text-mute", metaEnVarias ? "whitespace-normal" : "truncate")}>{lineaMeta}</span>}
    </span>
  );
}

/** Un enlace en medio del texto de una celda (fila con `enlaces`): verde y subrayado suave, como todo identificador. */
export const CLASE_ENLACE_CELDA = "text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";

/**
 * El identificador de una fila (el código del proceso, el N.° de la orden) al COMIENZO de su línea de contexto, en mono:
 * al final se recortaba («N.° 4504…») o ni se mostraba (pedido del usuario del 2026-11-05). Con `href` (su ficha en
 * Vigía) va verde y enlazado, y la fila necesita `enlaces`; sin página propia, texto. Nunca un RUC 10 (lleva el DNI).
 */
export function CodigoFila({ codigo, nombre, href }: { codigo: string; nombre: string; href?: string | null }) {
  return (
    <Dato tipo="codigo" nombre={nombre} mono className="whitespace-nowrap">
      {href ? (
        <Link href={href} prefetch={false} className={CLASE_ENLACE_CELDA}>
          {codigo}
        </Link>
      ) : (
        codigo
      )}
    </Dato>
  );
}

/**
 * Una barra proporcional pequeña dentro de una fila: cuánto pesa este valor frente al mayor de la lista.
 * Es dato (no adorno): llena el hueco entre el nombre y las cifras y deja comparar de un vistazo.
 * `parte` (0 a 1) es el largo de la barra; `resumen` es lo que dice a quien no la ve ("812 de 812 en cola").
 */
/** `tono="neutro"`: para una parte que no es buena ni mala por ser grande (entidades con indicio): en verde de marca,
 *  un 100 % se leía como «todo bien» cuando es el caso que más hay que mirar. */
export function CeldaBarra({ parte, resumen, className, tono = "marca" }: { parte: number; resumen: string; className?: string; tono?: "marca" | "neutro" }) {
  const p = Math.min(1, Math.max(0, Number.isFinite(parte) ? parte : 0));
  return (
    <span role="img" aria-label={resumen} className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-paperDeep", className)}>
      <span className={cn("block h-full rounded-full", tono === "neutro" ? "bg-inkSoft/70" : "bg-granate/70")} style={{ width: `${p > 0 ? Math.max(3, p * 100) : 0}%` }} />
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

/**
 * La fecha de una fila, siempre con el año: una tabla mezcla años, y «4 ago.» al lado de «4 ago. 2025» hacía creer que
 * la primera era de otro año o que le faltaba el dato.
 */
export function CeldaFecha({ fecha }: { fecha: string | null | undefined }) {
  return <span className="text-meta tabular-nums text-mute">{fecha ? fechaConAnio(fecha) : "Sin fecha"}</span>;
}

/** Misma rejilla que la tabla real: nada salta cuando llegan los datos. */
export function TablaSkeleton({ columnas, filas = 8 }: { columnas: Columna[]; filas?: number }) {
  const estilo = rejilla(columnas, true);
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper" style={estilo} aria-hidden>
      <div className={cn(GRID, "border-b border-line bg-paperSoft px-4 py-3")}>
        {columnas.map((c) => (
          <span key={c.clave} className={cn(c.desde && OCULTA_BLOQUE[c.desde], c.hasta && MOSTRAR_HASTA[c.hasta])}>
            <Skeleton className="h-3 w-16" />
          </span>
        ))}
        <span />
      </div>
      {Array.from({ length: filas }).map((_, i) => (
        <div key={i} className={cn(GRID, "min-h-[60px] border-b border-line/70 px-4 py-3 last:border-b-0")}>
          {columnas.map((c, j) => (
            <span key={c.clave} className={cn("min-w-0", c.desde && OCULTA_BLOQUE[c.desde], c.hasta && MOSTRAR_HASTA[c.hasta])}>
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
