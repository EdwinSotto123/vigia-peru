import Link from "next/link";
import { Scale, Store, TriangleAlert } from "lucide-react";
import { Ayuda, AyudaTermino, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, type DatoClave } from "@/components/patrones";
import {
  BarraFiltros,
  CeldaFecha,
  CeldaNumero,
  CeldaPrincipal,
  Tabla,
  TablaSkeleton,
  type Columna,
  type Fila,
  type Parametros,
} from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { Llamita } from "@/components/marca/Llamita";
import { AvisoDato, BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA, EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { PaginacionCursor } from "@/components/ui/PaginacionCursor";
import { motivoDudoso } from "@/lib/datoDudoso";
import { fecha as fechaLarga, fechaCorta, hoyLima, numero, oracion, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { FUENTE_TEXTO, SENAL, tipoContratacion } from "@/lib/personas";
import { P_ORD, type OrdenesPagina } from "@/lib/ordenes";

/**
 * Lista GENERAL de órdenes (subsección de Contratos). Clona la pestaña Órdenes de la ficha de empresa, pero sin RUC
 * fijo: añade el PROVEEDOR como dato de la fila, y pagina por `hayMas` (la API no cuenta el total del universo). Cada
 * orden abre su panel lateral; una orden es una compra directa (ver el ⓘ junto al título de la vista).
 *
 * Anatomía de fila, la de todo listado (§14.1): estado (chip; y la bandera de «posible error» si el monto no se puede
 * creer) · qué se compró, con entidad, proveedor, cómo se contrató y número · antecedentes del proveedor · monto ·
 * emitida. El parentesco con un funcionario (nepotismo) es una bandera de esa columna, con su evidencia en el panel;
 * antes era una píldora suelta en la fila y una caja ámbar en el panel, sin enlace.
 *
 * También exporta las piezas que comparte con la lista de contratos menores (components/menores): el chip de estado, la
 * fecha posterior a hoy, la celda sin antecedentes, el paginador por «hay más» y la espera.
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

/**
 * El paginador de una lista que sabe si «hay más» pero no cuántas son (la API no cuenta millones de filas): el kit de
 * cursor, con el tramo que se ve ("26–50") y, en la última página, el total que ya se sabe ("51–60 de 60"). Nunca
 * un «Página N» sin contexto ni un total inventado.
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
}: {
  ruta: string;
  parametros: Parametros;
  paramPagina: string;
  actual: number;
  tam: number;
  enPagina: number;
  hayMas: boolean;
  subir?: boolean;
}) {
  const desde = (actual - 1) * tam + 1;
  const hasta = desde + enPagina - 1;
  const texto = hayMas ? `${numero(desde)}–${numero(hasta)}` : `${numero(desde)}–${numero(hasta)} de ${numero(hasta)}`;
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
  { clave: "orden", titulo: "Orden", ancho: "minmax(0,1.8fr)" },
  {
    clave: "antecedentes", titulo: "Antecedentes del proveedor", corto: "Antecedentes", ancho: "minmax(0,0.8fr)", desde: "lg", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué antecedentes se revisan aquí?">
        Si el proveedor figura como pariente de un funcionario de la entidad que le dio la orden, según la Declaración
        Jurada de Intereses (Contraloría, Ley 31227). Es un indicio para revisar, no una acusación. Los demás registros
        del proveedor están en su ficha.
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Monto", ancho: "116px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "fecha", titulo: "Emitida", ancho: "104px", desde: "md", apilar: "con-rotulo" },
];

/** La barra de filtros de las órdenes: búsqueda, año (de los años disponibles), región y tipo; orden por fecha. */
export async function BarraOrdenesGeneral({ pagina, regiones = [] }: { pagina: Promise<OrdenesPagina | null>; regiones?: string[] }) {
  const anios = (await pagina)?.anios ?? [];
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
      ]}
      orden={{ param: P_ORD.orden, porDefecto: "reciente", opciones: [{ valor: "reciente", etiqueta: "Más recientes" }, { valor: "antiguo", etiqueta: "Más antiguas" }] }}
    />
  );
}

/** Mientras llega la página de órdenes. */
export function ListaOrdenesCargando() {
  return <ListaCargando texto="Cargando las órdenes…" columnas={COLUMNAS} />;
}

/** La bandera de nepotismo en la celda de antecedentes y en los chips del panel: la de toda bandera (CrucesCelda). */
function BanderaNepotismo() {
  return (
    <CrucesCelda
      cruces={[{ tipo: "nepotismo", severidad: "alta" }]}
      etiquetas={{ nepotismo: SENAL.nepotismo.corto }}
      explicaciones={{ nepotismo: SENAL.nepotismo.titulo }}
      etiquetaLista="Señales del proveedor"
    />
  );
}

export async function ListaOrdenes({ pagina: p, ruta, parametros, actual }: { pagina: Promise<OrdenesPagina | null>; ruta: string; parametros: Parametros; actual: number }) {
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
  if (!pagina.data.length) {
    // Una página que ya no existe (la lista cambió o se escribió a mano): hay órdenes, sólo que no tantas.
    return actual > 1 ? (
      <EstadoVacio
        compacto
        titulo="Esta página de la lista ya no tiene órdenes"
        accion={<Link href={hrefPagina(ruta, parametros, P_ORD.page, 1)} prefetch={false} className={CLASE_ACCION_LISTA}>Ir al principio de la lista</Link>}
      />
    ) : (
      <EstadoVacio compacto titulo="Ninguna orden con estos filtros">Cambia el año, el tipo o la búsqueda.</EstadoVacio>
    );
  }
  const filas: Fila[] = pagina.data.map((o, i) => {
    const motivo = o.montoDudoso != null ? motivoDudoso(o.dudosoMotivo) ?? "mayor_100m" : null;
    const tipo = tipoContratacion(o.tipoContratacion);
    const entidad = o.entidad ? tituloNatural(o.entidad) : null;
    const proveedor = o.contratista ? tituloNatural(o.contratista) : null;
    const descripcion = o.descripcion ? oracion(o.descripcion) : "Sin descripción";
    const clase = o.tipoOrden && /compra/i.test(o.tipoOrden) ? "Orden de compra" : "Orden de servicio";
    const explicaEstado = o.estado ? ESTADO_ORDEN[o.estado.toLowerCase()] : undefined;
    const estado = <EstadoCompra estado={o.estado} explica={explicaEstado} />;
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
        antecedentes: o.conNepotismo ? <BanderaNepotismo /> : <SinAntecedentes sinDato={o.conNepotismo == null} />,
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
              {o.conNepotismo && <BanderaNepotismo />}
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
          </CuerpoDetalle>
        ),
        pie: <span className="text-rotulo text-mute">Fuente: OECE, CONOSCE, órdenes de compra y de servicio{o.orden ? ` (${o.orden})` : ""}</span>,
      },
    };
  });
  const tam = pagina.size || filas.length;
  const pag = (subir: boolean) => (
    <PaginadorHayMas ruta={ruta} parametros={parametros} paramPagina={P_ORD.page} actual={actual} tam={tam} enPagina={filas.length} hayMas={pagina.hayMas} subir={subir} />
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Órdenes de compra y de servicio" />
      <div className="flex justify-end">{pag(true)}</div>
    </div>
  );
}
