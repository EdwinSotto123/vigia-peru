"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Loader2, RotateCw } from "lucide-react";
import { CuentaGrupo } from "@/components/listado";
import { TablaEvidencia } from "@/components/contratos/TablaEvidencia";
import { OrdenesFraccionadas } from "@/components/contratos/EvidenciaCruce";
import { baseApiNavegador } from "@/lib/api-client";
import type { EvidenciaAntecedente } from "@/lib/empresas";
import { numero } from "@/lib/formato";

/**
 * Los registros oficiales de UN antecedente de la empresa, pedidos al abrir su panel: los mismos que la ficha del contrato
 * muestra bajo cada antecedente (los aportes en la ONPE, el cargo en el JNE, cada penalidad, la resolución del Tribunal,
 * los otros procesos que le ganó a la entidad, la obra en INFOBRAS…) y, en «Órdenes que pasan 8 UIT», cada día con sus
 * órdenes. La tabla de casos no los trae: una empresa grande tiene cientos. El panel monta sólo la fila abierta
 * (DetalleFilas), así que se pide uno a la vez. Sin DNI ni nombres de personas naturales: así los da la API.
 */
export function EvidenciaDelAntecedente({ ruc, tipo, clave }: { ruc: string; tipo: string; clave: string }) {
  const [estado, setEstado] = useState<{ datos: EvidenciaAntecedente | null; error: boolean }>({ datos: null, error: false });
  const [intento, setIntento] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setEstado({ datos: null, error: false });
    fetch(`${baseApiNavegador()}/empresas/${ruc}/antecedentes/evidencia?tipo=${encodeURIComponent(tipo)}&clave=${encodeURIComponent(clave)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? (r.json() as Promise<EvidenciaAntecedente>) : Promise.reject(new Error(String(r.status)))))
      .then((datos) => setEstado({ datos, error: false }))
      .catch(() => {
        if (!ctl.signal.aborted) setEstado({ datos: null, error: true });
      });
    return () => ctl.abort();
  }, [ruc, tipo, clave, intento]);

  if (estado.error) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-inkSoft" role="status">
        No pudimos traer los registros ahora.
        <button
          type="button"
          onClick={() => setIntento((i) => i + 1)}
          className="inline-flex min-h-9 items-center gap-1.5 font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          <RotateCw size={14} aria-hidden />
          Reintentar
        </button>
      </div>
    );
  }
  if (!estado.datos) {
    return (
      <p className="flex items-center gap-2 text-meta text-mute" role="status">
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Trayendo los registros de la fuente…
      </p>
    );
  }
  const { evidencia, dias } = estado.datos;
  if (!evidencia.length && !dias.length) {
    return <p className="text-meta text-mute">La fuente no trae más registros que los datos de arriba: su enlace va al pie.</p>;
  }
  return (
    <div className="space-y-5">
      {dias.length > 0 && <OrdenesFraccionadas dias={dias} />}
      {evidencia.map((e) => (
        <section key={e.titulo} data-evidencia className="space-y-2">
          <h4 className="flex flex-wrap items-center gap-1.5 text-dato font-semibold text-ink">
            {e.titulo}
            <CuentaGrupo>{numero(e.total ?? e.filas.length)}</CuentaGrupo>
          </h4>
          {e.total != null && e.total > e.filas.length && (
            <p className="text-rotulo text-mute">
              Aquí van los {numero(e.filas.length)} más recientes; la fuente tiene los {numero(e.total)}.
            </p>
          )}
          <TablaEvidencia columnas={e.columnas} filas={e.filas} titulo={e.titulo} fuente={e.enlace} />
          {(e.verificar || e.enlace) && (
            <p className="text-rotulo leading-relaxed text-mute">
              {e.verificar}{" "}
              {e.enlace && (
                <a
                  href={e.enlace.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink"
                >
                  {e.enlace.texto} <ArrowUpRight size={11} aria-hidden className="inline align-baseline" />
                </a>
              )}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
