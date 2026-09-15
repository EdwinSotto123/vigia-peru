"use client";

/**
 * Tablero público "en vivo": tres columnas (En cola → Procesando → Procesado)
 * con los contratos asignados a aportes confirmados. Hace polling al API cada
 * `autoRefreshMs` sólo con la pestaña visible. Si el API no responde, conserva
 * lo último que mostró y lo dice en voz baja; nunca rompe la página.
 *
 * Datos: GET /financiamiento/procesamientos?ubigeo=&codigo=&limit=
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Cpu, Inbox, WifiOff } from "lucide-react";
import { formatPEN } from "@/lib/financiamiento";
import {
  PUBLIC_API_BASE,
  TOTAL_FASES,
  duracion,
  faseLabel,
  faseProgreso,
  haceCuanto,
  procesamientosQueryString,
  type EstadoProc,
  type Procesamiento,
} from "@/lib/auditoria";
import { EstadoPill } from "./EstadoPill";

type Columna = "encolado" | "procesando" | "procesado";

const COLUMNAS: { key: Columna; label: string; icon: React.ReactNode; vacio: string }[] = [
  { key: "encolado", label: "En cola", icon: <Clock size={14} />, vacio: "Nada esperando turno." },
  { key: "procesando", label: "Procesando", icon: <Cpu size={14} />, vacio: "Ningún contrato en análisis ahora mismo." },
  { key: "procesado", label: "Procesado", icon: <CheckCircle2 size={14} />, vacio: "Todavía no se publicó ningún resultado." },
];

const columnaDe = (estado: EstadoProc): Columna => (estado === "error" ? "encolado" : estado);

interface Props {
  ubigeo?: string;
  codigo?: string;
  titulo?: string;
  autoRefreshMs?: number;
  limit?: number;
  /** Datos ya cargados en el servidor (evita el parpadeo inicial y sirve de respaldo si el API cae). */
  initial?: Procesamiento[] | null;
  /** Para contenedores angostos (columna lateral): siempre pestañas + una columna, sin pasar a tres. */
  compacto?: boolean;
}

