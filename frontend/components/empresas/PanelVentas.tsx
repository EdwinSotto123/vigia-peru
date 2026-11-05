import Link from "next/link";
import { Building2, FileSignature, Receipt, Trophy, type LucideIcon } from "lucide-react";
import { ColumnasAnio } from "@/components/charts/ColumnasAnio";
import { Medidor, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { rutaEmpresa, type FichaEmpresa } from "@/lib/empresas";
import { TablaAnios } from "./AniosEmpresa";

/**
 * Lo que la empresa vendió al Estado, en un solo panel (pedido del usuario, 2026-11-05: las cuatro tarjetas «sirven, pero
 * ocupan mucho espacio para la información que dan»): a la izquierda las cifras, compactas, que hacen de leyenda del
 * gráfico (su cuadrito de color); a la derecha cómo se movió año por año, contratos que ganó sola y órdenes apiladas, con
 * el detalle de cada año al pasar el mouse. La tabla, plegada debajo. Lo ganado en consorcio no se apila (es de todo el
 * consorcio): va en su cifra y en la tabla. Server-safe (el gráfico es de cliente).
 */
function Fila({ icono: Icono, serie, valor, texto, href }: { icono: LucideIcon; serie?: 0 | 1; valor: string; texto: string; href?: string }) {
  const cuerpo = (
    <>
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-paperSoft text-inkSoft" aria-hidden>
        <Icono size={16} />
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          {serie != null && <MuestraSerie i={serie} />}
          <span className="font-display text-destacado font-bold leading-tight text-ink">{valor}</span>
        </span>
        <span className="block text-meta leading-snug text-inkSoft">{texto}</span>
      </span>
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} prefetch={false} className="-mx-2 flex gap-3 rounded-xl px-2 py-1.5 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate">
          {cuerpo}
        </Link>
      ) : (
        <span className="flex gap-3 py-1.5">{cuerpo}</span>
      )}
    </li>
  );
}

export function PanelVentas({ f }: { f: FichaEmpresa }) {
  const e = f.empresa;
  const tasa = e.postulaciones > 0 ? e.ganadas / e.postulaciones : null;
  const anual = f.anual ?? [];
  const desde = anual.length ? Math.min(...anual.map((a) => a.anio)) : null;
  return (
    <section className="tarjeta rounded-2xl border border-line bg-paper p-4 sm:p-5" aria-labelledby="panel-ventas-titulo">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="panel-ventas-titulo" className="font-display text-seccion font-bold text-ink">Lo que le vendió al Estado</h2>
        {desde && <p className="text-meta text-mute">Contratos y órdenes de CONOSCE (OECE), desde {desde}</p>}
      </div>
      <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-6">
        <ul className="grid content-start gap-1 sm:grid-cols-2 lg:grid-cols-1">
          <Fila
            icono={FileSignature}
            serie={0}
            valor={solesCompacto(e.adjMonto)}
            texto={`en ${plural(e.adjProcesos, "contrato que ganó sola", "contratos que ganó sola")}${e.consProcesos ? `; y ${plural(e.consProcesos, "proceso", "procesos")} en consorcio por ${solesCompacto(e.consMonto)}` : ""}`}
            href={rutaEmpresa(e.ruc, "contratos")}
          />
          <Fila icono={Receipt} serie={1} valor={solesCompacto(e.ordMonto)} texto={`en ${plural(e.ordN, "orden de compra o servicio", "órdenes de compra y servicio")}`} href={rutaEmpresa(e.ruc, "ordenes")} />
          <Fila icono={Building2} valor={numero(e.entidades)} texto={e.entidades === 1 ? "entidad le pagó" : "entidades le pagaron"} href={rutaEmpresa(e.ruc, "clientes")} />
          <li>
            <Link href={rutaEmpresa(e.ruc, "postulaciones")} prefetch={false} className="-mx-2 flex gap-3 rounded-xl px-2 py-1.5 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-paperSoft text-inkSoft" aria-hidden><Trophy size={16} /></span>
              <span className="min-w-0 flex-1">
                <span className="font-display text-destacado font-bold leading-tight text-ink">
                  {e.postulaciones ? `${tasa != null && e.postulaciones >= 5 ? `${Math.round(tasa * 100)} %` : numero(e.ganadas)}` : "Ninguna"}
                </span>
                <span className="block text-meta leading-snug text-inkSoft">
                  {e.postulaciones ? `de lo que postuló lo ganó: ${numero(e.ganadas)} de ${plural(e.postulaciones, "postulación", "postulaciones")}` : "postulación como postor desde 2018"}
                </span>
                {tasa != null && e.postulaciones >= 5 && <Medidor parte={tasa} etiqueta={`Ganó ${numero(e.ganadas)} de ${numero(e.postulaciones)} postulaciones`} className="mt-1.5" />}
              </span>
            </Link>
          </li>
        </ul>
        {anual.length > 0 ? (
          <div className="min-w-0 space-y-2">
            <ColumnasAnio
              etiqueta={`Lo que recibió ${e.nombre} cada año`}
              etiquetaA="Contratos que ganó sola"
              etiquetaB="Órdenes"
              formato="soles"
              anios={anual.map((a) => ({
                anio: a.anio,
                a: a.adjudicado,
                b: a.ordenado,
                detalleA: `${solesCompacto(a.adjudicado)} en ${plural(a.contratos, "proceso", "procesos")}`,
                detalleB: `${solesCompacto(a.ordenado)} en ${plural(a.ordenes, "orden", "órdenes")}`,
                aparte: a.contratosDudosos > 0 || a.dudosas > 0,
              }))}
            />
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft" aria-label="Leyenda">
              <li className="inline-flex items-center gap-1.5"><MuestraSerie i={0} />Contratos que ganó sola</li>
              <li className="inline-flex items-center gap-1.5"><MuestraSerie i={1} />Órdenes de compra y servicio</li>
              {anual.some((a) => a.contratosDudosos > 0 || a.dudosas > 0) && (
                <li className="inline-flex items-center gap-1.5"><span className="text-amberTexto" aria-hidden>▲</span>Año con montos de un posible error de carga, fuera de la columna</li>
              )}
            </ul>
            <TablaAnios anual={anual} />
          </div>
        ) : (
          <p className="self-center text-dato text-mute">Sin contratos ni órdenes desde 2018.</p>
        )}
      </div>
    </section>
  );
}
