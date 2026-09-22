"use client";

/**
 * Estado del pipeline: UNA barra con el ciclo completo de los contratos financiados y UNA
 * fila "ahora mismo" (contratos en análisis, tipo activo, lote de ingesta). Poll cada
 * `pollMs` (5 s) solo con la pestaña visible.
 *
 * Esta barra es la ÚNICA fuente de conteos de la pantalla. Antes había dos: esta franja
 * decía "24 en el pipeline = 12 esperan documentos + 12 en revisión humana" y tres
 * centímetros más abajo el tablero decía "12 en cola · 33 procesado · 12 en revisión
 * humana". Los mismos doce contratos aparecían como "esperan documentos" arriba y "en
 * cola" abajo, y los doce en revisión se leían como sumables a los 33 procesados cuando
 * en realidad SON doce de esos 33. Ahora:
 *
 *  · el total es el universo entero (todo lo financiado), no un subconjunto móvil;
 *  · `procesado` se parte en "con dictamen publicado" (procesado − revisión) y "en
 *    revisión humana", que es lo que evita el doble conteo;
 *  · los estados en 0 no dibujan segmento ni entrada de leyenda;
 *  · cada segmento mide exactamente su proporción (value/total), con un piso de 3 px para
 *    que un 1 de 500 siga siendo visible;
 *  · el alcance se DICE: el endpoint no acepta `ubigeo`, así que la barra siempre habla
 *    de todo el Perú aunque el tablero de abajo esté filtrado por región.
 *
 * Datos: GET /financiamiento/procesamientos/resumen
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Cpu, Download, WifiOff } from "lucide-react";
import { PUBLIC_API_BASE, duracion, faseHumana, fasesEfectivas, progresoFases } from "@/lib/auditoria";
import type { ResumenProcesamientoVivo } from "@/lib/contratos";
import { PulseDot } from "@/components/ui/PulseDot";
import { cn } from "@/lib/utils";

interface Props {
  initial?: ResumenProcesamientoVivo | null;
  pollMs?: number;
  /** Alcance de las cifras, dicho en voz alta. El endpoint de resumen es global. */
  alcance?: string;
}

interface Tramo {
  clave: string;
  label: string;
  value: number;
  color: string;
  titulo: string;
}

/** Piso en píxeles para que un segmento diminuto (1 de 500) no desaparezca. */
const PISO_PX = 3;

