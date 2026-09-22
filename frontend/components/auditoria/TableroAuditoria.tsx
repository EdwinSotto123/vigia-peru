"use client";

/**
 * Tablero público "en vivo": columnas En espera → Procesando → Procesado con los contratos
 * asignados a aportes confirmados. Hace polling al API cada `autoRefreshMs` sólo con la
 * pestaña visible. Si el API no responde, conserva lo último que mostró y lo dice en voz
 * baja; nunca rompe la página.
 *
 * Dos props gobiernan cuánto muestra:
 *  · `verMasHref`: la página ya tiene su propio histórico completo más abajo, así que la
 *    columna "Procesado" no se repite acá.
 *  · `conteosExternos`: otra superficie de la misma página ya publica los conteos (en
 *    /app/auditoria, la barra de estado del pipeline). Entonces este tablero NO los repite:
 *    dos fuentes para el mismo número fue el defecto histórico de esta pantalla — los mismos
 *    doce contratos salían como "esperan documentos" arriba y "en cola" acá abajo.
 *
 * La primera columna se llama "En espera" y no "En cola" a propósito: agrupa cuatro estados
 * (en cola, esperando documentos, con error, sin análisis aplicable) y "en cola" es uno solo
 * de ellos. Cada tarjeta lleva su estado exacto en la píldora, y el encabezado de la columna
 * dice de qué está hecha.
 *
 * Datos: GET /financiamiento/procesamientos?ubigeo=&codigo=&limit=
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Cpu, Eye, Inbox, WifiOff } from "lucide-react";
import { formatPEN } from "@/lib/financiamiento";
import {
  ESTADO_PROC,
  PUBLIC_API_BASE,
  duracion,
  estadoVisible,
  faseHumana,
  fasesEfectivas,
  haceCuanto,
  procesamientosQueryString,
  progresoCarriles,
  progresoFases,
  type EstadoProc,
  type Procesamiento,
} from "@/lib/auditoria";
import { PulseDot } from "@/components/ui/PulseDot";
import { Skeleton } from "@/components/ui/Skeleton";
import { MiniCarriles } from "./DagCarriles";
import { EstadoPill } from "./EstadoPill";

type Columna = "encolado" | "procesando" | "procesado";

const COLUMNAS: { key: Columna; label: string; icon: React.ReactNode; vacio: string }[] = [
  { key: "encolado", label: "En espera", icon: <Clock size={14} />, vacio: "Nada en espera con estos filtros." },
  { key: "procesando", label: "En análisis", icon: <Cpu size={14} />, vacio: "Ningún contrato en análisis ahora mismo." },
  { key: "procesado", label: "Procesado", icon: <CheckCircle2 size={14} />, vacio: "Todavía no se publicó ningún resultado." },
];

// error y pendiente_de_procesamiento se muestran en la columna "En espera" con su propia píldora.
const columnaDe = (estado: EstadoProc): Columna => (estado === "procesando" || estado === "procesado" ? estado : "encolado");

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
  /**
   * Si se pasa, esta página YA tiene su propio histórico completo más abajo (p.ej. /app/auditoria):
   * la columna "Procesado" no se repite acá — solo queda un link a ese histórico. Sin esto (p.ej.
   * /financiar/[ubigeo] compacto, /impacto/[codigo]), "Procesado" es la ÚNICA vista de resultados
   * que tiene esa página, así que se muestra completa como siempre.
   */
  verMasHref?: string;
  /** Otra superficie de la página ya publica los conteos: este tablero no los repite. */
  conteosExternos?: boolean;
  /**
   * Qué mostrar en el lugar de "En análisis" cuando no hay nada en análisis — que es el estado
   * NORMAL de esta pantalla, no la excepción. ReactNode ya renderizado (puede venir de un server
   * component); jamás una función: eso compila y rompe sólo en producción.
   */
  panelSecundario?: React.ReactNode;
}

