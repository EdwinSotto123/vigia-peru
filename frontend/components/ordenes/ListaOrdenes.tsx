import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { Banknote, Gauge, Gavel, ListFilter, ReceiptText, Scale, Store, TriangleAlert } from "lucide-react";
import {
  Ayuda,
  AyudaTermino,
  BloqueDetalle,
  CapitulosRelato,
  Cronologia,
  CuerpoDetalle,
  DatosClave,
  EnUnaFrase,
  EnlaceFuente,
  EstadoError,
  EstadoVacio,
  FuenteDato,
  Nota,
  type DatoClave,
  type PasoRelato,
  type SenalPaso,
} from "@/components/patrones";
import {
  BarraFiltros,
  CeldaFecha,
  CeldaNumero,
  CeldaPrincipal,
  Tabla,
  TablaSkeleton,
  type Columna,
  type FiltroSecundario,
  type Fila,
  type Parametros,
} from "@/components/listado";
import { CodigoFila } from "@/components/listado/Tabla";
import { enSeccion } from "@/components/contratos/filtros";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { BarraTope } from "@/components/charts/BarraTope";
import { IconoBandera } from "@/components/ui/IconoBandera";
import { ICONO_NIVEL } from "@/components/ui/Severidad";
import { Llamita } from "@/components/marca/Llamita";
import { AvisoDato, BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA, EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { PaginacionCursor } from "@/components/ui/PaginacionCursor";
import { TIPO_CRUCE } from "@/lib/cruces";
import { motivoDudoso } from "@/lib/datoDudoso";
import { P_COMPRAS } from "@/lib/compras";
import { enlaceProveedor, rutaEmpresa } from "@/lib/empresas";
import { decimal, fecha as fechaLarga, fechaConAnio, hoyLima, numero, oracion, plural, porcentaje, soles } from "@/lib/formato";
import { CLARIDAD_ONPE, CONOSCE_BUSCADOR, DATASET_SANCIONADOS, PLATAFORMA_JNE, busquedaOece, djiEntidad, fichaRnp } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { P_ANTECEDENTES } from "@/lib/parametrosEmpresa";
import { SENAL, rutaPersona, tipoContratacion } from "@/lib/personas";
import { rutaContrato } from "@/lib/rutas";
import { cn } from "@/lib/utils";
import { ExpedienteSiaf } from "./ExpedienteSiaf";
import {
  ANTECEDENTES_ORDEN,
  COMO_ORDEN,
  ESTADOS_ORDEN,
  MONTOS_ORDEN,
  P_ORD,
  montoOrden,
  rutaOrdenes,
  type InhabilitacionProveedor,
  type OrdenFraccionada,
  type OrdenGeneral,
  type OrdenesPagina,
  type ProcesoCandidato,
  type ProcesosPago,
} from "@/lib/ordenes";

/**
 * Lista GENERAL de órdenes (subsección de Contratos). Clona la pestaña Órdenes de la ficha de empresa, pero sin RUC
 * fijo: añade el PROVEEDOR como dato de la fila, y pagina por `hayMas` (la API no cuenta el total en vivo; con sólo el año
 * o la entidad, el paginador lo toma de las cifras precalculadas). Cada orden abre su panel lateral; una orden es una
 * compra directa (ver el ⓘ junto al título de la vista). Una orden en otra moneda va en la suya («CAD 7,445»).
 *
 * Anatomía de fila, la de todo listado (§14.1): estado (chip; y la bandera de «posible error» si el monto no se puede
 * creer) · qué se compró, con su número primero, entidad, proveedor y cómo se contrató · antecedentes · monto · emitida
 * (las columnas que dicen lo mismo en toda la página se quitan: `colapsarIguales`). Los
 * antecedentes son banderas de esa columna y, en el panel, una tarjeta cada una con su evidencia (`TarjetaBandera`): el
 * parentesco con un funcionario de la entidad (nepotismo), las señales de la persona con la entidad, las órdenes al borde
 * del tope, las del mismo día que juntas pasan 8 UIT (fraccionamiento, con las órdenes de ese día) y la inhabilitación del
 * Tribunal vigente al emitirse (con su resolución y su periodo). Una orden que paga un proceso dice cuál puede ser. El
 * panel cuenta la orden como un relato (`filaOrden`): el veredicto, qué pasó, por qué llama la atención y los datos.
 *
 * También exporta las piezas que comparte con la lista de contratos menores (components/menores): el chip de estado, la
 * fecha posterior a hoy, la celda sin antecedentes, el paginador por «hay más», la espera, la inhabilitación y los
 * enlaces del panel a la ficha de la entidad y del proveedor.
 */

// ─── Piezas compartidas con la lista de contratos menores ──────────────────────

/** El estado que publica la fuente, como chip neutro (§14.1: la columna de estado siempre es un chip, nunca texto suelto). */
export function EstadoCompra({ estado, explica }: { estado: string | null; explica?: string }) {
  return (
    <span className="pill max-w-full border-line bg-paperSoft text-inkSoft" title={explica}>
      <span className="truncate">{estado ? oracion(estado) : "Sin estado"}</span>
    </span>
  );
}

/** ¿La fecha (AAAA-MM-DD) es posterior a hoy en Lima? Un registro del Estado no puede traer una compra de mañana. */
export const esFutura = (f: string | null | undefined): boolean => !!f && f.slice(0, 10) > hoyLima();

/**
 * Una fecha imposible (posterior a hoy) con su bandera ámbar, la misma forma que «posible error de carga» del kit: se
 * muestra tal como vino, con la explicación en el `title` (en el panel va junto al dato, con su ⓘ).
 */
export function FechaFutura({ fuente }: { fuente: string }) {
  return (
    <span
      className="pill inline-flex items-center gap-1 border-amber/30 bg-amber-soft text-amberTexto"
      title={`La fecha que publica ${fuente} es posterior a hoy: puede ser un error de carga. Vigía la muestra tal como vino.`}
    >
      <TriangleAlert size={12} strokeWidth={2.25} className="shrink-0" aria-hidden />
      Fecha futura
    </span>
  );
}

/** La celda de fecha de la fila, con su bandera si la fecha es posterior a hoy. */
export function CeldaFechaCompra({ fecha, fuente }: { fecha: string | null | undefined; fuente: string }) {
  if (!esFutura(fecha)) return <CeldaFecha fecha={fecha} />;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <CeldaFecha fecha={fecha} />
      <FechaFutura fuente={fuente} />
    </span>
  );
}

/**
 * El valor de una fecha en el panel (`DatosClave`): la fecha, su bandera si es futura y el porqué a un clic. Siempre con
 * el año: «Emitida: 4 ago.» no decía de qué año era la orden.
 */
export function datoFecha(etiqueta: string, f: string | null | undefined, fuente: string): DatoClave {
  if (!esFutura(f)) return { etiqueta, valor: f ? fechaConAnio(f) : null, mono: true };
  return {
    etiqueta,
    valor: (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {fechaConAnio(f)}
        <FechaFutura fuente={fuente} />
      </span>
    ),
    mono: true,
    ayuda: (
      <Ayuda titulo="¿Por qué una fecha futura?">
        La fecha que publica {fuente}, el {fechaLarga(f!.slice(0, 10))}, es posterior a hoy. Puede ser un error de carga
        de la entidad o de la fuente: Vigía no la cambia, la muestra tal como vino.
      </Ayuda>
    ),
  };
}

/**
 * Adónde lleva cada nombre del panel de una compra: la entidad, a su ficha; el proveedor, a la de su empresa (RUC 20) o,
 * si es una persona con ficha, a la suya por su código (nunca por su RUC 10: lleva el DNI). Nada si ya se está en esa
 * ficha (la lista de una entidad o de una empresa).
 */
export function fichasCompra(
  ruta: string,
  entidadRuc: string | null | undefined,
  proveedorRuc: string | null | undefined,
  personaCodigo?: string | null,
): { entidad: string | null; proveedor: string | null } {
  const fuera = (href: string | null) => (href && !ruta.startsWith(href.split("?")[0]) ? href : null);
  return {
    entidad: fuera(entidadRuc ? `/entidad/${entidadRuc}` : null),
    proveedor: fuera(enlaceProveedor(proveedorRuc) ?? (personaCodigo ? rutaPersona(personaCodigo) : null)),
  };
}

/**
 * Un nombre del panel con el enlace a su ficha, si tiene (`fichasCompra`); si no, el nombre solo (y sin nombre, null:
 * `DatosClave` dice «Sin dato»). Sólo en el panel: la fila entera ya es un botón y un enlace adentro sería un control
 * dentro de otro. Verde y subrayado, como todo identificador (antes sin subrayar hasta pasar el puntero: no se notaba que
 * llevaba a algún lado; pedido del usuario del 2026-11-05).
 */
export function conFicha(nombre: string | null, href: string | null): ReactNode {
  if (!nombre || !href) return nombre;
  return (
    <Link href={href} prefetch={false} className="font-medium text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
      {nombre}
    </Link>
  );
}

/**
 * La columna de antecedentes cuando no hay ninguno: «Ninguno» donde la columna se ve; donde va apilada bajo la fila (el
 * celular), nada, para no repetir un renglón vacío en cada fila. `sinDato`: no se pudo revisar (la fuente no trae a ese
 * proveedor), que no es lo mismo que no tener ninguno.
 */
export function SinAntecedentes({ sinDato = false }: { sinDato?: boolean }) {
  return <span className="hidden text-meta text-mute lg:inline">{sinDato ? "Sin dato" : "Ninguno"}</span>;
}

/** Un enlace a esta lista con sus filtros y la página `n` (el parámetro de página es de cada lista). */
export function hrefPagina(ruta: string, parametros: Parametros, paramPagina: string, n: number): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) if (v) q.set(k, String(v));
  if (n > 1) q.set(paramPagina, String(n));
  else q.delete(paramPagina);
  const qs = q.toString();
  return qs ? `${ruta}?${qs}` : ruta;
}

/** Esta lista con sus filtros más uno (desde la página 1): «Ver sólo las de esta entidad» en el panel de una fila. */
export const hrefConFiltro = (ruta: string, parametros: Parametros, paramPagina: string, cambio: Parametros) =>
  hrefPagina(ruta, { ...parametros, ...cambio }, paramPagina, 1);

/**
 * «de N» con un total que no sale de la página sino de cifras precalculadas (las de la vista Órdenes cuentan sólo las
 * órdenes en soles y se refrescan con cada carga semanal): exacto hasta 10 mil y redondeado más arriba, donde la
 * diferencia con lo que se lista (las pocas en otra moneda, lo que llegó después) no se ve.
 */
function deTotal(n: number): string {
  // Desde 999,500 ya es «un millón» (redondeado a miles diría «unas 1,000 mil»).
  if (n >= 999_500) {
    const m = decimal(n / 1_000_000, 1);
    return m === "1" ? "de alrededor de un millón" : `de unos ${m} millones`;
  }
  if (n >= 10_000) return `de unas ${numero(Math.round(n / 1000))} mil`;
  return `de ${numero(n)}`;
}

/**
 * El paginador de una lista que sabe si «hay más» pero no cuántas son (la API no cuenta millones de filas): el kit de
 * cursor, con el tramo que se ve ("26–50") y, en la última página, el total que ya se sabe ("51–60 de 60"). Nunca
 * un «Página N» sin contexto ni un total inventado: `sinTotal` cuando la lista se acotó a las más recientes y la última
 * página no es el final de verdad. `total`: el que se sabe sin contar la lista (cifras precalculadas), para decirlo desde
 * la primera página («1–25 de unos 27.7 millones»; pedido del usuario del 2026-11-05: Órdenes decía sólo «1–25»).
 */
export function PaginadorHayMas({
  ruta,
  parametros,
  paramPagina,
  actual,
  tam,
  enPagina,
  hayMas,
  subir = false,
  sinTotal = false,
  total = null,
}: {
  ruta: string;
  parametros: Parametros;
  paramPagina: string;
  actual: number;
  tam: number;
  enPagina: number;
  hayMas: boolean;
  subir?: boolean;
  sinTotal?: boolean;
  total?: number | null;
}) {
  const desde = (actual - 1) * tam + 1;
  const hasta = desde + enPagina - 1;
  const rango = `${numero(desde)}–${numero(hasta)}`;
  // El total precalculado, sólo si es más que lo ya visto (uno que se quedó atrás de la lista no va: diría «26–50 de 40»).
  const texto = !hayMas && !sinTotal ? `${rango} de ${numero(hasta)}`
    : hayMas && !sinTotal && total != null && total > hasta ? `${rango} ${deTotal(total)}`
    : rango;
  return (
    <PaginacionCursor
      texto={texto}
      anterior={actual > 1 ? hrefPagina(ruta, parametros, paramPagina, actual - 1) : null}
      siguiente={hayMas ? hrefPagina(ruta, parametros, paramPagina, actual + 1) : null}
      subir={subir}
    />
  );
}

