import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Award, Landmark, Scale } from "lucide-react";
import { Ayuda, AyudaTermino, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, FuenteDato, type DatoClave } from "@/components/patrones";
import { BarraFiltros, CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila, type Parametros } from "@/components/listado";
import {
  BloqueOrdenSeace,
  EstadoCompra,
  ListaCargando,
  PaginadorHayMas,
  antecedentesOrden,
  conFicha,
  fichasCompra,
  filaOrden,
  filtroRuc,
  hrefPagina,
} from "@/components/ordenes/ListaOrdenes";
import { filaCatalogo } from "@/components/catalogo/ListaCatalogo";
import { filaMenor } from "@/components/menores/ListaMenores";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { DetalleContrato } from "@/components/contratos/DetalleContrato";
import { AvisoContrato, ConBanderaDato } from "@/components/contratos/DatoDudosoContrato";
import { EstadoContratoChip } from "@/components/contratos/estadoLectura";
import { PartidoQueGobierna } from "@/components/contratos/PartidoQueGobierna";
import { limpiarObjeto, recortar } from "@/components/contratos/recortar";
import { ETIQUETAS_SANCION, banderasDe, fraseSancion } from "@/components/empresas/secciones/contratos";
import { PersonName } from "@/components/Redact";
import { BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA, claseAccion } from "@/components/ui/EnlaceAccion";
import { esPersonaNatural, type ContratoResumen } from "@/lib/contratos";
import { motivoDudoso } from "@/lib/datoDudoso";
import { OBJETO_TEXTO, type ContratoEmpresa } from "@/lib/empresas";
import { fechaConAnio, numero, oracion, plural, porcentaje, soles } from "@/lib/formato";
import { CONOSCE_BUSCADOR, enlacesProceso } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { FUENTE_TEXTO } from "@/lib/personas";
import { rutaContrato } from "@/lib/rutas";
import {
  BANDERAS_COMPRA,
  CLASES_COMPRA,
  FILTROS_PROCESO,
  P_COMPRAS,
  claseCompra,
  type Compra,
  type ComprasPagina,
  type PagoProceso,
  type PagosProceso,
} from "@/lib/compras";

/**
 * Las compras de una entidad o las ventas de una empresa en UNA lista: una fila por compra, sin repetidas (GET /compras,
 * migración 240). Cada fila es un proceso de selección, una compra por el catálogo de Perú Compras, un contrato menor o
 * una orden sin concurso; su panel junta lo que dice cada registro de esa compra: el proceso con sus pagos, la orden del
 * catálogo con su orden del SEACE y su expediente SIAF, el contrato menor con su orden.
 *
 * Fila de todo listado (§14.1): estado (chip) · qué se compró, con la contraparte y cómo se compró · banderas · monto ·
 * fecha. Las filas y paneles son los de cada lista (components/ordenes, catalogo, menores y contratos), con lo que la
 * otra fuente suma (`ExtraFila`).
 */

const AYUDA_COMO = (
  <Ayuda titulo="¿Cómo se compra en el Estado?">
    {CLASES_COMPRA.map((c, i) => (
      <span key={c.valor} className={i ? "mt-2 block" : "block"}>
        <span className="font-semibold text-ink">{c.etiqueta}:</span> {c.explica}
      </span>
    ))}
    <span className="mt-2 block">
      Cada compra va una vez. Una compra por catálogo o un contrato menor también deja una orden en el SEACE, y un proceso de
      selección se paga con órdenes: esas órdenes van dentro de su compra, en su panel.
    </span>
  </Ayuda>
);

const AYUDA_BANDERAS = (
  <Ayuda titulo="¿Qué banderas se revisan?">
    <span className="block">Del precio: lo que pagó por un producto del catálogo frente a lo que pagaron las demás entidades.</span>
    <span className="mt-2 block">De quien ganó un proceso: aportes, candidaturas, sanciones, visitas, socios con otros postores.</span>
    <span className="mt-2 block">
      De la orden y su proveedor: parentesco con un funcionario, órdenes del mismo día que pasan 8 UIT, al borde del tope,
      inhabilitado por el Tribunal y lo que dice la SUNAT.
    </span>
    <span className="mt-2 block">Son indicios para revisar, no acusaciones: cada una lleva su evidencia en el panel.</span>
  </Ayuda>
);

