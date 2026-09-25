"use client";

/**
 * Acción de equipo en la cabecera de /app/convocatoria: sortear un contrato del SEACE que
 * Vigía todavía no leyó y despachar los agentes. Sólo con sesión de equipo (`useEsAdmin`);
 * el público no ve nada. Pegar un código concreto sigue en /admin/analisis.
 *
 * Mientras corre, el progreso (grafo en vivo y observabilidad) va en un panel encima de la
 * lista, que se puede cerrar y reabrir: la lectura sigue y al terminar abre el informe.
 */

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { useEsAdmin } from "@/lib/useEsAdmin";
import { SortearSeace } from "./sections/SortearSeace";
import { LoadingView } from "./sections/LoadingView";
import { useDespacho } from "./useDespacho";

export function DespachoEquipo() {
  const esAdmin = useEsAdmin();
  const d = useDespacho();
  const [abierto, setAbierto] = useState(false);
  if (!esAdmin) return null;

  const despachar = (codigo: string) => {
    setAbierto(true);
    void d.despachar(codigo);
  };
  const cerrar = () => {
    setAbierto(false);
    if (!d.cargando) d.limpiarError();
  };

  return (
    <>
      {d.cargando ? (
        <button type="button" onClick={() => setAbierto(true)} className={claseAccion("secundario")}>
          <Loader2 size={14} className="animate-spin" aria-hidden />
          Leyendo {d.codigo}, {d.elapsed} s
        </button>
      ) : (
        <SortearSeace onRunNew={despachar} />
      )}
      <Panel
        abierto={abierto && (d.cargando || !!d.error)}
        onCerrar={cerrar}
        titulo={d.error ? "No se pudo analizar el contrato" : "Análisis en curso"}
        descripcion={
          <>
            Convocatoria <span className="font-mono">{d.codigo}</span> · corrida del equipo, no se acredita a ningún aporte
          </>
        }
        ancho="xl"
      >
        {d.error ? (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-crimson/25 bg-crimson-soft/60 p-3 text-[13px] text-crimsonTexto">
            <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" />
            <span>{d.error}</span>
          </p>
        ) : (
          <LoadingView stepIdx={d.stepIdx} elapsed={d.elapsed} codigo={d.codigo} liveEvents={d.liveEvents} />
        )}
      </Panel>
    </>
  );
}
