"use client";

/**
 * El panel de un nodo del grafo (DESIGN_SYSTEM.md §14.4): chips de qué es, las cifras de su
 * consumo si las hay, y los tres bloques —qué recibió, qué hizo, qué entregó—, más quién sigue.
 * Los nodos vecinos se abren desde acá sin cerrar el panel.
 */

import { ArrowRight } from "lucide-react";
import { BloqueDetalle, ChipsDetalle, CuerpoDetalle } from "@/components/patrones/Detalle";
import { Indicadores } from "@/components/listado/Indicadores";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import type { ApiResult } from "../types";
import { BloqueEntrego, BloqueHizo, BloqueRecibio, ICONO_TIPO } from "./BloquesNodo";
import { RAMA_LABEL, usd } from "./cifras";
import { ControlesEnResumen } from "./ControlesCalidad";
import type { NodoTraza, Recorrido } from "./modelo";
import { ESTADO_NODO, TIPO_NODO } from "./nodos";

export function DetalleNodo({
  nodo,
  recorrido,
  result,
  onIr,
  onVerControles,
}: {
  nodo: NodoTraza;
  recorrido: Recorrido;
  result: ApiResult;
  onIr: (clave: string) => void;
  onVerControles: () => void;
}) {
  const Icono = ICONO_TIPO[nodo.tipo];
  const c = nodo.consumo;
  const nota = nodo.delegacion?.nota;
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <span className="pill border-line bg-paperSoft text-inkSoft">
          <Icono size={12} aria-hidden />
          {TIPO_NODO[nodo.tipo]}
        </span>
        {RAMA_LABEL[nodo.rama] !== TIPO_NODO[nodo.tipo] && <span className="pill border-line bg-paper text-inkSoft">{RAMA_LABEL[nodo.rama]}</span>}
        {nota && <span className="pill border-line bg-paper text-inkSoft">{nota === "en paralelo" ? "Corrió en paralelo" : "Lote determinista"}</span>}
        {nodo.estado !== "corrio" && (
          <span
            className={cn(
              "pill font-semibold",
              nodo.estado === "fallo" ? "border-crimson/40 bg-crimson-soft text-crimsonTexto" : "border-dashed border-line bg-paperSoft text-mute",
            )}
          >
            {ESTADO_NODO[nodo.estado]}
          </span>
        )}
      </ChipsDetalle>

      {c && (
        <Indicadores
          items={[
            { valor: numero(c.llamadas), etiqueta: c.llamadas === 1 ? "llamada al modelo" : "llamadas al modelo" },
            { valor: numero(c.tokens), etiqueta: "tokens", contexto: `${numero(c.entrada)} de entrada y ${numero(c.salida)} de salida` },
            { valor: usd(c.costo), etiqueta: "de cómputo" },
          ]}
        />
      )}

      <BloqueDetalle titulo="Qué recibió">
        <BloqueRecibio nodo={nodo} recorrido={recorrido} result={result} onIr={onIr} />
      </BloqueDetalle>

      <BloqueDetalle titulo="Qué hizo">
        {nodo.clave === "self_eval" ? (
          <ControlesEnResumen recorrido={recorrido} onVerControles={onVerControles} />
        ) : (
          <BloqueHizo nodo={nodo} />
        )}
      </BloqueDetalle>

      <BloqueDetalle titulo="Qué entregó">
        <BloqueEntrego nodo={nodo} recorrido={recorrido} result={result} />
      </BloqueDetalle>

      {nodo.sale.length > 0 && (
        <BloqueDetalle titulo={nodo.sale.length === 1 ? "Quién sigue" : "Quiénes siguen"}>
          <ul className="flex flex-wrap gap-1.5">
            {nodo.sale.map((k) => (
              <li key={k}>
                <button
                  type="button"
                  onClick={() => onIr(k)}
                  className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-line bg-paper px-3 py-1 text-[12.5px] font-medium text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50"
                >
                  {recorrido.porClave[k]?.nombre ?? k}
                  <ArrowRight size={12} className="text-mute" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </BloqueDetalle>
      )}
    </CuerpoDetalle>
  );
}
