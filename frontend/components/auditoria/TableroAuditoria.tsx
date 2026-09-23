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
 *    /app/auditoria, la barra de estado del pipeline). Entonces este tablero NO los repite.
 *
 * La primera columna se llama "En espera" y no "En cola" a propósito: agrupa cuatro estados
 * (en cola, esperando documentos, con error, sin análisis aplicable) y "en cola" es uno solo
 * de ellos. Cada tarjeta lleva su estado exacto en la píldora.
 *
 * Honestidad del "en vivo":
 *  · El punto pulsante sólo aparece cuando hay algo en análisis. Si nada se movió, el
 *    encabezado dice "Sin cambios desde {el último evento real}". Antes decía "en vivo,
 *    actualizado hace 3 s" refiriéndose al último sondeo, y escondía que la cola llevaba seis
 *    días quieta.
 *  · Cada tarjeta que espera documentos lleva su antigüedad real, con un reloj que avanza.
 *  · Cuando un sondeo trae un cambio de estado real, la tarjeta viaja a su nueva columna
 *    (FLIP, sin movimiento si el sistema pide menos movimiento) y se anuncia UNA vez en la
 *    única región viva de la página. Nada más en la página es región viva.
 *
 * Datos: GET /financiamiento/procesamientos?ubigeo=&codigo=&desde=&hasta=&financiador=&limit=
 * El backend ordena procesando → encolado → procesado → error → el resto (esperando
 * documentos incluido) y su filtro `estado` no acepta `esperando_documentos`. Si la primera
 * página no trae todo, se pide la cola del listado con un offset calculado, para que los que
 * esperan no se caigan del tablero detrás de los procesados.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, Cpu, Eye, Inbox, WifiOff } from "lucide-react";
import { formatPEN } from "@/lib/financiamiento";
import {
  ESTADO_PROC,
  PUBLIC_API_BASE,
  duracion,
  estadoVisible,
  faseHumana,
  fasesEfectivas,
  fechaLima,
  haceCuanto,
  procesamientosQueryString,
  progresoCarriles,
  progresoFases,
  relojEdad,
  type EstadoProc,
  type Procesamiento,
  type ProcesamientosQuery,
} from "@/lib/auditoria";
import { PulseDot } from "@/components/ui/PulseDot";
import { Skeleton } from "@/components/ui/Skeleton";
import { MiniCarriles } from "./DagCarriles";
import { EstadoPill } from "./EstadoPill";

type Columna = "encolado" | "procesando" | "procesado";

const COLUMNAS: { key: Columna; label: string; icon: React.ReactNode; vacio: string }[] = [
  { key: "encolado", label: "En espera", icon: <Clock size={14} aria-hidden />, vacio: "Nada en espera con estos filtros." },
  { key: "procesando", label: "En análisis", icon: <Cpu size={14} aria-hidden />, vacio: "Ningún contrato en análisis ahora mismo." },
  { key: "procesado", label: "Procesado", icon: <CheckCircle2 size={14} aria-hidden />, vacio: "Todavía no se publicó ningún resultado." },
];

// error y pendiente_de_procesamiento se muestran en la columna "En espera" con su propia píldora.
// Recibe el estado CRUDO (`p.estado`): "revision" no es una columna, es un procesado.
const columnaDe = (estado: EstadoProc): Columna =>
  estado === "procesando" ? "procesando" : estado === "procesado" || estado === "revision" ? "procesado" : "encolado";

// useLayoutEffect avisa en el render del servidor; el efecto sólo hace falta en el navegador.
const useLayoutEffectCliente = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Cómo se dice cada llegada, en singular y en plural. */
const VERBO: Record<EstadoProc, [string, string]> = {
  encolado: ["entró a la cola", "entraron a la cola"],
  procesando: ["empezó su análisis", "empezaron su análisis"],
  procesado: ["terminó su análisis", "terminaron su análisis"],
  revision: ["terminó su análisis y quedó en revisión humana", "terminaron su análisis y quedaron en revisión humana"],
  error: ["falló y se va a reintentar", "fallaron y se van a reintentar"],
  esperando_documentos: ["quedó esperando sus documentos", "quedaron esperando sus documentos"],
  pendiente_de_procesamiento: ["quedó sin análisis aplicable", "quedaron sin análisis aplicable"],
};