const AYUDA_FECHA = (
  <Ayuda titulo="¿Qué fecha es?">
    La de cada compra en su registro: un proceso, cuando se convocó (en la ficha de una empresa, su buena pro); una compra
    por catálogo, cuando se publicó la orden; un contrato menor, cuando se firmó; una orden, cuando se emitió.
  </Ayuda>
);

const COLUMNAS: Columna[] = [
  { clave: "estado", titulo: "Estado", ancho: "120px", desde: "md", apilar: true },
  { clave: "compra", titulo: "Qué se compró", ancho: "minmax(0,1.8fr)", ayuda: AYUDA_COMO },
  { clave: "banderas", titulo: "Banderas", ancho: "minmax(0,0.9fr)", desde: "lg", apilar: true, ayuda: AYUDA_BANDERAS },
  { clave: "monto", titulo: "Monto", ancho: "128px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "fecha", titulo: "Fecha", ancho: "104px", desde: "md", apilar: "con-rotulo", ayuda: AYUDA_FECHA },
];

export function ListaComprasCargando() {
  return <ListaCargando texto="Cargando sus compras…" columnas={COLUMNAS} />;
}

/** El dato de la fila que dice cómo se compró. */
const datoComo = (c: Compra) => <Dato key="como" icono={Scale} nombre="Cómo se compró">{claseCompra(c.clase).etiqueta}</Dato>;

/** Las celdas de la fila de una lista con las claves de esta (cada lista llama distinto a sus columnas). */
function aColumnas(f: Fila, principal: string, banderas: string, monto = "monto", fecha = "fecha"): Fila {
  return { ...f, celdas: { estado: f.celdas.estado, compra: f.celdas[principal], banderas: f.celdas[banderas], monto: f.celdas[monto], fecha: f.celdas[fecha] } };
}

/** Una orden de pago en una línea: «O/C N.° 350, 3 mar. 2025, S/ 40,625, comprometida». */
function LineaPago({ p }: { p: PagoProceso }) {
  const clase = p.tipoOrden && /compra/i.test(p.tipoOrden) ? "O/C" : "O/S";
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <span className="min-w-0">
        <span className="font-mono text-rotulo text-ink">{p.numero ? `${clase} N.° ${p.numero}` : clase}</span>
        <span className="text-meta text-inkSoft">
          {p.fecha ? `, ${fechaConAnio(p.fecha)}` : ""}
          {p.estado ? `, ${p.estado.toLocaleLowerCase("es")}` : ""}
          {p.candidatos && p.candidatos > 1 ? `, puede ser de ${p.candidatos} procesos` : ""}
        </span>
      </span>
      <span className="shrink-0 font-mono tabular-nums text-ink">{p.monto != null ? soles(p.monto) : "Sin dato"}</span>
    </li>
  );
}

/**
 * Cómo se pagó un proceso: las órdenes del SEACE que sólo pueden ser de él y, aparte, las que pueden ser de él o de otro
 * proceso que la misma empresa ganó en la entidad (el SEACE no dice a qué proceso pertenece una orden: se reconoce por la
 * entidad, el ganador y la fecha).
 */
