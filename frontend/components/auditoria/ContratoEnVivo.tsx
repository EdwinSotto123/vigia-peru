"use client";

/**
 * Vista en vivo de un contrato asignado a un aporte: cabecera, estado, línea de
 * tiempo de fases y, al terminar, el resultado con enlace al dossier completo.
 * Poll cada `pollMs` (3 s) mientras el estado sea encolado/procesando.
 *
 * Datos: GET /financiamiento/procesamientos/:ocid
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ArrowUpRight, CheckCircle2, ChevronLeft, Landmark, ShieldCheck, WifiOff } from "lucide-react";
import { formatPEN } from "@/lib/financiamiento";
import { PUBLIC_API_BASE, TOTAL_FASES, duracion, esActivo, faseLabel, haceCuanto, type ProcesamientoDetalle } from "@/lib/auditoria";
import { EstadoPill } from "./EstadoPill";
import { FaseTimeline } from "./FaseTimeline";

interface Props {
  ocid: string;
  initial?: ProcesamientoDetalle | null;
  pollMs?: number;
}

export function ContratoEnVivo({ ocid, initial, pollMs = 3000 }: Props) {
  const [data, setData] = useState<ProcesamientoDetalle | null>(initial ?? null);
  const [cargando, setCargando] = useState(initial == null);
  const [fallo, setFallo] = useState(false);
  const [actualizadoAt, setActualizadoAt] = useState<number | null>(initial ? Date.now() : null);
  const [ahora, setAhora] = useState(() => Date.now());
  const activoRef = useRef<boolean>(initial ? esActivo(initial.estado) : true);

  useEffect(() => {
    let vivo = true;
    let ctrl: AbortController | null = null;
    const cargar = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos/${encodeURIComponent(ocid)}`, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ProcesamientoDetalle;
        if (!vivo) return;
        setData({ ...json, eventos: Array.isArray(json.eventos) ? json.eventos : [] });
        setActualizadoAt(Date.now());
        setFallo(false);
        activoRef.current = esActivo(json.estado);
      } catch (e) {
        if ((e as Error)?.name === "AbortError" || !vivo) return;
        setFallo(true);
      } finally {
        if (vivo) setCargando(false);
      }
    };
    void cargar();
    // Sigue consultando mientras el contrato esté activo (o mientras no hayamos logrado cargarlo).
    const id = window.setInterval(() => {
      if (!activoRef.current) return;
      if (document.visibilityState !== "visible") return;
      void cargar();
    }, Math.max(1500, pollMs));
    const onVis = () => { if (document.visibilityState === "visible" && activoRef.current) void cargar(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      vivo = false;
      ctrl?.abort();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ocid, pollMs]);

  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!data) {
    return cargando ? (
      <div className="animate-pulse space-y-3 rounded-2xl border border-line bg-paper p-6" aria-busy>
        <div className="h-3 w-24 rounded bg-paperDeep" />
        <div className="h-6 w-3/4 rounded bg-paperDeep" />
        <div className="h-3 w-1/2 rounded bg-paperDeep" />
      </div>
    ) : (
      <div className="flex items-start gap-3 rounded-2xl border border-dashed border-line p-6 text-sm text-mute">
        <WifiOff size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden />
        <div>
          <div className="font-medium text-ink">No pudimos cargar el estado de este contrato.</div>
          <div className="mt-0.5">Reintentamos automáticamente. Código: <span className="font-mono">{ocid}</span></div>
        </div>
      </div>
    );
  }

  const p = data;
  const activo = esActivo(p.estado);
  const transcurrido = p.estado === "procesando" && p.iniciadoAt ? ahora - new Date(p.iniciadoAt).getTime() : null;
  const duro = p.iniciadoAt && p.finalizadoAt ? new Date(p.finalizadoAt).getTime() - new Date(p.iniciadoAt).getTime() : null;
  const conSenales = p.banderas > 0;
  const dossierHref = `/app/convocatoria/${encodeURIComponent(p.ocid)}`;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-mute">
        <Link href={`/app/auditoria?ubigeo=${p.ubigeo.slice(0, 2)}`} className="inline-flex items-center gap-1 hover:underline">
          <ChevronLeft size={14} /> Auditoría en vivo
        </Link>
        <span className="inline-flex items-center gap-1.5 text-[11px]" aria-live="polite" aria-atomic="true">
          {fallo ? (
            <span className="inline-flex items-center gap-1 text-amber"><WifiOff size={12} aria-hidden /> sin conexión · reintentando</span>
          ) : activo ? (
            <>
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-moss opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-moss" />
              </span>
              en vivo{actualizadoAt ? ` · actualizado ${haceCuanto(ahora - actualizadoAt)}` : ""}
            </>
          ) : (
            <span>{p.finalizadoAt ? `finalizado el ${new Date(p.finalizadoAt).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" })}` : "sin actividad"}</span>
          )}
        </span>
      </div>

      {/* cabecera */}
      <header className="mt-3 rounded-3xl border border-line bg-paper p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-mute">
              <span className="font-mono normal-case tracking-normal">{p.ocid}</span>
              {p.alertaCodigo && <span className="font-mono normal-case tracking-normal">· {p.alertaCodigo}</span>}
            </div>
            <h1 className="mt-1 font-serif text-2xl font-bold leading-tight text-ink sm:text-3xl">{p.titulo ?? "Contrato sin título registrado"}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-mute">
              <span className="inline-flex items-center gap-1"><Landmark size={13} aria-hidden /> {p.entidad ?? "Entidad no identificada"}</span>
              <Link href={`/app/financiar/${p.ubigeo}`} className="hover:underline">{p.zona}</Link>
              {p.montoPen != null && p.montoPen > 0 && <span className="font-mono text-ink">{formatPEN(p.montoPen)}</span>}
            </div>
          </div>
          <EstadoPill estado={p.estado} size="md" />
        </div>

        <p className="mt-5 flex flex-wrap items-center gap-x-1 border-t border-line pt-4 text-sm text-mute">
          <ShieldCheck size={14} className="text-moss" aria-hidden />
          Auditoría financiada por <span className="font-semibold text-ink">{p.financiador}</span>
          <span>·</span>
          <Link href={`/impacto/${p.contribucionCodigo}`} className="font-mono hover:underline">{p.contribucionCodigo}</Link>
        </p>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
        {/* línea de tiempo */}
        <div className="rounded-2xl border border-line bg-paper p-5">
          <FaseTimeline faseIndex={p.faseIndex} estado={p.estado} eventos={p.eventos} />
        </div>

        {/* estado / resultado */}
        <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          {p.estado === "encolado" && (
            <Panel titulo="En cola" tono="mute">
              <p>Este contrato ya está asignado a un aporte confirmado y espera turno. El sistema lo toma en orden de llegada, en pocos minutos.</p>
              {p.intentos > 0 && <p className="mt-2 text-[12px]">Intentos previos: <span className="font-mono">{p.intentos}</span>. Se reintenta automáticamente.</p>}
            </Panel>
          )}

          {p.estado === "procesando" && (
            <Panel titulo="Analizando ahora" tono="amber">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-mute">Fase actual</div>
                  <div className="text-lg font-semibold text-ink">{faseLabel(p.faseActual)}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-2xl font-semibold text-ink">
                    {Math.min(TOTAL_FASES, (p.faseIndex ?? 0) + 1)}<span className="text-mute">/{TOTAL_FASES}</span>
                  </div>
                  {transcurrido != null && transcurrido > 0 && <div className="font-mono text-[11px] text-mute">{duracion(transcurrido)} en curso</div>}
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuemin={0} aria-valuemax={TOTAL_FASES} aria-valuenow={p.faseIndex ?? 0} aria-label="Fases completadas">
                <div className="h-full rounded-full bg-amber transition-all duration-700 ease-out" style={{ width: `${Math.max(4, Math.round(((p.faseIndex ?? 0) / TOTAL_FASES) * 100))}%` }} />
              </div>
              <p className="mt-3 text-[12px] text-mute">Un análisis completo tarda entre 3 y 10 minutos según el tamaño del expediente. Esta página se actualiza sola.</p>
            </Panel>
          )}

          {p.estado === "error" && (
            <Panel titulo="Reintento automático" tono="crimson">
              {p.intentos < 3 ? (
                <p>Reintentando automáticamente (intento <span className="font-mono">{Math.max(1, p.intentos)}</span> de 3). El pipeline vuelve a tomar el contrato desde el inicio.</p>
              ) : (
                <p>Tras 3 intentos automáticos, este contrato quedó en revisión manual. El equipo lo re-encolará y el aporte no pierde su contrato.</p>
              )}
            </Panel>
          )}

          {p.estado === "procesado" && (
            <Panel titulo="Resultado" tono={conSenales ? "rust" : "moss"}>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-line bg-paper p-3">
                  <div className="text-[11px] uppercase tracking-wide text-mute">Señales de riesgo</div>
                  <div className={`mt-0.5 inline-flex items-center gap-1.5 font-mono text-2xl font-semibold ${conSenales ? "text-rust" : "text-moss"}`}>
                    {conSenales ? <AlertTriangle size={18} aria-hidden /> : <CheckCircle2 size={18} aria-hidden />}
                    {p.banderas}
                  </div>
                </div>
                <div className="rounded-xl border border-line bg-paper p-3">
                  <div className="text-[11px] uppercase tracking-wide text-mute">Score de riesgo</div>
                  <div className="mt-0.5 font-mono text-2xl font-semibold text-ink">{p.score != null ? Math.round(p.score) : "—"}<span className="text-sm text-mute">{p.score != null ? "/100" : ""}</span></div>
                </div>
              </div>
              <p className="mt-3 text-[12px] text-mute">
                {conSenales
                  ? "Cada señal cita la norma y la evidencia oficial. Una señal no es una acusación: es un patrón que merece revisión."
                  : "El pipeline no encontró patrones de riesgo en este contrato. El dictamen completo explica qué se revisó."}
                {duro != null && duro > 0 && <> Análisis completado en <span className="font-mono">{duracion(duro)}</span>.</>}
              </p>
              <Link href={dossierHref} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-transform hover:scale-[1.02]">
                Ver dossier completo <ArrowRight size={15} aria-hidden />
              </Link>
              {!p.alertaCodigo && <p className="mt-2 text-[11px] text-mute">El dictamen se está publicando; si el enlace no muestra nada todavía, vuelve en un minuto.</p>}
            </Panel>
          )}

          <div className="flex flex-wrap gap-2 text-sm">
            <Link href={`/impacto/${p.contribucionCodigo}`} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-mute hover:bg-paperDeep">
              Comprobante de impacto <ArrowUpRight size={13} aria-hidden />
            </Link>
            <Link href={`/app/auditoria?ubigeo=${p.ubigeo.slice(0, 2)}`} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-mute hover:bg-paperDeep">
              Más contratos en vivo <ArrowUpRight size={13} aria-hidden />
            </Link>
          </div>

          <div className="flex items-start gap-2 rounded-xl bg-paperDeep p-4 text-[12px] text-mute">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-moss" aria-hidden />
            <span>El pipeline no sabe quién financió este análisis. Los resultados se publican aunque señalen al financiador. <Link href="/app/financiar#independencia" className="underline">Reglas de independencia</Link>.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Panel({ titulo, tono, children }: { titulo: string; tono: "mute" | "amber" | "crimson" | "moss" | "rust"; children: React.ReactNode }) {
  const borde = { mute: "border-line", amber: "border-amber/50 ring-1 ring-amber/20", crimson: "border-crimson/40", moss: "border-moss/40", rust: "border-rust/40" }[tono];
  const color = { mute: "text-mute", amber: "text-amber", crimson: "text-crimson", moss: "text-moss", rust: "text-rust" }[tono];
  return (
    <section className={`rounded-2xl border bg-paper p-5 text-sm text-inkSoft transition-all ${borde}`}>
      <h2 className={`text-[11px] font-semibold uppercase tracking-wide ${color}`}>{titulo}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
