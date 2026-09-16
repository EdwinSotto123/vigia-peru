"use client";

/**
 * Panel compacto de procesamiento en vivo: UNA franja de siete cifras y UNA fila
 * "ahora mismo" (contratos activos con fase y tiempo, agentes activos, lote de
 * ingesta si lo hay). Poll cada `pollMs` (5 s) solo con la pestaña visible.
 *
 * Datos: GET /financiamiento/procesamientos/resumen
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cpu, Download, Moon, WifiOff } from "lucide-react";
import { PUBLIC_API_BASE, duracion, faseHumana, fasesEfectivas, progresoFases } from "@/lib/auditoria";
import type { ResumenProcesamientoVivo } from "@/lib/contratos";
import { cn } from "@/lib/utils";

interface Props {
  initial?: ResumenProcesamientoVivo | null;
  pollMs?: number;
}

export function PanelProcesamiento({ initial, pollMs = 5000 }: Props) {
  const [data, setData] = useState<ResumenProcesamientoVivo | null>(initial ?? null);
  const [fallo, setFallo] = useState(false);
  const [ahora, setAhora] = useState(0);   // 0 hasta montar: sin desajuste de hidratación en los cronómetros
  const recibidoAt = useRef<number>(Date.now());

  useEffect(() => {
    let vivo = true;
    let ctrl: AbortController | null = null;
    const cargar = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos/resumen`, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ResumenProcesamientoVivo;
        if (!vivo) return;
        setData(json);
        recibidoAt.current = Date.now();
        setFallo(false);
      } catch (e) {
        if ((e as Error)?.name === "AbortError" || !vivo) return;
        setFallo(true);
      }
    };
    void cargar();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void cargar(); }, Math.max(2000, pollMs));
    setAhora(Date.now());
    const tick = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => { vivo = false; ctrl?.abort(); window.clearInterval(id); window.clearInterval(tick); };
  }, [pollMs]);

  const e = data?.porEstado ?? {};
  const enCola = (e.encolado ?? 0) + (e.error ?? 0);
  const procesando = e.procesando ?? 0;
  const enRevision = data?.enRevision ?? e.revision ?? 0;
  const cifras: { label: string; value: number; tone?: "amber" | "moss" | "rust" | "clay"; title?: string }[] = [
    { label: "Documentos (7 días)", value: data?.documentosDescargados7d?.n ?? 0,
      title: `Documentos del SEACE bajados por el lote nocturno en los últimos 7 días${data?.documentosDescargados7d ? ` · ${data.documentosDescargados7d.contratos.toLocaleString("es-PE")} contratos` : ""}. No son contratos nuevos.` },
    { label: "En cola", value: enCola },
    { label: "Procesando", value: procesando, tone: procesando > 0 ? "amber" : undefined },
    { label: "Procesados hoy", value: data?.procesadosHoy ?? 0, tone: "moss" },
    { label: "En revisión humana", value: enRevision, tone: enRevision > 0 ? "clay" : undefined,
      title: "Procesados cuya autoevaluación bloqueó la publicación: una persona los revisa antes de publicarlos o descartarlos. Cuentan como procesados, no como señales." },
    { label: "Con error", value: e.error ?? 0, tone: (e.error ?? 0) > 0 ? "rust" : undefined },
    { label: "Pendientes", value: e.pendiente_de_procesamiento ?? 0, tone: (e.pendiente_de_procesamiento ?? 0) > 0 ? "clay" : undefined,
      title: "Pendientes de procesamiento: tipo o etapa sin análisis aplicable todavía." },
  ];
  const activos = data?.activos ?? [];
  const pedidos = data?.pedidos ?? null;
  const esperando = e.esperando_documentos ?? 0;
  const agentes = data?.agentesActivos ?? [];
  const lote = data?.lote ?? null;
  const drift = ahora > 0 ? Math.max(0, Math.round((ahora - recibidoAt.current) / 1000)) : 0;   // segundos desde el último dato

  return (
    <div className="rounded-2xl border border-line bg-paper" aria-live="polite">
      {/* Franja de cifras */}
      <div className="grid grid-cols-4 divide-x divide-line sm:grid-cols-7">
        {cifras.map((c) => (
          <div key={c.label} className="px-3 py-2.5" title={c.title}>
            <div className={cn("font-mono text-lg font-semibold leading-none tabular-nums", c.tone ? { amber: "text-amber", moss: "text-moss", rust: "text-rust", clay: "text-clay" }[c.tone] : "text-ink")}>
              {c.value.toLocaleString("es-PE")}
            </div>
            <div className="mt-1 truncate text-[10px] uppercase tracking-wide text-mute" title={c.title ?? c.label}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Ahora mismo */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-paperSoft px-3 py-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide text-mute">
          {procesando > 0 ? (
            <span className="relative flex h-1.5 w-1.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber" />
            </span>
          ) : (
            <Cpu size={11} aria-hidden />
          )}
          Ahora mismo
        </span>
        {fallo && (
          <span className="inline-flex items-center gap-1 text-rust"><WifiOff size={11} /> sin conexión con el API</span>
        )}
        {data?.procesamientoActivo && (
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-mute" title={data.procesamientoActivo.nota ?? ""}>
            análisis activo: <span className="text-ink">{data.procesamientoActivo.tipos_activos.join(", ")}</span>
            {data.documentosListos ? <> · {data.documentosListos.contratos.toLocaleString("es-PE")} contratos con documentos listos</> : null}
          </span>
        )}
        {esperando > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 text-clay" title="Contratos financiados cuyos documentos se descargan en el lote nocturno">
            <Moon size={11} /> {esperando} esperan documentos{pedidos?.fallidos ? <span className="text-rust"> · {pedidos.fallidos} sin documentos</span> : null}
          </span>
        )}
        {!fallo && activos.length === 0 && agentes.length === 0 && !lote && esperando === 0 && (
          <span className="text-mute">ningún contrato en análisis · los agentes esperan la próxima asignación</span>
        )}
        {activos.map((a) => {
          const seg = a.desdeSeg + drift;
          // iniciadoAt en el epoch + "ahora" = segundos transcurridos: faseHumana mide la espera sin tocar Date.now() en el render.
          const p = { estado: "procesando" as const, faseActual: a.faseActual, faseIndex: a.faseIndex, fases: a.fases ?? null, iniciadoAt: new Date(0).toISOString() };
          const fases = fasesEfectivas(p);
          const prog = progresoFases(fases, "procesando");
          return (
            <Link
              key={a.ocid}
              href={`/app/auditoria/${encodeURIComponent(a.ocid)}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber/40 bg-amber-soft px-2 py-0.5 text-ink hover:border-amber"
              title={a.titulo ?? a.ocid}
            >
              <span className="font-mono">{a.ocid}</span>
              <span className="font-mono tabular-nums text-mute">{prog.hechas}/{prog.aplicables}</span>
              <span className="truncate text-amber">{faseHumana(p, seg * 1000, fases)}</span>
              <span className="font-mono tabular-nums text-mute">{duracion(seg * 1000)}</span>
            </Link>
          );
        })}
        {lote && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2 py-0.5 text-mute" title={`Lote ${lote.id}${lote.tipo ? ` · ${lote.tipo}` : ""}`}>
            <Download size={11} />
            ingesta {lote.completados ?? 0}/{lote.total ?? "?"}
            {lote.total ? (
              <span className="inline-block h-1 w-16 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
                <span className="block h-full bg-moss" style={{ width: `${Math.min(100, Math.round(((lote.completados ?? 0) / lote.total) * 100))}%` }} />
              </span>
            ) : null}
            {(lote.fallidos ?? 0) > 0 && <span className="text-rust">{lote.fallidos} fallidos</span>}
          </span>
        )}
      </div>
    </div>
  );
}
