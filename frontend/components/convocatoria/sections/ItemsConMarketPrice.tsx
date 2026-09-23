"use client";

import { Package, Table2 } from "lucide-react";
import { DetallePrecioItem, TablaPrecios } from "@/components/charts/DetallePrecioItem";
import { RangoPrecios } from "@/components/charts/RangoPrecios";
import { construirFilas, maximoEscala, ordenarPorDiferencia } from "@/components/charts/mercado";
import { Revelar } from "@/components/ui/Revelar";

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
}: {
  items: any[];
  allItems?: any[];
  market: any;
  fmtMoney: (n: any) => string;
}) {
  const { filas, padreLote } = construirFilas({ items, allItems, market });
  const { orden, fuera } = ordenarPorDiferencia(filas);
  const maximo = maximoEscala(orden);
  // Conteos sobre TODOS los ítems desglosados, no solo sobre los que entran al
  // gráfico: el denominador de la portada tiene que ser el requerimiento real.
  const conMedicion = filas.filter((f) => f.medido).length;
  const sobreRango = filas.filter((f) => f.sobreElRango).length;
  const estimados = filas.filter((f) => f.tipoReferencia === "estimacion_ia" && f.referenciaUnit !== null).length;

  if (filas.length === 0) {
    return (
      <div className="px-5 py-6 text-sm text-mute">
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
        <p className="border-l-2 border-heroViolet/40 pl-3 text-[12px] text-mute">
          <strong className="font-semibold text-ink">Lote OCDS {padreLote.numero}:</strong>{" "}
          {padreLote.cantidad !== null ? `${padreLote.cantidad.toLocaleString("es-PE")} ${padreLote.unidad}` : padreLote.unidad}{" "}
          por {padreLote.cuantia !== null ? fmtMoney(padreLote.cuantia) : "cuantía no publicada"}, desglosado acá en{" "}
          {filas.length} sub-ítem(s). {String(padreLote.descripcion).slice(0, 120)}
        </p>
      )}

      <p className="text-[13px] leading-snug text-ink">
        <strong className="font-semibold">
          {conMedicion} de {filas.length} ítems
        </strong>{" "}
        tienen precio de mercado medido con fuentes verificables
        {sobreRango > 0 ? (
          <>
            , y <strong className="font-semibold text-rust">{sobreRango}</strong> de esos {conMedicion} quedan por
            encima del techo del rango que se observó en el mercado.
          </>
        ) : conMedicion > 0 ? (
          ", y ninguno supera el techo del rango observado en el mercado."
        ) : (
          "."
        )}
        {estimados > 0 && (
          <>
            {" "}
            Otros {estimados} traen solo una estimación del modelo, sin búsqueda: se dibujan con textura y no cuentan
            en el sobreprecio.
          </>
        )}
      </p>

      {orden.length > 0 && maximo > 0 ? (
        <RangoPrecios
          filas={orden}
          maximo={maximo}
          fmtMoney={fmtMoney}
          detalles={detalles}
          titulo={`Comparación de precio ofertado contra el mercado en ${orden.length} ítem(s), ordenados por diferencia en soles. La tabla completa con las mismas cifras está bajo "ver la tabla completa".`}
        />
      ) : (
        <p className="border-l-2 border-line pl-3 text-[12px] text-mute">
          Ningún ítem llegó a tener precio de mercado y cantidad a la vez, que es lo mínimo para compararlo. No hay
          gráfico porque no hay comparación que dibujar. El detalle de por qué está abajo, ítem por ítem.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Revelar
          titulo="Todos los ítems y sus precios"
          descripcion={`${conMedicion} medido(s), ${estimados} estimado(s) y ${fuera.length} sin comparación, de ${filas.length} ítems desglosados`}
          detalle={<TablaPrecios filas={filas} fmtMoney={fmtMoney} />}
          ancho="xl"
          className="w-auto"
          etiqueta={`Ver la tabla completa de los ${filas.length} ítems con sus precios`}
        >
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors duration-rapido group-hover:bg-paperSoft">
            <Table2 size={12} aria-hidden />
            Ver la tabla completa ({filas.length} ítems)
          </span>
        </Revelar>

        {fuera.length > 0 && (
          <Revelar
            titulo={`${fuera.length} ítem(s) sin comparación de mercado`}
            descripcion="Qué falta en cada uno para poder compararlo"
            detalle={
              <div className="text-[13px] text-ink">
                <p className="mb-3 text-[12px] text-mute">
                  El agente de precios necesita dos cosas para comparar un ítem: la cantidad del requerimiento y al
                  menos tres precios de mercado con fuente verificable. Estos no las tienen. Se listan igual:
                  desaparecerlos haría ver una cobertura que no existe.
                </p>
                <ul className="divide-y divide-line/60">
                  {fuera.map((f) => (
                    <li key={f.key} className="py-2">
                      <div className="flex items-baseline gap-1.5">
                        <span className="font-mono text-[10px] font-bold text-heroViolet">{f.numero}</span>
                        <span className="font-medium">{f.descripcion}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 text-[11px] text-mute">
                        <span>
                          {f.cantidad !== null
                            ? `${f.cantidad.toLocaleString("es-PE")} ${f.unidad}`
                            : "sin cantidad en el expediente"}
                        </span>
                        <span>{f.motivo ?? f.veredicto.etiqueta.toLowerCase()}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            }
            ancho="lg"
            className="w-auto"
            etiqueta={`Ver por qué ${fuera.length} ítems no tienen comparación de mercado`}
          >
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1 text-[11px] font-semibold text-mute transition-colors duration-rapido group-hover:bg-paperSoft group-hover:text-ink">
              Por qué {fuera.length} {fuera.length === 1 ? "ítem no tiene" : "ítems no tienen"} comparación
            </span>
          </Revelar>
        )}
      </div>
    </div>
  );
}