interface Cambio { ocid: string; titulo: string; de: EstadoProc | null; a: EstadoProc; columnaDe: Columna | null; columnaA: Columna }

const recortar = (t: string, n = 70) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/** Una sola frase para lo que cambió entre dos sondeos. Es lo único que oye un lector de pantalla. */
function describirCambios(cambios: Cambio[]): string {
  const movidos = cambios.filter((c) => c.de !== null);
  const nuevos = cambios.filter((c) => c.de === null);
  const partes: string[] = [];
  if (movidos.length === 1) {
    const c = movidos[0];
    partes.push(`“${recortar(c.titulo)}” ${VERBO[c.a][0]}`);
  } else if (movidos.length > 1) {
    const porEstado = new Map<EstadoProc, number>();
    for (const c of movidos) porEstado.set(c.a, (porEstado.get(c.a) ?? 0) + 1);
    const detalle = [...porEstado.entries()].map(([a, n]) => `${n} ${n === 1 ? VERBO[a][0] : VERBO[a][1]}`);
    partes.push(`${movidos.length} contratos cambiaron de estado: ${lista(detalle)}`);
  }
  if (nuevos.length === 1) partes.push(`llegó un contrato nuevo al tablero: “${recortar(nuevos[0].titulo)}”`);
  else if (nuevos.length > 1) partes.push(`llegaron ${nuevos.length} contratos nuevos al tablero`);
  const frase = partes.join(". ");
  return frase ? `${frase.charAt(0).toUpperCase()}${frase.slice(1)}.` : "";
}

/** El último momento en que algo se movió de verdad en este tablero (no el último sondeo). */
function ultimoMovimiento(items: Procesamiento[]): number | null {
  let max = -Infinity;
  for (const p of items) {
    for (const v of [p.finalizadoAt, p.iniciadoAt]) {
      const t = v ? Date.parse(v) : NaN;
      if (Number.isFinite(t) && t > max) max = t;
    }
  }
  return Number.isFinite(max) ? max : null;
}

interface Props {
  ubigeo?: string;
  codigo?: string;
  /** Mismos filtros que el histórico: el tablero en vivo también los obedece. YYYY-MM-DD sobre la entrada a la cola. */
  desde?: string;
  hasta?: string;
  financiador?: string;
  titulo?: string;
  autoRefreshMs?: number;
  /** Filas por consulta (el API acepta hasta 300). */
  limit?: number;
  /** Datos ya cargados en el servidor (evita el parpadeo inicial y sirve de respaldo si el API cae). */
  initial?: Procesamiento[] | null;
  /** Para contenedores angostos (columna lateral): siempre pestañas + una columna, sin pasar a tres. */
  compacto?: boolean;
  /**
   * Si se pasa, esta página YA tiene su propio histórico completo más abajo (p.ej. /app/auditoria):
   * la columna "Procesado" no se repite acá; solo queda un link a ese histórico. Sin esto (p.ej.
   * /financiar/[ubigeo] compacto, /impacto/[codigo]), "Procesado" es la ÚNICA vista de resultados
   * que tiene esa página, así que se muestra completa como siempre.
   */
  verMasHref?: string;
  /** Otra superficie de la página ya publica los conteos: este tablero no los repite. */
  conteosExternos?: boolean;
  /**
   * Qué mostrar en el lugar de "En análisis" cuando no hay nada en análisis, que es el estado
   * NORMAL de esta pantalla, no la excepción. ReactNode ya renderizado (puede venir de un server
   * component); jamás una función: eso compila y rompe sólo en producción.
   */
  panelSecundario?: React.ReactNode;
}

