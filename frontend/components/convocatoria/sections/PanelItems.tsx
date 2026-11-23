"use client";

/** Pestaña "Ítems y mercado" del informe, cargada con `next/dynamic` al abrirla (PanelesDossier). */

import { Package } from "lucide-react";
import { setRedactNames } from "../../Redact";
import { montoDossier } from "../dossier";
import type { PanelDossierProps } from "./PanelesDossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { ItemsConMarketPrice } from "./ItemsConMarketPrice";
import { LaboratorioPrecios } from "./LaboratorioPrecios";
import { MarketVerdictCard, verificadoConEstado } from "./MarketVerdictCard";
import { PreciosDelEstado } from "./PreciosDelEstado";
import { SeccionSegura } from "./SeccionSegura";

export function PanelItems({ result, corrida, nItems, nombresPrivados, postoresContrato, ocidContrato }: PanelDossierProps) {
  setRedactNames(nombresPrivados);
  const items = result.items || [];
  const findings = result.market_analysis?.findings || [];
  const consolidados = result.document_analysis?.items_consolidados || [];
  const hayItems = items.length > 0 || findings.length > 0;
  const hayVeredicto = !!result.market_analysis?.veredicto_global;
  const precios = (result as any).precios_internos;
  // Lo que sí se verificó contra compras del Estado: el veredicto de mercado y el gráfico lo dicen.
  const estado = verificadoConEstado(precios);
  // «Lo que pagó el Estado por lo mismo» sólo con alguna referencia: con ninguna era una tarjeta entera que decía «Sin
  // referencia» mientras el análisis de abajo sí tenía compras del Estado con qué comparar (2026-11-23).
  const hayPrecios = (precios?.items || []).length > 0 && !!estado;
  // El laboratorio de precios (renglón por renglón, tiendas y compras del Estado) va primero y aparece aunque el agente
  // de precios no haya desglosado ítems: lo lee de su propio servicio, no de este análisis.
  const laboratorio = (
    <SeccionSegura nombre="el laboratorio de precios">
      <LaboratorioPrecios ocid={ocidContrato ?? postoresContrato?.ocid ?? null} />
    </SeccionSegura>
  );
  if (!hayItems && !hayVeredicto && !hayPrecios) {
    return (
      <div className="space-y-4">
        {laboratorio}
        <AvisoSeccion titulo="No hay ítems ni comparación de mercado para este contrato" icono={<Package size={16} aria-hidden />}>
          {result.market_analysis_raw && !result.market_analysis
            ? "La comparación de precios respondió, pero su resultado no se pudo leer, así que no se publica ninguna."
            : corrida.agentes.includes("market")
              ? "La comparación de precios corrió, pero no llegó a desglosar ítems comparables."
              : "La comparación de precios no llegó a correr en este análisis."}{" "}
          No se muestra una comparación que no se hizo.
        </AvisoSeccion>
      </div>
    );
  }
  // Primero el veredicto (lo que se concluye), después lo que se compró y la evidencia. Los postores ya no van aquí: están
  // en la ficha del contrato y en «Proveedor» (el usuario: «¿por qué aparece una vez más?»).
  return (
    <div className="space-y-4">
      {hayVeredicto && (
        <SeccionSegura nombre="el veredicto de mercado">
          <MarketVerdictCard market={result.market_analysis} fmtMoney={montoDossier} estado={estado} />
        </SeccionSegura>
      )}
      {laboratorio}
      {hayPrecios && (
        <SeccionSegura nombre="los precios del Estado">
          <PreciosDelEstado datos={precios} />
        </SeccionSegura>
      )}
      {hayItems && (
        <SeccionSegura nombre="los ítems">
          <section className="overflow-hidden rounded-2xl border border-line bg-paper">
            <div className="border-b border-line bg-paperSoft px-5 py-3">
              <h2 className="font-display text-seccion font-bold leading-tight text-ink">Qué se está comprando</h2>
              <p className="mt-0.5 text-rotulo text-mute">
                {nItems} {nItems === 1 ? "ítem" : "ítems"}
                {findings.length > items.length && ", desglosados al leer el requerimiento técnico"}
              </p>
              {consolidados.length > items.length && (
                <p className="mt-1 text-rotulo text-mute">
                  El registro OCDS reporta {items.length} {items.length === 1 ? "ítem global" : "ítems globales"}; al leer el
                  requerimiento técnico se desglosaron en {consolidados.length} productos.
                </p>
              )}
            </div>
            <ItemsConMarketPrice
              items={items}
              allItems={consolidados}
              market={result.market_analysis}
              fmtMoney={montoDossier}
              conEstado={estado?.conReferencia ?? 0}
              renglonesFicha={postoresContrato?.renglones ?? 0}
              ocidFicha={postoresContrato?.ocid ?? null}
            />
          </section>
        </SeccionSegura>
      )}
    </div>
  );
}
