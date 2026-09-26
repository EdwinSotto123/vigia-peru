"use client";

/**
 * El estado global de la auditoría, sondeado UNA vez para toda la página: las cifras de
 * arriba (`EstadoAuditoria`), el tablero de la pestaña Actividad (`ActividadAuditoria`) y
 * la versión con la que el tablero en vivo decide si vuelve a pedir su lista.
 *
 * Habla de todo el Perú aunque la página esté filtrada: el endpoint de resumen no acepta
 * `ubigeo` (se dice en el ⓘ de cada cifra).
 *
 * Sondea cada `pollMs` (5 s) sólo con la pestaña del navegador visible, y al volver a ella.
 * Con datos iniciales del servidor no vuelve a pedir al montar: el primer sondeo llega a los
 * `pollMs`. Sin región viva: la de la página es la del tablero en vivo.
 *
 * Datos: GET /financiamiento/procesamientos/resumen           (cada 5 s; trae `version`)
 *        GET /financiamiento/procesamientos/ritmo?dias=14      (sólo cuando termina un
 *            análisis o cambia el día de Lima; conteo en SQL, sin tope)
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DIAS_RITMO,
  PUBLIC_API_BASE,
  TOPE_LISTA_PROCESAMIENTOS,
  diaLima,
  leerRitmo,
  procesamientosQueryString,
  ritmoDesdeLista,
  rutaRitmo,
  type Procesamiento,
  type RitmoProcesamientos,
} from "@/lib/auditoria";
import type { ResumenProcesamientoVivo } from "@/lib/contratos";
import { anotarResumen, apiNueva } from "@/lib/capacidades";

/** Días de la ventana del ritmo (vive en lib/auditoria: el servidor también lo usa). */
export { DIAS_RITMO };

export interface ResumenVivo {
  data: ResumenProcesamientoVivo | null;
  fallo: boolean;
  /** 0 hasta montar: el HTML del servidor no lleva relativos ("hace 3 h"). Avanza de a un minuto. */
  ahora: number;
  /** Análisis terminados por día (hora de Lima), hasta hoy inclusive. */
  ritmo: { dia: string; n: number }[] | null;
  /** Cuándo terminó el último análisis (ms), o null. */
  ultimoFin: number | null;
  /** El ritmo salió de una lista con tope y puede faltar algún día viejo (sólo con la API vieja). */
  ritmoParcial: boolean;
}

const Ctx = createContext<ResumenVivo | null>(null);

export function useResumenAuditoria(): ResumenVivo {
  const c = useContext(Ctx);
  if (!c) throw new Error("useResumenAuditoria fuera de <ResumenAuditoria>");
  return c;
}

/** Igual, pero sin exigir el proveedor: el tablero en vivo también vive fuera de /app/auditoria. */
export function useResumenAuditoriaOpcional(): ResumenVivo | null {
  return useContext(Ctx);
}

// COMPAT-API-VIEJA: `/ritmo` sólo con la API nueva (el resumen trae `version`, ver
// lib/capacidades); si igual respondiera 404, esta pestaña no lo vuelve a pedir. Con la API
// vieja se cuenta sobre la lista de procesados (con tope), como antes. Borrar cuando esté en prod.
let ritmoSinEndpoint = false;

