"use client";

/**
 * La pestaña "Cómo se hizo" del informe, en tres partes (`Pestanas` del kit, `?traza=`):
 *   · Recorrido: qué pasos corrieron, qué recibió, hizo y entregó cada uno (Grafo o Texto);
 *   · Controles de calidad: los evaluadores del análisis y las reglas fuera del modelo;
 *   · Costo: lo que costó la lectura y quién lo consumió.
 *
 * Aquí sí va el vocabulario técnico (agentes, herramientas, tokens), siempre en segundo plano
 * detrás de la palabra llana. Los datos personales que trae la traza van en vidrio
 * (`ProveedorSensibles` + `TextoSeguro`).
 */

import { useMemo, useState } from "react";
import { Pestanas } from "@/components/patrones/Pestanas";
import type { ApiResult } from "../types";
import { ControlesCalidad } from "./ControlesCalidad";
import { CostoCorrida } from "./CostoCorrida";
import { construirRecorrido } from "./modelo";
import { RecorridoAgentes } from "./RecorridoAgentes";
import { ProveedorSensibles, sensiblesDeTraza } from "./redaccion";

const PARAM = "traza";

export function TrazaAnalisis({ result }: { result: ApiResult }) {
  const recorrido = useMemo(() => construirRecorrido(result), [result]);
  const sensibles = useMemo(() => sensiblesDeTraza(result.agent_trace || []), [result]);
  // Sólo cliente (ver RecorridoAgentes): leer la URL al montar no desfasa la hidratación.
  const [inicial] = useState<string | undefined>(() =>
    typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get(PARAM) ?? undefined,
  );

  return (
    <ProveedorSensibles valor={sensibles}>
      <Pestanas
        etiqueta="Partes de cómo se hizo el análisis"
        param={PARAM}
        activa={inicial}
        pestanas={[
          { clave: "recorrido", etiqueta: "Recorrido", contenido: <RecorridoAgentes recorrido={recorrido} result={result} /> },
          {
            clave: "controles",
            etiqueta: "Controles de calidad",
            conteo: recorrido.evaluaciones.length || null,
            contenido: <ControlesCalidad recorrido={recorrido} result={result} />,
          },
          { clave: "costo", etiqueta: "Costo", contenido: <CostoCorrida recorrido={recorrido} result={result} /> },
        ]}
      />
    </ProveedorSensibles>
  );
}