/**
 * La espera de una de estas listas (§10.5): la rejilla en esqueleto y, en el renglón del paginador, qué se espera con la
 * llamita caminando, que aparece pasado 1 s. La demora es de CSS: sin JS ni movimiento, igual se ve.
 */
export function ListaCargando({ texto, columnas }: { texto: string; columnas: Columna[] }) {
  return (
    <div className="space-y-3" role="status" aria-busy>
      <p className="flex min-h-[44px] items-center gap-2.5 text-dato text-mute animate-[fadeIn_200ms_ease-out_1s_both] sm:min-h-[36px]">
        <Llamita caminando className="w-6 text-granate/70" />
        {texto}
      </p>
      <TablaSkeleton columnas={columnas} filas={10} />
    </div>
  );
}

// ─── La lista de órdenes ──────────────────────────────────────────────────────

/** Qué dice cada estado de una orden en CONOSCE (las anuladas no se listan). */
const ESTADO_ORDEN: Record<string, string> = {
  emitida: "La entidad emitió la orden.",
  comprometida: "La entidad ya separó el presupuesto para pagarla (compromiso).",
  devengada: "La entidad reconoció que el proveedor cumplió y que le debe el pago (devengado).",
};

const FUENTE_ORDEN = "CONOSCE";

// Las columnas que en una página dicen lo mismo en todas las filas («Emitida», «Ninguno») se quitan y lo dicen una vez
// sobre la tabla (`colapsarIguales`, pedido del usuario del 2026-11-05): `igual` es esa frase.
const COLUMNAS: Columna[] = [
  {
    clave: "estado", titulo: "Estado", ancho: "120px", desde: "md", apilar: true,
    igual: {
      texto: "Estado de todas: {}",
      frases: { Emitida: "Todas emitidas", Comprometida: "Todas comprometidas", Devengada: "Todas devengadas" },
      vacia: "Ninguna trae su estado",
    },
    ayuda: (
      <Ayuda titulo="¿Qué dice el estado de una orden?">
        <span className="block">Emitida: la entidad emitió la orden.</span>
        <span className="block">Comprometida: ya separó el presupuesto para pagarla.</span>
        <span className="block">Devengada: reconoció que el proveedor cumplió y que le debe el pago.</span>
        <span className="mt-2 block">Ninguna de las tres quiere decir que ya se pagó.</span>
      </Ayuda>
    ),
  },
  {
    clave: "orden", titulo: "Orden", ancho: "minmax(0,1.8fr)",
    ayuda: (
      <Ayuda titulo="¿Qué dice cada orden?">
        <span className="block">Qué se compró o se pagó, la entidad, el proveedor, el tipo de orden y su número.</span>
        <span className="mt-2 block">
          Cómo se contrató, según CONOSCE: hasta 8 UIT sin concurso (lo que la ley deja comprar sin proceso; fueron 9 UIT con
          el D.U. 016-2022 y 3 UIT antes de 2019), sin proceso de selección, de un proceso de selección, por contratación
          directa, por el catálogo electrónico de Perú Compras o el pago de un servicio público.
        </span>
        <span className="mt-2 block">
          Una persona natural (RUC 10) es alguien que factura con su nombre: un locador, por lo general. Una empresa tiene RUC 20.
        </span>
      </Ayuda>
    ),
  },
  {
    clave: "antecedentes", titulo: "Antecedentes", ancho: "minmax(0,0.8fr)", desde: "lg", apilar: true,
    igual: { frases: { Ninguno: "Ninguna con antecedentes" }, vacia: "Antecedentes: sin dato en todas" },
    ayuda: (
      <Ayuda titulo="¿Qué antecedentes se revisan aquí?">
        <span className="block">
          Posible nepotismo: el proveedor figura como pariente de un funcionario de la entidad que le dio la orden,
          según su Declaración Jurada de Intereses (Contraloría, Ley 31227).
        </span>
        <span className="mt-2 block">
          Pasan 8 UIT: la entidad le emitió ese mismo día varias órdenes que juntas pasan el tope de 8 UIT, el monto hasta el que
          se puede comprar sin concurso (CONOSCE). Puede ser una compra partida para no hacer un proceso.
        </span>
        <span className="mt-2 block">
          Inhabilitado: el Tribunal de Contrataciones tenía inhabilitado al proveedor el día en que se emitió la orden.
        </span>
        <span className="mt-2 block">Son indicios para revisar, no acusaciones. Los demás registros del proveedor están en su ficha.</span>
      </Ayuda>
    ),
  },
  {
    clave: "monto", titulo: "Monto", ancho: "116px", alinear: "der", desde: "md", apilar: "con-rotulo", ayuda: <AyudaTermino clave="uit" />,
    igual: { texto: "Monto de todas: {}", vacia: "Ninguna trae monto" },
  },
  {
    clave: "fecha", titulo: "Emitida", ancho: "104px", desde: "md", apilar: "con-rotulo",
    igual: { texto: "Todas emitidas el {}", vacia: "Ninguna trae fecha de emisión" },
  },
];

/** Las opciones de un filtro desde su lista (lib/ordenes.ts, lib/menores.ts), con su conteo si lo hay. */
export const opcionesDe = (lista: readonly { valor: string; etiqueta: string; grupo?: string }[], conteos?: Record<string, number> | null) =>
  lista.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta, grupo: o.grupo, conteo: conteos ? conteos[o.valor] ?? 0 : null }));

/** «Tipo de proveedor»: lo mismo en Órdenes y en Menores. */
export const PERSONAS_PROVEEDOR = [
  { valor: "natural", etiqueta: "Persona natural (RUC 10)" },
  { valor: "empresa", etiqueta: "Empresa (RUC 20)" },
] as const;

/**
 * El chip de un filtro de RUC puesto por un enlace (el panel de una fila o la URL): con el nombre que traen las filas, para
 * poder verlo y quitarlo. Antes `oent`/`oprov` filtraban la lista sin aparecer en ningún lado. Una persona natural no se
 * nombra con su RUC (lleva su DNI): las filas la traen con un apellido tapado o, sin filas, se dice que es una persona.
 */
export function filtroRuc(param: string, etiqueta: string, todas: string, ruc: string | undefined, nombre: string | null | undefined): FiltroSecundario[] {
  if (!ruc) return [];
  const texto = nombre ? tituloNatural(nombre) : ruc.startsWith("10") ? "Una persona natural" : `RUC ${ruc}`;
  return [{ param, etiqueta, todas, opciones: [{ valor: ruc, etiqueta: texto }] }];
}

/**
 * La barra de filtros de las órdenes, por pregunta: a la vista el alcance (año, región), el tipo y los antecedentes; en
 * «Filtros», quién (entidad, proveedor, persona o empresa), cómo (estado, cómo se contrató) y cuánto (monto, posible error).
 * Sin conteos: la API no cuenta los millones de órdenes (pagina por «hay más»).
 */
export async function BarraOrdenesGeneral({
  pagina,
  regiones = [],
  parametros = {},
  entidadNombre = null,
}: {
  pagina: Promise<OrdenesPagina | null>;
  regiones?: string[];
  parametros?: Parametros;
  /** El nombre de la entidad filtrada, si la página lo buscó (para el chip cuando ninguna orden cumple los filtros). */
  entidadNombre?: string | null;
}) {
  const p = await pagina;
  const anios = p?.anios ?? [];
  const filas = p?.data ?? [];
  const entidad = parametros[P_ORD.entidad];
  const proveedor = parametros[P_ORD.proveedor];
  // Con el filtro puesto, todas las filas son de esa entidad (o proveedor): su nombre sale de la primera.
  const nombreEntidad = entidad ? filas.find((o) => o.entidadRuc === entidad)?.entidad ?? entidadNombre : null;
  const nombreProveedor = proveedor ? filas.find((o) => o.rucContratista === proveedor)?.contratista : null;
  const filtros: FiltroSecundario[] = [
    ...enSeccion(
      "Quién",
      ...filtroRuc(P_ORD.entidad, "Entidad", "Toda entidad", entidad, nombreEntidad),
      ...filtroRuc(P_ORD.proveedor, "Proveedor", "Todo proveedor", proveedor, nombreProveedor),
      { param: P_ORD.persona, etiqueta: "Tipo de proveedor", todas: "Personas y empresas", opciones: opcionesDe(PERSONAS_PROVEEDOR) },
    ),
    ...enSeccion(
      "Cómo",
      { param: P_ORD.estado, etiqueta: "Estado de la orden", todas: "Todo estado", opciones: opcionesDe(ESTADOS_ORDEN) },
      { param: P_ORD.como, etiqueta: "Cómo se contrató", todas: "De cualquier forma", opciones: opcionesDe(COMO_ORDEN) },
    ),
    ...enSeccion(
      "Cuánto",
      { param: P_ORD.monto, etiqueta: "Monto de la orden", todas: "Cualquier monto", opciones: opcionesDe(MONTOS_ORDEN) },
      { param: P_ORD.dudosa, etiqueta: "Calidad del dato", todas: "Todos los datos", opciones: [{ valor: "si", etiqueta: "Con posible error de carga" }] },
    ),
  ];
  return (
    <BarraFiltros
      busqueda={{ param: P_ORD.q, placeholder: "Buscar por descripción, entidad, proveedor o número…", etiqueta: "Buscar en las órdenes", min: 3 }}
      visibles={[
        // Sin año, la API trae las más recientes de todos los años (desde 2018), no sólo las del último.
        { param: P_ORD.anio, etiqueta: "Año", corta: "Año", todas: "Todos los años", opciones: anios.map((a) => ({ valor: String(a), etiqueta: String(a) })) },
        ...(regiones.length
          ? [{ param: P_ORD.region, etiqueta: "Región", corta: "Región", todas: "Todo el país", opciones: regiones.map((r) => ({ valor: r, etiqueta: tituloNatural(r) })) }]
          : []),
        {
          param: P_ORD.tipo, etiqueta: "Tipo de orden", corta: "Tipo", todas: "Compra y servicio",
          opciones: [
            { valor: "compra", etiqueta: "Órdenes de compra" },
            { valor: "servicio", etiqueta: "Órdenes de servicio" },
          ],
        },
        // Los antecedentes que filtran, en dos grupos: los de la persona con la entidad y los de la orden misma.
        { param: P_ORD.antecedente, etiqueta: "Antecedentes", corta: "Antecedentes", todas: "Todos", opciones: opcionesDe(ANTECEDENTES_ORDEN) },
      ]}
      filtros={filtros}
      orden={{ param: P_ORD.orden, porDefecto: "reciente", opciones: [{ valor: "reciente", etiqueta: "Más recientes" }, { valor: "antiguo", etiqueta: "Más antiguas" }] }}
    />
  );
}

/** Mientras llega la página de órdenes. */
export function ListaOrdenesCargando() {
  return <ListaCargando texto="Cargando las órdenes…" columnas={COLUMNAS} />;
}

// ─── Antecedentes de una orden (y de un contrato menor) ──────────────────────────

/** Un antecedente como bandera de la fila: tipo, severidad, el nombre del chip y qué significa (su `title`). */
export interface Antecedente {
  tipo: string;
  severidad: "alta" | "media" | "baja";
  chip: string;
  explica: string;
}

/** Los antecedentes como banderas, en la celda y en los chips del panel: las de toda lista (CrucesCelda). */
/** En la celda, la más grave entera y «+n»; en un panel (`todas`), todas: ahí hay ancho. */
export function BanderasAntecedentes({ antecedentes, etiqueta = "Antecedentes", todas = false }: { antecedentes: Antecedente[]; etiqueta?: string; todas?: boolean }) {
  return (
    <CrucesCelda
      max={todas ? antecedentes.length : undefined}
      cruces={antecedentes.map((a) => ({ tipo: a.tipo, severidad: a.severidad }))}
      etiquetas={Object.fromEntries(antecedentes.map((a) => [a.tipo, a.chip]))}
      explicaciones={Object.fromEntries(antecedentes.map((a) => [a.tipo, a.explica]))}
      etiquetaLista={etiqueta}
    />
  );
}

/** «Del 3 mar. 2025 al 2 mar. 2026» o «desde el 3 mar. 2025, de forma definitiva». */
function periodoInhabilitacion(i: InhabilitacionProveedor): string {
  const desde = i.desde ? fechaLarga(i.desde) : null;
  if (i.tipo === "definitivo") return desde ? `desde el ${desde}, de forma definitiva` : "de forma definitiva";
  return desde && i.hasta ? `del ${desde} al ${fechaLarga(i.hasta)}` : desde ? `desde el ${desde}` : "en esa fecha";
}