export function TableroAuditoria({ ubigeo, codigo, titulo, autoRefreshMs = 5000, limit = 100, initial, compacto = false }: Props) {
  const [items, setItems] = useState<Procesamiento[]>(initial ?? []);
  const [cargado, setCargado] = useState<boolean>(initial != null);
  const [actualizadoAt, setActualizadoAt] = useState<number | null>(initial != null ? Date.now() : null);
  const [fallo, setFallo] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());
  const [tab, setTab] = useState<Columna>("procesando");
  const tabElegida = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  const qs = useMemo(() => procesamientosQueryString({ ubigeo, codigo, limit }), [ubigeo, codigo, limit]);

  const cargar = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const res = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos?${qs}`, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { data?: Procesamiento[] };
      if (ctrl.signal.aborted) return;
      setItems(Array.isArray(json.data) ? json.data : []);
      setActualizadoAt(Date.now());
      setFallo(false);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setFallo(true);
    } finally {
      if (!ctrl.signal.aborted) setCargado(true);
    }
  }, [qs]);

  // Polling sólo con la pestaña visible; al volver, refresca de inmediato.
  useEffect(() => {
    void cargar();
    const tick = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void cargar();
    };
    const id = window.setInterval(tick, Math.max(1500, autoRefreshMs));
    const onVis = () => { if (document.visibilityState === "visible") void cargar(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      abortRef.current?.abort();
    };
  }, [cargar, autoRefreshMs]);

  // Reloj de 1 s para "actualizado hace Ns" y los tiempos transcurridos.
  useEffect(() => {
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const porColumna = useMemo(() => {
    const m: Record<Columna, Procesamiento[]> = { encolado: [], procesando: [], procesado: [] };
    for (const p of items) m[columnaDe(p.estado)].push(p);
    return m;
  }, [items]);

  // En móvil, arrancamos en la pestaña con actividad (sin pisar la elección del usuario).
  useEffect(() => {
    if (tabElegida.current || !cargado) return;
    if (porColumna.procesando.length) setTab("procesando");
    else if (porColumna.encolado.length) setTab("encolado");
    else if (porColumna.procesado.length) setTab("procesado");
  }, [porColumna, cargado]);

  const vacio = cargado && items.length === 0;

  return (
    <section aria-label={titulo ?? "Tablero de auditoría en vivo"}>
      {/* encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {titulo && <h2 className="font-serif text-2xl font-bold text-ink">{titulo}</h2>}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute">
            {COLUMNAS.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1">
                <span className={c.key === "procesando" && porColumna.procesando.length ? "text-amber" : ""}>{c.icon}</span>
                <span className="font-mono text-ink transition-all">{porColumna[c.key].length}</span> {c.label.toLowerCase()}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-mute" aria-live="polite" aria-atomic="true">
          {fallo ? (
            <span className="inline-flex items-center gap-1 text-amber"><WifiOff size={12} aria-hidden /> sin conexión · reintentando</span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-moss opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-moss" />
              </span>
              en vivo · {actualizadoAt ? `actualizado ${haceCuanto(ahora - actualizadoAt)}` : "conectando…"}
            </span>
          )}
        </div>
      </div>

      {/* tabs móviles */}
      {!vacio && (
        <div className={`mt-4 grid grid-cols-3 gap-1 rounded-xl border border-line bg-paperDeep p-1 ${compacto ? "" : "md:hidden"}`} role="tablist" aria-label="Columnas">
          {COLUMNAS.map((c) => {
            const activa = tab === c.key;
            return (
              <button
                key={c.key}
                type="button"
                role="tab"
                aria-selected={activa}
                onClick={() => { tabElegida.current = true; setTab(c.key); }}
                className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all ${activa ? "bg-paper text-ink shadow-sm" : "text-mute"}`}
              >
                {c.icon} {c.label} <span className="font-mono text-[11px]">{porColumna[c.key].length}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* cuerpo */}
      {vacio ? (
        <EstadoVacio fallo={fallo} codigo={codigo} ubigeo={ubigeo} />
      ) : (
        <div className={`mt-4 grid gap-4 ${compacto ? "" : "md:grid-cols-3"}`}>
          {COLUMNAS.map((c) => (
            <div
              key={c.key}
              role="tabpanel"
              className={`${tab === c.key ? "block" : "hidden"} ${compacto ? "" : "md:block"} rounded-2xl border border-line bg-paperDeep/60 p-2`}
            >
              <div className={`hidden items-center justify-between px-2 py-1.5 text-[11px] uppercase tracking-wide text-mute ${compacto ? "" : "md:flex"}`}>
                <span className="inline-flex items-center gap-1.5">{c.icon} {c.label}</span>
                <span className="font-mono">{porColumna[c.key].length}</span>
              </div>
              <ul className={`space-y-2 ${compacto ? "max-h-[28rem] overflow-y-auto pr-1 scrollbar-warm" : ""}`}>
                {porColumna[c.key].length === 0 && !cargado && <SkeletonCard />}
                {porColumna[c.key].length === 0 && cargado && (
                  <li className="rounded-xl border border-dashed border-line p-4 text-center text-[12px] text-mute">{c.vacio}</li>
                )}
                {porColumna[c.key].map((p) => (
                  <li key={p.ocid} className="animate-slideUp">
                    <Tarjeta p={p} ahora={ahora} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Tarjeta({ p, ahora }: { p: Procesamiento; ahora: number }) {
  const progreso = faseProgreso(p);
  const conSenales = p.banderas > 0;
  const transcurrido = p.estado === "procesando" && p.iniciadoAt ? ahora - new Date(p.iniciadoAt).getTime() : null;
  return (
    <Link
      href={`/app/auditoria/${encodeURIComponent(p.ocid)}`}
      className={`block rounded-xl border bg-paper p-3 transition-all hover:-translate-y-0.5 hover:shadow-card ${
        p.estado === "procesando" ? "border-amber/50 ring-1 ring-amber/20" : "border-line"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium leading-snug text-ink">{p.titulo ?? p.ocid}</p>
        <EstadoPill estado={p.estado} />
      </div>
      <p className="mt-1 truncate text-[12px] text-mute">{p.entidad ?? "Entidad no identificada"}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-mute">
        <span>{p.zona}</span>
        {p.montoPen != null && p.montoPen > 0 && <span className="font-mono">{formatPEN(p.montoPen)}</span>}
      </p>

      {p.estado === "procesando" && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-amber">{faseLabel(p.faseActual)}</span>
            <span className="font-mono text-mute">
              {Math.min(TOTAL_FASES, (p.faseIndex ?? 0) + 1)}/{TOTAL_FASES}
              {transcurrido != null && transcurrido > 0 && ` · ${duracion(transcurrido)}`}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progreso} aria-label="Avance del análisis">
            <div className="h-full rounded-full bg-amber transition-all duration-700 ease-out" style={{ width: `${Math.max(4, progreso)}%` }} />
          </div>
        </div>
      )}

      {p.estado === "error" && (
        <p className="mt-2 text-[11px] text-crimson">Reintento automático · intento {Math.min(3, Math.max(1, p.intentos))} de 3</p>
      )}

      {p.estado === "procesado" && (
        <div className="mt-2.5 flex items-center justify-between text-[12px]">
          <span className={`inline-flex items-center gap-1 font-medium ${conSenales ? "text-rust" : "text-moss"}`}>
            {conSenales ? <AlertTriangle size={13} aria-hidden /> : <CheckCircle2 size={13} aria-hidden />}
            {conSenales ? `${p.banderas} ${p.banderas === 1 ? "señal de riesgo" : "señales de riesgo"}` : "sin señales"}
          </span>
          <span className="inline-flex items-center gap-0.5 text-mute">ver análisis <ArrowUpRight size={12} aria-hidden /></span>
        </div>
      )}

      <p className="mt-2 truncate border-t border-line pt-2 text-[11px] text-mute">
        gracias a <span className="font-medium text-inkSoft">{p.financiador}</span>
        <span className="font-mono"> · {p.contribucionCodigo}</span>
      </p>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <li className="animate-pulse rounded-xl border border-line bg-paper p-3" aria-hidden>
      <div className="h-3.5 w-4/5 rounded bg-paperDeep" />
      <div className="mt-2 h-3 w-3/5 rounded bg-paperDeep" />
      <div className="mt-3 h-1.5 w-full rounded bg-paperDeep" />
    </li>
  );
}

function EstadoVacio({ fallo, codigo, ubigeo }: { fallo: boolean; codigo?: string; ubigeo?: string }) {
  if (fallo) {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-line p-6 text-sm text-mute">
        <WifiOff size={18} className="mt-0.5 shrink-0 text-amber" aria-hidden />
        <div>
          <div className="font-medium text-ink">El servicio de auditoría en vivo no respondió.</div>
          <div className="mt-0.5">Reintentamos automáticamente cada pocos segundos. Los resultados ya publicados siguen disponibles en el mapa.</div>
        </div>
      </div>
    );
  }
  const copy = codigo
    ? "Los contratos se asignan al confirmar el pago. Cuando el aporte esté validado, aquí verás cada uno pasar de la cola al análisis."
    : ubigeo
      ? "Cuando alguien financie esta zona, verás aquí cada contrato pasar de la cola al análisis y al dictamen."
      : "Cuando se confirme un aporte, sus contratos aparecerán aquí y podrás verlos avanzar fase por fase.";
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-line p-6 text-sm text-mute">
      <Inbox size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div>
        <div className="font-medium text-ink">Nada en proceso todavía.</div>
        <div className="mt-0.5">{copy}</div>
      </div>
    </div>
  );
}