export function PanelProcesamiento({ initial, pollMs = 5000, alcance = "en todo el Perú" }: Props) {
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
  const esperando = e.esperando_documentos ?? 0;
  const procesando = e.procesando ?? 0;
  const enRevision = data?.enRevision ?? e.revision ?? 0;
  // `revision` NO es un estado aparte en la base: es `procesado` con la alerta bloqueada por
  // la autoevaluación. Restarlo es lo que impide contar los mismos doce contratos dos veces.
  const publicados = Math.max(0, (e.procesado ?? 0) - enRevision);

  // Orden cronológico del ciclo: llega → espera documentos → espera turno → lo leen →
  // lo revisa una persona → se publica. Los dos estados excepcionales van al final.
  const tramos: Tramo[] = [
    { clave: "esperando", label: "esperan documentos", value: esperando, color: "bg-mute",
      titulo: "Financiados cuyos documentos del SEACE se descargan en el lote nocturno. Todavía no se pueden leer." },
    { clave: "cola", label: "en cola", value: e.encolado ?? 0, color: "bg-inkSoft",
      titulo: "Con documentos listos, esperando turno. La asignación es por antigüedad, en SQL: nadie elige cuál va primero." },
    { clave: "procesando", label: "en análisis", value: procesando, color: "bg-amber",
      titulo: "Los agentes los están leyendo en este momento." },
    { clave: "revision", label: "en revisión humana", value: enRevision, color: "bg-clay",
      titulo: "El análisis terminó, pero la autoevaluación no alcanzó el umbral: una persona lo revisa antes de publicarlo. Cuentan como leídos, no como señales." },
    { clave: "publicado", label: "con dictamen publicado", value: publicados, color: "bg-moss",
      titulo: "Dictamen público, con cada señal citando norma y evidencia." },
    { clave: "error", label: "con error", value: e.error ?? 0, color: "bg-rust",
      titulo: "El análisis falló y se reintenta automáticamente, hasta tres veces." },
    { clave: "pendiente", label: "sin análisis aplicable", value: e.pendiente_de_procesamiento ?? 0, color: "bg-paperEdge",
      titulo: "Tipo o etapa para los que todavía no corre ningún perfil de análisis." },
  ].filter((t) => t.value > 0);

  const financiados = tramos.reduce((s, t) => s + t.value, 0);
  const pct = (v: number) => (financiados ? (v / financiados) * 100 : 0);
  const activos = data?.activos ?? [];
  const agentes = data?.agentesActivos ?? [];
  const lote = data?.lote ?? null;
  const drift = ahora > 0 ? Math.max(0, Math.round((ahora - recibidoAt.current) / 1000)) : 0;   // segundos desde el último dato

  return (
    <div className="rounded-2xl border border-line bg-paper" aria-live="polite">
      <div className="px-3 py-3 sm:px-4">
        {financiados === 0 ? (
          <p className="text-[13px] text-mute">
            Todavía no hay ningún contrato financiado {alcance}. Cuando se confirme un aporte, sus contratos
            aparecen acá y se los ve pasar de la cola al dictamen.
          </p>
        ) : (
          <>
            <p className="text-[13px] leading-snug text-mute">
              <span className="font-mono font-semibold text-ink">{publicados.toLocaleString("es-PE")}</span> de{" "}
              <span className="font-mono font-semibold text-ink">{financiados.toLocaleString("es-PE")}</span>{" "}
              contratos financiados {alcance} ya tienen dictamen publicado
              {(data?.procesadosHoy ?? 0) > 0 && <> · {data!.procesadosHoy.toLocaleString("es-PE")} leídos hoy</>}
            </p>
            <div
              className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-paperDeep"
              role="img"
              aria-label={tramos.map((t) => `${t.value} ${t.label}`).join(", ") + ` — ${financiados} en total`}
            >
              {tramos.map((t) => (
                <div
                  key={t.clave}
                  className={cn(t.color, "h-full")}
                  style={{ width: `${pct(t.value)}%`, minWidth: PISO_PX }}
                  title={`${t.value} ${t.label} · ${t.titulo}`}
                />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {tramos.map((t) => (
                <li key={t.clave} className="inline-flex items-baseline gap-1.5 text-[12px] text-mute" title={t.titulo}>
                  <span className={cn("relative top-[1px] h-2 w-2 shrink-0 rounded-full", t.color)} aria-hidden />
                  <span className="font-mono font-semibold text-ink">{t.value.toLocaleString("es-PE")}</span>
                  {t.label}
                  <span className="font-mono text-[11px] tabular-nums text-mute/80">{Math.round(pct(t.value))}%</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {data?.documentosDescargados7d && (
          // Esto es ingesta, no auditoría: no pertenece a la barra de estados del pipeline,
          // donde competía por atención con cifras de otra naturaleza.
          <p className="mt-2.5 border-t border-line pt-2 text-[12px] text-mute">
            Aparte, el lote nocturno bajó{" "}
            <span className="font-mono font-semibold text-inkSoft">{data.documentosDescargados7d.n.toLocaleString("es-PE")}</span>{" "}
            documentos del SEACE en 7 días, de {data.documentosDescargados7d.contratos.toLocaleString("es-PE")} contratos. No son contratos nuevos: es el material que los agentes van a leer.
          </p>
        )}
      </div>

      {/* Ahora mismo. Nada de lo que ya cuenta la barra se repite acá. */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-paperSoft px-3 py-2 text-[11px] sm:px-4">
        <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide text-mute">
          {procesando > 0 ? <PulseDot color="amber" size={6} /> : <Cpu size={11} aria-hidden />}
          Ahora mismo
        </span>
        {fallo && (
          <span className="inline-flex items-center gap-1 text-crimsonTexto"><WifiOff size={11} /> sin conexión con el API · reintentando</span>
        )}
        {data?.procesamientoActivo && (
          <span className="inline-flex items-center gap-1 rounded-xl border border-line bg-paper px-2 py-0.5 text-mute" title={data.procesamientoActivo.nota ?? ""}>
            perfil en marcha: <span className="text-ink">{data.procesamientoActivo.tipos_activos.join(", ")}</span>
            {data.documentosListos ? <> · {data.documentosListos.contratos.toLocaleString("es-PE")} con documentos listos</> : null}
          </span>
        )}
        {!fallo && activos.length === 0 && agentes.length === 0 && !lote && (
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
              <span className="font-mono tabular-nums text-mute">{prog.hechas}/{prog.aplicables} pasos</span>
              <span className="truncate text-amberTexto">{faseHumana(p, seg * 1000, fases)}</span>
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
            {(lote.fallidos ?? 0) > 0 && <span className="text-crimsonTexto">{lote.fallidos} fallidos</span>}
          </span>
        )}
      </div>
    </div>
  );
}