/** La bandera de la inhabilitación del Tribunal vigente en la fecha de la orden (o de la firma de un contrato menor). */
export const antecedenteInhabilitado = (i: InhabilitacionProveedor, chip: string): Antecedente => ({
  tipo: "inhabilitado",
  severidad: "alta",
  chip,
  explica: `El Tribunal de Contrataciones del Estado lo tenía inhabilitado para contratar con el Estado (${periodoInhabilitacion(i)}).`,
});

/**
 * La inhabilitación en el panel de una compra (los contratos menores: su lista y su ficha), como la tarjeta de bandera de
 * las órdenes (`TarjetaInhabilitacion`). Antes era un bloque de texto con la fuente enlazada a una portada. Con `fecha` (la
 * de la compra), también cuánto antes lo inhabilitó y el periodo dibujado con la compra adentro.
 */
export function BloqueInhabilitacion({
  i,
  cuando,
  ruc,
  fecha,
  marca,
}: {
  i: InhabilitacionProveedor;
  cuando: string;
  ruc?: string | null;
  fecha?: string | null;
  marca?: string;
}) {
  return <TarjetaInhabilitacion i={i} cuando={cuando} ruc={ruc} fecha={fecha} marca={marca} />;
}

/** Una señal de la persona por su tipo (las que llegan de la API y la web aún no conoce, no se muestran). */
const senalPersona = (tipo: string) => (SENAL as Record<string, { corto: string; titulo: string; explica: string } | undefined>)[tipo];

/** A qué porcentaje de su tope quedó la orden («96.8 %»). */
const parteDelTope = (monto: number, tope: number) => porcentaje((100 * monto) / tope, { decimales: 1 });

/** El nombre de dos banderas en la fila y en el panel: el mismo en el chip de la celda y en el índice de las tarjetas. */
const CHIP_INHABILITADO = "Inhabilitado al emitirse";
const CHIP_FRACCIONAMIENTO = TIPO_CRUCE.fraccionamiento?.chip ?? "Pasan 8 UIT";

/** Los antecedentes de una orden, del más grave al más leve; cada uno con su evidencia en el panel. */
export function antecedentesOrden(o: OrdenGeneral): Antecedente[] {
  const out: Antecedente[] = [];
  if (o.conNepotismo) out.push({ tipo: "nepotismo", severidad: "alta", chip: SENAL.nepotismo.corto, explica: SENAL.nepotismo.titulo });
  if (o.inhabilitacion) out.push(antecedenteInhabilitado(o.inhabilitacion, CHIP_INHABILITADO));
  // Las demás señales de la persona con esta entidad, con el mismo nombre que en su ficha.
  for (const s of o.senalesPersona ?? []) {
    const def = senalPersona(s.tipo);
    if (def) out.push({ tipo: s.tipo, severidad: s.severidad, chip: def.corto, explica: def.titulo });
  }
  if (o.alBorde && o.monto != null) {
    out.push({
      tipo: "al_borde_del_tope",
      severidad: "media",
      chip: SENAL.al_borde_del_tope.corto,
      explica: `Quedó en el ${parteDelTope(o.monto, o.alBorde.tope)} del tope de su año (${soles(o.alBorde.tope)}), como la mayoría de las órdenes que la entidad le dio.`,
    });
  }
  const f = o.fraccionamiento;
  if (f) {
    out.push({
      tipo: "fraccionamiento",
      severidad: f.severidad === "alta" ? "alta" : "media",
      chip: CHIP_FRACCIONAMIENTO,
      explica: `Una de ${f.ordenes} órdenes que la entidad le emitió ese día: suman ${soles(f.total)}, más que el tope de 8 UIT (${soles(f.tope)}).`,
    });
  }
  const rango = { alta: 0, media: 1, baja: 2 } as const;
  return out.sort((a, b) => rango[a.severidad] - rango[b.severidad]);
}

/**
 * De dónde sale cada señal de la persona, sin repetir y con dónde comprobarlo: sólo las fuentes de las que están (las
 * órdenes, siempre). Las declaraciones juradas, las de la entidad que dio la orden.
 */
function fuentesSenales(tipos: string[], entidadRuc: string | null | undefined): { texto: string; href: string }[] {
  const f = new Map<string, string>();
  for (const t of tipos) {
    if (t === "financio_campana" || t === "aporte_gobierna") f.set("ONPE (aportes)", CLARIDAD_ONPE);
    if (t === "candidato_gobierna" || t === "autoridad_contratada") f.set("JNE (candidaturas y autoridades)", PLATAFORMA_JNE);
    if (t === "nepotismo_gobierno") f.set("Contraloría (declaraciones juradas de intereses)", djiEntidad(entidadRuc));
  }
  f.set("OECE (órdenes)", CONOSCE_BUSCADOR);
  return [...f].map(([texto, href]) => ({ texto, href }));
}

// ─── Las banderas en el panel: una tarjeta por bandera, con su evidencia ─────────

/*
 * Pedido del usuario del 2026-11-05, del panel de una orden con «Inhabilitado al emitirse»: «aca no hay nada de
 * información… el enlace no te lleva a nada, no tiene buen diseño ni nada que DIGA esa es la bandera». Arriba iba el chip
 * y, muy abajo, un bloque de texto suelto con la fuente enlazada a una portada. Ahora cada bandera es una tarjeta (en el
 * capítulo «Por qué llama la atención» del panel): su severidad con su ícono y su palabra («Bandera grave»), su nombre
 * como título, lo que se encontró en una oración con los datos clave (fechas, resolución, montos), un gráfico chico donde
 * lo hay (el periodo de la sanción con la orden adentro, el monto contra su tope, las órdenes del día contra 8 UIT) y la
 * evidencia: dónde está el caso en Vigía y dónde comprobarlo en la fuente oficial, con qué buscar si la fuente no abre el
 * registro.
 */

/** Un identificador dentro de una oración en negrita (el veredicto, un paso): verde y subrayado, con el peso del texto. */
const CLASE_ENLACE_FRASE = "text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate";

/** Un identificador en una frase del panel (un proceso, una ficha): verde y subrayado, como todo identificador. */
const CLASE_ENLACE = `font-medium ${CLASE_ENLACE_FRASE}`;

/** ¿Es una empresa (RUC 20)? Sólo ésas llevan enlace por su RUC: el RUC 10 lleva el DNI. */
const esEmpresa = (ruc: string | null | undefined): ruc is string => !!ruc && /^20\d{9}$/.test(ruc);

/** Los tres canales de la severidad de una bandera (color, forma y palabra), los mismos de BanderasFicha. */
const NIVEL = {
  alta: {
    palabra: "Bandera grave", Icono: ICONO_NIVEL.alta, borde: "border-crimson/35", cabeza: "bg-crimson-soft", texto: "text-crimsonTexto",
  },
  media: {
    palabra: "Bandera media", Icono: ICONO_NIVEL.media, borde: "border-amber/35", cabeza: "bg-amber-soft", texto: "text-amberTexto",
  },
  baja: {
    palabra: "Bandera leve", Icono: ICONO_NIVEL.baja, borde: "border-line", cabeza: "bg-paperDeep", texto: "text-inkSoft",
  },
} as const;

type Nivel = keyof typeof NIVEL;

/**
 * Una bandera como tarjeta: la cabecera teñida con su severidad (ícono y palabra) y su nombre; debajo, lo que se encontró;
 * al pie, la evidencia. `id`: el ancla a la que lleva su señal en la cronología del panel (`pasosOrden`). Server-safe.
 */
export function TarjetaBandera({
  id,
  tipo,
  severidad,
  nombre,
  ayuda,
  pie,
  children,
}: {
  id: string;
  tipo: string;
  severidad: Nivel;
  nombre: string;
  ayuda?: ReactNode;
  pie?: ReactNode;
  children: ReactNode;
}) {
  const n = NIVEL[severidad];
  return (
    <article id={id} aria-labelledby={`${id}-nombre`} className={cn("scroll-mt-4 overflow-hidden rounded-2xl border bg-paper", n.borde)}>
      <header className={cn("flex items-start gap-3 px-4 py-3", n.cabeza)}>
        <n.Icono size={20} className={cn("mt-0.5 shrink-0", n.texto)} aria-hidden />
        <div className="min-w-0">
          <p className={cn("text-rotulo font-semibold", n.texto)}>{n.palabra}</p>
          <h3 id={`${id}-nombre`} className="flex items-center gap-1.5 font-display text-bloque font-bold leading-snug text-ink">
            <IconoBandera tipo={tipo} size={16} className="text-inkSoft" />
            <span className="min-w-0">{nombre}</span>
            {ayuda}
          </h3>
        </div>
      </header>
      <div className="space-y-3 px-4 py-3.5 text-dato leading-relaxed text-inkSoft">{children}</div>
      {pie && <footer className="space-y-2.5 border-t border-line/70 px-4 py-3">{pie}</footer>}
    </article>
  );
}

/** Los datos clave de una bandera, cada uno con su ícono (`Dato`), en una línea que se parte si no entra. */
function HechosBandera({ children }: { children: ReactNode }) {
  return <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta leading-snug text-ink">{children}</p>;
}

/** Un monto dentro de un dato: en mono tabular, como todo monto. */
const Monto = ({ n }: { n: number }) => <span className="font-mono tabular-nums">{soles(n)}</span>;

/**
 * Dónde comprobar una bandera en la fuente oficial: cada enlace con qué buscar ahí (`pista`) cuando la fuente no abre el
 * registro (un buscador, un archivo de datos abiertos), para no dejar a nadie frente a una búsqueda vacía.
 */
function DondeComprobarlo({ enlaces }: { enlaces: { texto: string; href: string; pista?: string | null }[] }) {
  return (
    <div className="text-rotulo leading-relaxed text-mute">
      <p className="font-semibold text-inkSoft">Dónde comprobarlo</p>
      <ul className="mt-0.5 space-y-0.5">
        {enlaces.map((e) => (
          <li key={e.href}>
            <EnlaceFuente href={e.href}>{e.texto}</EnlaceFuente>
            {e.pista ? `: ${e.pista}.` : ""}
          </li>
        ))}
      </ul>
      <p className="mt-1">Es un dato para revisar, no una acusación.</p>
    </div>
  );
}

/** Las acciones que llevan a la evidencia en Vigía (la ficha con el caso, la lista con las órdenes que la sostienen). */
function AccionesBandera({ acciones }: { acciones: ({ href: string; texto: string } | null | false | undefined)[] }) {
  const lista = acciones.filter((a): a is { href: string; texto: string } => !!a);
  if (!lista.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {lista.map((a) => (
        <EnlaceAccion key={a.href} href={a.href} prefetch={false} variante="secundario" flecha>
          {a.texto}
        </EnlaceAccion>
      ))}
    </div>
  );
}

const DIA_MS = 86_400_000;
const diaUtc = (f: string) => Date.parse(`${f.slice(0, 10)}T12:00:00Z`);
const diasEntre = (a: string, b: string) => Math.round((diaUtc(b) - diaUtc(a)) / DIA_MS);

/** Un lapso como se dice, igual que LineaHitos: días hasta dos meses, meses hasta dos años, después años y meses. */
function lapso(dias: number): string {
  if (dias < 60) return plural(dias, "día", "días");
  const meses = Math.round(dias / 30.44);
  if (meses < 24) return plural(meses, "mes", "meses");
  const anios = Math.floor(meses / 12);
  const resto = meses % 12;
  return resto ? `${plural(anios, "año", "años")} y ${plural(resto, "mes", "meses")}` : plural(anios, "año", "años");
}

/** Las infracciones de la resolución, sin la viñeta ni la letra del inciso («- j) Presentar…» → «Presentar…»). */
const infracciones = (t: string | null | undefined): string[] =>
  (t ?? "")
    .split(/\n+/)
    .map((x) => x.replace(/^\s*-\s*/, "").replace(/^[a-z]\)\s*/i, "").trim())
    .filter(Boolean)
    .slice(0, 4);

/**
 * El periodo de la inhabilitación como una barra, con una raya en el día de la compra (que cae adentro: por eso es
 * bandera). La escala va del comienzo de la sanción a su fin con un margen a cada lado; una definitiva no termina: llega
 * al borde. El rótulo de la compra va sobre su raya, hacia el lado con más lugar. Server-safe.
 */
