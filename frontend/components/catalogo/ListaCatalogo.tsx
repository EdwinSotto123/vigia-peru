import Link from "next/link";
import type { ReactNode } from "react";
import { FileSearch, FileText, Store } from "lucide-react";
import { Ayuda, AyudaTermino, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, FuenteDato, type DatoClave } from "@/components/patrones";
import { BarraFiltros, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila, type Parametros } from "@/components/listado";
import {
  BanderasAntecedentes,
  CeldaFechaCompra,
  EstadoCompra,
  ListaCargando,
  PaginadorHayMas,
  SinAntecedentes,
  conFicha,
  datoFecha,
  fichasCompra,
  hrefPagina,
  opcionesDe,
  type Antecedente,
} from "@/components/ordenes/ListaOrdenes";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA, claseAccion } from "@/components/ui/EnlaceAccion";
import { fechaConAnio, numero, oracion, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  ESTADOS_CATALOGO,
  ORDENES_CATALOGO,
  P_CAT,
  rutaProducto,
  vecesTexto,
  type CatalogoPagina,
  type ItemCatalogo,
  type OrdenCatalogo,
} from "@/lib/catalogo";

/**
 * Las compras por los Catálogos Electrónicos de Perú Compras de una entidad o de una empresa (la vista «Catálogo» de sus
 * fichas). Es la única fuente con QUÉ se compró: cada orden abre su panel con sus productos, su cantidad y su precio por
 * unidad, frente a lo que pagaron las demás entidades por la misma ficha-producto ese año (la mediana y el tramo del
 * medio), y los PDF de la orden y de su sustento.
 *
 * Fila de todo listado (§14.1): estado (chip) · qué compró, con entidad, proveedor y acuerdo marco · precio frente a la
 * mediana (la bandera, si pagó el doble o más) · total · publicada.
 */

const FUENTE = "Perú Compras";
/** La consulta pública de órdenes de los Catálogos: se busca por el número de la orden. */
const CONSULTA_PERU_COMPRAS = "https://www.catalogos.perucompras.gob.pe/ConsultaOrdenesPub/";

const AYUDA_PRECIO = (
  <Ayuda titulo="¿Cómo se compara el precio?">
    <span className="block">
      Cada producto del catálogo tiene su ficha. Se compara lo que pagó esta orden por unidad, sin IGV, con lo que pagaron las
      demás entidades por la misma ficha ese año: la mediana y el tramo del medio. Sólo si la compraron al menos 5 entidades.
    </span>
    <span className="mt-2 block">
      La bandera sale cuando pagó el doble de la mediana o más y la diferencia, por la cantidad comprada, es de S/ 1,000 o más.
    </span>
    <span className="mt-2 block">
      Es un dato para revisar, no una prueba: el precio de catálogo incluye la entrega en el lugar (un distrito lejano cuesta
      más) y una compra chica no tiene el precio de una grande.
    </span>
  </Ayuda>
);

const COLUMNAS: Columna[] = [
  { clave: "estado", titulo: "Estado", ancho: "112px", desde: "md", apilar: true },
  { clave: "orden", titulo: "Lo que compró", ancho: "minmax(0,1.8fr)" },
  { clave: "precio", titulo: "Precio frente a la mediana", corto: "Precio", ancho: "minmax(0,0.9fr)", desde: "lg", apilar: true, ayuda: AYUDA_PRECIO },
  { clave: "monto", titulo: "Total", ancho: "116px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "fecha", titulo: "Publicada", ancho: "104px", desde: "md", apilar: "con-rotulo" },
];

/** La bandera de una orden con líneas al doble de la mediana o más. */
function banderaSobreprecio(s: NonNullable<OrdenCatalogo["sobreprecio"]>): Antecedente {
  return {
    tipo: "sobreprecio_catalogo",
    severidad: s.veces >= 3 ? "alta" : "media",
    chip: `Pagó ${vecesTexto(s.veces)}`,
    explica: `${plural(s.lineas, "producto se pagó", "productos se pagaron")} al doble o más de la mediana de las demás entidades ese año: ${soles(s.exceso)} por encima, por la cantidad comprada. Es un dato para revisar.`,
  };
}

/**
 * La barra del catálogo: a la vista el año y las compras al doble de la mediana; en «Filtros», el estado de la orden.
 * Cada opción con su conteo (la API cuenta cada filtro con los demás puestos).
 */
export async function BarraCatalogo({ pagina }: { pagina: Promise<CatalogoPagina | null> }) {
  const p = await pagina;
  const f = p?.facetas ?? null;
  const anios = Object.keys(f?.anio ?? {}).map(Number).sort((a, b) => b - a);
  return (
    <BarraFiltros
      busqueda={{ param: P_CAT.q, placeholder: "Buscar un producto, una marca o un número de orden…", etiqueta: "Buscar en sus compras por catálogo", min: 3 }}
      visibles={[
        ...(anios.length
          ? [{ param: P_CAT.anio, etiqueta: "Año", corta: "Año", todas: "Todos los años", opciones: anios.map((a) => ({ valor: String(a), etiqueta: String(a), conteo: f?.anio[String(a)] ?? 0 })) }]
          : []),
        {
          param: P_CAT.sobreprecio, etiqueta: "Precio", corta: "Precio", todas: "Todas",
          opciones: [{ valor: "si", etiqueta: "Al doble de la mediana o más", conteo: f ? f.sobreprecio.si : null }],
        },
      ]}
      filtros={[{ param: P_CAT.estado, etiqueta: "Estado de la orden", todas: "Cualquier estado", opciones: opcionesDe(ESTADOS_CATALOGO, f?.estado) }]}
      orden={{ param: P_CAT.orden, porDefecto: "reciente", opciones: ORDENES_CATALOGO.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })) }}
    />
  );
}

