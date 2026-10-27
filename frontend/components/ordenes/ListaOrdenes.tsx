import Link from "next/link";
import type { ReactNode } from "react";
import { ListFilter, Scale, Store, TriangleAlert } from "lucide-react";
import { Ayuda, AyudaTermino, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, Nota, type DatoClave } from "@/components/patrones";
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
import { enSeccion } from "@/components/contratos/filtros";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { BarraTope } from "@/components/charts/BarraTope";
import { IconoBandera } from "@/components/ui/IconoBandera";
import { Llamita } from "@/components/marca/Llamita";
import { AvisoDato, BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA, EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { PaginacionCursor } from "@/components/ui/PaginacionCursor";
import { TIPO_CRUCE } from "@/lib/cruces";
import { motivoDudoso } from "@/lib/datoDudoso";
import { fecha as fechaLarga, fechaCorta, hoyLima, listaY, numero, oracion, porcentaje, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { FUENTE_TEXTO, SENAL, tipoContratacion } from "@/lib/personas";
import {
  ANTECEDENTES_ORDEN,
  COMO_ORDEN,
  ESTADOS_ORDEN,
  MONTOS_ORDEN,
  P_ORD,
  type InhabilitacionProveedor,
  type OrdenFraccionada,
  type OrdenGeneral,
  type OrdenesPagina,
} from "@/lib/ordenes";

/**
 * Lista GENERAL de órdenes (subsección de Contratos). Clona la pestaña Órdenes de la ficha de empresa, pero sin RUC
 * fijo: añade el PROVEEDOR como dato de la fila, y pagina por `hayMas` (la API no cuenta el total del universo). Cada
 * orden abre su panel lateral; una orden es una compra directa (ver el ⓘ junto al título de la vista).
 *
 * Anatomía de fila, la de todo listado (§14.1): estado (chip; y la bandera de «posible error» si el monto no se puede
 * creer) · qué se compró, con entidad, proveedor, cómo se contrató y número · antecedentes · monto · emitida. Los
 * antecedentes son banderas de esa columna, cada una con su evidencia en el panel: el parentesco con un funcionario de la
 * entidad (nepotismo), las órdenes del mismo día que juntas pasan 8 UIT (fraccionamiento, con las órdenes de ese día) y
 * la inhabilitación del Tribunal vigente al emitirse (con su resolución).
 *
 * También exporta las piezas que comparte con la lista de contratos menores (components/menores): el chip de estado, la
 * fecha posterior a hoy, la celda sin antecedentes, el paginador por «hay más», la espera y la inhabilitación.
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

/** El valor de una fecha en el panel (`DatosClave`): la fecha, su bandera si es futura y el porqué a un clic. */
export function datoFecha(etiqueta: string, f: string | null | undefined, fuente: string): DatoClave {
  if (!esFutura(f)) return { etiqueta, valor: f ? fechaCorta(f) : null, mono: true };
  return {
    etiqueta,
    valor: (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        {fechaCorta(f)}
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
 * El paginador de una lista que sabe si «hay más» pero no cuántas son (la API no cuenta millones de filas): el kit de
 * cursor, con el tramo que se ve ("26–50") y, en la última página, el total que ya se sabe ("51–60 de 60"). Nunca
 * un «Página N» sin contexto ni un total inventado: `sinTotal` cuando la lista se acotó a las más recientes y la última
 * página no es el final de verdad.
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
}) {
  const desde = (actual - 1) * tam + 1;
  const hasta = desde + enPagina - 1;
  const texto = hayMas || sinTotal ? `${numero(desde)}–${numero(hasta)}` : `${numero(desde)}–${numero(hasta)} de ${numero(hasta)}`;
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

const COLUMNAS: Columna[] = [
  {
    clave: "estado", titulo: "Estado", ancho: "120px", desde: "md", apilar: true,
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
  { clave: "monto", titulo: "Monto", ancho: "116px", alinear: "der", desde: "md", apilar: "con-rotulo", ayuda: <AyudaTermino clave="uit" /> },
  { clave: "fecha", titulo: "Emitida", ancho: "104px", desde: "md", apilar: "con-rotulo" },
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

/** La evidencia de la inhabilitación en el panel: el periodo y la resolución, y cuándo se emitió o firmó. */
export function BloqueInhabilitacion({ i, cuando }: { i: InhabilitacionProveedor; cuando: string }) {
  return (
    <BloqueDetalle titulo="El proveedor estaba inhabilitado" ayuda={<AyudaTermino clave="inhabilitacion" />}>
      <p className="text-inkSoft">
        El Tribunal de Contrataciones del Estado lo inhabilitó {periodoInhabilitacion(i)}
        {i.resolucion ? ` (resolución ${i.resolucion})` : ""}. {cuando}, dentro de ese periodo.
      </p>
      <p className="mt-1.5 text-rotulo text-mute">Fuente: {FUENTE_TEXTO.osce_sancionados}. Es un dato para revisar, no una acusación.</p>
    </BloqueDetalle>
  );
}

/** Una señal de la persona por su tipo (las que llegan de la API y la web aún no conoce, no se muestran). */
const senalPersona = (tipo: string) => (SENAL as Record<string, { corto: string; titulo: string; explica: string } | undefined>)[tipo];

/** A qué porcentaje de su tope quedó la orden («96.8 %»). */
const parteDelTope = (monto: number, tope: number) => porcentaje((100 * monto) / tope, { decimales: 1 });

/** Los antecedentes de una orden, del más grave al más leve; cada uno con su evidencia en el panel. */
function antecedentesOrden(o: OrdenGeneral): Antecedente[] {
  const out: Antecedente[] = [];
  if (o.conNepotismo) out.push({ tipo: "nepotismo", severidad: "alta", chip: SENAL.nepotismo.corto, explica: SENAL.nepotismo.titulo });
  if (o.inhabilitacion) out.push(antecedenteInhabilitado(o.inhabilitacion, "Inhabilitado al emitirse"));
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
      chip: TIPO_CRUCE.fraccionamiento?.chip ?? "Pasan 8 UIT",
      explica: `Una de ${f.ordenes} órdenes que la entidad le emitió ese día: suman ${soles(f.total)}, más que el tope de 8 UIT (${soles(f.tope)}).`,
    });
  }
  const rango = { alta: 0, media: 1, baja: 2 } as const;
  return out.sort((a, b) => rango[a.severidad] - rango[b.severidad]);
}

/** De dónde sale cada señal de la persona, sin repetir: sólo las fuentes de las que están (las órdenes, siempre). */
function fuentesSenales(tipos: string[]): string[] {
  const f = new Set<string>();
  for (const t of tipos) {
    if (t === "financio_campana" || t === "aporte_gobierna") f.add("ONPE (aportes)");
    if (t === "candidato_gobierna" || t === "autoridad_contratada") f.add("JNE (candidaturas y autoridades)");
    if (t === "nepotismo_gobierno") f.add("Contraloría (declaraciones juradas de intereses)");
  }
  f.add("OECE (órdenes)");
  return [...f];
}

/**
 * Las señales de la persona (RUC 10) con la entidad que le dio la orden: qué se encontró, y, si la orden es una de las
 * que quedaron al borde del tope, a qué porcentaje. La evidencia de cada una (el aporte, la candidatura, las órdenes)
 * está en su ficha.
 */
function BloqueSenalesPersona({ o }: { o: OrdenGeneral }) {
  const senales = (o.senalesPersona ?? []).filter((s) => senalPersona(s.tipo));
  const borde = o.alBorde && o.monto != null ? o.alBorde : null;
  if (!senales.length && !borde) return null;
  return (
    <BloqueDetalle titulo="Lo que se sabe de esta persona con la entidad">
      <ul className="space-y-2.5">
        {senales.map((s) => {
          const def = senalPersona(s.tipo)!;
          return (
            <li key={s.tipo} className="flex gap-2">
              <IconoBandera tipo={s.tipo} size={15} className="mt-0.5 text-inkSoft" />
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{def.titulo}</span>
                <span className="block text-inkSoft">{def.explica}</span>
              </span>
            </li>
          );
        })}
        {borde && (
          <li className="flex gap-2">
            <IconoBandera tipo="al_borde_del_tope" size={15} className="mt-0.5 text-inkSoft" />
            <span className="min-w-0 flex-1 space-y-2">
              <span className="block font-semibold text-ink">{SENAL.al_borde_del_tope.titulo}</span>
              <span className="block text-inkSoft">
                Esta orden quedó en el {parteDelTope(o.monto!, borde.tope)} del tope de su año, como la mayoría de las que la entidad
                le dio. Puede ser casualidad o la forma de no hacer un proceso de selección.
              </span>
              <BarraTope monto={o.monto!} tope={borde.tope} />
            </span>
          </li>
        )}
      </ul>
      <p className="mt-2 text-rotulo text-mute">Fuente: {listaY(fuentesSenales(senales.map((s) => s.tipo)))}. Es un dato para revisar, no una acusación.</p>
      {o.personaCodigo && (
        <EnlaceAccion href={`/app/personas/${o.personaCodigo}?seccion=senales`} prefetch={false} variante="secundario" flecha className="mt-3">
          Ver la evidencia en su ficha
        </EnlaceAccion>
      )}
    </BloqueDetalle>
  );
}

/** Las órdenes del mismo día que juntas pasan 8 UIT, en el panel: cuántas, cuánto suman frente al tope y cada una. */
function BloqueFraccionamiento({ f, fecha }: { f: OrdenFraccionada; fecha: string | null }) {
  return (
    <BloqueDetalle titulo="Órdenes del mismo día que juntas pasan 8 UIT" ayuda={<AyudaTermino clave="fraccionamiento" />}>
      <p className="text-inkSoft">
        {fecha ? `El ${fechaLarga(fecha)}` : "Ese día"} la entidad le emitió {f.ordenes} órdenes que suman {soles(f.total)}: más que el tope de
        8 UIT de ese año ({soles(f.tope)}), el monto hasta el que se puede comprar sin concurso.
        {f.mismaDescripcion ? " Todas dicen lo mismo." : ""} Puede ser una compra partida para no hacer un proceso; no lo prueba.
      </p>
      <ul className="mt-2 space-y-1.5" aria-label="Las órdenes de ese día">
        {f.detalle.map((d) => (
          <li key={d.orden} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="min-w-0">
              <span className="font-mono text-rotulo text-ink">{d.orden}</span>
              {d.descripcion && <span className="block text-meta text-inkSoft">{oracion(d.descripcion)}</span>}
            </span>
            <span className="shrink-0 font-mono tabular-nums text-ink">{soles(d.monto)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-rotulo text-mute">Fuente: {FUENTE_TEXTO.conosce_ordenes}.</p>
    </BloqueDetalle>
  );
}

/**
 * Cuando la lista se acotó a las órdenes más recientes (una búsqueda de texto, o filtros que pedían recorrer cientos de
 * miles de órdenes de una entidad grande), lo dice: cuántas se revisaron y cómo ver el resto (un año acota la búsqueda).
 */
function textoRevisadas(revisadas: number, anio: number | null): string {
  return `Con estos filtros, Vigía revisó las ${numero(revisadas)} órdenes más recientes${anio ? ` de ${anio}` : ""}: puede haber más antes. ` +
    (anio ? "Quita un filtro o acorta la búsqueda para ver más." : "Elige un año para buscar en todo ese año.");
}

export async function ListaOrdenes({
  pagina: p,
  ruta,
  parametros,
  actual,
  vacia,
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
}) {
  const pagina = await p;
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
  // «Ver sólo las órdenes de esta entidad / de este proveedor»: sólo en la lista general (la de una ficha ya está anclada)
  // y para una empresa (el RUC 10 de una persona lleva su DNI: no va en un enlace).
  const enGeneral = ruta === "/app/contratos";
  const filas: Fila[] = pagina.data.map((o, i) => {
    const motivo = o.montoDudoso != null ? motivoDudoso(o.dudosoMotivo) ?? "mayor_100m" : null;
    const tipo = tipoContratacion(o.tipoContratacion);
    const entidad = o.entidad ? tituloNatural(o.entidad) : null;
    const proveedor = o.contratista ? tituloNatural(o.contratista) : null;
    const descripcion = o.descripcion ? oracion(o.descripcion) : "Sin descripción";
    const clase = o.tipoOrden && /compra/i.test(o.tipoOrden) ? "Orden de compra" : "Orden de servicio";
    const explicaEstado = o.estado ? ESTADO_ORDEN[o.estado.toLowerCase()] : undefined;
    const estado = <EstadoCompra estado={o.estado} explica={explicaEstado} />;
    const antecedentes = antecedentesOrden(o);
    const soloEntidad = enGeneral && o.entidadRuc && parametros[P_ORD.entidad] !== o.entidadRuc
      ? hrefConFiltro(ruta, parametros, P_ORD.page, { [P_ORD.entidad]: o.entidadRuc }) : null;
    const soloProveedor = enGeneral && /^20\d{9}$/.test(o.rucContratista ?? "") && parametros[P_ORD.proveedor] !== o.rucContratista
      ? hrefConFiltro(ruta, parametros, P_ORD.page, { [P_ORD.proveedor]: o.rucContratista! }) : null;
    return {
      id: `${o.orden ?? i}-${o.fecha}-${o.entidadRuc}`,
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
              entidad && <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
              proveedor && <Dato key="prov" icono={Store} nombre="Proveedor">{proveedor}</Dato>,
              // Cómo se contrató («Hasta 8 UIT, sin concurso»): antes, en tres renglones bajo cada monto.
              tipo && <Dato key="como" icono={Scale} nombre="Cómo se contrató">{tipo.corto}</Dato>,
              <Dato key="tipo" tipo="tipo">{clase}</Dato>,
              o.numero && <Dato key="numero" tipo="codigo" nombre="Número de orden" mono>{`N.° ${o.numero}`}</Dato>,
            ]}
          />
        ),
        // Sin el campo (una API anterior), no se sabe: «Sin dato», no «Ninguno».
        antecedentes: antecedentes.length ? <BanderasAntecedentes antecedentes={antecedentes} /> : <SinAntecedentes sinDato={o.conNepotismo == null} />,
        monto: <CeldaNumero sub={motivo ? "posible error de CONOSCE" : undefined}>{o.monto != null ? soles(o.monto) : "Sin dato"}</CeldaNumero>,
        fecha: <CeldaFechaCompra fecha={o.fecha} fuente={FUENTE_ORDEN} />,
      },
      detalle: {
        titulo: o.numero ? `${clase} N.° ${o.numero}` : clase,
        etiqueta: `Ver el detalle de la orden ${o.numero ?? ""}`.trim(),
        descripcion: entidad ?? undefined,
        contenido: (
          <CuerpoDetalle>
            <ChipsDetalle>
              {estado}
              {antecedentes.length > 0 && <BanderasAntecedentes antecedentes={antecedentes} todas />}
            </ChipsDetalle>
            {motivo && <AvisoDato motivo={motivo} fuente="conosce_ordenes">{`La orden trae ${soles(o.monto)} en el archivo oficial de CONOSCE.`}</AvisoDato>}
            <DatosClave
              items={[
                { etiqueta: clase === "Orden de compra" ? "Qué se compró" : "Qué se pagó", valor: descripcion },
                o.objeto ? { etiqueta: "Bien, servicio u obra", valor: tituloNatural(o.objeto) } : null,
                { etiqueta: "Entidad", valor: entidad },
                { etiqueta: "Proveedor", valor: proveedor },
                datoFecha("Emitida", o.fecha, FUENTE_ORDEN),
                o.fechaNotificacion ? { etiqueta: "Notificada al proveedor", valor: fechaCorta(o.fechaNotificacion), mono: true } : null,
                o.fechaCompromiso ? { etiqueta: "Compromiso presupuestal", valor: fechaCorta(o.fechaCompromiso), mono: true, ayuda: <AyudaTermino clave="compromiso-presupuestal" /> } : null,
                { etiqueta: "Estado", valor: o.estado ? oracion(o.estado) : null },
                { etiqueta: "Monto", valor: o.monto != null ? (motivo ? `${soles(o.monto)}, tal como lo publicó CONOSCE` : soles(o.monto)) : null, mono: true },
                { etiqueta: "Cómo se contrató", valor: tipo?.corto ?? null },
                tipo?.convocatoria ? { etiqueta: "¿Tuvo convocatoria?", valor: tipo.convocatoria } : null,
              ].filter(Boolean) as DatoClave[]}
            />
            {o.conNepotismo && (
              <BloqueDetalle titulo={SENAL.nepotismo.titulo}>
                <p className="text-inkSoft">{SENAL.nepotismo.explica}</p>
                <p className="mt-1.5 text-rotulo text-mute">Fuente: {FUENTE_TEXTO.dji_contraloria}.</p>
                {/* La evidencia: las personas de esta entidad con la señal, cada una con su declaración en su ficha. */}
                {o.entidadRuc && (
                  <EnlaceAccion href={`/entidad/${o.entidadRuc}?seccion=personas&psenal=nepotismo`} prefetch={false} variante="secundario" flecha className="mt-3">
                    Ver los casos en la ficha de la entidad
                  </EnlaceAccion>
                )}
              </BloqueDetalle>
            )}
            <BloqueSenalesPersona o={o} />
            {o.fraccionamiento && <BloqueFraccionamiento f={o.fraccionamiento} fecha={o.fecha} />}
            {o.inhabilitacion && <BloqueInhabilitacion i={o.inhabilitacion} cuando={o.fecha ? `La orden se emitió el ${fechaLarga(o.fecha)}` : "La orden se emitió"} />}
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
          </CuerpoDetalle>
        ),
        pie: <span className="text-rotulo text-mute">Fuente: OECE, CONOSCE, órdenes de compra y de servicio{o.orden ? ` (${o.orden})` : ""}</span>,
      },
    };
  });
  const tam = pagina.size || filas.length;
  const pag = (subir: boolean) => (
    <PaginadorHayMas ruta={ruta} parametros={parametros} paramPagina={P_ORD.page} actual={actual} tam={tam} enPagina={filas.length} hayMas={pagina.hayMas} subir={subir} sinTotal={!!acotada} />
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Órdenes de compra y de servicio" />
      {acotada && <Nota>{acotada}</Nota>}
      <div className="flex justify-end">{pag(true)}</div>
    </div>
  );
}