function BloquePagos({ pagos, conGanador, adjudicado: adjudicadoFila }: { pagos: PagosProceso | null | undefined; conGanador: boolean; adjudicado?: number | null }) {
  if (!conGanador) return null;
  const adjudicado = pagos?.adjudicado ?? adjudicadoFila ?? null;
  if (!pagos) {
    return (
      <BloqueDetalle titulo="Cómo se pagó">
        <p className="text-inkSoft">
          El SEACE no tiene órdenes que paguen este proceso: se pagó con un contrato escrito (que no pasa por el registro de
          órdenes), lo ganó un consorcio o todavía no se paga.
        </p>
      </BloqueDetalle>
    );
  }
  return (
    <BloqueDetalle titulo="Cómo se pagó" ayuda={<AyudaTermino clave="orden-servicio" />}>
      {pagos.total > 0 && (
        <>
          <p className="text-inkSoft">
            {pagos.total === 1 ? "La entidad registró en el SEACE una orden que paga este proceso" : `La entidad registró en el SEACE ${numero(pagos.total)} órdenes que pagan este proceso`}
            {pagos.pagado != null ? `: suman ${soles(pagos.pagado)}` : ""}
            {pagos.pagado != null && adjudicado ? `, el ${porcentaje((100 * pagos.pagado) / adjudicado, { decimales: 0 })} de lo adjudicado (${soles(adjudicado)})` : ""}.
          </p>
          <ul className="mt-2 space-y-1.5" aria-label="Las órdenes que pagan este proceso">
            {pagos.lista.map((p) => <LineaPago key={`${p.orden}-${p.fecha}`} p={p} />)}
          </ul>
          {pagos.total > pagos.lista.length && (
            <p className="mt-1.5 text-meta text-mute">Y {plural(pagos.total - pagos.lista.length, "orden más", "órdenes más")}.</p>
          )}
        </>
      )}
      {pagos.posibles && (
        <div className={pagos.total > 0 ? "mt-3" : undefined}>
          <p className="text-inkSoft">
            {pagos.posibles.n === 1 ? "Una orden" : `${numero(pagos.posibles.n)} órdenes`} a esta empresa en la entidad
            {pagos.posibles.n === 1 ? " puede" : " pueden"} pagar este proceso u otro de los que ganó ahí: el SEACE no dice cuál.
          </p>
          <ul className="mt-2 space-y-1.5" aria-label="Las órdenes que pueden pagar este proceso">
            {pagos.posibles.muestra.map((p) => <LineaPago key={`${p.orden}-${p.fecha}`} p={p} />)}
          </ul>
        </div>
      )}
      <FuenteDato fuente={FUENTE_TEXTO.conosce_ordenes} href={CONOSCE_BUSCADOR} className="mt-2" />
    </BloqueDetalle>
  );
}

/** La orden que no se encontró en el SEACE, en el panel de una compra que la debía tener. */
function SinOrdenSeace({ que }: { que: string }) {
  return (
    <BloqueDetalle titulo="La orden en el SEACE">
      <p className="text-inkSoft">
        La entidad no registró {que} en el SEACE con el mismo número ni el mismo monto (o todavía no llega el reporte del mes).
        Sin esa orden no se puede buscar su expediente SIAF.
      </p>
    </BloqueDetalle>
  );
}

