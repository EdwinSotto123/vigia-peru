"use client";

/**
 * El estado global de la auditoría, sondeado UNA vez para toda la página: las cifras de
 * arriba (`EstadoAuditoria`) y el tablero de la pestaña Actividad (`ActividadAuditoria`)
 * leen el mismo resumen. Antes eran un solo bloque apilado arriba; al separarlos en dos
 * lugares de la página, cada uno con su propio sondeo, habrían pedido lo mismo dos veces
 * cada 5 s y podrían mostrar números de dos momentos distintos.
 *
 * Habla de todo el Perú aunque la página esté filtrada: el endpoint de resumen no acepta
 * `ubigeo` (se dice en el ⓘ de cada cifra).
 *
 * Sondea cada `pollMs` (5 s) sólo con la pestaña del navegador visible. Sin región viva: la
 * de la página es la del tablero en vivo, que anuncia cambios reales.
 *
 * Datos: GET /financiamiento/procesamientos/resumen
 *        GET /financiamiento/procesamientos?estado=procesado&limit=300 (ritmo por día)
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PUBLIC_API_BASE, procesamientosQueryString, ritmoDiario, type Procesamiento } from "@/lib/auditoria";
import type { ResumenProcesamientoVivo } from "@/lib/contratos";

/** Días de la ventana del ritmo (barras por día). */
export const DIAS_RITMO = 14;

export interface ResumenVivo {
  data: ResumenProcesamientoVivo | null;
  fallo: boolean;
  /** 0 hasta montar: el HTML del servidor no lleva relativos ("hace 3 h"). */
  ahora: number;
  /** Análisis terminados por día (hora de Lima), hasta hoy inclusive. */
  ritmo: { dia: string; n: number }[] | null;
  /** Cuándo terminó el último análisis (ms), o null. */
  ultimoFin: number | null;
}

const Ctx = createContext<ResumenVivo | null>(null);

export function useResumenAuditoria(): ResumenVivo {
  const c = useContext(Ctx);
  if (!c) throw new Error("useResumenAuditoria fuera de <ResumenAuditoria>");
  return c;
}

export function ResumenAuditoria({
  initial,
  finalizados: finalizadosIniciales,
  pollMs = 5000,
  children,
}: {
  initial?: ResumenProcesamientoVivo | null;
  /** `finalizadoAt` de los procesados (todo el Perú), ya pedidos en el servidor. */
  finalizados?: string[] | null;
  pollMs?: number;
  children: ReactNode;
}) {
  const [data, setData] = useState<ResumenProcesamientoVivo | null>(initial ?? null);
  const [fallo, setFallo] = useState(false);
  const [ahora, setAhora] = useState(0);
  const [finalizados, setFinalizados] = useState<string[] | null>(finalizadosIniciales ?? null);
  const procesadosConocidos = useRef<number | null>(initial?.porEstado?.procesado ?? null);

  useEffect(() => {
    let vivo = true;
    let ctrl: AbortController | null = null;
    const pedirRitmo = async () => {
      try {
        const qs = procesamientosQueryString({ estado: "procesado", limit: 300 });
        const res = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos?${qs}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { data?: Procesamiento[] };
        if (vivo && Array.isArray(j.data)) setFinalizados(j.data.map((p) => p.finalizadoAt).filter((f): f is string => !!f));
      } catch { /* el ritmo es accesorio: si falla, queda el último */ }
    };
    const cargar = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos/resumen`, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ResumenProcesamientoVivo;
        if (!vivo) return;
        setData(json);
        setFallo(false);
        // El ritmo sólo cambia cuando termina un análisis: se vuelve a pedir sólo entonces.
        const n = json.porEstado?.procesado ?? null;
        if (n != null && n !== procesadosConocidos.current) {
          procesadosConocidos.current = n;
          void pedirRitmo();
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError" || !vivo) return;
        setFallo(true);
      }
    };
    if (finalizadosIniciales == null) void pedirRitmo();
    void cargar();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void cargar(); }, Math.max(2000, pollMs));
    // Un minuto basta: acá no hay cronómetros, sólo "hace N h".
    setAhora(Date.now());
    const tick = window.setInterval(() => setAhora(Date.now()), 60_000);
    return () => { vivo = false; ctrl?.abort(); window.clearInterval(id); window.clearInterval(tick); };
    // `finalizadosIniciales` sólo decide la primera carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs]);

  // Ritmo real, en días de Lima. `ahora` es 0 en el servidor: el día de hoy se toma del reloj.
  const reloj = ahora || Date.now();
  const minuto = Math.floor(reloj / 60_000);
  const ritmo = useMemo(() => (finalizados ? ritmoDiario(finalizados, reloj, DIAS_RITMO) : null), [finalizados, minuto]); // eslint-disable-line react-hooks/exhaustive-deps
  const ultimoFin = useMemo(() => {
    let max = -Infinity;
    for (const f of finalizados ?? []) { const t = Date.parse(f); if (Number.isFinite(t) && t > max) max = t; }
    return Number.isFinite(max) ? max : null;
  }, [finalizados]);

  const valor = useMemo(() => ({ data, fallo, ahora, ritmo, ultimoFin }), [data, fallo, ahora, ritmo, ultimoFin]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
