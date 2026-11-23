"use client";

import { useMemo } from "react";
import { nombresPrivadosDe } from "./nombresPrivados";
import { PanelTraza } from "./sections/PanelTraza";
import type { ApiResult } from "./types";

/**
 * La vista «Trazabilidad» de un contrato leído sin lectura en vivo (la mayoría: los lee el lote, no un aporte): el
 * recorrido de los agentes, sus controles de calidad y su costo, que antes eran la última pestaña del dictamen
 * («Cómo se hizo»). `?vista=vivo` de esos contratos redirigía a la ficha sin decir nada: ahora abre esto (auditoría
 * visual del 2026-11-13). La traza se pide al abrir (PanelTraza), como antes.
 */
export function TrazaContrato({ result, ocid }: { result: ApiResult; ocid: string }) {
  const nombresPrivados = useMemo(() => nombresPrivadosDe(result), [result]);
  return (
    // El título de la vista va dentro de la tarjeta del resumen de la corrida (antes flotaba sobre el fondo, encima de ella).
    <PanelTraza
      result={result}
      nombresPrivados={nombresPrivados}
      ocidContrato={ocid}
      cabecera={{
        titulo: "Trazabilidad",
        bajada: "Qué agentes leyeron este contrato, en qué orden, qué consultó cada uno, cómo se controló su trabajo y cuánto costó.",
      }}
    />
  );
}
