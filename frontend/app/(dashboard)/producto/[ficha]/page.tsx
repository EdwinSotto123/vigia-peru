import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Store } from "lucide-react";
import { Ayuda, AyudaTermino, EncabezadoPagina, EstadoVacio, FuenteDato, Migas, Pagina, Seccion } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Indicadores, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import { BanderasAntecedentes, CeldaFechaCompra } from "@/components/ordenes/ListaOrdenes";
import { Dato } from "@/components/ui/Dato";
import { numero, oracion, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { canonica, descripcion } from "@/lib/seo";
import { getFichaCatalogo, P_CAT, rutaProducto, vecesTexto } from "@/lib/catalogo";
import { cn } from "@/lib/utils";

/**
 * /producto/[ficha] — un producto de los Catálogos Electrónicos de Perú Compras (su ficha-producto) y quién lo compró:
 * el precio de referencia de cada año (la mediana y el tramo del medio de lo que pagaron las entidades, por unidad y sin
 * IGV) y, del año elegido (`?anio=`, por defecto el último con compras), cada compra del precio más alto al más bajo, con
 * la bandera de las que pagaron el doble de la mediana o más. Se llega desde el panel de una orden de catálogo («Ver quién
 * más lo compró»). Cada fila lleva a esa orden en la ficha de su entidad.
 */

const ANIO_OK = (v: string | string[] | undefined) => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return n >= 2015 && n <= 2100 ? n : undefined;
};

/** El nombre corto del producto: la categoría de su ficha («IMPRESORA MULTIFUNCIONAL LASER : T/MONOCROMATICA…»). */
const nombreCorto = (d: string | null, categoria: string | null) => {
  const antes = d?.split(" : ")[0]?.trim();
  return oracion(antes || categoria || "Producto del catálogo");
};

export async function generateMetadata({ params, searchParams }: { params: { ficha: string }; searchParams?: Record<string, string | string[] | undefined> }): Promise<Metadata> {
  const f = await getFichaCatalogo(params.ficha, ANIO_OK(searchParams?.anio));
  if (!f?.producto) return { title: "Producto del catálogo" };
  const titulo = nombreCorto(f.producto.descripcion, f.producto.categoria);
  return {
    title: `${titulo}${f.producto.marca ? ` ${tituloNatural(f.producto.marca)}` : ""}: quién lo compró y a cuánto`,
    description: descripcion([`${titulo} en los Catálogos Electrónicos de Perú Compras:`, "lo que pagó cada entidad por unidad, año por año, frente a la mediana."]),
    alternates: canonica(rutaProducto(params.ficha)),
  };
}

