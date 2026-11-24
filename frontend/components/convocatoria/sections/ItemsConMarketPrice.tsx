"use client";

import Link from "next/link";
import { ChevronRight, Package, SearchX, Table2 } from "lucide-react";
import { DetallePrecioItem, TablaPrecios } from "@/components/charts/DetallePrecioItem";
import { RangoPrecios } from "@/components/charts/RangoPrecios";
import { construirFilas, maximoEscala, ordenarPorDiferencia } from "@/components/charts/mercado";
import { Revelar } from "@/components/ui/Revelar";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueDetalle, CuerpoDetalle } from "@/components/patrones/Detalle";
import { numero, plural } from "@/lib/formato";
import { rutaContrato } from "@/lib/rutas";

/**
 * Ofertado contra mercado, ítem por ítem.
 *
 * Esto eran 584 líneas que renderizaban como texto el dato más cuantitativo
 * del producto: precio ofertado, mediana de mercado, rango mín–máx y
 * cantidad, por ítem. El rango se imprimía como dos números separados por un
 * guion, y para contestar "¿cuánto se pagó de más y en qué ítems?" había que
 * leer la tabla renglón por renglón.
 *
 * Ahora manda el gráfico (`RangoPrecios`), ordenado por diferencia en soles,
 * y todo lo demás es profundidad bajo demanda: la evidencia de cada ítem en
 * un panel lateral, la tabla completa —equivalente textual del gráfico— en
 * otro. Nada se borró; se dejó de servir todo junto y siempre abierto.
 *
 * Lo que este componente NO hace, a propósito: sumar un sobreprecio de lote.
 * Esa cifra es del backend (`MarketVerdictCard` la muestra tal cual) porque
 * su juez de plausibilidad ya decidió si el lote es comparable.
 */