/** El proceso en la ficha de una entidad: la fila de su lista de contratos, con sus pagos. */
function filaProcesoEntidad(c: ContratoResumen, compra: Compra): Fila {
  const titulo = c.titulo ? oracion(limpiarObjeto(c.titulo)) : "Sin objeto registrado";
  const montoTexto = compra.monto ? soles(compra.monto) : null;
  const ganador = c.proveedor ? (
    <Dato key="ganador" icono={Award} nombre="Ganador">
      Ganó {esPersonaNatural(c.proveedorRuc) ? <PersonName name={c.proveedor} orden="sunat" /> : c.proveedor}
    </Dato>
  ) : (
    <Dato key="ganador" icono={Award} nombre="Ganador">Sin ganador todavía</Dato>
  );
  return {
    id: compra.id,
    celdas: {
      estado: (
        <ConBanderaDato dato={c.datoDudoso}>
          <EstadoContratoChip c={c} />
        </ConBanderaDato>
      ),
      compra: (
        <CeldaPrincipal
          titulo={recortar(titulo, 160)}
          dosLineas
          meta={[datoComo(compra), ganador, c.gobierno ? <PartidoQueGobierna key="partido" g={c.gobierno} /> : null,
                 c.codigo ? <Dato key="codigo" tipo="codigo" nombre="Código del proceso" mono>{c.codigo}</Dato> : null]}
        />
      ),
      banderas: <CrucesCelda cruces={c.cruces} sinGanador={!c.proveedor} />,
      monto: <CeldaNumero sub={compra.adjudicado != null ? "adjudicado" : "valor referencial"}>{montoTexto ?? <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
      fecha: <CeldaFecha fecha={c.fecha?.slice(0, 10)} />,
    },
    detalle: {
      titulo,
      etiqueta: `Ver el resumen de ${titulo}`,
      descripcion: (
        <span className="flex flex-wrap items-baseline gap-x-3">
          <span className="font-mono">{c.codigo}</span>
          {c.fecha && <span className="tabular-nums">Convocado el {fechaConAnio(c.fecha.slice(0, 10))}</span>}
        </span>
      ),
      contenido: (
        <div className="space-y-4">
          <AvisoContrato dato={c.datoDudoso} />
          <DetalleContrato c={c} />
          <BloquePagos pagos={compra.pagos} conGanador={!!c.proveedor} adjudicado={compra.adjudicado} />
        </div>
      ),
      pie: (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FuenteDato fuente="registro OCDS del OECE (SEACE)" enlaces={enlacesProceso(c.ocid, { codigo: c.codigo })} />
          <Link href={rutaContrato(c.ocid)} prefetch={false} className={claseAccion("primario")}>
            Ver el dossier completo <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      ),
    },
  };
}

/** El proceso en la ficha de una empresa: lo que ganó (sola o en consorcio), con sus banderas y sus pagos. */
function filaProcesoEmpresa(c: ContratoEmpresa, compra: Compra, ruta: string): Fila {
  const entidad = c.entidad ? tituloNatural(c.entidad) : "Entidad no identificada";
  const titulo = c.descripcion ? oracion(c.descripcion) : c.nomenclatura ?? "Proceso sin descripción";
  const banderas = banderasDe(c);
  const fichas = fichasCompra(ruta, c.entidadRuc, null);
  const monto = c.monto != null ? soles(c.monto) : c.montoOtraMoneda != null ? `${numero(c.montoOtraMoneda)} ${c.otraMoneda ?? ""}`.trim() : null;
  const items: (DatoClave | null)[] = [
    { etiqueta: "Qué se contrató", valor: titulo },
    { etiqueta: "Entidad", valor: conFicha(entidad, fichas.entidad) },
    c.objeto ? { etiqueta: "Bien, servicio u obra", valor: OBJETO_TEXTO[c.objeto] ?? c.objeto } : null,
    c.familia && c.familia !== "Sin dato" ? { etiqueta: "Tipo de proceso", valor: c.familia } : null,
    c.nomenclatura ? { etiqueta: "Nomenclatura", valor: c.nomenclatura, mono: true } : null,
    c.fecha ? { etiqueta: "Buena pro", valor: fechaConAnio(c.fecha), mono: true } : null,
    { etiqueta: "Adjudicado", valor: monto ? `${monto}${c.consorcio ? ", de todo el consorcio" : ""} (${plural(c.items, "ítem", "ítems")})` : null, mono: true },
    c.consorcio ? { etiqueta: "Ganó en consorcio", valor: tituloNatural(c.consorcio) } : null,
  ];
  const sancion = fraseSancion(c.sancion);
  return {
    id: compra.id,
    celdas: {
      estado: <EstadoCompra estado="Adjudicado" explica="Se le dio la buena pro." />,
      compra: (
        <CeldaPrincipal
          titulo={titulo}
          dosLineas
          meta={[
            datoComo(compra),
            <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
            c.nomenclatura && <Dato key="codigo" tipo="codigo" mono>{c.nomenclatura}</Dato>,
            c.consorcio && <Dato key="consorcio" tipo="personas" nombre="Ganó en consorcio">{`En ${tituloNatural(c.consorcio)}`}</Dato>,
          ]}
        />
      ),
      banderas: (
        <span className="flex min-w-0 max-w-full flex-nowrap items-center gap-1" title={sancion}>
          {c.dudoso && <BanderaDato motivo={motivoDudoso(c.dudoso) ?? "adjudicado_20x"} fuente="conosce_ordenes" />}
          {(banderas.length > 0 || !c.dudoso) && <CrucesCelda cruces={banderas} etiquetas={ETIQUETAS_SANCION} />}
        </span>
      ),
      monto: <CeldaNumero sub={c.consorcio ? "de todo el consorcio" : "adjudicado"}>{monto ?? "Sin dato"}</CeldaNumero>,
      fecha: <CeldaFecha fecha={c.fecha} />,
    },
    detalle: {
      titulo,
      etiqueta: `Ver el resumen de ${titulo}`,
      descripcion: entidad,
      contenido: (
        <CuerpoDetalle>
          {banderas.length > 0 && (
            <ChipsDetalle>
              <CrucesCelda cruces={banderas} etiquetas={ETIQUETAS_SANCION} max={banderas.length} />
            </ChipsDetalle>
          )}
          <DatosClave items={items.filter(Boolean) as DatoClave[]} />
          {sancion && (
            <BloqueDetalle titulo="Sus sanciones frente a la buena pro" ayuda={<AyudaTermino clave="inhabilitacion" />}>
              <p className="text-inkSoft">{sancion}</p>
            </BloqueDetalle>
          )}
          <BloquePagos pagos={compra.pagos} conGanador adjudicado={c.monto} />
        </CuerpoDetalle>
      ),
      pie: (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FuenteDato fuente="OECE, CONOSCE, adjudicaciones" href={CONOSCE_BUSCADOR} />
          <Link href={rutaContrato(c.ocid ?? c.codigo)} prefetch={false} className={claseAccion("primario")}>
            Ver el dossier completo <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      ),
    },
  };
}

/** De qué proceso es un pago (sólo con una bandera de la orden: la lista sin filtros los muestra dentro del proceso). */
function BloquePagoDe({ c }: { c: Compra }) {
  const p = c.pagoDe;
  if (c.clase !== "pago") return null;
  return (
    <BloqueDetalle titulo="Qué proceso paga">
      {p?.codigo ? (
        <p className="text-inkSoft">
          Paga el proceso {p.titulo ? `«${oracion(p.titulo)}»` : p.codigo}
          {p.ocid && (
            <>
              {" "}
              <Link href={rutaContrato(p.ocid)} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
                (ver el proceso)
              </Link>
            </>
          )}
          .
        </p>
      ) : p && p.candidatos > 1 ? (
        <p className="text-inkSoft">
          Paga uno de los {p.candidatos} procesos que esta empresa ganó en la entidad en los 3 años anteriores: el SEACE no dice cuál.
        </p>
      ) : (
        <p className="text-inkSoft">
          La orden dice que paga un proceso de selección, pero esta empresa no figura ganando ninguno en la entidad en los 3
          años anteriores: puede ser de antes de 2018, de un consorcio o un error de registro.
        </p>
      )}
    </BloqueDetalle>
  );
}

/** La fila de una compra, con la de la lista de su fuente y lo que suman las demás. */
function filaDe(c: Compra, i: number, ctx: { ruta: string; parametros: Parametros; ancla: "entidad" | "proveedor" }): Fila | null {
  if (c.proceso) {
    return ctx.ancla === "entidad" ? filaProcesoEntidad(c.proceso as ContratoResumen, c) : filaProcesoEmpresa(c.proceso as ContratoEmpresa, c, ctx.ruta);
  }
  if (c.catalogo) {
    const f = filaCatalogo(c.catalogo, { ruta: ctx.ruta }, {
      meta: [datoComo(c)],
      ocultar: ctx.ancla === "entidad" ? "entidad" : "proveedor",
      antecedentes: c.orden ? antecedentesOrden(c.orden) : [],
      bloques: c.orden ? <BloqueOrdenSeace o={c.orden} /> : c.catalogo.estadoGrupo === "anulada" ? null : <SinOrdenSeace que="esta compra" />,
    });
    return { ...aColumnas(f, "orden", "precio"), id: c.id };
  }
  if (c.menor) {
    const f = filaMenor(c.menor, i, ctx, {
      meta: [datoComo(c)],
      ocultar: ctx.ancla === "entidad" ? "entidad" : "proveedor",
      antecedentes: c.orden ? antecedentesOrden(c.orden) : [],
      bloques: c.orden ? <BloqueOrdenSeace o={c.orden} /> : <SinOrdenSeace que="este contrato" />,
    });
    return { ...aColumnas(f, "contrato", "antecedentes"), id: c.id };
  }
  if (c.orden) {
    const f = filaOrden(c.orden, i, ctx, {
      ocultar: ctx.ancla === "entidad" ? "entidad" : "proveedor",
      bloques: (
        <>
          <BloquePagoDe c={c} />
          {c.clase === "catalogo" && (
            <BloqueDetalle titulo="Lo que compró">
              <p className="text-inkSoft">
                La entidad la registró como una compra por el catálogo electrónico, pero Perú Compras no tiene una orden con este
                número y monto: sin ella no se sabe qué productos compró ni a cuánto la unidad.
              </p>
            </BloqueDetalle>
          )}
        </>
      ),
    });
    return { ...aColumnas(f, "orden", "antecedentes"), id: c.id };
  }
  return null;
}

/** La barra: buscar, cómo se compró (con su número), el año, las banderas y la contraparte que puso un enlace. */
export async function BarraCompras({ pagina, ancla, con, proceso }: {
  pagina: Promise<ComprasPagina | null>;
  ancla: "entidad" | "proveedor";
  /** La contraparte que puso un enlace (el proveedor en una entidad, la entidad en una empresa). */
  con?: string;
  /** Los filtros de contratos de un enlace de antes: no tienen control propio, van como chip. */
  proceso?: string[];
}) {
  const p = await pagina;
  const f = p?.facetas ?? null;
  const anios = Object.keys(f?.anio ?? {}).map(Number).filter((a) => a > 0).sort((a, b) => b - a);
  // El nombre de la contraparte, de las filas (todas son con ella).
  const nombreCon = con
    ? p?.data.map((c) => (ancla === "entidad" ? c.orden?.contratista ?? c.catalogo?.proveedor ?? c.menor?.proveedor : c.orden?.entidad ?? c.catalogo?.entidad ?? c.menor?.entidad)).find(Boolean)
    : null;
  return (
    <BarraFiltros
      busqueda={{ param: P_COMPRAS.q, placeholder: "Buscar qué se compró, un proveedor o un número de orden…", etiqueta: "Buscar en sus compras", min: 3 }}
      faceta={{
        param: P_COMPRAS.como,
        etiqueta: "Cómo se compró",
        todas: "Todas",
        conteoTodas: f ? Object.values(f.como).reduce((s, n) => s + (n ?? 0), 0) : null,
        // Las que no tiene (un menor en una entidad que no usa el módulo) no van: un chip en 0 no ayuda.
        opciones: CLASES_COMPRA.filter((c) => !f || (f.como[c.valor] ?? 0) > 0).map((c) => ({ valor: c.valor, etiqueta: c.etiqueta, conteo: f ? f.como[c.valor] ?? 0 : null })),
        nombreEnChip: false,
      }}
      visibles={[
        ...(anios.length
          ? [{ param: P_COMPRAS.anio, etiqueta: "Año", corta: "Año", todas: "Todos los años", opciones: anios.map((a) => ({ valor: String(a), etiqueta: String(a), conteo: f?.anio[String(a)] ?? 0 })) }]
          : []),
        { param: P_COMPRAS.bandera, etiqueta: "Banderas", corta: "Banderas", todas: "Con o sin banderas", opciones: BANDERAS_COMPRA.map((b) => ({ valor: b.valor, etiqueta: b.etiqueta, grupo: b.grupo })) },
      ]}
      filtros={filtroRuc(P_COMPRAS.con, ancla === "entidad" ? "Proveedor" : "Entidad", ancla === "entidad" ? "Todos los proveedores" : "Todas las entidades", con, nombreCon)}
      orden={{ param: P_COMPRAS.orden, porDefecto: "reciente", opciones: [{ valor: "reciente", etiqueta: "Más recientes" }, { valor: "antiguo", etiqueta: "Más antiguas" }] }}
      chips={proceso?.length ? [{ clave: "proceso", texto: "Sólo los procesos de selección del enlace", params: proceso }] : undefined}
    />
  );
}

/** Sin ninguna compra (y sin filtros): lo dice la ficha. */
const SIN_COMPRAS = (
  <EstadoVacio compacto conLlamita={false} titulo="No registra compras">
    Ni procesos de selección, ni órdenes del SEACE, ni compras por catálogo o contratos menores con este RUC.
  </EstadoVacio>
);

export async function ListaCompras({
  pagina: p,
  ruta,
  parametros,
  actual,
  ancla,
  vacia = SIN_COMPRAS,
}: {
  pagina: Promise<ComprasPagina | null>;
  ruta: string;
  parametros: Parametros;
  actual: number;
  ancla: "entidad" | "proveedor";
  vacia?: ReactNode;
}) {
  const pagina = await p;
  if (!pagina) {
    return (
      <EstadoError
        titulo="No pudimos cargar sus compras"
        accion={<a href={hrefPagina(ruta, parametros, P_COMPRAS.page, actual)} className={CLASE_ACCION_LISTA}>Reintentar</a>}
      >
        Suele ser momentáneo: vuelve a intentarlo en unos segundos. Si se repite, elige un año o acorta la búsqueda.
      </EstadoError>
    );
  }
  if (!pagina.disponible) {
    return (
      <EstadoVacio compacto conLlamita={false} titulo="Las compras se están juntando">
        Vigía está juntando cada compra con sus órdenes para mostrarla una sola vez. Vuelve en unas horas.
      </EstadoVacio>
    );
  }
  const filtrada = Object.entries(P_COMPRAS).some(([k, param]) => k !== "orden" && k !== "page" && !!parametros[param])
    || FILTROS_PROCESO.some((k) => !!parametros[k]);
  if (!pagina.data.length) {
    if (actual > 1) {
      return (
        <EstadoVacio
          compacto
          titulo="Esta página de la lista ya no tiene compras"
          accion={<Link href={hrefPagina(ruta, parametros, P_COMPRAS.page, 1)} prefetch={false} className={CLASE_ACCION_LISTA}>Ir al principio de la lista</Link>}
        />
      );
    }
    return filtrada
      ? <EstadoVacio compacto titulo="Ninguna compra con estos filtros">Cambia el año, la búsqueda o la forma de compra, o quita un filtro.</EstadoVacio>
      : <>{vacia}</>;
  }
  const filas = pagina.data.map((c, i) => filaDe(c, i, { ruta, parametros, ancla })).filter(Boolean) as Fila[];
  const tam = pagina.size || filas.length;
  const pag = (subir: boolean) => (
    <PaginadorHayMas ruta={ruta} parametros={parametros} paramPagina={P_COMPRAS.page} actual={actual} tam={tam} enPagina={filas.length} hayMas={pagina.hayMas} subir={subir} />
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {pagina.resumen ? (
          <Dato icono={Landmark} nombre="Sus compras">
            {`${plural(pagina.resumen.compras, "compra", "compras")} por ${soles(pagina.resumen.monto)}`}
          </Dato>
        ) : (
          <span />
        )}
        {pag(false)}
      </div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta={ancla === "entidad" ? "Sus compras" : "Sus ventas al Estado"} />
      <div className="flex justify-end">{pag(true)}</div>
    </div>
  );
}