function PeriodoSancion({ i, fecha, marca }: { i: InhabilitacionProveedor; fecha: string; marca: string }) {
  if (!i.desde) return null;
  const definitiva = i.tipo === "definitivo" || !i.hasta;
  const desde = diaUtc(i.desde);
  const fin = definitiva ? Math.max(diaUtc(fecha), diaUtc(hoyLima())) : diaUtc(i.hasta!);
  const margen = Math.max((fin - desde) * 0.08, 20 * DIA_MS);
  const ini = desde - margen;
  const ancho = fin + margen - ini;
  const pos = (t: number) => Math.min(100, Math.max(0, (100 * (t - ini)) / ancho));
  const izq = pos(desde);
  const der = definitiva ? 100 : pos(fin);
  const enCompra = pos(diaUtc(fecha));
  return (
    <figure className="space-y-1">
      <div
        role="img"
        aria-label={`La inhabilitación va ${periodoInhabilitacion(i)}. ${marca} es del ${fechaLarga(fecha)}: cae dentro de ese periodo.`}
        className="relative h-11"
      >
        <span
          aria-hidden
          className="absolute top-0 whitespace-nowrap text-micro font-semibold text-ink"
          style={enCompra > 55 ? { right: `${100 - enCompra}%` } : { left: `${enCompra}%` }}
        >
          {marca}, {fechaConAnio(fecha)}
        </span>
        <span aria-hidden className="absolute inset-x-0 top-[26px] h-2 rounded-full bg-paperDeep" />
        <span
          aria-hidden
          className={cn("absolute top-[26px] h-2 bg-crimson/45 ring-1 ring-inset ring-crimson/60", definitiva ? "rounded-l-full" : "rounded-full")}
          style={{ left: `${izq}%`, width: `${Math.max(der - izq, 1)}%` }}
        />
        <span aria-hidden className="absolute top-4 h-[22px] w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${enCompra}%` }} />
      </div>
      <figcaption className="flex items-baseline justify-between gap-3 text-rotulo text-mute">
        <span>
          Inhabilitado desde el <span className="font-mono tabular-nums text-inkSoft">{fechaConAnio(i.desde)}</span>
        </span>
        <span className="text-right">
          {definitiva ? (
            "de forma definitiva"
          ) : (
            <>
              hasta el <span className="font-mono tabular-nums text-inkSoft">{fechaConAnio(i.hasta)}</span>
            </>
          )}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * La inhabilitación del Tribunal vigente al emitirse la orden (o al firmarse un contrato menor), como tarjeta: cuánto antes
 * lo inhabilitó y por cuánto tiempo, la resolución y el periodo como datos, el periodo dibujado con la compra adentro, por
 * qué lo inhabilitó (la infracción) y la evidencia. En Vigía, la sanción en la pestaña Antecedentes de la empresa (la
 * misma que abre la cabecera de su ficha, `atipo=sancion_temporal` o `sancion_definitiva`); afuera, su ficha en el RNP
 * del OECE (abre por RUC, sólo una empresa) y los datos abiertos del Tribunal, que no abren por registro: ahí, qué buscar
 * (la resolución; nunca el RUC 10, que lleva el DNI). Antes el único enlace era la ficha del RNP, sin decir qué mirar.
 */
export function TarjetaInhabilitacion({
  i,
  cuando,
  ruc,
  fecha = null,
  marca = "Esta compra",
  id = "bandera-inhabilitado",
  nombre = "Proveedor inhabilitado por el Tribunal",
}: {
  i: InhabilitacionProveedor;
  /** La compra en una frase: «La orden se emitió el 2 de marzo de 2026». */
  cuando: string;
  ruc?: string | null;
  /** La fecha de la compra (AAAA-MM-DD): con ella, cuánto antes lo inhabilitó y el periodo dibujado con la compra adentro. */
  fecha?: string | null;
  /** El rótulo de la compra en el dibujo («Esta orden»). */
  marca?: string;
  id?: string;
  nombre?: string;
}) {
  // El RUC sólo de una empresa: el de una persona natural lleva su DNI y no va en un enlace ni en una pista.
  const empresa = esEmpresa(ruc) ? ruc : null;
  const definitiva = i.tipo === "definitivo";
  const dia = fecha && /^\d{4}-\d{2}-\d{2}/.test(fecha) ? fecha.slice(0, 10) : null;
  const antes = dia && i.desde ? diasEntre(i.desde, dia) : null;
  const duracion = !definitiva && i.desde && i.hasta ? lapso(diasEntre(i.desde, i.hasta)) : null;
  const vigente = definitiva || (!!i.hasta && i.hasta.slice(0, 10) >= hoyLima());
  const motivos = infracciones(i.infraccion);
  const resolucion = i.resolucion ? `la resolución ${i.resolucion}` : null;
  const periodo = !i.desde
    ? null
    : definitiva
      ? `Desde el ${fechaConAnio(i.desde)}, definitiva`
      : i.hasta
        ? `Del ${fechaConAnio(i.desde)} al ${fechaConAnio(i.hasta)}`
        : `Desde el ${fechaConAnio(i.desde)}`;
  return (
    <TarjetaBandera
      id={id}
      tipo="inhabilitado"
      severidad="alta"
      nombre={nombre}
      ayuda={<AyudaTermino clave="inhabilitacion" />}
      pie={
        <>
          <AccionesBandera
            acciones={[
              empresa
                ? {
                    href: rutaEmpresa(empresa, "antecedentes", { [P_ANTECEDENTES.tipo]: definitiva ? "sancion_definitiva" : "sancion_temporal" }),
                    texto: "Ver la sanción en la ficha de la empresa",
                  }
                : null,
            ]}
          />
          <DondeComprobarlo
            enlaces={[
              ...(empresa ? [{ texto: "Su ficha en el RNP del OECE", href: fichaRnp(empresa), pista: resolucion ? `entre sus sanciones, ${resolucion}` : "entre sus sanciones" }] : []),
              {
                texto: "Sancionados del Tribunal (datos abiertos)",
                href: DATASET_SANCIONADOS,
                pista: resolucion ? `en sus archivos, busca ${resolucion}` : empresa ? `en sus archivos, busca el RUC ${empresa}` : "en sus archivos, busca al proveedor por su nombre",
              },
            ]}
          />
        </>
      }
    >
      <p>
        {antes != null && antes >= 0
          ? `${cuando}: el Tribunal de Contrataciones del Estado había inhabilitado al proveedor para contratar con el Estado ${antes === 0 ? "ese mismo día" : `${lapso(antes)} antes`}${definitiva ? ", de forma definitiva" : duracion ? `, por ${duracion}` : ""}.`
          : `El Tribunal de Contrataciones del Estado inhabilitó al proveedor ${periodoInhabilitacion(i)}. ${cuando}, dentro de ese periodo.`}
      </p>
      <HechosBandera>
        {i.resolucion && (
          <Dato icono={Gavel} nombre="Resolución del Tribunal">
            Resolución <span className="font-mono tabular-nums">{i.resolucion}</span>
          </Dato>
        )}
        {periodo && <Dato tipo="fecha" nombre="Periodo de la inhabilitación">{periodo}</Dato>}
        {vigente && <span className="pill border-crimson/30 bg-crimson-soft text-crimsonTexto">Sigue vigente hoy</span>}
      </HechosBandera>
      {dia && <PeriodoSancion i={i} fecha={dia} marca={marca} />}
      {motivos.length > 0 && (
        <div>
          <p className="text-rotulo text-mute">{motivos.length === 1 ? "Por qué lo inhabilitó" : "Por qué lo inhabilitó (las infracciones de la resolución)"}</p>
          <ul className="mt-1 space-y-1">
            {motivos.map((m, k) => (
              <li key={k} className="border-l-2 border-crimson/40 pl-2.5 text-meta text-ink">
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
    </TarjetaBandera>
  );
}

/** La ficha de la persona (RUC 10) con la evidencia de sus señales: por su código al azar, nunca por su RUC. */
const evidenciaPersona = (o: OrdenGeneral) =>
  o.personaCodigo ? { href: `/app/personas/${o.personaCodigo}?seccion=senales`, texto: "Ver la evidencia en su ficha" } : null;

/** El parentesco declarado con un funcionario de la entidad que le dio la orden. */
function TarjetaNepotismo({ o, id }: { o: OrdenGeneral; id: string }) {
  return (
    <TarjetaBandera
      id={id}
      tipo="nepotismo"
      severidad="alta"
      nombre={SENAL.nepotismo.corto}
      pie={
        <>
          <AccionesBandera
            acciones={[
              evidenciaPersona(o),
              o.entidadRuc ? { href: `/entidad/${o.entidadRuc}?seccion=personas&psenal=nepotismo`, texto: "Ver los casos de la entidad" } : null,
            ]}
          />
          <DondeComprobarlo
            enlaces={[{ texto: "Declaraciones juradas de intereses de la entidad (Contraloría)", href: djiEntidad(o.entidadRuc), pista: "el funcionario lo declaró ahí entre sus parientes" }]}
          />
        </>
      }
    >
      <p>{SENAL.nepotismo.explica}</p>
    </TarjetaBandera>
  );
}

/** Una señal de la persona con la entidad (financió la campaña, candidato del que gobierna…): la evidencia, en su ficha. */
function TarjetaSenalPersona({ o, tipo, severidad, id }: { o: OrdenGeneral; tipo: string; severidad: Nivel; id: string }) {
  const def = senalPersona(tipo);
  if (!def) return null;
  return (
    <TarjetaBandera
      id={id}
      tipo={tipo}
      severidad={severidad}
      nombre={def.corto}
      pie={
        <>
          <AccionesBandera acciones={[evidenciaPersona(o)]} />
          <DondeComprobarlo enlaces={fuentesSenales([tipo], o.entidadRuc)} />
        </>
      }
    >
      <p>
        <span className="font-semibold text-ink">{def.titulo}.</span> {def.explica}
      </p>
    </TarjetaBandera>
  );
}

/**
 * La orden quedó entre el 95 % y el 100 % de su tope, y la mayoría de las que la entidad le dio también: el monto y el
 * tope como datos y la barra contra el tope. La evidencia: la ficha de la persona o, de una empresa, sus órdenes al borde
 * del tope con esta entidad (la lista de órdenes con ese filtro).
 */
function TarjetaAlBorde({ o, monto, tope, id }: { o: OrdenGeneral; monto: number; tope: number; id: string }) {
  return (
    <TarjetaBandera
      id={id}
      tipo="al_borde_del_tope"
      severidad="media"
      nombre={SENAL.al_borde_del_tope.corto}
      ayuda={<AyudaTermino clave="uit" />}
      pie={
        <>
          <AccionesBandera
            acciones={[
              evidenciaPersona(o) ??
                (esEmpresa(o.rucContratista) && o.entidadRuc
                  ? { href: rutaOrdenes({ entidad: o.entidadRuc, proveedor: o.rucContratista, antecedente: "al_borde_del_tope" }), texto: "Ver sus órdenes al borde del tope en la entidad" }
                  : null),
            ]}
          />
          <DondeComprobarlo enlaces={[{ texto: "Buscador de CONOSCE (OECE)", href: CONOSCE_BUSCADOR, pista: "busca las órdenes de la entidad a este proveedor" }]} />
        </>
      }
    >
      <p>
        Esta orden quedó justo debajo del tope de su año, el monto desde el cual se debe hacer un proceso de selección, como la
        mayoría de las que la entidad le dio. Puede ser casualidad o la forma de no hacer un proceso.
      </p>
      <HechosBandera>
        <Dato icono={Banknote} nombre="Monto de la orden">
          Orden: <Monto n={monto} />
        </Dato>
        <Dato icono={Gauge} nombre="Tope de su año">
          Tope: <Monto n={tope} />
        </Dato>
        <span className="pill border-amber/30 bg-amber-soft text-amberTexto">El {parteDelTope(monto, tope)} del tope</span>
      </HechosBandera>
      <BarraTope monto={monto} tope={tope} />
    </TarjetaBandera>
  );
}

/** El color de la serie de una barra (el mismo de la compra partida de un contrato menor, FichaMenor). */
const SERIE = "rgb(var(--serie-1))";
const SERIE_CLARA = "rgb(var(--serie-1) / 0.4)";

/**
 * Las órdenes del mismo día una al lado de la otra, contra el tope de 8 UIT: esta orden en el color lleno y las demás en
 * el claro; la raya marca el tope. La escala empieza en cero. Server-safe.
 */
function BarraDelDia({ f, orden }: { f: OrdenFraccionada; orden: string | null }) {
  const escala = Math.max(f.total, f.tope) * 1.04;
  const enTope = (100 * f.tope) / escala;
  return (
    <figure className="space-y-1.5">
      <div className="relative pt-4">
        <span
          aria-hidden
          className="absolute top-0 whitespace-nowrap text-micro font-semibold text-ink"
          style={enTope > 55 ? { right: `${100 - enTope}%` } : { left: `${enTope}%` }}
        >
          Tope de 8 UIT
        </span>
        <div
          role="img"
          aria-label={`Las ${f.ordenes} órdenes de ese día suman ${soles(f.total)}, más que el tope de 8 UIT (${soles(f.tope)}).`}
          className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-paperDeep"
        >
          {f.detalle.map((d, k) => (
            <span
              key={`${d.orden}-${k}`}
              title={`${d.orden}: ${soles(d.monto)}${d.orden === orden ? " (esta orden)" : ""}`}
              className="h-full min-w-[3px]"
              style={{ width: `${(100 * d.monto) / escala}%`, background: d.orden === orden ? SERIE : SERIE_CLARA }}
            />
          ))}
        </div>
        <span aria-hidden className="absolute bottom-[-2px] top-3.5 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${enTope}%` }} />
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-rotulo text-mute">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIE }} aria-hidden />
          Esta orden
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SERIE_CLARA }} aria-hidden />
          Las demás de ese día
        </span>
      </figcaption>
    </figure>
  );
}

/** Las órdenes del mismo día que juntas pasan 8 UIT: cuántas, cuánto suman frente al tope, la barra y cada una. */
function TarjetaFraccionamiento({ o, f, id }: { o: OrdenGeneral; f: OrdenFraccionada; id: string }) {
  return (
    <TarjetaBandera
      id={id}
      tipo="fraccionamiento"
      severidad={f.severidad === "alta" ? "alta" : "media"}
      nombre="Órdenes del mismo día que pasan 8 UIT"
      ayuda={<AyudaTermino clave="fraccionamiento" />}
      pie={
        <>
          <AccionesBandera
            acciones={[
              esEmpresa(o.rucContratista) && o.entidadRuc
                ? {
                    href: rutaOrdenes({ entidad: o.entidadRuc, proveedor: o.rucContratista, antecedente: "fraccionamiento" }),
                    texto: "Ver sus órdenes partidas en la entidad",
                  }
                : null,
            ]}
          />
          <DondeComprobarlo
            enlaces={[{
              texto: "Buscador de CONOSCE (OECE)",
              href: CONOSCE_BUSCADOR,
              pista: o.fecha ? `busca las órdenes de la entidad del ${fechaLarga(o.fecha)}` : "busca las órdenes de la entidad de ese día",
            }]}
          />
        </>
      }
    >
      <p>
        {o.fecha ? `El ${fechaLarga(o.fecha)}` : "Ese día"} la entidad le emitió varias órdenes que juntas pasan el tope de 8 UIT de ese
        año, el monto hasta el que se puede comprar sin concurso.{f.mismaDescripcion ? " Todas dicen lo mismo." : ""} Puede ser una
        compra partida para no hacer un proceso; no lo prueba.
      </p>
      <HechosBandera>
        <Dato icono={ReceiptText} nombre="Órdenes de ese día">{plural(f.ordenes, "orden", "órdenes")} ese día</Dato>
        <Dato icono={Banknote} nombre="Lo que suman">
          Suman <Monto n={f.total} />
        </Dato>
        <Dato icono={Gauge} nombre="Tope de 8 UIT de ese año">
          Tope: <Monto n={f.tope} />
        </Dato>
      </HechosBandera>
      <BarraDelDia f={f} orden={o.orden} />
      <ul className="divide-y divide-line/70 rounded-xl border border-line" aria-label="Las órdenes de ese día">
        {f.detalle.map((d, k) => (
          <li key={`${d.orden}-${k}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2">
            <span className="min-w-0">
              <span className="font-mono text-rotulo text-ink">{d.orden}</span>
              {d.orden === o.orden && <span className="pill ml-2 border-line bg-paperSoft text-inkSoft">Esta orden</span>}
              {d.descripcion && <span className="block text-meta text-inkSoft">{oracion(d.descripcion)}</span>}
            </span>
            <span className="shrink-0 font-mono text-meta tabular-nums text-ink">{soles(d.monto)}</span>
          </li>
        ))}
      </ul>
    </TarjetaBandera>
  );
}

/**
 * Una bandera de la orden en el panel: su nombre (el mismo del chip de la fila, que va como señal en la cronología), lo
 * que se encontró en una oración (la segunda del veredicto, si es la más grave) y su tarjeta con la evidencia.
 */
interface BanderaOrden {
  id: string;
  tipo: string;
  severidad: Nivel;
  chip: string;
  frase: string;
  tarjeta: ReactNode;
}

/** La inhabilitación en la frase del veredicto: «hasta el 2 de marzo de 2028» o «de forma definitiva». */
const hastaCuando = (i: InhabilitacionProveedor) =>
  i.tipo === "definitivo" ? " de forma definitiva" : i.hasta ? ` hasta el ${fechaLarga(i.hasta)}` : "";

/**
 * Las banderas de una orden como tarjetas, en el orden de `antecedentesOrden` (de la más grave a la más leve; a igual
 * severidad, el de siempre): cada una con el mismo nombre de su chip en la fila.
 */
function banderasDeOrden(o: OrdenGeneral): BanderaOrden[] {
  const out: BanderaOrden[] = [];
  const poner = (tipo: string, severidad: Nivel, chip: string, frase: string, tarjeta: (id: string) => ReactNode) => {
    const id = `bandera-orden-${tipo}`;
    out.push({ id, tipo, severidad, chip, frase, tarjeta: tarjeta(id) });
  };
  if (o.conNepotismo) {
    const frase = `${SENAL.nepotismo.titulo} en su declaración jurada de intereses.`;
    poner("nepotismo", "alta", SENAL.nepotismo.corto, frase, (id) => <TarjetaNepotismo o={o} id={id} />);
  }
  const inh = o.inhabilitacion;
  if (inh) {
    const frase =
      `Para entonces, el Tribunal de Contrataciones ya lo había inhabilitado para contratar con el Estado${hastaCuando(inh)}.`;
    poner("inhabilitado", "alta", CHIP_INHABILITADO, frase, (id) => (
      <TarjetaInhabilitacion
        id={id}
        i={inh}
        ruc={o.rucContratista}
        fecha={o.fecha}
        marca="Esta orden"
        nombre="Inhabilitado al emitirse la orden"
        cuando={o.fecha ? `La orden se emitió el ${fechaLarga(o.fecha)}` : "La orden se emitió"}
      />
    ));
  }
  for (const s of o.senalesPersona ?? []) {
    const def = senalPersona(s.tipo);
    if (!def) continue;
    poner(s.tipo, s.severidad, def.corto, `${def.titulo}.`, (id) => <TarjetaSenalPersona o={o} tipo={s.tipo} severidad={s.severidad} id={id} />);
  }
  const borde = o.alBorde;
  const monto = o.monto;
  if (borde && monto != null) {
    const frase =
      `La orden quedó en el ${parteDelTope(monto, borde.tope)} del tope de su año (${soles(borde.tope)}), ` +
      "como la mayoría de las que la entidad le dio.";
    poner("al_borde_del_tope", "media", SENAL.al_borde_del_tope.corto, frase, (id) => (
      <TarjetaAlBorde o={o} monto={monto} tope={borde.tope} id={id} />
    ));
  }
  const f = o.fraccionamiento;
  if (f) {
    const frase = `Ese mismo día le emitió ${otrasDelDia(f)}: con ésta suman ${soles(f.total)}, más que el tope de 8 UIT (${soles(f.tope)}).`;
    const sev = f.severidad === "alta" ? "alta" : "media";
    poner("fraccionamiento", sev, CHIP_FRACCIONAMIENTO, frase, (id) => <TarjetaFraccionamiento o={o} f={f} id={id} />);
  }
  const rango = { alta: 0, media: 1, baja: 2 } as const;
  return out.sort((a, b) => rango[a.severidad] - rango[b.severidad]);
}

/** Las otras órdenes del día de una orden partida («otra orden», «otras 3 órdenes»): `ordenes` la cuenta a ella también. */
function otrasDelDia(f: OrdenFraccionada): string {
  const otras = Math.max(f.ordenes - 1, 1);
  return otras === 1 ? "otra orden" : `otras ${numero(otras)} órdenes`;
}

/** Las tarjetas de las banderas, una debajo de otra (nada si no hay ninguna). */
function TarjetasBanderas({ banderas }: { banderas: BanderaOrden[] }) {
  if (!banderas.length) return null;
  return (
    <div className="space-y-3">
      {banderas.map((b) => (
        <Fragment key={b.id}>{b.tarjeta}</Fragment>
      ))}
    </div>
  );
}

// ─── El panel de una orden como relato ───────────────────────────────────────────

/*
 * Pedido del usuario del 2026-11-05: «veo que solo apilamos y demás sin dar orden o contar una historia». El panel apilaba
 * el estado y los chips de las banderas, las tarjetas, los datos y los procesos que puede pagar, sin decir qué pasó. Ahora
 * se lee como un relato (components/patrones/Relato.tsx), de arriba abajo:
 *
 *   el veredicto     quién le compró qué a quién, por cuánto y cuándo, y lo más grave que se encontró (`fraseOrden`);
 *   1. Qué pasó      las fechas de la orden con lo de antes que la explica, y cada señal en el paso donde ocurre
 *                    (`pasosOrden`): la sanción del Tribunal antes, la orden destacada, las demás órdenes de ese día;
 *   2. Por qué llama la atención   las tarjetas con su evidencia, de la más grave a la más leve;
 *   3. Qué proceso paga            si la orden dice pagar uno;
 *   4. Los datos de la orden       la referencia: las fichas de la entidad y del proveedor, el expediente SIAF.
 *
 * Los chips que indexaban las banderas arriba se fueron: la frase dice la más grave (y cuántas más hay) y cada señal de la
 * cronología lleva a su tarjeta, así que eran un tercer lugar con lo mismo. Los capítulos se leen de a uno
 * (CapitulosRelato, sin ir a la URL de la lista): un enlace de la frase a un capítulo lo abre.
 */

/** Los ids de los capítulos del panel: las señales y la frase llevan a ellos sin salir del panel. */
const CAP = { quePaso: "orden-que-paso", porQue: "orden-por-que", proceso: "orden-proceso", datos: "orden-datos" } as const;

/** Un nombre en la frase o en un paso, con su ficha si la tiene (`fichasCompra`: nunca por un RUC 10). */
const enFrase = (nombre: string, href: string | null): ReactNode =>
  href ? (
    <Link href={href} prefetch={false} className={CLASE_ENLACE_FRASE}>
      {nombre}
    </Link>
  ) : (
    nombre
  );

/** Qué se compró, para la frase: hasta unas 90 letras, cortado en una palabra (entero va en «Los datos de la orden»). */
function recortarFrase(t: string, max = 90): string {
  if (t.length <= max) return t;
  const c = t.slice(0, max);
  const corte = c.lastIndexOf(" ");
  return `${(corte > max * 0.6 ? c.slice(0, corte) : c).replace(/[\s,;:.(-]+$/, "")}…`;
}

const conMayuscula = (t: string) => t.charAt(0).toLocaleUpperCase("es") + t.slice(1);

/**
 * La primera oración del veredicto: «La Municipalidad de Ate le encargó a Juan P. «Servicio de limpieza» por S/ 30,000, el
 * 14 de agosto de 2026.» Le «compró» (orden de compra) o le «encargó» (de servicio), nunca le «pagó»: emitida,
 * comprometida o devengada, CONOSCE no dice si ya se pagó (eso, el girado, lo dice el expediente SIAF). Un monto con
 * posible error de carga va con su reserva.
 */
function fraseOrden(
  o: OrdenGeneral,
  d: {
    entidad: string | null;
    proveedor: string | null;
    fichas: { entidad: string | null; proveedor: string | null };
    compra: boolean;
    monto: string | null;
    dudoso: boolean;
  },
): ReactNode {
  const que = o.descripcion ? recortarFrase(oracion(o.descripcion)) : null;
  return (
    <>
      {d.entidad ? enFrase(d.entidad, d.fichas.entidad) : "La entidad"} le {d.compra ? "compró" : "encargó"} a{" "}
      {d.proveedor ? enFrase(d.proveedor, d.fichas.proveedor) : "su proveedor"}
      {que && ` «${que}»`}
      {d.monto && (
        <>
          {" por "}
          <span className="tabular-nums">{d.monto}</span>
          {d.dudoso && " (según CONOSCE: puede ser un error de carga)"}
        </>
      )}
      {o.fecha && `, el ${fechaLarga(o.fecha.slice(0, 10))}`}.
    </>
  );
}

/** El proceso de una orden de pago con su enlace: a su ficha en Vigía o, sin su OCID, a su búsqueda por código. */
function EnlaceProceso({ c }: { c: ProcesoCandidato }) {
  const nombre = c.nomenclatura?.trim() || `Proceso ${c.codigo}`;
  return c.ocid ? (
    <Link href={rutaContrato(c.ocid)} prefetch={false} className={cn(CLASE_ENLACE, "break-all font-mono")}>
      {nombre}
    </Link>
  ) : (
    // Sin su OCID en Vigía, su búsqueda por código en Contrataciones Abiertas (lib/fuentes.ts: con el código solo, el
    // proceso no abre).
    <EnlaceFuente href={busquedaOece(c.codigo)} className="break-all font-mono">
      {nombre}
    </EnlaceFuente>
  );
}

/** AAAA-MM-DD de una fecha que puede traer la hora; null si no es una fecha. */
const diaDe = (f: string | null | undefined) => (f && /^\d{4}-\d{2}-\d{2}/.test(f) ? f.slice(0, 10) : null);

/**
 * El paso de la buena pro del proceso que la orden paga (o puede pagar): el único que el proveedor ganó en la entidad, el
 * de lo adjudicado igual al monto de la orden o, si ninguno, el de la buena pro más reciente. Sin ninguno ganado, el paso
 * que falta: la orden dice pagar un proceso que no aparece.
 */
function pasoProceso(p: ProcesosPago): PasoRelato | null {
  if (p.total > 0 && !p.lista.length) return null;
  if (p.total === 0) {
    return {
      cuando: "En los 3 años anteriores",
      falta: true,
      titulo: "No figura ganando ningún proceso en la entidad",
      detalle: "La orden dice que paga uno: puede ser de antes de 2018, de un consorcio o un error de registro.",
    };
  }
  const primero = p.lista[0];
  const masReciente = () => p.lista.reduce((a, b) => ((b.buenaPro ?? "") > (a.buenaPro ?? "") ? b : a));
  const c = p.total === 1 || primero.mismoMonto ? primero : masReciente();
  const cual =
    p.total === 1 ? "el único en la entidad en los 3 años anteriores: el que esta orden paga"
    : c.mismoMonto ? "por el mismo monto de esta orden: el que más probablemente paga"
    : `el más reciente de los ${numero(p.total)} que esta orden puede pagar`;
  return {
    fecha: diaDe(c.buenaPro),
    cuando: "Sin fecha de buena pro",
    titulo: (
      <>
        Ganó el proceso <EnlaceProceso c={c} />, {cual}
      </>
    ),
    detalle: (
      <>
        {c.adjudicado != null ? (
          <>
            Le adjudicaron <span className="tabular-nums">{soles(c.adjudicado)}</span>.
          </>
        ) : (
          "Sin monto adjudicado en soles."
        )}
        {p.total > 1 && (
          <>
            {" El SEACE no dice cuál paga: "}
            <a href={`#${CAP.proceso}`} className={CLASE_ENLACE_FRASE}>
              los candidatos, en «Qué proceso paga»
            </a>
            .
          </>
        )}
      </>
    ),
  };
}

/**
 * «Qué pasó»: los pasos de la orden en el orden en que pasaron, con lo de antes que la explica y cada señal pegada al paso
 * donde ocurre, como chip que lleva a su tarjeta. Antes, por fecha: la sanción del Tribunal (si ya regía al emitirse) y la
 * buena pro del proceso que paga. La orden, destacada, con las señales de la orden y del proveedor (el parentesco, la
 * inhabilitación, el tope). El mismo día, las demás órdenes de la compra partida. Después, la notificación y el
 * compromiso; al final, lo que CONOSCE dice sin fecha (el devengado) y el pago, que no publica: está en el expediente SIAF.
 */
function pasosOrden(
  o: OrdenGeneral,
  banderas: BanderaOrden[],
  extra: Antecedente[],
  d: { clase: string; monto: string | null },
): PasoRelato[] {
  const senal = (b: BanderaOrden): SenalPaso => ({ severidad: b.severidad, texto: b.chip, href: `#${b.id}` });
  const emitida = diaDe(o.fecha);
  // Lo de antes sólo si es de antes (o del mismo día): la regla de las dos fuentes ya lo asegura, esto lo cuida.
  const deAntes = (f: string | null) => !f || !emitida || f <= emitida;

  const antes: PasoRelato[] = [];
  const i = o.inhabilitacion;
  const desde = diaDe(i?.desde);
  if (i && desde && deAntes(desde)) {
    const partes = [i.resolucion ? `resolución ${i.resolucion}` : "", hastaCuando(i).trim()].filter(Boolean);
    antes.push({
      fecha: desde,
      titulo: "El Tribunal de Contrataciones inhabilitó al proveedor para contratar con el Estado",
      detalle: partes.length ? `${conMayuscula(partes.join(", "))}.` : undefined,
    });
  }
  const proceso = o.procesosPago ? pasoProceso(o.procesosPago) : null;
  if (proceso && deAntes(proceso.fecha ?? null)) antes.push(proceso);
  // Por fecha; lo que no tiene (el proceso que no aparece), primero.
  antes.sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? ""));

  // Cómo se contrató y, si quedó al borde del tope, a cuánto: «Hasta 8 UIT, sin concurso: el 97.3 % del tope de su año».
  const tipo = tipoContratacion(o.tipoContratacion)?.corto ?? null;
  const tope = o.alBorde?.tope;
  const borde = tope != null && o.monto != null ? `el ${parteDelTope(o.monto, tope)} del tope de su año (${soles(tope)})` : null;
  const como = tipo && borde ? `${tipo}: ${borde}.` : tipo ? `${tipo}.` : borde ? `${conMayuscula(borde)}.` : null;
  // (Una fecha de emisión futura lleva su bandera en el veredicto y en los datos: aquí sería la tercera.)
  const orden: PasoRelato = {
    fecha: emitida,
    cuando: "Sin fecha de emisión",
    destacado: true,
    titulo: `La entidad emitió la ${d.clase.toLocaleLowerCase("es")}${d.monto ? ` por ${d.monto}` : ""}`,
    detalle: como ?? undefined,
    // Las de la orden y del proveedor van en la orden; la compra partida, en el paso de las demás órdenes de ese día. Las
    // que suma otra fuente (components/compras) no tienen tarjeta: van sin enlace.
    senales: [
      ...banderas.filter((b) => b.tipo !== "fraccionamiento").map(senal),
      ...extra.map((a): SenalPaso => ({ severidad: a.severidad, texto: a.chip })),
    ],
  };

  const mismoDia: PasoRelato[] = [];
  const f = o.fraccionamiento;
  const bf = banderas.find((b) => b.tipo === "fraccionamiento");
  if (f && bf) {
    mismoDia.push({
      fecha: emitida,
      cuando: "Ese mismo día",
      titulo: `La entidad le emitió ${otrasDelDia(f)}`,
      detalle:
        `Con ésta suman ${soles(f.total)}: más que el tope de 8 UIT de ese año (${soles(f.tope)}).` +
        (f.mismaDescripcion ? " Todas dicen lo mismo." : ""),
      senales: [senal(bf)],
    });
  }

  const despues: PasoRelato[] = [];
  const notificada = diaDe(o.fechaNotificacion);
  if (notificada) despues.push({ fecha: notificada, titulo: "Le notificó la orden al proveedor" });
  const compromiso = diaDe(o.fechaCompromiso);
  const tituloCompromiso = (
    <>
      Separó el presupuesto para pagarla (compromiso) <AyudaTermino clave="compromiso-presupuestal" />
    </>
  );
  if (compromiso) despues.push({ fecha: compromiso, titulo: tituloCompromiso });
  despues.sort((a, b) => (a.fecha ?? "").localeCompare(b.fecha ?? ""));

  // Lo que CONOSCE dice sin fecha: el estado de la orden y, siempre, que el pago no consta ahí.
  const estado = o.estado?.toLowerCase();
  const sinFecha = "Sin fecha en CONOSCE";
  const alFinal: PasoRelato[] = [];
  if (estado === "devengada") {
    alFinal.push({ cuando: sinFecha, titulo: "Reconoció que el proveedor cumplió y que le debe el pago (devengado)" });
  } else if (estado === "comprometida" && !compromiso) {
    alFinal.push({ cuando: sinFecha, titulo: tituloCompromiso });
  }
  const conSiaf = !!(o.entidadRuc && o.fecha && o.numero);
  alFinal.push({
    cuando: sinFecha,
    falta: true,
    titulo: "El pago al proveedor (girado)",
    detalle: conSiaf ? (
      <>
        CONOSCE no dice si ya se pagó: lo dice el{" "}
        <a href={`#${CAP.datos}`} className={CLASE_ENLACE_FRASE}>
          expediente SIAF, en los datos de la orden
        </a>
        .
      </>
    ) : (
      "CONOSCE no dice si ya se pagó."
    ),
  });

  return [...antes, orden, ...mismoDia, ...despues, ...alFinal];
}

/**
 * Cuando la lista se acotó a las órdenes más recientes (una búsqueda de texto, o filtros que pedían recorrer cientos de
 * miles de órdenes de una entidad grande), lo dice: cuántas se revisaron y cómo ver el resto (un año acota la búsqueda).
 */
function textoRevisadas(revisadas: number, anio: number | null): string {
  return `Con estos filtros, Vigía revisó las ${numero(revisadas)} órdenes más recientes${anio ? ` de ${anio}` : ""}: puede haber más antes. ` +
    (anio ? "Quita un filtro o acorta la búsqueda para ver más." : "Elige un año para buscar en todo ese año.");
}

/** Por qué una orden va en otra moneda y no se suma: junto a su monto, en el panel. */
function AyudaOtraMoneda({ nombre }: { nombre: string }) {
  return (
    <Ayuda titulo="¿Por qué en otra moneda?">
      CONOSCE publica esta orden en {nombre}: por lo general, una compra en el extranjero. Vigía la muestra en su moneda, sin
      convertirla a soles, y no la suma a ningún total en soles.
    </Ayuda>
  );
}

/**
 * El monto de una orden en el panel, en soles o en su moneda («CAD 7,445, en dólares canadienses»), con el porqué de
 * la otra moneda a un clic. `tal como lo publicó CONOSCE`: el de una orden con posible error de carga.
 */
function datoMonto(o: OrdenGeneral, etiqueta: string, posibleError = false): DatoClave {
  const { texto, moneda } = montoOrden(o);
  const valor = !texto ? null : posibleError ? `${texto}, tal como lo publicó CONOSCE` : moneda ? `${texto}, en ${moneda.nombre}` : texto;
  return { etiqueta, valor, mono: true, ayuda: moneda ? <AyudaOtraMoneda nombre={moneda.nombre} /> : undefined };
}

/** Lo que la lista de compras (components/compras) le suma a la fila de una lista: banderas, datos y bloques del panel. */
export interface ExtraFila {
  antecedentes?: Antecedente[];
  /** Datos que van primero en la fila (cómo se compró). */
  meta?: ReactNode[];
  bloques?: ReactNode;
  /** El nombre que ya dice la ficha (la entidad en la suya, el proveedor en la de una empresa): no se repite en la fila. */
  ocultar?: "entidad" | "proveedor";
}

/** Un dato del panel en la rejilla de dos columnas: `ancho` lo pone a lo ancho de las dos (si no se dice, un texto largo). */
type Par = DatoClave & { ancho?: boolean };

/**
 * Los datos de la orden en pares etiqueta → valor, en dos columnas cuando el panel tiene el ancho (container query): la
 * etiqueta arriba y chica, como «Datos del contrato» de un contrato menor. Pedido del usuario del 2026-11-05: el panel
 * era una lista de once renglones de etiqueta y valor (con el estado repetido del chip de arriba) y las banderas quedaban
 * debajo de todo. Un valor largo (qué se pagó, la entidad, el proveedor, el botón del expediente) va a lo ancho y los
 * cortos llenan los huecos (`grid-flow-row-dense`). Sin valor, «Sin dato».
 */
function DatosCompactos({ items }: { items: (Par | null | false | undefined)[] }) {
  const lista = items.filter((d): d is Par => !!d);
  return (
    <div className="rounded-xl border border-line px-3.5 py-3 [container-type:inline-size]">
      <dl className="grid gap-x-5 gap-y-3 [@container(min-width:22rem)]:grid-flow-row-dense [@container(min-width:22rem)]:grid-cols-2">
        {lista.map((d) => {
          const ancho = d.ancho ?? (typeof d.valor === "string" && d.valor.length > 48);
          return (
            <div key={d.etiqueta} className={cn("min-w-0", ancho && "[@container(min-width:22rem)]:col-span-2")}>
              <dt className="flex items-center gap-1 text-rotulo text-mute">
                {d.etiqueta}
                {d.ayuda}
              </dt>
              <dd className={cn("mt-0.5 break-words text-dato leading-snug text-ink", d.mono && "font-mono text-meta tabular-nums")}>
                {d.valor == null || d.valor === "" ? <span className="text-mute">Sin dato</span> : d.valor}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/** Un proceso que la orden puede estar pagando: su nomenclatura (a su ficha), de qué trata, su buena pro y lo adjudicado. */
function FilaProcesoCandidato({ c }: { c: ProcesoCandidato }) {
  return (
    <li className="space-y-1 px-3 py-2.5">
      <p className="text-meta">
        <EnlaceProceso c={c} />
      </p>
      {c.descripcion && <p className="line-clamp-2 text-meta leading-snug text-inkSoft">{oracion(c.descripcion)}</p>}
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-rotulo text-inkSoft">
        {c.buenaPro && <Dato tipo="fecha" nombre="Buena pro">Buena pro el {fechaConAnio(c.buenaPro)}</Dato>}
        <Dato icono={Banknote} nombre="Adjudicado">
          {c.adjudicado != null ? (
            <>
              Adjudicado: <Monto n={c.adjudicado} />
            </>
          ) : (
            "Adjudicado: sin monto en soles"
          )}
        </Dato>
        {c.mismoMonto && <span className="pill border-line bg-paperSoft font-semibold text-ink">Mismo monto que la orden</span>}
      </p>
    </li>
  );
}

/**
 * Qué proceso paga una orden «Deviene de procesos de selección…» (GET /ordenes y las filas de /compras, `procesosPago`).
 * Pedido del usuario del 2026-11-05: decía «Paga uno de los 5 procesos que esta empresa ganó en la entidad en los 3 años
 * anteriores: el SEACE no dice cuál» sin nombrar ninguno. Ahora los nombra, del más cercano a la orden al más lejano (el de
 * lo adjudicado igual al monto, los que alcanzan para pagarla, la buena pro más reciente), cada uno a su ficha; con más de
 * ocho, a todos los procesos que ganó en la entidad (sólo una empresa: el RUC 10 no va en un enlace). Es el capítulo
 * «Qué proceso paga» del panel: el título y su ⓘ (`AyudaProcesoPagado`) los pone el capítulo; antes, un BloqueDetalle.
 */
function ProcesoPagado({ o, p }: { o: OrdenGeneral; p: ProcesosPago }) {
  const empresa = esEmpresa(o.rucContratista) ? o.rucContratista : null;
  const quien = empresa ? "esta empresa" : "este proveedor";
  const todos = empresa && o.entidadRuc && p.total > p.lista.length
    ? `/entidad/${o.entidadRuc}?${new URLSearchParams({ seccion: "contratos", [P_COMPRAS.con]: empresa, [P_COMPRAS.como]: "proceso" })}`
    : null;
  return (
    <div>
      {p.total === 0 ? (
        <p className="text-inkSoft">
          La orden dice que paga un proceso de selección, pero {quien} no figura ganando ninguno en la entidad en los 3 años
          anteriores: puede ser de antes de 2018, de un consorcio o un error de registro.
        </p>
      ) : (
        <>
          <p className="text-inkSoft">
            {p.total === 1
              ? `Paga este proceso: es el único que ${quien} ganó en la entidad en los 3 años anteriores a la orden.`
              : `Paga uno de los ${numero(p.total)} procesos que ${quien} ganó en la entidad en los 3 años anteriores: el SEACE no dice cuál. ${
                  p.total > p.lista.length ? `Estos son los ${numero(p.lista.length)} más cercanos a la orden` : "Van del más cercano a la orden al más lejano"
                }, por monto y por fecha de la buena pro.`}
          </p>
          <ol className="mt-2 divide-y divide-line/70 rounded-xl border border-line" aria-label="Los procesos que puede pagar">
            {p.lista.map((c) => (
              <FilaProcesoCandidato key={c.codigo} c={c} />
            ))}
          </ol>
          {p.total > p.lista.length &&
            (todos ? (
              <Link href={todos} prefetch={false} className={cn(CLASE_ENLACE, "mt-2 inline-flex min-h-8 items-center text-meta")}>
                Ver todos los procesos que ganó en la entidad
              </Link>
            ) : (
              <p className="mt-1.5 text-meta text-mute">Y {plural(p.total - p.lista.length, "proceso más", "procesos más")}.</p>
            ))}
        </>
      )}
      <FuenteDato fuente="OECE, CONOSCE: adjudicaciones" href={CONOSCE_BUSCADOR} className="mt-2" />
    </div>
  );
}

/** Cómo se sabe qué proceso paga una orden: el ⓘ del título del capítulo. */
function AyudaProcesoPagado() {
  return (
    <Ayuda titulo="¿Cómo se sabe qué proceso paga?">
      El SEACE no dice a qué proceso pertenece una orden de pago. Vigía busca los procesos que el proveedor ganó en la
      entidad en los 3 años anteriores a la orden (CONOSCE, adjudicaciones): con uno solo, es ése; con varios, puede ser
      cualquiera. Van primero el de lo adjudicado igual al monto de la orden y los que alcanzan para pagarla; después, de la
      buena pro más reciente a la más antigua.
    </Ayuda>
  );
}

/**
 * La fila de una orden con su panel: la de esta lista y la de la lista de compras de una ficha (que le suma lo suyo en
 * `extra`). «Ver sólo las de esta entidad / de este proveedor», sólo en la lista general (/app/contratos).
 *
 * El panel cuenta la orden (pedido del usuario del 2026-11-05: «contar una historia», ver «El panel de una orden como
 * relato»): el veredicto en una frase; 1. Qué pasó, la cronología con las señales en su paso; 2. Por qué llama la
 * atención, las tarjetas de las banderas con su evidencia (o, sin ninguna, una línea que lo dice); 3. Qué proceso paga, si
 * es pago de uno; 4. Los datos de la orden, en dos columnas (`DatosCompactos`, con el expediente SIAF como un dato más) y
 * lo que suma la otra fuente; al pie, la fuente.
 */
export function filaOrden(o: OrdenGeneral, i: number, { ruta, parametros }: { ruta: string; parametros: Parametros }, extra?: ExtraFila): Fila {
  const enGeneral = ruta === "/app/contratos";
  const motivo = o.montoDudoso != null ? motivoDudoso(o.dudosoMotivo) ?? "mayor_100m" : null;
  // En soles o, si CONOSCE la publica en otra moneda, en la suya («CAD 7,445», con el nombre debajo): nunca convertida
  // ni sumada a los soles (pedido del usuario del 2026-11-05: esas órdenes no salían en ninguna lista).
  const { texto: montoTexto, moneda } = montoOrden(o);
  const tipo = tipoContratacion(o.tipoContratacion);
  const entidad = o.entidad ? tituloNatural(o.entidad) : null;
  const proveedor = o.contratista ? tituloNatural(o.contratista) : null;
  const descripcion = o.descripcion ? oracion(o.descripcion) : "Sin descripción";
  const clase = o.tipoOrden && /compra/i.test(o.tipoOrden) ? "Orden de compra" : "Orden de servicio";
  const explicaEstado = o.estado ? ESTADO_ORDEN[o.estado.toLowerCase()] : undefined;
  const estado = <EstadoCompra estado={o.estado} explica={explicaEstado} />;
  const extraAntecedentes = extra?.antecedentes ?? [];
  const antecedentes = [...antecedentesOrden(o), ...extraAntecedentes];
  // Las mismas banderas como tarjetas del panel, con su evidencia (las de `extra`, sólo como chip).
  const banderas = banderasDeOrden(o);
  const rucEmpresa = esEmpresa(o.rucContratista) ? o.rucContratista : null;
  const soloEntidad = enGeneral && o.entidadRuc && parametros[P_ORD.entidad] !== o.entidadRuc
    ? hrefConFiltro(ruta, parametros, P_ORD.page, { [P_ORD.entidad]: o.entidadRuc }) : null;
  const soloProveedor = enGeneral && /^20\d{9}$/.test(o.rucContratista ?? "") && parametros[P_ORD.proveedor] !== o.rucContratista
    ? hrefConFiltro(ruta, parametros, P_ORD.page, { [P_ORD.proveedor]: o.rucContratista! }) : null;
  const fichas = fichasCompra(ruta, o.entidadRuc, o.rucContratista, o.personaCodigo);
  // El veredicto: lo más grave de las banderas (y de lo que suma otra fuente) le da el tono y su segunda oración; las demás
  // se cuentan al pie. Sin ninguna, el veredicto es neutro: sólo qué pasó.
  const rango = { alta: 0, media: 1, baja: 2 } as const;
  const hallazgos = [
    ...banderas.map((b) => ({ severidad: b.severidad, frase: b.frase })),
    ...extraAntecedentes.map((a) => ({ severidad: a.severidad, frase: /[.!?]$/.test(a.explica) ? a.explica : `${a.explica}.` })),
  ].sort((a, b) => rango[a.severidad] - rango[b.severidad]);
  const grave = hallazgos[0] ?? null;
  const resto = hallazgos.length - 1;
  const masSenales = resto === 1 ? "Hay una señal más" : `Hay ${numero(resto)} señales más`;
  const pieFrase = grave ? (
    <>
      {resto > 0 ? `${masSenales}; todas, con su evidencia, en «` : "La evidencia, en «"}
      <a href={`#${CAP.porQue}`} className={CLASE_ENLACE_FRASE}>
        Por qué llama la atención
      </a>
      {`». ${resto > 0 ? "Son datos para revisar, no acusaciones." : "Es un dato para revisar, no una acusación."}`}
    </>
  ) : undefined;
  const pasos = pasosOrden(o, banderas, extraAntecedentes, { clase, monto: montoTexto });
  // «Qué proceso paga» es el capítulo 3 sólo si la orden paga un proceso; si no, los datos suben al 3.
  return {
    id: `${o.orden ?? i}-${o.fecha}-${o.entidadRuc}`,
    // Lo que dice cada celda, para quitar la columna que dice lo mismo en toda la página (`colapsarIguales`). Sin texto
    // (la columna se queda): la que lleva una bandera (posible error, fecha futura) o banderas de antecedentes.
    textos: {
      estado: motivo ? undefined : o.estado ? oracion(o.estado) : null,
      antecedentes: antecedentes.length ? undefined : o.conNepotismo == null ? null : "Ninguno",
      // Con otra moneda, sin texto: la celda lleva el nombre de la moneda debajo y «Monto de todas: CAD 155» lo perdería.
      monto: motivo || moneda ? undefined : montoTexto,
      fecha: esFutura(o.fecha) ? undefined : o.fecha ? fechaConAnio(o.fecha) : null,
    },
    celdas: {
      estado: (
        <span className="flex flex-col items-start gap-1">
          {estado}
          {motivo && <BanderaDato motivo={motivo} fuente="conosce_ordenes" />}
        </span>
      ),
      orden: (
        <CeldaPrincipal
          titulo={descripcion}
          dosLineas
          meta={[
            // El número PRIMERO: al final de la línea se recortaba («N.° 4504…», pedido del usuario del 2026-11-05). Sin
            // enlace: una orden no tiene ficha propia en Vigía (su panel es esta fila).
            o.numero && <CodigoFila key="numero" codigo={`N.° ${o.numero}`} nombre="Número de orden" />,
            ...(extra?.meta ?? []),
            extra?.ocultar !== "entidad" && entidad && <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
            extra?.ocultar !== "proveedor" && proveedor && <Dato key="prov" icono={Store} nombre="Proveedor">{proveedor}</Dato>,
            // Cómo se contrató («Hasta 8 UIT, sin concurso»): antes, en tres renglones bajo cada monto.
            tipo && <Dato key="como" icono={Scale} nombre="Cómo se contrató">{tipo.corto}</Dato>,
            <Dato key="tipo" tipo="tipo">{clase}</Dato>,
          ]}
        />
      ),
      // Sin el campo (una API anterior), no se sabe: «Sin dato», no «Ninguno».
      antecedentes: antecedentes.length ? <BanderasAntecedentes antecedentes={antecedentes} /> : <SinAntecedentes sinDato={o.conNepotismo == null} />,
      monto: <CeldaNumero sub={motivo ? "posible error de CONOSCE" : moneda?.nombre}>{montoTexto ?? "Sin dato"}</CeldaNumero>,
      fecha: <CeldaFechaCompra fecha={o.fecha} fuente={FUENTE_ORDEN} />,
    },
    detalle: {
      titulo: o.numero ? `${clase} N.° ${o.numero}` : clase,
      etiqueta: `Ver el detalle de la orden ${o.numero ?? ""}`.trim(),
      descripcion: entidad ?? undefined,
      contenido: (
        <CuerpoDetalle className="space-y-6">
          {/* El veredicto: qué pasó en una oración y, si hay, lo más grave en la segunda («…ya lo había inhabilitado»). */}
          <EnUnaFrase
            tono={grave?.severidad ?? "neutro"}
            datos={
              <>
                {montoTexto && (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Dato icono={Banknote} nombre="Monto" mono>{montoTexto}</Dato>
                    {motivo && <BanderaDato motivo={motivo} fuente="conosce_ordenes" />}
                  </span>
                )}
                {o.fecha && (
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <Dato tipo="fecha" nombre="Emitida" mono>{fechaConAnio(o.fecha)}</Dato>
                    {esFutura(o.fecha) && <FechaFutura fuente={FUENTE_ORDEN} />}
                  </span>
                )}
                <Dato tipo="tipo">{clase}</Dato>
                {tipo && <Dato icono={Scale} nombre="Cómo se contrató">{tipo.corto}</Dato>}
              </>
            }
            pie={pieFrase}
          >
            {fraseOrden(o, { entidad, proveedor, fichas, compra: clase === "Orden de compra", monto: montoTexto, dudoso: !!motivo })}
            {grave && ` ${grave.frase}`}
          </EnUnaFrase>

          {/* Los capítulos se leen de a uno («divídelo por subsecciones, menos scroll»): el panel ya no se baja entero. */}
          <CapitulosRelato
            url={false}
            nivel={3}
            etiqueta="Capítulos de la orden"
            capitulos={[
              {
                id: CAP.quePaso,
                titulo: "Qué pasó",
                contenido: <Cronologia pasos={pasos} etiqueta="Lo que pasó con esta orden, paso a paso" />,
              },
              // Sin señales, una línea (no una caja vacía): qué se revisó y que no salió nada.
              {
                id: CAP.porQue,
                titulo: hallazgos.length ? "Por qué llama la atención" : "Qué revisamos",
                conteo: hallazgos.length,
                tono: grave?.severidad,
                contenido: (
                  <>
                    {hallazgos.length ? (
                      <div className="space-y-3">
                        <TarjetasBanderas banderas={banderas} />
                        {/* Las que suma la otra fuente (components/compras) no tienen tarjeta aquí: van como chip. */}
                        {extraAntecedentes.length > 0 && (
                          <BanderasAntecedentes antecedentes={extraAntecedentes} todas etiqueta="Otras señales de esta compra" />
                        )}
                      </div>
                    ) : o.conNepotismo == null ? (
                      <p className="text-inkSoft">Esta orden llegó sin la revisión de sus antecedentes: no sabemos si tiene señales.</p>
                    ) : (
                      // Sólo lo que de verdad se revisa para este proveedor: el parentesco declarado, sólo en una persona (RUC 10).
                      <p className="text-inkSoft">
                        <span className="font-semibold text-ink">No encontramos señales en esta orden.</span>{" "}
                        {`Revisamos ${/^10\d{9}$/.test(o.rucContratista ?? "") ? "el parentesco con funcionarios de la entidad, " : ""}`}
                        la inhabilitación del Tribunal, las órdenes del mismo día y el tope de 8 UIT.
                      </p>
                    )}
                  </>
                ),
              },
              ...(o.procesosPago
                ? [
                    {
                      id: CAP.proceso,
                      titulo: "Qué proceso paga",
                      tituloLargo: (
                        <>
                          Qué proceso paga <AyudaProcesoPagado />
                        </>
                      ),
                      contenido: <ProcesoPagado o={o} p={o.procesosPago} />,
                    },
                  ]
                : []),
              {
                id: CAP.datos,
                titulo: "Los datos",
                tituloLargo: "Los datos de la orden",
                contenido: (
                    <div className="space-y-4">
                      {motivo && (
                        <AvisoDato motivo={motivo} fuente="conosce_ordenes">
                          {`La orden trae ${montoTexto ?? "un monto"} en el archivo oficial de CONOSCE.`}
                        </AvisoDato>
                      )}
                      <DatosCompactos
                        items={[
                          { etiqueta: clase === "Orden de compra" ? "Qué se compró" : "Qué se pagó", valor: descripcion, ancho: true },
                          { etiqueta: "Entidad", valor: conFicha(entidad, fichas.entidad), ancho: true },
                          {
                            etiqueta: "Proveedor",
                            valor: proveedor ? (
                              <>
                                {conFicha(proveedor, fichas.proveedor)}
                                {/* El RUC sólo de una empresa: el de una persona natural lleva su DNI. */}
                                {rucEmpresa && <span className="ml-2 whitespace-nowrap font-mono text-rotulo tabular-nums text-mute">RUC {rucEmpresa}</span>}
                              </>
                            ) : null,
                            ancho: true,
                          },
                          datoMonto(o, "Monto", !!motivo),
                          // Si tuvo convocatoria, en su ⓘ: antes era un renglón aparte de una oración entera.
                          {
                            etiqueta: "Cómo se contrató",
                            valor: tipo?.corto ?? null,
                            ayuda: tipo?.convocatoria ? <Ayuda titulo="¿Tuvo convocatoria?">{tipo.convocatoria}</Ayuda> : undefined,
                          },
                          datoFecha("Emitida", o.fecha, FUENTE_ORDEN),
                          // El estado vuelve aquí: su chip de arriba del panel se fue con el índice de las banderas.
                          {
                            etiqueta: "Estado",
                            valor: o.estado ? oracion(o.estado) : null,
                            ayuda: explicaEstado ? (
                              <Ayuda titulo="¿Qué dice el estado?">{`${explicaEstado} Ningún estado de CONOSCE quiere decir que ya se pagó.`}</Ayuda>
                            ) : undefined,
                          },
                          o.fechaNotificacion ? { etiqueta: "Notificada al proveedor", valor: fechaConAnio(o.fechaNotificacion), mono: true } : null,
                          o.fechaCompromiso
                            ? { etiqueta: "Compromiso presupuestal", valor: fechaConAnio(o.fechaCompromiso), mono: true, ayuda: <AyudaTermino clave="compromiso-presupuestal" /> }
                            : null,
                          o.objeto ? { etiqueta: "Bien, servicio u obra", valor: tituloNatural(o.objeto) } : null,
                          // El botón del expediente, como un dato más (antes, un bloque con título para un solo botón).
                          o.entidadRuc && o.fecha && o.numero
                            ? {
                                etiqueta: "Expediente SIAF",
                                valor: <ExpedienteSiaf entidadRuc={o.entidadRuc} fecha={o.fecha} compra={clase === "Orden de compra"} numero={o.numero} />,
                                ayuda: <AyudaTermino clave="expediente-siaf" />,
                                ancho: true,
                              }
                            : null,
                        ]}
                      />
                      {extra?.bloques}
                      {(soloEntidad || soloProveedor) && (
                        <div className="flex flex-wrap gap-2">
                          {soloEntidad && (
                            <EnlaceAccion href={soloEntidad} prefetch={false} variante="secundario">
                              <ListFilter size={15} aria-hidden />
                              Ver sólo las órdenes de esta entidad
                            </EnlaceAccion>
                          )}
                          {soloProveedor && (
                            <EnlaceAccion href={soloProveedor} prefetch={false} variante="secundario">
                              <ListFilter size={15} aria-hidden />
                              Ver sólo las órdenes de este proveedor
                            </EnlaceAccion>
                          )}
                        </div>
                      )}
                    </div>
                ),
              },
            ]}
          />
        </CuerpoDetalle>
      ),
      // Una orden no tiene página propia en el OECE: el buscador de CONOSCE la encuentra por entidad y número.
      pie: (
        <FuenteDato
          fuente={`OECE, CONOSCE, órdenes de compra y de servicio${o.orden ? ` (${o.orden})` : ""}`}
          enlaces={[{ texto: "Buscador de CONOSCE (OECE): búscala por entidad y número", href: CONOSCE_BUSCADOR }]}
        />
      ),
    },
  };
}

/**
 * La orden del SEACE de una compra que vino de otra fuente (un catálogo de Perú Compras, un contrato menor): su número, su
 * estado y su compromiso, el botón de su expediente SIAF y sus antecedentes con la evidencia. En el panel de la lista de
 * compras: la misma compra, vista desde el registro de órdenes del Estado.
 */
export function BloqueOrdenSeace({ o, titulo = "La orden en el SEACE" }: { o: OrdenGeneral; titulo?: string }) {
  const clase = o.tipoOrden && /compra/i.test(o.tipoOrden) ? "Orden de compra" : "Orden de servicio";
  const tipo = tipoContratacion(o.tipoContratacion);
  return (
    <>
      <BloqueDetalle titulo={titulo} ayuda={<AyudaTermino clave="orden-servicio" />}>
        <DatosClave
          items={[
            { etiqueta: "Número", valor: o.numero ? `${clase} N.° ${o.numero}` : clase, mono: true },
            datoFecha("Emitida", o.fecha, FUENTE_ORDEN),
            o.fechaCompromiso ? { etiqueta: "Compromiso presupuestal", valor: fechaConAnio(o.fechaCompromiso), mono: true, ayuda: <AyudaTermino clave="compromiso-presupuestal" /> } : null,
            { etiqueta: "Estado", valor: o.estado ? oracion(o.estado) : null },
            datoMonto(o, "Monto"),
            tipo ? { etiqueta: "Cómo la registró la entidad", valor: tipo.corto } : null,
          ].filter(Boolean) as DatoClave[]}
        />
        {o.entidadRuc && o.fecha && o.numero && (
          <div className="mt-3">
            <ExpedienteSiaf entidadRuc={o.entidadRuc} fecha={o.fecha} compra={clase === "Orden de compra"} numero={o.numero} />
          </div>
        )}
      </BloqueDetalle>
      {/* Sus banderas, como las del panel de una orden: una tarjeta cada una, con su evidencia. */}
      <TarjetasBanderas banderas={banderasDeOrden(o)} />
    </>
  );
}

export async function ListaOrdenes({
  pagina: p,
  ruta,
  parametros,
  actual,
  vacia,
  total = null,
}: {
  pagina: Promise<OrdenesPagina | null>;
  ruta: string;
  parametros: Parametros;
  actual: number;
  /**
   * La lista de una ficha (una entidad): lo que se muestra si no tiene ninguna orden sin filtros puestos, que no es lo
   * mismo que «ninguna con estos filtros». En la lista general siempre hay órdenes.
   */
  vacia?: ReactNode;
  /**
   * Cuántas órdenes tiene la lista sin contarla (las cifras precalculadas, GET /ordenes/resumen), para el paginador:
   * sólo cuando nada fuera de esas cifras la recorta (el año y la entidad). Si no llega, el paginador va sin total.
   */
  total?: Promise<number | null> | null;
}) {
  const [pagina, cuantas] = await Promise.all([p, (total ?? Promise.resolve(null)).catch(() => null)]);
  if (!pagina) {
    return (
      <EstadoError
        titulo="No pudimos cargar las órdenes"
        // `<a>` y no `<Link>`: reintentar es pedir la misma página otra vez al servidor, con los mismos filtros.
        accion={<a href={hrefPagina(ruta, parametros, P_ORD.page, actual)} className={CLASE_ACCION_LISTA}>Reintentar</a>}
      >
        Suele ser momentáneo: vuelve a intentarlo en unos segundos. Si se repite, elige un año o acorta la búsqueda.
      </EstadoError>
    );
  }
  // La lista se acotó y esta página es la última que salió: puede no ser el final de verdad.
  const acotada = pagina.revisadas != null && !pagina.hayMas ? textoRevisadas(pagina.revisadas, pagina.anio) : null;
  if (!pagina.data.length) {
    // Sin filtros de esta lista (no cuentan la pestaña, la vista ni el orden), no hay órdenes: lo dice la ficha.
    const filtrada = Object.entries(P_ORD).some(([k, param]) => k !== "orden" && k !== "page" && !!parametros[param]);
    if (vacia && !filtrada && actual <= 1) return <>{vacia}</>;
    // Una página que ya no existe (la lista cambió o se escribió a mano): hay órdenes, sólo que no tantas.
    return actual > 1 ? (
      <EstadoVacio
        compacto
        titulo="Esta página de la lista ya no tiene órdenes"
        accion={<Link href={hrefPagina(ruta, parametros, P_ORD.page, 1)} prefetch={false} className={CLASE_ACCION_LISTA}>Ir al principio de la lista</Link>}
      />
    ) : acotada ? (
      <EstadoVacio compacto titulo="Ninguna orden con estos filtros entre las más recientes">{acotada}</EstadoVacio>
    ) : (
      <EstadoVacio compacto titulo="Ninguna orden con estos filtros">Cambia el año, el tipo o la búsqueda, o quita un filtro.</EstadoVacio>
    );
  }
  const filas: Fila[] = pagina.data.map((o, i) => filaOrden(o, i, { ruta, parametros }));
  const tam = pagina.size || filas.length;
  const pag = (subir: boolean) => (
    <PaginadorHayMas
      ruta={ruta} parametros={parametros} paramPagina={P_ORD.page} actual={actual} tam={tam} enPagina={filas.length} hayMas={pagina.hayMas}
      subir={subir} sinTotal={!!acotada} total={cuantas}
    />
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Órdenes de compra y de servicio" colapsarIguales />
      {acotada && <Nota>{acotada}</Nota>}
      <div className="flex justify-end">{pag(true)}</div>
    </div>
  );
}