export function TableroAuditoria({
  ubigeo,
  codigo,
  desde,
  hasta,
  financiador,
  titulo,
  autoRefreshMs = 5000,
  limit = 300,
  initial,
  compacto = false,
  verMasHref,
  conteosExternos = false,
  panelSecundario,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState<Procesamiento[]>(initial ?? []);
  const [total, setTotal] = useState<number>(initial?.length ?? 0);
  const [cargado, setCargado] = useState<boolean>(initial != null);
  const [fallo, setFallo] = useState(false);
  const [ahora, setAhora] = useState(0);   // 0 hasta montar: el HTML del servidor no lleva cronómetros
  const [tab, setTab] = useState<Columna>("procesando");
  const [anuncio, setAnuncio] = useState("");
  const [ultimoCambio, setUltimoCambio] = useState<{ texto: string; at: number } | null>(null);
  const [recien, setRecien] = useState<Record<string, true>>({});
  const tabElegida = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // Estado conocido de cada tarjeta (crudo y visible), para detectar cambios reales entre sondeos.
  const conocido = useRef<Map<string, { crudo: EstadoProc; visible: EstadoProc }> | null>(
    initial ? new Map(initial.map((p) => [p.ocid, { crudo: p.estado, visible: estadoVisible(p) }])) : null,
  );
  const tarjetas = useRef(new Map<string, HTMLElement>());
  const rectsAntes = useRef<Map<string, DOMRect> | null>(null);
  const menosMovimiento = useRef(false);

  const filtros: ProcesamientosQuery = useMemo(() => ({ ubigeo, codigo, desde, hasta, financiador }), [ubigeo, codigo, desde, hasta, financiador]);

  useEffect(() => {
    try {
      menosMovimiento.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch { /* sin matchMedia: se anima */ }
  }, []);

  const cargar = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const base = `${PUBLIC_API_BASE}/financiamiento/procesamientos`;
    const pedir = async (q: ProcesamientosQuery) => {
      const res = await fetch(`${base}?${procesamientosQueryString(q)}`, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { data?: Procesamiento[]; total?: number };
      return { data: Array.isArray(j.data) ? j.data : [], total: typeof j.total === "number" ? j.total : null };
    };
    try {
      const primera = await pedir({ ...filtros, limit });
      let data = primera.data;
      const tot = primera.total ?? data.length;
      // La primera página no trajo todo: los que esperan documentos quedaron detrás de los
      // procesados. Se pide la cola del listado saltando procesando + encolado + procesados.
      if (tot > data.length) {
        const activos = data.filter((p) => p.estado === "procesando" || p.estado === "encolado").length;
        if (activos < data.length) {
          const procesados = await pedir({ ...filtros, estado: "procesado", limit: 1 });
          const offset = activos + (procesados.total ?? 0);
          if (offset < tot) {
            const cola = await pedir({ ...filtros, limit, offset });
            const vistos = new Set(data.map((p) => p.ocid));
            data = [...data, ...cola.data.filter((p) => !vistos.has(p.ocid))];
          }
        }
      }
      if (ctrl.signal.aborted) return;

      // ¿Qué cambió de verdad desde el sondeo anterior?
      const prev = conocido.current;
      const cambios: Cambio[] = [];
      if (prev) {
        for (const p of data) {
          const visible = estadoVisible(p);
          const antes = prev.get(p.ocid);
          if (!antes) cambios.push({ ocid: p.ocid, titulo: p.titulo ?? p.ocid, de: null, a: visible, columnaDe: null, columnaA: columnaDe(p.estado) });
          else if (antes.visible !== visible) {
            cambios.push({ ocid: p.ocid, titulo: p.titulo ?? p.ocid, de: antes.visible, a: visible, columnaDe: columnaDe(antes.crudo), columnaA: columnaDe(p.estado) });
          }
        }
      }
      conocido.current = new Map(data.map((p) => [p.ocid, { crudo: p.estado, visible: estadoVisible(p) }]));

      if (cambios.length) {
        // FLIP, primer paso: dónde estaba cada tarjeta que cambia de columna.
        if (!menosMovimiento.current) {
          const rects = new Map<string, DOMRect>();
          for (const c of cambios) {
            if (c.columnaDe === null || c.columnaDe === c.columnaA) continue;
            const el = tarjetas.current.get(c.ocid);
            if (el) rects.set(c.ocid, el.getBoundingClientRect());
          }
          rectsAntes.current = rects.size ? rects : null;
        }
        const texto = describirCambios(cambios);
        setAnuncio(texto);
        setUltimoCambio({ texto, at: Date.now() });
        const marcados = Object.fromEntries(cambios.map((c) => [c.ocid, true as const]));
        setRecien((r) => ({ ...r, ...marcados }));
        window.setTimeout(() => {
          setRecien((r) => {
            const s = { ...r };
            for (const k of Object.keys(marcados)) delete s[k];
            return s;
          });
        }, 6000);
        // Un contrato terminó: lo que la página renderiza en el servidor (último análisis,
        // histórico) quedó viejo. Se refresca sin recargar.
        if (cambios.some((c) => c.de !== null && (c.a === "procesado" || c.a === "revision"))) router.refresh();
      }

      setItems(data);
      setTotal(Math.max(tot, data.length));
      setFallo(false);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setFallo(true);
    } finally {
      if (!ctrl.signal.aborted) setCargado(true);
    }
  }, [filtros, limit, router]);

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

  // Reloj de 1 s para los tiempos transcurridos y la antigüedad de lo que espera.
  useEffect(() => {
    setAhora(Date.now());
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // FLIP, segundo paso: la tarjeta ya está en su columna nueva; arranca desde donde estaba.
  useLayoutEffectCliente(() => {
    const rects = rectsAntes.current;
    if (!rects) return;
    rectsAntes.current = null;
    for (const [ocid, r0] of rects) {
      const el = tarjetas.current.get(ocid);
      if (!el || r0.width === 0 || typeof el.animate !== "function") continue;
      const r1 = el.getBoundingClientRect();
      if (r1.width === 0) continue;   // su columna está oculta (pestañas en móvil)
      const dx = r0.left - r1.left;
      const dy = r0.top - r1.top;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, opacity: 0.7 },
          { transform: "translate(0, 0)", opacity: 1 },
        ],
        { duration: 700, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
      );
    }
  }, [items]);

  const porColumna = useMemo(() => {
    const m: Record<Columna, Procesamiento[]> = { encolado: [], procesando: [], procesado: [] };
    for (const p of items) m[columnaDe(p.estado)].push(p);
    return m;
  }, [items]);
  // Procesados con alerta bloqueada por la autoevaluación: se muestran en "Procesado" con su píldora, y se cuentan aparte.
  const enRevision = useMemo(() => items.filter((p) => estadoVisible(p) === "revision").length, [items]);
  const movido = useMemo(() => ultimoMovimiento(items), [items]);

  /** De qué está hecha cada columna, contado sobre las MISMAS tarjetas que se ven debajo. */
  const composicion = useCallback(
    (listaCol: Procesamiento[]) => {
      const m = new Map<EstadoProc, number>();
      for (const p of listaCol) {
        const s = estadoVisible(p);
        m.set(s, (m.get(s) ?? 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    },
    [],
  );

  // El API puede no devolverlo todo: si faltan filas, se dice cuántas se muestran de cuántas.
  const truncado = cargado && total > items.length;

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
  const nAnalisis = porColumna.procesando.length;

  return (
    <section aria-label={titulo ?? "Tablero de auditoría en vivo"}>
      {/* La ÚNICA región viva del tablero: anuncia cambios de estado reales, una vez cada uno. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{anuncio}</p>

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
                  <Eye size={14} aria-hidden />
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
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-[11px] text-mute">
          {truncado && <span title={`El API devuelve como mucho ${limit} filas por consulta.`}>mostrando {items.length} de {total}</span>}
          {fallo ? (
            <span className="inline-flex items-center gap-1 text-amberTexto"><WifiOff size={12} aria-hidden /> sin conexión, reintentando</span>
          ) : nAnalisis > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-amberTexto">
              <PulseDot color="amber" size={6} />
              en vivo: {nAnalisis} {nAnalisis === 1 ? "contrato en análisis" : "contratos en análisis"}
            </span>
          ) : movido != null ? (
            <span className="inline-flex items-center gap-1.5" title="Último contrato que empezó o terminó su análisis en este tablero. Se vuelve a consultar cada pocos segundos.">
              <Clock size={12} aria-hidden />
              <span>
                Sin cambios desde el <time dateTime={new Date(movido).toISOString()}>{fechaLima(movido, { hora: true })}</time>
                {ahora > 0 && <span suppressHydrationWarning> ({haceCuanto(ahora - movido)})</span>}
              </span>
            </span>
          ) : cargado ? (
            <span>Sin movimientos todavía</span>
          ) : (
            <span>conectando…</span>
          )}
        </div>
      </div>

      {/* Lo último que se movió mientras esta página estuvo abierta. */}
      {ultimoCambio && (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 rounded-lg bg-heroViolet-soft px-2.5 py-1.5 text-[12px] leading-snug text-ink">
          <span className="font-semibold">Recién:</span>
          <span className="min-w-0">{ultimoCambio.texto}</span>
          {ahora > 0 && <span className="font-mono text-[11px] text-mute" suppressHydrationWarning>{haceCuanto(Math.max(0, ahora - ultimoCambio.at))}</span>}
        </p>
      )}

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
        <EstadoVacio fallo={fallo} codigo={codigo} ubigeo={ubigeo} filtrado={!!(desde || hasta || financiador)} />
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
            const listaCol = porColumna[c.key];
            const partes = composicion(listaCol);
            return (
              <div
                key={c.key}
                role={conTabs ? "tabpanel" : undefined}
                aria-label={c.label}
                className={`${conTabs && tab !== c.key ? "hidden" : "block"} ${compacto || !conTabs ? "" : "md:block"} rounded-2xl border border-line bg-paperDeep/60 p-2`}
              >
                <div className={`${conTabs && !compacto ? "hidden md:block" : "block"} px-2 pb-1 pt-1.5`}>
                  <div className="flex items-baseline justify-between gap-2 text-[11px] uppercase tracking-wide text-mute">
                    <span className="inline-flex items-center gap-1.5">{c.icon} {c.label}</span>
                    <span className="font-mono">{listaCol.length}</span>
                  </div>
                  {/* De qué está hecha la columna, contado sobre estas mismas tarjetas. Con un
                      solo estado no se repite la cifra del encabezado: se nombra y basta. */}
                  {partes.length === 1 && (
                    <p className="mt-0.5 text-[11px] leading-snug text-mute">
                      {listaCol.length === 1 ? "" : "todos "}
                      {ESTADO_PROC[partes[0][0]].label.toLowerCase()}
                    </p>
                  )}
                  {partes.length > 1 && (
                    <ul className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] leading-snug text-mute">
                      {partes.map(([estado, n]) => (
                        <li key={estado}>
                          <span className="font-mono text-inkSoft">{n}</span> {ESTADO_PROC[estado].label.toLowerCase()}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {/* Con el panel al lado (escritorio), la cola se recorre adentro para que las dos
                    mitades pesen lo mismo. En móvil las columnas van apiladas: una caja con su
                    propio scroll dentro de la página era un scroll anidado, y no se hace. */}
                <ul className={`space-y-2 ${compacto ? "max-h-[28rem] overflow-y-auto pr-1 scrollbar-warm" : conPanel ? "scrollbar-warm md:max-h-[28rem] md:overflow-y-auto md:pr-1" : ""}`}>
                  {listaCol.length === 0 && !cargado && <SkeletonCard />}
                  {listaCol.length === 0 && cargado && (
                    <li className="rounded-xl border border-dashed border-line p-4 text-center text-[12px] text-mute">{c.vacio}</li>
                  )}
                  {listaCol.map((p) => (
                    <li
                      key={p.ocid}
                      ref={(el) => {
                        if (el) tarjetas.current.set(p.ocid, el);
                        else tarjetas.current.delete(p.ocid);
                      }}
                    >
                      <Tarjeta p={p} ahora={ahora} recien={!!recien[p.ocid]} />
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
export function Tarjeta({ p, ahora, recien = false }: { p: Procesamiento; ahora: number; recien?: boolean }) {
  const estado = estadoVisible(p);
  const conSenales = p.banderas > 0;
  const transcurrido = ahora > 0 && p.estado === "procesando" && p.iniciadoAt ? ahora - new Date(p.iniciadoAt).getTime() : null;
  const fases = p.estado === "procesando" ? fasesEfectivas(p) : null;
  const prog = fases ? progresoFases(fases, estado) : null;
  const esperaDesde = p.estado === "esperando_documentos" && p.iniciadoAt ? Date.parse(p.iniciadoAt) : NaN;
  return (
    <Link
      href={`/app/auditoria/${encodeURIComponent(p.ocid)}`}
      className={`block rounded-xl border bg-paper p-3 transition-all hover:-translate-y-0.5 hover:shadow-card ${
        recien
          ? "border-heroViolet/50 ring-2 ring-heroViolet/40"
          : p.estado === "procesando" ? "border-amber/50 ring-1 ring-amber/20" : "border-line"
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
            <span className="min-w-0 truncate text-amberTexto">{faseHumana(p, ahora || undefined, fases)}</span>
            <span className="shrink-0 font-mono tabular-nums text-mute">
              {prog.hechas}/{prog.aplicables} pasos
              {transcurrido != null && transcurrido > 0 && ` en ${duracion(transcurrido)}`}
            </span>
          </div>
          <div className="mt-1.5" aria-label={`Avance del análisis: ${prog.hechas} de ${prog.aplicables} pasos`}>
            <MiniCarriles carriles={progresoCarriles(fases, estado)} />
          </div>
        </div>
      )}

      {/* Lo que espera documentos dice desde cuándo, y su reloj avanza de verdad. */}
      {p.estado === "esperando_documentos" && (
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-[11px] text-clayTexto">
          <span>
            {Number.isFinite(esperaDesde)
              ? <>Espera sus documentos desde el <time dateTime={p.iniciadoAt!}>{fechaLima(esperaDesde, { hora: true })}</time></>
              : "Espera que se descarguen sus documentos"}
          </span>
          {Number.isFinite(esperaDesde) && ahora > 0 && (
            <span className="font-mono tabular-nums" title="Tiempo que lleva esperando" suppressHydrationWarning>
              {relojEdad(ahora - esperaDesde)}
            </span>
          )}
        </div>
      )}

      {p.estado === "error" && (
        <p className="mt-2 text-[11px] text-crimsonTexto">
          {p.intentos >= 3
            ? "Falló en los 3 intentos automáticos; el equipo lo revisa a mano."
            : `Falló el intento ${Math.max(1, p.intentos)} de 3; se vuelve a intentar solo.`}
        </p>
      )}

      {estado === "revision" && (
        <p className="mt-2 text-[11px] text-clayTexto">En revisión humana: no se publica hasta que una persona lo revise.</p>
      )}

      {estado === "procesado" && (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[12px]">
          <span className={`inline-flex flex-wrap items-center gap-1 font-medium ${conSenales ? "text-rust" : "text-mossTexto"}`}>
            {conSenales ? <AlertTriangle size={13} aria-hidden /> : <CheckCircle2 size={13} aria-hidden />}
            {conSenales ? `${p.banderas} ${p.banderas === 1 ? "señal de riesgo" : "señales de riesgo"}` : "sin señales"}
            {p.score != null && <span className="ml-2 font-mono text-[11px] tabular-nums text-mute">riesgo {Math.round(p.score)}/100</span>}
          </span>
          <span className="inline-flex items-center gap-0.5 text-mute">ver dictamen <ArrowUpRight size={12} aria-hidden /></span>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-t border-line pt-2 text-[11px] text-mute">
        <span className="flex min-w-0 items-baseline gap-x-2.5">
          <span className="truncate">
            lo pagó <span className="font-medium text-inkSoft">{p.financiador}</span>
          </span>
          <span className="shrink-0 font-mono">{p.contribucionCodigo}</span>
        </span>
        <EstadoPill estado={estado} intentos={p.intentos} />
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

function EstadoVacio({ fallo, codigo, ubigeo, filtrado }: { fallo: boolean; codigo?: string; ubigeo?: string; filtrado: boolean }) {
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
  const copy = filtrado
    ? "Ningún contrato financiado coincide con la fecha o con quien lo pagó. Quita un filtro arriba para ver el resto."
    : codigo
      ? "Los contratos se asignan al confirmar el pago. Cuando el aporte esté validado, aquí verás cada uno pasar de la cola al análisis."
      : ubigeo
        ? "Cuando alguien financie esta zona, verás aquí cada contrato pasar de la cola al análisis y al dictamen."
        : "Cuando se confirme un aporte, sus contratos aparecerán aquí y podrás verlos avanzar paso por paso.";
  return (
    <div className="mt-4 flex items-start gap-3 rounded-2xl border border-dashed border-line p-6 text-sm text-mute">
      <Inbox size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div>
        <div className="font-medium text-ink">{filtrado ? "Nada coincide con estos filtros." : "Nada en proceso todavía."}</div>
        <div className="mt-0.5">{copy}</div>
      </div>
    </div>
  );
}