export function ListaCatalogoCargando() {
  return <ListaCargando texto="Cargando sus compras por catálogo…" columnas={COLUMNAS} />;
}

/** «Y 3 productos más» o la línea de mayor monto: lo que se ve como título de la fila. */
function principal(o: OrdenCatalogo): ItemCatalogo | null {
  return o.items.reduce<ItemCatalogo | null>((m, i) => (m == null || (i.subtotal ?? 0) > (m.subtotal ?? 0) ? i : m), null);
}

/** El nombre de un producto del catálogo: la descripción trae «CATEGORÍA : característica…»; va entera, en oración. */
const nombreProducto = (i: ItemCatalogo) => (i.descripcion ? oracion(i.descripcion) : i.categoria ? oracion(i.categoria) : "Producto sin descripción");

/** Un producto de la orden, con su precio frente a la referencia de su ficha ese año. */
function Producto({ i, anio }: { i: ItemCatalogo; anio: number | null }) {
  const r = i.ref;
  return (
    <li className="space-y-1 border-t border-line pt-3 first:border-t-0 first:pt-0">
      <p className="font-medium text-ink">{nombreProducto(i)}</p>
      <p className="text-meta text-inkSoft">
        {[i.marca && `Marca ${tituloNatural(i.marca)}`, i.nroParte && `N.º de parte ${i.nroParte}`].filter(Boolean).join(", ")}
      </p>
      <p className="text-meta text-ink">
        <span className="font-mono">{i.cantidad != null ? numero(i.cantidad) : "Sin dato"}</span> {i.cantidad === 1 ? "unidad" : "unidades"} a{" "}
        <span className="font-mono">{soles(i.precio)}</span> cada una, sin IGV: <span className="font-mono">{soles(i.subtotal)}</span>
      </p>
      {r ? (
        <p className={i.sobreprecio ? "text-meta font-medium text-amberTexto" : "text-meta text-inkSoft"}>
          {i.sobreprecio
            ? `Pagó ${vecesTexto(i.sobreprecio.veces)}: ${soles(i.sobreprecio.exceso)} por encima por la cantidad comprada. `
            : ""}
          {r.entidades >= 5
            ? `${plural(r.entidades, "entidad la compró", "entidades la compraron")}${anio ? ` en ${anio}` : ""} a una mediana de ${soles(r.mediana)} (la mitad del medio, entre ${soles(r.p25)} y ${soles(r.p75)}).`
            : `Sólo ${plural(r.entidades, "entidad la compró", "entidades la compraron")}${anio ? ` en ${anio}` : ""}: muy pocas para comparar el precio.`}
        </p>
      ) : (
        <p className="text-meta text-mute">Sin precio de referencia: nadie más compró esta ficha ese año.</p>
      )}
      {i.ficha && r && r.entidades > 1 && (
        <Link href={rutaProducto(i.ficha, anio)} prefetch={false} className="inline-flex items-center gap-1.5 text-meta font-medium text-granate underline-offset-2 hover:underline">
          <FileSearch size={14} aria-hidden /> Ver quién más lo compró y a cuánto
        </Link>
      )}
    </li>
  );
}