export function TableroAuditoria({
  ubigeo,
  codigo,
  titulo,
  autoRefreshMs = 5000,
  limit = 100,
  initial,
  compacto = false,
  verMasHref,
  conteosExternos = false,
  panelSecundario,
}: Props) {
  const [items, setItems] = useState<Procesamiento[]>(initial ?? []);
  const [cargado, setCargado] = useState<boolean>(initial != null);
  const [actualizadoAt, setActualizadoAt] = useState<number | null>(initial != null ? Date.now() : null);
  const [fallo, setFallo] = useState(false);
  const [ahora, setAhora] = useState(0);   // 0 hasta montar: el HTML del servidor no lleva cronómetros
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
    setAhora(Date.now());
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const porColumna = useMemo(() => {
    const m: Record<Columna, Procesamiento[]> = { encolado: [], procesando: [], procesado: [] };
    for (const p of items) m[columnaDe(p.estado)].push(p);
    return m;
  }, [items]);
  // Procesados con alerta bloqueada por la autoevaluación: se muestran en "Procesado" con su píldora, y se cuentan aparte.
  const enRevision = useMemo(() => items.filter((p) => estadoVisible(p) === "revision").length, [items]);

  /** De qué está hecha cada columna, contado sobre las MISMAS tarjetas que se ven debajo. */
  const composicion = useCallback(
    (lista: Procesamiento[]) => {
      const m = new Map<EstadoProc, number>();
      for (const p of lista) {
        const s = estadoVisible(p);
        m.set(s, (m.get(s) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    },
    [],
  );

  // El API devuelve como mucho `limit` filas: si se llenó, lo que se cuenta acá es una página,
  // no el universo. Decirlo es lo que evita que este tablero contradiga a la barra de estado.
  const truncado = cargado && items.length >= limit;

  // Con verMasHref, "Procesado" ya vive (completo, filtrable) en el histórico de abajo: acá solo
  // quedan las dos columnas realmente "en vivo" (transitorias) + un link al histórico.
  const sinAnalisis = porColumna.procesando.length === 0;
  const columnasVisibles = useMemo(() => {
    let cols = verMasHref ? COLUMNAS.filter((c) => c.key !== "procesado") : COLUMNAS;
    // Nada en análisis + hay algo mejor que un hueco → esa columna cede su lugar.
    if (panelSecundario && sinAnalisis) cols = cols.filter((c) => c.key !== "procesando");
    return cols;
  }, [verMasHref, panelSecundario, sinAnalisis]);

  const conPanel = !!panelSecundario && sinAnalisis;
  const celdas = columnasVisibles.length + (conPanel ? 1 : 0);

  // En móvil, arrancamos en la pestaña con actividad (sin pisar la elección del usuario).
  useEffect(() => {
    if (tabElegida.current || !cargado) return;
    if (porColumna.procesando.length) setTab("procesando");
    else if (porColumna.encolado.length) setTab("encolado");
    else if (!verMasHref && porColumna.procesado.length) setTab("procesado");
  }, [porColumna, cargado, verMasHref]);

  // Si la pestaña elegida dejó de existir (la columna "En análisis" cedió el lugar), volver a una viva.
  useEffect(() => {
    if (!columnasVisibles.some((c) => c.key === tab)) setTab(columnasVisibles[0]?.key ?? "encolado");
  }, [columnasVisibles, tab]);

  const vacio = cargado && items.length === 0;
  const conTabs = !vacio && columnasVisibles.length > 1;

  return (
    <section aria-label={titulo ?? "Tablero de auditoría en vivo"}>
      {/* encabezado */}
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          {titulo && <h2 className="font-serif text-2xl font-bold text-ink">{titulo}</h2>}
          {/* Los conteos van una sola vez por página. Si otra superficie ya los publica, acá no. */}
          {!conteosExternos && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute">
              {COLUMNAS.map((c) => (
                <span key={c.key} className="inline-flex items-center gap-1">
                  <span className={c.key === "procesando" && porColumna.procesando.length ? "text-amberTexto" : ""}>{c.icon}</span>
                  <span className="font-mono text-ink transition-all">{porColumna[c.key].length}</span> {c.label.toLowerCase()}
                </span>
              ))}
              {enRevision > 0 && (
                <span className="inline-flex items-center gap-1 text-clayTexto" title="Procesados cuya autoevaluación bloqueó la publicación; una persona los revisa. Son parte de los procesados, no se suman.">
                  <Eye size={14} />
                  <span className="font-mono">{enRevision}</span> de ellos en revisión humana
                </span>
              )}
            </div>
          )}
          {verMasHref && porColumna.procesado.length > 0 && (
            <a href={verMasHref} className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-mute underline-offset-2 hover:text-ink hover:underline">
              Ver todo lo ya leído en el histórico ↓
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-[11px] text-mute" aria-live="polite" aria-atomic="true">
          {truncado && <span title={`El API devuelve como mucho ${limit} filas por consulta.`}>mostrando los {limit} más recientes</span>}
          {fallo ? (
            <span className="inline-flex items-center gap-1 text-amberTexto"><WifiOff size={12} aria-hidden /> sin conexión · reintentando</span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <PulseDot color="moss" size={6} />
              en vivo · {ahora > 0 && actualizadoAt ? `actualizado ${haceCuanto(ahora - actualizadoAt)}` : "conectando…"}
            </span>
          )}
        </div>
      </div>

      {/* tabs móviles */}
      {conTabs && (
        <div
          className={`mt-4 grid gap-1 rounded-xl border border-line bg-paperDeep p-1 ${columnasVisibles.length === 3 ? "grid-cols-3" : "grid-cols-2"} ${compacto ? "" : "md:hidden"}`}
          role="tablist"
          aria-label="Columnas"
        >
          {columnasVisibles.map((c) => {
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
        // `grid-cols-1` explícito, no `grid` a secas: sin él la pista implícita es `auto` y
        // se dimensiona al max-content de las tarjetas, así que en 390 px la columna medía
        // 557 px y la página entera scrolleaba en horizontal. `grid-cols-N` de Tailwind es
        // `minmax(0, 1fr)`, que es justamente el mínimo que hay que fijar.
        <div
          className={`mt-4 grid grid-cols-1 items-start gap-4 ${
            compacto ? "" : celdas === 3 ? "md:grid-cols-3" : celdas === 2 ? "md:grid-cols-2" : ""
          }`}
        >
          {columnasVisibles.map((c) => {
            const lista = porColumna[c.key];
            const partes = composicion(lista);
            return (
              <div
                key={c.key}
                role={conTabs ? "tabpanel" : undefined}
                className={`${conTabs && tab !== c.key ? "hidden" : "block"} ${compacto || !conTabs ? "" : "md:block"} rounded-2xl border border-line bg-paperDeep/60 p-2`}
              >
                <div className={`${conTabs && !compacto ? "hidden md:block" : "block"} px-2 pb-1 pt-1.5`}>
                  <div className="flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wide text-mute">
                    <span className="inline-flex items-center gap-1.5">{c.icon} {c.label}</span>
                    <span className="font-mono">{lista.length}</span>
                  </div>
                  {/* De qué está hecha la columna, contado sobre estas mismas tarjetas. Con un
                      solo estado no se repite la cifra del encabezado: se nombra y basta. */}
                  {partes.length === 1 && (
                    <p className="mt-0.5 text-[11px] leading-snug text-mute">
                      {lista.length === 1 ? "" : "todos "}
                      {ESTADO_PROC[partes[0][0]].label.toLowerCase()}
                    </p>
                  )}
                  {partes.length > 1 && (
                    <p className="mt-0.5 text-[11px] leading-snug text-mute">
                      {partes.map(([estado, n], i) => (
                        <span key={estado}>
                          {i > 0 && " · "}
                          <span className="font-mono text-inkSoft">{n}</span> {ESTADO_PROC[estado].label.toLowerCase()}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                {/* La cola puede tener decenas de tarjetas y el panel de al lado dos pantallas
                    menos: sin tope, la mitad derecha de la página queda en blanco. Con tope,
                    la cola se recorre adentro y las dos mitades pesan lo mismo. */}
                <ul className={`space-y-2 ${compacto || conPanel ? "max-h-[28rem] overflow-y-auto pr-1 scrollbar-warm" : ""}`}>
                  {lista.length === 0 && !cargado && <SkeletonCard />}
                  {lista.length === 0 && cargado && (
                    <li className="rounded-xl border border-dashed border-line p-4 text-center text-[12px] text-mute">{c.vacio}</li>
                  )}
                  {lista.map((p) => (
                    <li key={p.ocid}>
                      <Tarjeta p={p} ahora={ahora} />
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {/* En móvil va primero: leer lo último que se analizó vale más que scrollear la cola. */}
          {conPanel && <div className="order-first md:order-none">{panelSecundario}</div>}
        </div>
      )}
    </section>
  );
}

/** Exportada: la reusa HistoricoProcesados.tsx (mismo diseño de tarjeta en el buscador histórico). */
export function Tarjeta({ p, ahora }: { p: Procesamiento; ahora: number }) {
  const estado = estadoVisible(p);
  const conSenales = p.banderas > 0;
  const transcurrido = ahora > 0 && p.estado === "procesando" && p.iniciadoAt ? ahora - new Date(p.iniciadoAt).getTime() : null;
  const fases = p.estado === "procesando" ? fasesEfectivas(p) : null;
  const prog = fases ? progresoFases(fases, estado) : null;
  return (
    <Link
      href={`/app/auditoria/${encodeURIComponent(p.ocid)}`}
      className={`block rounded-xl border bg-paper p-3 transition-all hover:-translate-y-0.5 hover:shadow-card ${
        p.estado === "procesando" ? "border-amber/50 ring-1 ring-amber/20" : "border-line"
      }`}
    >
      {/* La entidad primero y en chico: es lo que ubica al lector antes de leer el objeto,
          que es largo y en mayúsculas. La píldora de estado baja al pie y deja de robarle
          dos líneas de ancho al título. */}
      <p className="truncate text-[11px] font-medium uppercase tracking-wide text-mute">{p.entidad ?? "Entidad no identificada"}</p>
      <p className="mt-0.5 line-clamp-2 text-sm font-semibold leading-snug text-ink">{p.titulo ?? p.ocid}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-mute">
        <span>{p.zona}</span>
        {p.montoPen != null && p.montoPen > 0 && <span className="font-mono tabular-nums">{formatPEN(p.montoPen)}</span>}
      </p>

      {p.estado === "procesando" && fases && prog && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="min-w-0 truncate text-amberTexto" aria-live="polite">{faseHumana(p, ahora || undefined, fases)}</span>
            <span className="shrink-0 font-mono tabular-nums text-mute">
              {prog.hechas}/{prog.aplicables} pasos
              {transcurrido != null && transcurrido > 0 && ` · ${duracion(transcurrido)}`}
            </span>
          </div>
          <div className="mt-1.5" aria-label={`Avance del análisis: ${prog.hechas} de ${prog.aplicables} pasos`}>
            <MiniCarriles carriles={progresoCarriles(fases, estado)} />
          </div>
        </div>
      )}

      {p.estado === "error" && (
        <p className="mt-2 text-[11px] text-crimsonTexto">Reintento automático · intento {Math.min(3, Math.max(1, p.intentos))} de 3</p>
      )}

      {estado === "revision" && (
        <p className="mt-2 text-[11px] text-clayTexto">La autoevaluación pidió revisión humana antes de publicar.</p>
      )}

      {estado === "procesado" && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[12px]">
          <span className={`inline-flex flex-wrap items-center gap-1 font-medium ${conSenales ? "text-rust" : "text-mossTexto"}`}>
            {conSenales ? <AlertTriangle size={13} aria-hidden /> : <CheckCircle2 size={13} aria-hidden />}
            {conSenales ? `${p.banderas} ${p.banderas === 1 ? "señal de riesgo" : "señales de riesgo"}` : "sin señales"}
            {p.score != null && <span className="ml-1 font-mono text-[11px] tabular-nums text-mute">· riesgo {Math.round(p.score)}/100</span>}
          </span>
          <span className="inline-flex items-center gap-0.5 text-mute">ver dictamen <ArrowUpRight size={12} aria-hidden /></span>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-line pt-2 text-[11px] text-mute">
        <span className="min-w-0 truncate">
          lo pagó <span className="font-medium text-inkSoft">{p.financiador}</span>
          <span className="font-mono"> · {p.contribucionCodigo}</span>
        </span>
        <EstadoPill estado={estado} />
      </div>
    </Link>
  );
}

function SkeletonCard() {
  return (
    <li className="rounded-xl border border-line bg-paper p-3" aria-hidden>
      <Skeleton className="h-3 w-2/5" />
      <Skeleton className="mt-2 h-3.5 w-4/5" />
      <Skeleton className="mt-2 h-3 w-3/5" />
      <Skeleton className="mt-3 h-1.5 w-full" />
    </li>
  );
}

function EstadoVacio({ fallo, codigo, ubigeo }: { fallo: boolean; codigo?: string; ubigeo?: string }) {
  if (fallo) {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-line p-6 text-sm text-mute">
        <WifiOff size={18} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
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
      : "Cuando se confirme un aporte, sus contratos aparecerán aquí y podrás verlos avanzar paso por paso.";
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
