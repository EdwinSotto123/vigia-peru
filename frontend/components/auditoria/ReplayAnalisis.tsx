"use client";

/**
 * "Ver cómo se analizó": repite, con los eventos REALES de este contrato (bitácora +
 * timestamps guardados en Postgres), la misma animación que se ve en vivo mientras un
 * agente corre — para poder mirarla en cualquier momento, no solo en la rara ventana en
 * que algo está procesando de verdad. Reusa DagCarriles/Bitacora tal cual: solo les da
 * un "ahora" virtual que avanza más rápido que el reloj real (toda corrida, sea de 3 o de
 * 10 minutos, se ve en ≈ `DURACION_OBJETIVO_MS`), preservando el ritmo relativo real entre
 * eventos (una ráfaga paralela se sigue viendo como ráfaga).
 *
 * No hace ninguna llamada de red: todo sale de `eventos`, ya cargados por ContratoEnVivo.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { faseHumana, nodoActivoYHechos, reducirFases, type EstadoProc, type EventoFase } from "@/lib/auditoria";
import { FlowGraph } from "@/components/convocatoria/sections/FlowGraph";
import { Bitacora } from "./Bitacora";
import { DagCarriles } from "./DagCarriles";

const DURACION_OBJETIVO_MS = 26_000;
const TICK_MS = 100;

interface Props {
  eventos: EventoFase[];
  estadoFinal: EstadoProc;
  compacto?: boolean;
}

export function ReplayAnalisis({ eventos, estadoFinal, compacto = false }: Props) {
  const ordenados = useMemo(
    () => [...eventos].filter((e) => e?.ts).sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime()),
    [eventos],
  );
  const t0 = ordenados.length ? new Date(ordenados[0].ts).getTime() : 0;
  const duracionReal = ordenados.length ? new Date(ordenados[ordenados.length - 1].ts).getTime() - t0 : 0;
  const factor = duracionReal > DURACION_OBJETIVO_MS ? duracionReal / DURACION_OBJETIVO_MS : 1;

  const [cursorReal, setCursorReal] = useState(0); // ms transcurridos en la escala REAL del análisis
  const [reproduciendo, setReproduciendo] = useState(true);
  const rafRef = useRef<number | null>(null);
  const idRef = useRef<number | null>(null);

  useEffect(() => {
    if (!reproduciendo || !ordenados.length) return;
    idRef.current = window.setInterval(() => {
      setCursorReal((c) => {
        const next = c + TICK_MS * factor;
        if (next >= duracionReal) {
          setReproduciendo(false);
          return duracionReal;
        }
        return next;
      });
    }, TICK_MS);
    return () => { if (idRef.current) window.clearInterval(idRef.current); };
  }, [reproduciendo, factor, duracionReal, ordenados.length]);

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const terminoReplay = cursorReal >= duracionReal;
  const visibles = useMemo(
    () => ordenados.filter((e) => new Date(e.ts).getTime() - t0 <= cursorReal),
    [ordenados, t0, cursorReal],
  );
  const fases = useMemo(() => reducirFases(visibles), [visibles]);
  const ahoraVirtual = t0 + cursorReal;
  const estadoVirtual: EstadoProc = terminoReplay ? estadoFinal : "procesando";

  const reiniciar = () => { setCursorReal(0); setReproduciendo(true); };

  if (!ordenados.length) return null;

  return (
    <div className={compacto ? "space-y-3" : "space-y-4"}>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-amber/30 bg-amber-soft px-3 py-2 text-[11px]">
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <span className="relative flex h-1.5 w-1.5" aria-hidden>
            <span className={`absolute inline-flex h-full w-full rounded-full bg-amber opacity-70 ${reproduciendo ? "animate-ping" : ""}`} />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber" />
          </span>
          Repetición del análisis real
          <span className="ml-1.5 font-mono normal-case text-mute">
            {Math.round(cursorReal / 1000)}s / {Math.round(duracionReal / 1000)}s reales
          </span>
        </span>
        <div className="flex items-center gap-1">
          {!terminoReplay && (
            <button
              type="button"
              onClick={() => setReproduciendo((r) => !r)}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-1 font-medium text-ink hover:bg-paperSoft"
            >
              {reproduciendo ? <Pause size={11} /> : <Play size={11} />} {reproduciendo ? "Pausar" : "Seguir"}
            </button>
          )}
          <button
            type="button"
            onClick={reiniciar}
            className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-1 font-medium text-ink hover:bg-paperSoft"
          >
            <RotateCcw size={11} /> Reiniciar
          </button>
        </div>
      </div>

      {!compacto && (
        <FlowGraph
          override={{
            ...nodoActivoYHechos(fases),
            narracion: faseHumana({ estado: estadoVirtual, faseActual: null, faseIndex: null, fases, iniciadoAt: null }, ahoraVirtual, fases),
          }}
        />
      )}
      <DagCarriles fases={fases} estado={estadoVirtual} ahora={ahoraVirtual} compacto={compacto} />

      <div>
        <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-mute">
          <span>Bitácora (repetida)</span>
          <span className="font-mono normal-case tracking-normal">{visibles.length}/{ordenados.length} eventos</span>
        </div>
        <Bitacora eventos={visibles} ahora={ahoraVirtual} max={compacto ? 6 : 14} activo={!terminoReplay} compacto={compacto} />
      </div>
    </div>
  );
}