export function ItemsConMarketPrice({
  items,
  allItems = [],
  market,
  fmtMoney,
  conEstado = 0,
  renglonesFicha = 0,
  ocidFicha = null,
}: {
  items: any[];
  allItems?: any[];
  market: any;
  fmtMoney: (n: any) => string;
  /**
   * Cuántos ítems sí se compararon con compras del Estado por el mismo bien (`precios_internos`): con alguno, un ítem
   * sin precio de mercado no se rotula «No verificable» a secas (pedido del usuario del 2026-11-16).
   */
  conEstado?: number;
  /** Cuántos renglones de lo comprado trae la ficha (bases y contrato leídos por pieza) y el contrato al que enlazar. */
  renglonesFicha?: number;
  ocidFicha?: string | null;
}) {
  const armadas = construirFilas({ items, allItems, market });
  const padreLote = armadas.padreLote;
  // El veredicto es el del agente (no cambia ni lo medido ni los conteos): sólo el rótulo dice que la mitad sí se verificó.
  const filas =
    conEstado > 0
      ? armadas.filas.map((f) =>
          f.veredicto.clave === "no_verificable" && (f.finding?.ancla_regional?.estado === "hallado" || armadas.filas.length === 1)
            ? { ...f, veredicto: { ...f.veredicto, etiqueta: "Verificación parcial con compras del Estado" } }
            : f,
        )
      : armadas.filas;
  const { orden, fuera } = ordenarPorDiferencia(filas);
  const maximo = maximoEscala(orden);
  // Conteos sobre TODOS los ítems desglosados, no solo sobre los que entran al
  // gráfico: el denominador de la portada tiene que ser el requerimiento real.
  const conMedicion = filas.filter((f) => f.medido).length;
  const sobreRango = filas.filter((f) => f.sobreElRango).length;
  const estimados = filas.filter((f) => f.tipoReferencia === "estimacion_ia" && f.referenciaUnit !== null).length;
  // Los ítems del proceso (el registro) pueden ser más que los desglosados del expediente: cada conteo con su denominador
  // (2026-2543-197 decía «4 de 4 se compararon con el Estado» arriba de «4 de 13 ítems con referencia»).
  const nTotal = Math.max(items.length, filas.length);

  if (filas.length === 0) {
    return (
      <div className="px-5 py-6 text-dato leading-5 text-mute">
        <p className="flex items-start gap-2">
          <Package size={15} className="mt-0.5 shrink-0 text-mute" aria-hidden />
          <span>
            <strong className="font-semibold text-ink">Todavía no hay ítems desglosados.</strong> El agente de precios
            compara producto por producto contra el mercado, así que necesita el requerimiento técnico del expediente.
            En esta convocatoria no se pudo extraer esa lista: no se emite ninguna comparación en lugar de inventar una.
          </span>
        </p>
      </div>
    );
  }

  const detalles: Record<string, React.ReactNode> = {};
  for (const fila of orden) {
    detalles[fila.key] = <DetallePrecioItem fila={fila} fmtMoney={fmtMoney} />;
  }

  return (
    <div className="space-y-3 px-5 py-4">
      {padreLote && (
        <p className="border-l-2 border-line pl-3 text-rotulo text-mute">
          <strong className="font-semibold text-ink">Lote OCDS {padreLote.numero}:</strong>{" "}
          {padreLote.cantidad !== null ? `${numero(padreLote.cantidad)} ${padreLote.unidad}` : padreLote.unidad}{" "}
          por {padreLote.cuantia !== null ? fmtMoney(padreLote.cuantia) : "cuantía no publicada"}, desglosado acá en{" "}
          {plural(filas.length, "sub-ítem", "sub-ítems")}. {String(padreLote.descripcion).slice(0, 120)}
        </p>
      )}

      <p className="text-meta leading-snug text-ink">
        <strong className="font-semibold">
          {conMedicion} de {filas.length} ítems
        </strong>
        {filas.length < nTotal ? ` desglosados del expediente (el proceso tiene ${nTotal})` : ""}{" "}
        tienen precio de mercado medido con fuentes verificables
        {sobreRango > 0 ? (
          <>
            , y <strong className="font-semibold">{sobreRango}</strong> de esos {conMedicion} quedan por
            encima del techo del rango que se observó en el mercado.
          </>
        ) : conMedicion > 0 ? (
          ", y ninguno supera el techo del rango observado en el mercado."
        ) : (
          "."
        )}
        {conEstado > 0 && conMedicion < filas.length && (
          <>
            {" "}
            <strong className="font-semibold">
              {conEstado} de {nTotal}
            </strong>{" "}
            sí {conEstado === 1 ? "se comparó" : "se compararon"} con lo que pagó el Estado por el mismo bien: esa comparación está arriba.
          </>
        )}
        {estimados > 0 && (
          <>
            {" "}
            Otros {estimados} traen solo una estimación del modelo, sin búsqueda: se dibujan con textura y no cuentan
            en el sobreprecio.
          </>
        )}
      </p>

      {conMedicion === 0 && <SinComparacion n={filas.length} renglones={renglonesFicha} ocid={ocidFicha} conGrafico={orden.length > 0 && maximo > 0} />}

      {orden.length > 0 && maximo > 0 ? (
        <RangoPrecios
          filas={orden}
          maximo={maximo}
          fmtMoney={fmtMoney}
          detalles={detalles}
          titulo={`Comparación de precio ofertado contra el mercado en ${plural(orden.length, "ítem", "ítems")}, ordenados por diferencia en soles. La tabla completa con las mismas cifras está bajo "ver la tabla completa".`}
        />
      ) : (
        conMedicion > 0 && (
          <p className="text-rotulo text-mute">No hay gráfico: ningún ítem medido llegó a tener también su cantidad.</p>
        )
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Revelar
          titulo="Todos los ítems y sus precios"
          descripcion={`${numero(conMedicion)} con precio medido, ${numero(estimados)} estimados y ${numero(fuera.length)} sin comparación, de ${plural(filas.length, "ítem desglosado", "ítems desglosados")}`}
          detalle={<TablaPrecios filas={filas} fmtMoney={fmtMoney} />}
          ancho="xl"
          className="w-auto"
          etiqueta={`Ver la tabla completa de los ${filas.length} ítems con sus precios`}
        >
          <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-rotulo font-semibold text-ink transition-colors duration-rapido group-hover:bg-paperSoft">
            <Table2 size={12} aria-hidden />
            Ver la tabla completa ({filas.length} ítems)
          </span>
        </Revelar>

        {fuera.length > 0 && (
          <Revelar
            titulo={`${plural(fuera.length, "ítem", "ítems")} sin comparación de mercado`}
            descripcion="Qué falta en cada uno para poder compararlo"
            detalle={
              // Formato de panel (§14.4): la regla del agente a un clic, la lista en su bloque.
              // Sin chips ni datos arriba, el bloque abre el panel sin su borde superior.
              <CuerpoDetalle>
                <BloqueDetalle
                  titulo="Qué le falta a cada uno"
                  className="border-t-0 pt-0"
                  ayuda={
                    <Ayuda titulo="¿Qué necesita un ítem para compararse?">
                      La cantidad del requerimiento y al menos tres precios de mercado con fuente verificable. Estos no
                      las tienen. Se listan igual: desaparecerlos haría ver una cobertura que no existe.
                    </Ayuda>
                  }
                >
                  <ul className="divide-y divide-line/60 rounded-xl border border-line">
                    {fuera.map((f) => (
                      <li key={f.key} className="px-3.5 py-2.5">
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono text-rotulo font-semibold text-inkSoft">{f.numero}</span>
                          <span className="font-medium">{f.descripcion}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-x-3 text-rotulo text-mute">
                          <span>
                            {f.cantidad !== null ? `${numero(f.cantidad)} ${f.unidad}` : "sin cantidad en el expediente"}
                          </span>
                          <span>{f.motivo ?? f.veredicto.etiqueta.toLowerCase()}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </BloqueDetalle>
              </CuerpoDetalle>
            }
            ancho="lg"
            className="w-auto"
            etiqueta={`Ver por qué ${fuera.length} ítems no tienen comparación de mercado`}
          >
            <span className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-rotulo font-semibold text-inkSoft transition-colors duration-rapido group-hover:bg-paperSoft group-hover:text-ink">
              Por qué {fuera.length} {fuera.length === 1 ? "ítem no tiene" : "ítems no tienen"} comparación
            </span>
          </Revelar>
        )}
      </div>
    </div>
  );
}

/**
 * Cuando ningún ítem llegó a compararse: qué faltó, dicho con sus causas y sin gráfico. Si la ficha del contrato trae más
 * renglones que los ítems que miró el agente (el SEACE registró un paquete como un ítem: diez lubricantes en 1225937), lo
 * dice y lleva a esos renglones, con su marca y su precio contratado.
 */
function SinComparacion({ n, renglones, ocid, conGrafico = false }: { n: number; renglones: number; ocid: string | null; conGrafico?: boolean }) {
  const paquete = renglones > n;
  return (
    <div className="rounded-xl border border-line bg-paperSoft px-4 py-3.5">
      <p className="flex items-center gap-2 text-dato font-semibold text-ink">
        <SearchX size={16} className="shrink-0 text-mute" aria-hidden />
        El agente de precios no tuvo con qué comparar
      </p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5 text-meta leading-relaxed text-inkSoft marker:text-mute">
        {paquete && (
          <li>
            El SEACE registró la compra como {n === 1 ? "un solo ítem" : plural(n, "ítem", "ítems")} y el agente buscó precio para ese
            conjunto. Los documentos traen {plural(renglones, "renglón", "renglones")}, cada uno con su marca y su precio contratado.
          </li>
        )}
        <li>
          Para comparar hace falta, en cada ítem, un precio de mercado con su fuente y la cantidad comprada: ningún ítem llegó a
          tener las dos cosas.
        </li>
        <li>
          {conGrafico
            ? "Lo que se dibuja abajo es una estimación del modelo, sin búsqueda que la respalde: no cuenta para el sobreprecio."
            : "Sin esa base no se dibuja un gráfico ni se afirma un sobreprecio. El detalle de cada ítem está abajo."}
        </li>
      </ul>
      {paquete && ocid && (
        <Link
          href={rutaContrato(ocid, "ficha", { seccion: "items" })}
          prefetch={false}
          className="mt-2.5 inline-flex items-center gap-1 text-meta font-semibold text-granate underline-offset-2 hover:underline"
        >
          Ver los {numero(renglones)} renglones en la ficha del contrato <ChevronRight size={14} aria-hidden />
        </Link>
      )}
    </div>
  );
}