async function pedirRitmo(dias: number, signal: AbortSignal): Promise<RitmoProcesamientos | null> {
  if (!ritmoSinEndpoint && (await apiNueva())) {
    // `no-cache`: el navegador revalida con su ETag (If-None-Match) y un 304 no baja nada.
    const res = await fetch(`${PUBLIC_API_BASE}${rutaRitmo(dias)}`, { cache: "no-cache", signal });
    if (res.ok) return leerRitmo(await res.json());
    if (res.status !== 404) return null;
    ritmoSinEndpoint = true;
  }
  // COMPAT-API-VIEJA: el ritmo sobre los últimos procesados de la lista.
  const qs = procesamientosQueryString({ estado: "procesado", limit: TOPE_LISTA_PROCESAMIENTOS });
  const res = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos?${qs}`, { cache: "no-store", signal });
  if (!res.ok) return null;
  const j = (await res.json()) as { data?: Procesamiento[] };
  return Array.isArray(j.data) ? ritmoDesdeLista(j.data, Date.now(), dias) : null;
}

const ultimoDia = (r: RitmoProcesamientos | null | undefined) => (r?.dias.length ? r.dias[r.dias.length - 1].dia : null);

export function ResumenAuditoria({
  initial,
  ritmoInicial,
  pollMs = 5000,
  children,
}: {
  initial?: ResumenProcesamientoVivo | null;
  /** El ritmo ya pedido en el servidor (todo el Perú). */
  ritmoInicial?: RitmoProcesamientos | null;
  pollMs?: number;
  children: ReactNode;
}) {
  const [data, setData] = useState<ResumenProcesamientoVivo | null>(initial ?? null);
  const [fallo, setFallo] = useState(false);
  const [ahora, setAhora] = useState(0);
  const [ritmo, setRitmo] = useState<RitmoProcesamientos | null>(ritmoInicial ?? null);
  const procesadosConocidos = useRef<number | null>(initial?.porEstado?.procesado ?? null);
  // El último día del ritmo que se tiene: si el día de Lima cambia, se vuelve a pedir.
  const diaDelRitmo = useRef<string | null>(ultimoDia(ritmoInicial));
  const ctrlRitmo = useRef<AbortController | null>(null);

  useEffect(() => {
    let vivo = true;
    let ctrl: AbortController | null = null;

    const actualizarRitmo = async () => {
      ctrlRitmo.current?.abort();
      const c = new AbortController();
      ctrlRitmo.current = c;
      try {
        const r = await pedirRitmo(DIAS_RITMO, c.signal);
        if (!vivo || !r) return;
        diaDelRitmo.current = ultimoDia(r);
        setRitmo(r);
      } catch { /* el ritmo es accesorio: si falla, queda el último */ }
    };

    const cargar = async () => {
      if (document.visibilityState !== "visible") return;
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos/resumen`, { cache: "no-cache", signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ResumenProcesamientoVivo;
        if (!vivo) return;
        anotarResumen(json);
        setData(json);
        setFallo(false);
        // El ritmo sólo cambia cuando termina un análisis: se vuelve a pedir sólo entonces.
        const n = json.porEstado?.procesado ?? null;
        if (n != null && n !== procesadosConocidos.current) {
          procesadosConocidos.current = n;
          void actualizarRitmo();
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError" || !vivo) return;
        setFallo(true);
      }
    };

    // Con datos del servidor, el primer sondeo va a los `pollMs`; sin ellos, ya.
    if (initial) anotarResumen(initial);
    if (initial == null) void cargar();
    if (ritmoInicial == null) void actualizarRitmo();
    const id = window.setInterval(cargar, Math.max(2000, pollMs));
    const alVolver = () => { if (document.visibilityState === "visible") void cargar(); };
    document.addEventListener("visibilitychange", alVolver);

    // Un minuto basta: acá no hay cronómetros, sólo "hace N h". Si cambió el día de Lima,
    // la ventana del ritmo se corre un día.
    const tic = () => {
      const t = Date.now();
      setAhora(t);
      const hoy = diaLima(t);
      if (hoy && diaDelRitmo.current && hoy !== diaDelRitmo.current) {
        diaDelRitmo.current = hoy;
        void actualizarRitmo();
      }
    };
    tic();
    const reloj = window.setInterval(tic, 60_000);
    return () => {
      vivo = false;
      ctrl?.abort();
      ctrlRitmo.current?.abort();
      window.clearInterval(id);
      window.clearInterval(reloj);
      document.removeEventListener("visibilitychange", alVolver);
    };
    // Los datos iniciales sólo deciden la primera carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs]);

  const ultimoFin = useMemo(() => {
    const t = ritmo?.ultimoFin ? Date.parse(ritmo.ultimoFin) : NaN;
    return Number.isFinite(t) ? t : null;
  }, [ritmo]);

  const valor = useMemo<ResumenVivo>(
    () => ({ data, fallo, ahora, ritmo: ritmo?.dias.length ? ritmo.dias : null, ultimoFin, ritmoParcial: !!ritmo?.parcial }),
    [data, fallo, ahora, ritmo, ultimoFin],
  );
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
