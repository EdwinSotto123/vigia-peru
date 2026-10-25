import Link from "next/link";
import { Store } from "lucide-react";
import { DatosClave, EstadoVacio } from "@/components/patrones";
import {
  BarraFiltros,
  CeldaFecha,
  CeldaNumero,
  CeldaPrincipal,
  Tabla,
  type Columna,
  type Fila,
  type Parametros,
} from "@/components/listado";
import { AvisoDato, BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { motivoDudoso } from "@/lib/datoDudoso";
import { fechaCorta, numero, oracion, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { tipoContratacion } from "@/lib/personas";
import { P_ORD, type OrdenesPagina } from "@/lib/ordenes";

/**
 * Lista GENERAL de órdenes (subsección de Contratos). Clona la pestaña Órdenes de la ficha de empresa, pero sin RUC
 * fijo: añade el PROVEEDOR como dato de la fila, y pagina por `hayMas` (la API no cuenta el total del universo). Cada
 * orden abre su panel lateral; una orden es una compra directa (ver el ⓘ junto al título de la vista).
 */

const COLUMNAS: Columna[] = [
  { clave: "fecha", titulo: "Emitida", ancho: "92px", desde: "md", apilar: true },
  { clave: "orden", titulo: "Orden", ancho: "minmax(0,1.9fr)" },
  { clave: "estado", titulo: "Estado", ancho: "minmax(0,0.6fr)", desde: "lg", apilar: true },
  { clave: "monto", titulo: "Monto", ancho: "116px", alinear: "der" },
];

/** La barra de filtros de las órdenes: búsqueda, año (de los años disponibles) y tipo; orden por fecha. */
export async function BarraOrdenesGeneral({ pagina }: { pagina: Promise<OrdenesPagina | null> }) {
  const anios = (await pagina)?.anios ?? [];
  return (
    <BarraFiltros
      busqueda={{ param: P_ORD.q, placeholder: "Buscar por descripción, entidad, proveedor o número…", etiqueta: "Buscar en las órdenes", min: 3 }}
      visibles={[
        { param: P_ORD.anio, etiqueta: "Año", corta: "Año", todas: "Último año", opciones: anios.map((a) => ({ valor: String(a), etiqueta: String(a) })) },
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

function Pager({ ruta, parametros, actual, hayMas }: { ruta: string; parametros: Parametros; actual: number; hayMas: boolean }) {
  const href = (page: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(parametros)) if (v) q.set(k, String(v));
    if (page > 1) q.set(P_ORD.page, String(page)); else q.delete(P_ORD.page);
    const qs = q.toString();
    return qs ? `${ruta}?${qs}` : ruta;
  };
  const botón = "rounded-lg border border-line px-3 py-1.5 text-meta";
  return (
    <nav className="flex items-center gap-2" aria-label="Paginación de órdenes">
      {actual > 1
        ? <Link href={href(actual - 1)} prefetch={false} className={`${botón} text-inkSoft transition-colors duration-rapido hover:text-ink`}>← Anterior</Link>
        : <span className={`${botón} text-mute opacity-50`} aria-disabled>← Anterior</span>}
      <span className="text-rotulo text-mute">Página {numero(actual)}</span>
      {hayMas
        ? <Link href={href(actual + 1)} prefetch={false} className={`${botón} text-inkSoft transition-colors duration-rapido hover:text-ink`}>Siguiente →</Link>
        : <span className={`${botón} text-mute opacity-50`} aria-disabled>Siguiente →</span>}
    </nav>
  );
}

export async function ListaOrdenes({ pagina: p, ruta, parametros, actual }: { pagina: Promise<OrdenesPagina | null>; ruta: string; parametros: Parametros; actual: number }) {
  const pagina = await p;
  if (!pagina) return <EstadoVacio compacto titulo="No pudimos cargar las órdenes">Probá con otro año o quita la búsqueda.</EstadoVacio>;
  if (!pagina.data.length) return <EstadoVacio compacto titulo="Ninguna orden con estos filtros">Cambia el año, el tipo o la búsqueda.</EstadoVacio>;
  const filas: Fila[] = pagina.data.map((o, i) => {
    const motivo = o.montoDudoso != null ? motivoDudoso(o.dudosoMotivo) ?? "mayor_100m" : null;
    const tipo = tipoContratacion(o.tipoContratacion);
    const entidad = o.entidad ? tituloNatural(o.entidad) : null;
    const proveedor = o.contratista ? tituloNatural(o.contratista) : null;
    const descripcion = o.descripcion ? oracion(o.descripcion) : "Sin descripción";
    const clase = o.tipoOrden && /compra/i.test(o.tipoOrden) ? "Orden de compra" : "Orden de servicio";
    return {
      id: `${o.orden ?? i}-${o.fecha}-${o.entidadRuc}`,
      celdas: {
        fecha: <CeldaFecha fecha={o.fecha} />,
        orden: (
          <CeldaPrincipal
            titulo={descripcion}
            dosLineas
            meta={[
              entidad && <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
              proveedor && <Dato key="prov" icono={Store} nombre="Proveedor">{proveedor}</Dato>,
              <Dato key="tipo" tipo="tipo">{clase}</Dato>,
              o.numero && <Dato key="numero" tipo="codigo" nombre="Número de orden" mono>{`N.° ${o.numero}`}</Dato>,
            ]}
          />
        ),
        estado: (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-meta text-inkSoft">{o.estado ?? "Sin estado"}</span>
            {motivo && <BanderaDato motivo={motivo} fuente="conosce_ordenes" />}
          </span>
        ),
        monto: <CeldaNumero sub={motivo ? "posible error de CONOSCE" : tipo?.corto}>{o.monto != null ? soles(o.monto) : "Sin dato"}</CeldaNumero>,
      },
      detalle: {
        titulo: o.numero ? `${clase} N.° ${o.numero}` : clase,
        etiqueta: `Ver el detalle de la orden ${o.numero ?? ""}`.trim(),
        descripcion: entidad ?? undefined,
        contenido: (
          <div className="space-y-4">
            {motivo && <AvisoDato motivo={motivo} fuente="conosce_ordenes">{`La orden trae ${soles(o.monto)} en el archivo oficial de CONOSCE.`}</AvisoDato>}
            <DatosClave
              items={[
                { etiqueta: clase === "Orden de compra" ? "Qué se compró" : "Qué se pagó", valor: descripcion },
                { etiqueta: "Entidad", valor: entidad },
                { etiqueta: "Proveedor", valor: proveedor },
                { etiqueta: "Emitida", valor: o.fecha ? fechaCorta(o.fecha) : null, mono: true },
                { etiqueta: "Estado", valor: o.estado },
                { etiqueta: "Monto", valor: o.monto != null ? (motivo ? `${soles(o.monto)}, tal como lo publicó CONOSCE` : soles(o.monto)) : null, mono: true },
                { etiqueta: "Cómo se contrató", valor: tipo?.corto ?? null },
              ]}
            />
          </div>
        ),
        pie: <span className="text-rotulo text-mute">Fuente: OECE, CONOSCE, órdenes de compra y de servicio{o.orden ? ` (${o.orden})` : ""}</span>,
      },
    };
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-meta text-inkSoft">Órdenes{pagina.anio ? ` de ${pagina.anio}` : ""}</p>
        <Pager ruta={ruta} parametros={parametros} actual={actual} hayMas={pagina.hayMas} />
      </div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Órdenes de compra y de servicio" />
      <div className="flex justify-end">
        <Pager ruta={ruta} parametros={parametros} actual={actual} hayMas={pagina.hayMas} />
      </div>
    </div>
  );
}