const COLUMNAS: Columna[] = [
  { clave: "quien", titulo: "Quién lo compró", ancho: "minmax(0,1.6fr)" },
  {
    clave: "precio", titulo: "Precio por unidad", corto: "Precio", ancho: "minmax(0,1fr)", alinear: "der",
    ayuda: <AyudaTermino clave="precio-referencia" />,
  },
  { clave: "cantidad", titulo: "Cantidad", ancho: "96px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "fecha", titulo: "Publicada", ancho: "104px", desde: "md", apilar: "con-rotulo" },
];

export default async function ProductoCatalogo({ params, searchParams }: { params: { ficha: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const pedido = ANIO_OK(searchParams?.anio);
  const f = await getFichaCatalogo(params.ficha, pedido);
  if (!f) notFound();
  const ruta = rutaProducto(f.ficha);
  const titulo = nombreCorto(f.producto?.descripcion ?? null, f.producto?.categoria ?? null);
  const ref = f.referencias.find((r) => r.anio === f.anio) ?? null;
  const marcadas = f.compras.filter((c) => c.veces != null).length;
  const cifras: Indicador[] = ref
    ? [
        { etiqueta: `Mediana en ${f.anio}`, valor: soles(ref.mediana), contexto: "por unidad, sin IGV", ayuda: <AyudaTermino clave="mediana" /> },
        { etiqueta: "La mitad del medio", valor: `${soles(ref.p25)} a ${soles(ref.p75)}`, contexto: "entre el cuartil 1 y el 3" },
        { etiqueta: "Entidades que lo compraron", valor: numero(ref.entidades), contexto: plural(ref.lineas, "compra", "compras") },
        { etiqueta: "Al doble de la mediana o más", valor: numero(marcadas), contexto: ref.entidades >= 5 ? "con S/ 1,000 o más de diferencia" : "con menos de 5 entidades no se compara", tono: marcadas ? "media" : "neutro" },
      ]
    : [];
  const filas: Fila[] = f.compras.map((c) => {
    const entidad = c.entidad ? tituloNatural(c.entidad) : "Entidad sin nombre";
    const proveedor = c.proveedor ? tituloNatural(c.proveedor) : null;
    return {
      id: `${c.orden}-${c.linea}`,
      // La orden en la ficha de su entidad: su vista Catálogo, buscada por su número.
      href: c.entidadRuc ? `/entidad/${c.entidadRuc}?${new URLSearchParams({ seccion: "contratos", vista: "catalogo", [P_CAT.q]: c.orden })}` : undefined,
      celdas: {
        quien: (
          <CeldaPrincipal
            titulo={entidad}
            meta={[
              proveedor && <Dato key="prov" icono={Store} nombre="Proveedor">{proveedor}</Dato>,
              <Dato key="orden" tipo="codigo" nombre="Orden" mono>{c.orden}</Dato>,
            ]}
          />
        ),
        precio: (
          <div className="flex flex-col items-end gap-1">
            <CeldaNumero>{soles(c.precio)}</CeldaNumero>
            {c.veces != null && (
              <BanderasAntecedentes
                etiqueta="Precio frente a la mediana"
                antecedentes={[{
                  tipo: "sobreprecio_catalogo", severidad: c.veces >= 3 ? "alta" : "media", chip: vecesTexto(c.veces),
                  explica: `${soles(c.exceso)} por encima de la mediana por la cantidad comprada. Es un dato para revisar.`,
                }]}
              />
            )}
          </div>
        ),
        cantidad: <CeldaNumero>{numero(c.cantidad)}</CeldaNumero>,
        fecha: <CeldaFechaCompra fecha={c.fecha} fuente="Perú Compras" />,
      },
    };
  });

  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: titulo, href: ruta }]} />
      <EncabezadoPagina
        titulo={f.producto?.marca ? `${titulo} ${tituloNatural(f.producto.marca)}` : titulo}
        bajada={
          <span className="block text-inkSoft">
            {f.producto?.descripcion ? oracion(f.producto.descripcion) : "Producto de los Catálogos Electrónicos"}
            {f.producto?.nroParte ? `. N.º de parte ${f.producto.nroParte}` : ""}
          </span>
        }
        ayuda={
          <Ayuda titulo="¿Qué muestra esta página?">
            <span className="block">
              Un producto de la tienda en línea del Estado (los Catálogos Electrónicos de Perú Compras) y lo que pagó por él cada
              entidad que lo compró, por unidad y sin IGV.
            </span>
            <span className="mt-2 block">
              La misma ficha-producto es el mismo producto, así que los precios se pueden comparar. El precio incluye la entrega en
              el lugar: una compra en un distrito lejano o una muy chica puede costar más sin que haya nada raro.
            </span>
          </Ayuda>
        }
      />

      {f.referencias.length > 1 && (
        <nav aria-label="Año de las compras" className="flex flex-wrap gap-2">
          {f.referencias.map((r) => (
            <Link
              key={r.anio}
              href={rutaProducto(f.ficha, r.anio)}
              prefetch={false}
              aria-current={r.anio === f.anio ? "page" : undefined}
              className={cn(
                "pill min-h-[44px] px-3 sm:min-h-0",
                r.anio === f.anio ? "border-granate bg-granate-soft font-semibold text-granate" : "border-line bg-paper text-inkSoft hover:border-granate",
              )}
            >
              {r.anio}: {plural(r.entidades, "entidad", "entidades")}
            </Link>
          ))}
        </nav>
      )}

      {cifras.length > 0 && <Indicadores items={cifras} />}

      <Seccion titulo={`Quién lo compró en ${f.anio}`} descripcion="Del precio más alto al más bajo. Cada fila abre la orden en la ficha de su entidad.">
        {filas.length ? (
          <Tabla columnas={COLUMNAS} filas={filas} etiqueta={`Compras de ${titulo} en ${f.anio}`} />
        ) : (
          <EstadoVacio compacto conLlamita={false} titulo={`Nadie lo compró en ${f.anio}`}>
            Elige otro año.
          </EstadoVacio>
        )}
        {f.compras.length >= 200 && <p className="mt-3 text-meta text-mute">Se muestran las 200 compras de precio más alto de ese año.</p>}
      </Seccion>

      <FuenteDato
        fuente={`Perú Compras, Catálogos Electrónicos: ficha-producto ${f.ficha}`}
        enlaces={[{ texto: "Consulta de órdenes de los Catálogos Electrónicos (Perú Compras)", href: "https://www.catalogos.perucompras.gob.pe/ConsultaOrdenesPub/" }]}
      />
    </Pagina>
  );
}