const SIN_CATALOGO = (
  <EstadoVacio compacto conLlamita={false} titulo="No registra compras por catálogo">
    Perú Compras no tiene órdenes de los Catálogos Electrónicos con este RUC desde 2017.
  </EstadoVacio>
);

export async function ListaCatalogo({
  pagina: p,
  ruta,
  parametros,
  actual,
  vacia = SIN_CATALOGO,
}: {
  pagina: Promise<CatalogoPagina | null>;
  ruta: string;
  parametros: Parametros;
  actual: number;
  vacia?: ReactNode;
}) {
  const pagina = await p;
  if (!pagina) {
    return (
      <EstadoError
        titulo="No pudimos cargar las compras por catálogo"
        accion={<a href={hrefPagina(ruta, parametros, P_CAT.page, actual)} className={CLASE_ACCION_LISTA}>Reintentar</a>}
      >
        Suele ser momentáneo: vuelve a intentarlo en unos segundos. Si se repite, elige un año o acorta la búsqueda.
      </EstadoError>
    );
  }
  if (!pagina.disponible) {
    return (
      <EstadoVacio compacto conLlamita={false} titulo="Las compras por catálogo se están cargando">
        Vigía está sumando las órdenes de los Catálogos Electrónicos de Perú Compras. Vuelve en unas horas.
      </EstadoVacio>
    );
  }
  if (!pagina.data.length) {
    if (actual > 1) {
      return (
        <EstadoVacio
          compacto
          titulo="Esta página de la lista ya no tiene órdenes"
          accion={<Link href={hrefPagina(ruta, parametros, P_CAT.page, 1)} prefetch={false} className={CLASE_ACCION_LISTA}>Ir al principio de la lista</Link>}
        />
      );
    }
    const filtrada = Object.entries(P_CAT).some(([k, param]) => k !== "orden" && k !== "page" && !!parametros[param]);
    return filtrada ? <EstadoVacio compacto titulo="Ninguna orden con estos filtros">Cambia el año o la búsqueda, o quita un filtro.</EstadoVacio> : <>{vacia}</>;
  }
  const filas: Fila[] = pagina.data.map((o) => {
    const entidad = o.entidad ? tituloNatural(o.entidad) : null;
    const proveedor = o.proveedor ? tituloNatural(o.proveedor) : null;
    const top = principal(o);
    const otros = o.lineas - 1;
    const anio = o.fecha ? Number(o.fecha.slice(0, 4)) : null;
    const acuerdo = o.acuerdo ? oracion(o.acuerdo.replace(/\s*\*\s*No Vigente\s*$/i, "")) : null;
    // Una orden de servicios (boletos aéreos, datos abiertos) no trae productos: su título es el acuerdo.
    const titulo = top ? nombreProducto(top) : acuerdo ?? "Orden sin detalle";
    const estado = <EstadoCompra estado={o.estado} />;
    const bandera = o.sobreprecio ? [banderaSobreprecio(o.sobreprecio)] : [];
    const fichas = fichasCompra(ruta, o.entidadRuc, o.proveedorRuc);
    const items: (DatoClave | null)[] = [
      { etiqueta: "Entidad", valor: conFicha(entidad, fichas.entidad) },
      { etiqueta: "Proveedor", valor: conFicha(proveedor, fichas.proveedor) },
      acuerdo ? { etiqueta: "Acuerdo marco", valor: o.acuerdoCodigo ? `${acuerdo} (${o.acuerdoCodigo})` : acuerdo } : null,
      o.procedimiento ? { etiqueta: "Procedimiento", valor: oracion(o.procedimiento) } : null,
      o.ordenFisica ? { etiqueta: "N.º de la orden en la entidad", valor: o.ordenFisica, mono: true } : null,
      { etiqueta: "Orden electrónica", valor: o.orden, mono: true },
      datoFecha("Publicada", o.fecha, FUENTE),
      o.aceptada ? datoFecha("Aceptada por el proveedor", o.aceptada, FUENTE) : null,
      { etiqueta: "Total", valor: o.total != null ? `${soles(o.total)}${o.igv ? ` (con ${soles(o.igv)} de IGV)` : ""}` : null, mono: true },
      o.entregas ? { etiqueta: "Entregas", valor: `${plural(o.entregas.entregas, "entrega", "entregas")}${o.entregas.hasta ? `, la última hasta el ${fechaConAnio(o.entregas.hasta)}` : ""}` } : null,
    ];
    return {
      id: o.orden,
      celdas: {
        estado,
        orden: (
          <CeldaPrincipal
            titulo={otros > 0 ? `${titulo} y ${plural(otros, "producto más", "productos más")}` : titulo}
            dosLineas
            meta={[
              entidad && <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
              proveedor && <Dato key="prov" icono={Store} nombre="Proveedor">{proveedor}</Dato>,
              o.acuerdoCodigo && <Dato key="acuerdo" tipo="codigo" nombre="Acuerdo marco" mono>{o.acuerdoCodigo}</Dato>,
            ]}
          />
        ),
        precio: bandera.length ? <BanderasAntecedentes antecedentes={bandera} etiqueta="Precio frente a la mediana" /> : <SinAntecedentes />,
        monto: <CeldaNumero>{o.total != null ? soles(o.total) : "Sin dato"}</CeldaNumero>,
        fecha: <CeldaFechaCompra fecha={o.fecha} fuente={FUENTE} />,
      },
      detalle: {
        // «ORDEN DE COMPRA N° 201800193» u «OC 199-2026» ya dicen que es una orden: no se repite.
        titulo: o.ordenFisica ? (/^(orden|o\.?\s?c)(\s|\.|$)/i.test(o.ordenFisica) ? oracion(o.ordenFisica) : `Orden ${o.ordenFisica}`) : `Orden ${o.orden}`,
        etiqueta: `Ver lo que compró la orden ${o.orden}`,
        descripcion: entidad ?? undefined,
        contenido: (
          <CuerpoDetalle>
            <ChipsDetalle>
              {estado}
              {bandera.length > 0 && <BanderasAntecedentes antecedentes={bandera} etiqueta="Precio frente a la mediana" todas />}
            </ChipsDetalle>
            <DatosClave items={items.filter(Boolean) as DatoClave[]} />
            {o.lineas > 0 ? (
              <BloqueDetalle
                titulo={`Lo que compró (${plural(o.lineas, "producto", "productos")})`}
                ayuda={<AyudaTermino clave="precio-referencia" />}
              >
                <ul className="space-y-3">
                  {o.items.map((i) => <Producto key={i.linea} i={i} anio={anio} />)}
                </ul>
                {o.lineas > o.items.length && (
                  <p className="mt-3 text-meta text-mute">
                    Y {plural(o.lineas - o.items.length, "producto más", "productos más")}: están en el PDF de la orden.
                  </p>
                )}
              </BloqueDetalle>
            ) : (
              <BloqueDetalle titulo="Lo que compró">
                <p className="text-meta text-inkSoft">
                  Perú Compras publica de las órdenes de servicios sólo su total, sin el detalle. En los boletos aéreos, el
                  detalle nombra a quien viaja: Vigía no lo muestra.
                </p>
              </BloqueDetalle>
            )}
            {(o.pdfOrden || o.pdfSustento) && (
              <BloqueDetalle titulo="Documentos">
                <div className="flex flex-wrap gap-2">
                  {o.pdfOrden && (
                    <a href={o.pdfOrden} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
                      <FileText className="size-4" aria-hidden /> La orden firmada
                      <span className="sr-only"> (PDF de Perú Compras, se abre en otra pestaña)</span>
                    </a>
                  )}
                  {o.pdfSustento && (
                    <a href={o.pdfSustento} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
                      <FileSearch className="size-4" aria-hidden /> El sustento (las cotizaciones)
                      <span className="sr-only"> (PDF de Perú Compras, se abre en otra pestaña)</span>
                    </a>
                  )}
                </div>
              </BloqueDetalle>
            )}
          </CuerpoDetalle>
        ),
        pie: (
          <FuenteDato
            fuente={`Perú Compras, orden ${o.orden}`}
            enlaces={[{ texto: "Consulta de órdenes de los Catálogos Electrónicos (Perú Compras)", href: CONSULTA_PERU_COMPRAS }]}
          />
        ),
      },
    };
  });
  const tam = pagina.size || filas.length;
  const pag = (subir: boolean) => (
    <PaginadorHayMas ruta={ruta} parametros={parametros} paramPagina={P_CAT.page} actual={actual} tam={tam} enPagina={filas.length} hayMas={pagina.hayMas} subir={subir} />
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Compras por los Catálogos Electrónicos" />
      <div className="flex justify-end">{pag(true)}</div>
    </div>
  );
}
