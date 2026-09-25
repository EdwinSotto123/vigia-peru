"use client";

/**
 * Los tres carriles del DAG (Expediente · Proveedor · Síntesis) en su versión completa y en su
 * versión estrecha.
 *
 *  · Completa (`compacto = false`): el EJE DE TIEMPO COMPARTIDO — cada agente con su ventana
 *    real de ejecución (`fases[clave].desde` / `.hasta`) dibujada contra el mismo eje, así el
 *    paralelismo del DAG se VE en vez de afirmarse. Vive en components/agentes/EjeAgentes.
 *  · Estrecha (`compacto = true`, el aside de /app/contratos/[ocid]): la tira de chips, que ahí
 *    sigue siendo la lectura correcta porque no hay ancho para un eje legible.
 *
 * De las animaciones que había quedó una sola: el punto del agente EN CURSO, que es estado que
 * cambia de verdad mientras se mira. Las transiciones de ancho bajaron al rango del producto.
 */

import { CARRILES, duracion, faseLabel, faseLabelCorto, humanizar, motivoHumano, type EstadoProc, type FasesMap, type SenalRiesgo } from "@/lib/auditoria";
import { EjeAgentes, ventanaDe } from "@/components/agentes/EjeAgentes";
import { ESTADO_PASO, IconoEstado } from "@/components/agentes/EstadoPaso";
import { agruparPorAgente, desdeSenalRiesgo } from "@/components/agentes/senales";

interface Props {
  fases: FasesMap;
  estado: EstadoProc;
  ahora: number;
  compacto?: boolean;
  /** Señales del análisis: si llegan, cada agente muestra cuántas emitió y se vuelve filtro. */
  senales?: SenalRiesgo[] | null;
}

export function DagCarriles({ fases, estado, ahora, compacto = false, senales }: Props) {
  if (!compacto) {
    const normalizadas = senales?.length ? senales.map(desdeSenalRiesgo) : null;
    return (
      <EjeAgentes
        fases={fases}
        estado={estado}
        ahora={ahora}
        senalesPorAgente={normalizadas ? agruparPorAgente(normalizadas) : undefined}
        totalSenales={normalizadas?.length}
      />
    );
  }

  return (
    <div className="space-y-2" aria-label="Agentes del análisis por carril">
      {CARRILES.map((c) => (
        <div key={c.key} className="flex flex-col gap-1">
          <div className="shrink-0 text-[12px] font-semibold text-mute">{c.label}</div>
          <ol className="flex min-w-0 flex-wrap items-center gap-y-1.5">
            {c.pasos.map((grupo, gi) => (
              <li key={gi} className="flex items-center">
                {gi > 0 && <span aria-hidden className="mx-1 h-px w-2 bg-line" />}
                <span className="flex flex-wrap items-center gap-1">
                  {grupo.map((key, ki) => {
                    const v = ventanaDe(fases, key, estado, ahora);
                    const e = ESTADO_PASO[v.estado];
                    const t = v.estado === "hecho" || (v.estado === "corriendo" && ahora > 0) ? v.ms : null;
                    const title =
                      v.estado === "omitido" ? `${faseLabel(key)}: omitido, ${motivoHumano(v.motivo)}`
                        : v.estado === "error" ? humanizar({ kind: "error", name: key, msg: v.motivo ?? "" })
                          : v.estado === "corriendo" ? `${faseLabel(key)}: en curso${v.msg ? `. ${humanizar({ kind: "phase", name: key, msg: v.msg })}` : ""}`
                            : v.estado === "hecho" ? `${faseLabel(key)}: completada${v.motivo ? `, ${motivoHumano(v.motivo)}` : ""}`
                              : `${faseLabel(key)}: pendiente`;
                    return (
                      <span key={key} className="flex items-center">
                        {ki > 0 && <span aria-hidden className="mx-1 text-[11px] text-mute/70">∥</span>}
                        <span
                          title={title}
                          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium transition-colors duration-normal ${e.borde} ${e.fondo} ${
                            v.estado === "omitido" ? "text-mute/70 line-through decoration-mute/50" : "text-ink"
                          }`}
                        >
                          <IconoEstado estado={v.estado} size={10} />
                          {faseLabelCorto(key)}
                          <span className="sr-only">{` (${e.label})`}</span>
                          {t != null && v.estado === "corriendo" && (
                            <span className="font-mono text-[11px] tabular-nums text-amberTexto" suppressHydrationWarning>
                              {duracion(t)}
                            </span>
                          )}
                        </span>
                      </span>
                    );
                  })}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

/** Mini-progreso por carril (tres barritas) en la fila de un contrato en análisis. Sólo `span`: va dentro del enlace de la fila. */
export function MiniCarriles({ carriles }: { carriles: { key: string; label: string; pct: number; activo: boolean }[] }) {
  return (
    <span
      className="flex items-center gap-1"
      role="img"
      aria-label={`Avance por carril: ${carriles.map((c) => `${c.label} ${c.pct} %`).join(", ")}`}
    >
      {carriles.map((c) => (
        <span key={c.key} title={`${c.label}: ${c.pct}%`} className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-paperDeep">
          <span
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-panel ease-salida ${c.pct >= 100 ? "bg-moss" : "bg-amber"}`}
            style={{ width: `${Math.max(c.pct > 0 ? 8 : 0, c.pct)}%` }}
          />
          {/* La única animación que queda: el carril con un agente corriendo ahora mismo. */}
          {c.activo && c.pct < 100 && <span aria-hidden className="absolute inset-y-0 right-0 w-1/3 animate-pulse rounded-full bg-amber/40" />}
        </span>
      ))}
    </span>
  );
}
