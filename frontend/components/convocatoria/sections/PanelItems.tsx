"use client";

/** Pestaña "Ítems y mercado" del informe, cargada con `next/dynamic` al abrirla (PanelesDossier). */

import { Package } from "lucide-react";
import { setRedactNames } from "../../Redact";
import { montoDossier } from "../dossier";
import type { PanelDossierProps } from "./PanelesDossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { ItemsConMarketPrice } from "./ItemsConMarketPrice";
import { MarketVerdictCard } from "./MarketVerdictCard";
import { PostoresSection } from "./PostoresSection";
import { SeccionSegura } from "./SeccionSegura";

export function PanelItems({ result, corrida, nItems, nombresPrivados }: PanelDossierProps) {
  setRedactNames(nombresPrivados);
  const items = result.items || [];
  const findings = result.market_analysis?.findings || [];
  const consolidados = result.document_analysis?.items_consolidados || [];
  const hayItems = items.length > 0 || findings.length > 0;
  const hayVeredicto = !!result.market_analysis?.veredicto_global;
  const hayPostores = (result.postores || []).length > 0;
  if (!hayItems && !hayVeredicto && !hayPostores) {
    return (
      <AvisoSeccion titulo="No hay ítems ni comparación de mercado para este contrato" icono={<Package size={16} aria-hidden />}>
        {result.market_analysis_raw && !result.market_analysis
          ? "La comparación de precios respondió, pero su resultado no se pudo leer, así que no se publica ninguna."
          : corrida.agentes.includes("market")
            ? "La comparación de precios corrió, pero no llegó a desglosar ítems comparables."
            : "La comparación de precios no llegó a correr en este análisis."}{" "}
        No se muestra una comparación que no se hizo.
      </AvisoSeccion>
    );
  }
  return (
    <div className="space-y-4">
      {hayItems && (
        <SeccionSegura nombre="los ítems">
          <section className="overflow-hidden rounded-2xl border border-line bg-paper">
            <div className="border-b border-line bg-paperSoft px-5 py-3">
              <h2 className="font-display text-xl font-bold text-ink">Qué se está comprando</h2>
              <p className="mt-0.5 text-[12px] text-mute">
                {nItems} {nItems === 1 ? "ítem" : "ítems"}
                {findings.length > items.length && ", desglosados al leer el requerimiento técnico"}
              </p>
              {consolidados.length > items.length && (
                <p className="mt-1 text-[12px] text-mute">
                  El registro OCDS reporta {items.length} {items.length === 1 ? "ítem global" : "ítems globales"}; al leer el
                  requerimiento técnico se desglosaron en {consolidados.length} productos.
                </p>
              )}
            </div>
            <ItemsConMarketPrice items={items} allItems={consolidados} market={result.market_analysis} fmtMoney={montoDossier} />
          </section>
        </SeccionSegura>
      )}
      {hayVeredicto && (
        <SeccionSegura nombre="el veredicto de mercado">
          <MarketVerdictCard market={result.market_analysis} fmtMoney={montoDossier} />
        </SeccionSegura>
      )}
      {hayPostores && (
        <SeccionSegura nombre="los postores">
          <PostoresSection postores={result.postores || []} fmtMoney={montoDossier} />
        </SeccionSegura>
      )}
    </div>
  );
}
