"use client";

/**
 * Tablero público "en vivo": UNA lista de los contratos asignados a aportes confirmados,
 * agrupada por momento del ciclo (En análisis → En espera → Leídos), una fila por contrato
 * (FilaProcesamiento). Hace polling al API cada `autoRefreshMs` sólo con la pestaña visible.
 * Si el API no responde, conserva lo último que mostró y lo dice en voz baja; nunca rompe.
 *
 * Antes era un kanban de tarjetas (entidad + objeto en dos líneas + zona + quién pagó + código
 * + una frase por estado): en /app/auditoria, la página con más texto de la app. Una tabla
 * compara en columna el estado, el valor y el tiempo, que es para lo que se entra aquí.
 *
 * Dos props gobiernan cuánto muestra:
 *  · `verMasHref`: la página ya tiene su propio histórico completo más abajo, así que el
 *    grupo "Leídos" no se repite acá.
 *  · `conteosExternos`: otra superficie de la misma página ya publica los conteos (en
 *    /app/auditoria, la barra de estado del pipeline). Entonces este tablero NO los repite.
 *
 * El grupo se llama "En espera" y no "En cola" a propósito: agrupa cuatro estados (en cola,
 * esperando documentos, con error, sin análisis aplicable) y "en cola" es uno solo de ellos.
 * Cada fila lleva su estado exacto en la píldora.
 *
 * Honestidad del "en vivo":
 *  · El punto pulsante sólo aparece cuando hay algo en análisis. Si nada se movió, el
 *    encabezado dice "Sin cambios desde {el último evento real}". Antes decía "en vivo,
 *    actualizado hace 3 s" refiriéndose al último sondeo, y escondía que la cola llevaba seis
 *    días quieta.
 *  · Cada fila que espera documentos lleva su antigüedad real, con un reloj que avanza.
 *  · Cuando un sondeo trae un cambio de estado real, la fila viaja a su nuevo grupo (FLIP,
 *    sin movimiento si el sistema pide menos movimiento) y se anuncia UNA vez en la única
 *    región viva de la página. Nada más en la página es región viva.
 *
 * Datos: GET /financiamiento/procesamientos?ubigeo=&codigo=&desde=&hasta=&financiador=&limit=
 * El backend ordena procesando → encolado → procesado → error → el resto (esperando
 * documentos incluido) y su filtro `estado` no acepta `esperando_documentos`. Si la primera
 * página no trae todo, se pide la cola del listado con un offset calculado, para que los que
 * esperan no se caigan del tablero detrás de los procesados.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Cpu, Eye, WifiOff } from "lucide-react";
import { numero, plural } from "@/lib/formato";
import {
  ESTADO_PROC,
  PUBLIC_API_BASE,
  estadoVisible,
  fechaLima,
  haceCuanto,
  procesamientosQueryString,
  type EstadoProc,
  type Procesamiento,
  type ProcesamientosQuery,
} from "@/lib/auditoria";
import { PulseDot } from "@/components/ui/PulseDot";
import { EstadoError, EstadoVacio } from "@/components/patrones";
import { CabeceraFilas, FilaProcesamiento, FilaSkeleton } from "./FilaProcesamiento";

type Columna = "encolado" | "procesando" | "procesado";

const COLUMNAS: { key: Columna; label: string; icon: React.ReactNode; vacio: string }[] = [
  { key: "encolado", label: "En espera", icon: <Clock size={14} aria-hidden />, vacio: "Nada en espera con estos filtros." },
  { key: "procesando", label: "En análisis", icon: <Cpu size={14} aria-hidden />, vacio: "Ningún contrato en análisis ahora mismo." },
  { key: "procesado", label: "Leídos", icon: <CheckCircle2 size={14} aria-hidden />, vacio: "Todavía no se publicó ningún resultado." },
];

/** Orden de la lista: lo que se mueve ahora arriba, después lo que espera, al final lo leído. */
const GRUPOS = ["procesando", "encolado", "procesado"].map((k) => COLUMNAS.find((c) => c.key === k)!);

// error y pendiente_de_procesamiento van en el grupo "En espera" con su propia píldora.
// Recibe el estado CRUDO (`p.estado`): "revision" no es un grupo, es un procesado.
const columnaDe = (estado: EstadoProc): Columna =>
  estado === "procesando" ? "procesando" : estado === "procesado" || estado === "revision" ? "procesado" : "encolado";

// useLayoutEffect avisa en el render del servidor; el efecto sólo hace falta en el navegador.
const useLayoutEffectCliente = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Cómo se dice cada llegada, en singular y en plural. */
const VERBO: Record<EstadoProc, [string, string]> = {
  encolado: ["entró a la cola", "entraron a la cola"],
  procesando: ["empezó su análisis", "empezaron su análisis"],
  procesado: ["terminó su análisis", "terminaron su análisis"],
  revision: ["terminó su análisis y quedó en revisión", "terminaron su análisis y quedaron en revisión"],
  error: ["falló y se va a reintentar", "fallaron y se van a reintentar"],
  esperando_documentos: ["quedó esperando sus documentos", "quedaron esperando sus documentos"],
  pendiente_de_procesamiento: ["quedó sin análisis aplicable", "quedaron sin análisis aplicable"],
};

interface Cambio { ocid: string; titulo: string; de: EstadoProc | null; a: EstadoProc; columnaDe: Columna | null; columnaA: Columna }

/** La palabra del estado dentro de una frase, concordada: "1 leído", "3 leídos", "todos en cola". */
const etiquetaEstado = (e: EstadoProc, n: number) => {
  const t = ESTADO_PROC[e].label.toLowerCase();
  return n !== 1 && t === "leído" ? "leídos" : t;
};

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
  /** Para contenedores angostos (columna lateral): filas siempre apiladas y la lista con su propio scroll. */
  compacto?: boolean;
  /**
   * Si se pasa, esta página YA tiene su propio histórico completo más abajo (p.ej. /app/auditoria):
   * el grupo "Leídos" no se repite acá; solo queda un link a ese histórico. Sin esto (p.ej.
   * /financiar/[ubigeo] compacto, /impacto/[codigo]), "Leídos" es la ÚNICA vista de resultados
   * que tiene esa página, así que se muestra completo como siempre.
   */
  verMasHref?: string;
  /** Otra superficie de la página ya publica los conteos: este tablero no los repite. */
  conteosExternos?: boolean;
  /**
   * Qué mostrar en lugar del grupo "En análisis" (arriba de la lista) cuando no hay nada en
   * análisis, que es el estado NORMAL de esta pantalla, no la excepción. ReactNode ya renderizado
   * (puede venir de un server component); jamás una función: eso compila y rompe sólo en producción.
   */
  panelSecundario?: React.ReactNode;
  /**
   * El vacío y el error del tablero llevan la llamita (patrones EstadoVacio/EstadoError).
   * Apagado por defecto: el tablero vive también dentro de /app/financiar/[ubigeo] e
   * /impacto/[codigo], que ya tienen la suya, y va una sola por pantalla (DESIGN_SYSTEM.md §2.4).
   */
  conLlamita?: boolean;
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
  conLlamita = false,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState<Procesamiento[]>(initial ?? []);
  const [total, setTotal] = useState<number>(initial?.length ?? 0);
  const [cargado, setCargado] = useState<boolean>(initial != null);
  const [fallo, setFallo] = useState(false);
  const [ahora, setAhora] = useState(0);   // 0 hasta montar: el HTML del servidor no lleva cronómetros
  const [anuncio, setAnuncio] = useState("");
  const [ultimoCambio, setUltimoCambio] = useState<{ texto: string; at: number } | null>(null);
  const [recien, setRecien] = useState<Record<string, true>>({});
  const abortRef = useRef<AbortController | null>(null);
  // Estado conocido de cada fila (crudo y visible), para detectar cambios reales entre sondeos.
  const conocido = useRef<Map<string, { crudo: EstadoProc; visible: EstadoProc }> | null>(
    initial ? new Map(initial.map((p) => [p.ocid, { crudo: p.estado, visible: estadoVisible(p) }])) : null,
  );
  const filas = useRef(new Map<string, HTMLElement>());
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
        // FLIP, primer paso: dónde estaba cada fila que cambia de grupo.
        if (!menosMovimiento.current) {
          const rects = new Map<string, DOMRect>();
          for (const c of cambios) {
            if (c.columnaDe === null || c.columnaDe === c.columnaA) continue;
            const el = filas.current.get(c.ocid);
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

  // FLIP, segundo paso: la fila ya está en su grupo nuevo; arranca desde donde estaba.
  useLayoutEffectCliente(() => {
    const rects = rectsAntes.current;
    if (!rects) return;
    rectsAntes.current = null;
    for (const [ocid, r0] of rects) {
      const el = filas.current.get(ocid);
      if (!el || r0.width === 0 || typeof el.animate !== "function") continue;
      const r1 = el.getBoundingClientRect();
      if (r1.width === 0) continue;   // fila oculta: no hay desde dónde animar
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
  // Procesados con alerta bloqueada por la autoevaluación: van en "Leídos" con su píldora, y se cuentan aparte.
  const enRevision = useMemo(() => items.filter((p) => estadoVisible(p) === "revision").length, [items]);
  const movido = useMemo(() => ultimoMovimiento(items), [items]);

  /** De qué está hecho cada grupo, contado sobre las MISMAS filas que se ven debajo. */
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

  // Con verMasHref, "Leídos" ya vive (completo, filtrable) en el histórico de abajo: acá solo
  // quedan los grupos realmente "en vivo" (transitorios) + un enlace al histórico.
  const sinAnalisis = porColumna.procesando.length === 0;
  const conPanel = !!panelSecundario && sinAnalisis;
  const grupos = useMemo(() => {
    let gs = verMasHref ? GRUPOS.filter((g) => g.key !== "procesado") : GRUPOS;
    // Nada en análisis + hay algo mejor que un grupo vacío → el panel ocupa su lugar.
    if (conPanel) gs = gs.filter((g) => g.key !== "procesando");
    return gs;
  }, [verMasHref, conPanel]);

  const vacio = cargado && items.length === 0;
  const nAnalisis = porColumna.procesando.length;
  // La lista se recorre adentro cuando la página sigue más abajo (histórico) o el contenedor es
  // angosto; en el celular no: un scroll dentro de otro scroll no se hace.
  const scroll = compacto
    ? "max-h-[28rem] overflow-y-auto scrollbar-warm"
    : verMasHref || conPanel
      ? "scrollbar-warm lg:max-h-[34rem] lg:overflow-y-auto"
      : "";

  return (
    <section aria-label={titulo ?? "Tablero de auditoría en vivo"}>
      {/* La ÚNICA región viva del tablero: anuncia cambios de estado reales, una vez cada uno. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{anuncio}</p>

      {titulo && <h2 className="font-display text-2xl font-bold text-ink">{titulo}</h2>}

      {/* Una línea de datos: conteos (si nadie más los publica), enlace al histórico y estado del sondeo. */}
      <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px] text-mute ${titulo ? "mt-1" : ""}`}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {/* Los conteos van una sola vez por página. Si otra superficie ya los publica, acá no. */}
          {!conteosExternos &&
            COLUMNAS.map((c) => (
              <span key={c.key} className="inline-flex items-center gap-1">
                <span className={c.key === "procesando" && nAnalisis ? "text-amberTexto" : ""}>{c.icon}</span>
                <span className="font-semibold tabular-nums text-ink">{numero(porColumna[c.key].length)}</span> {c.label.toLowerCase()}
              </span>
            ))}
          {!conteosExternos && enRevision > 0 && (
            <span className="inline-flex items-center gap-1 text-clayTexto" title="Leídos cuya autoevaluación frenó la publicación; una persona los revisa. Son parte de los leídos, no se suman.">
              <Eye size={14} aria-hidden />
              <span className="font-semibold tabular-nums">{numero(enRevision)}</span> de ellos en revisión
            </span>
          )}
          {verMasHref && porColumna.procesado.length > 0 && (
            <a href={verMasHref} className="inline-flex min-h-[24px] items-center gap-1 font-medium text-granate underline-offset-2 hover:underline">
              Ver lo ya leído <span aria-hidden>↓</span>
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5">
          {truncado && (
            <span className="tabular-nums" title={`El API devuelve como mucho ${limit} filas por consulta.`}>
              Mostrando {numero(items.length)} de {numero(total)}
            </span>
          )}
          {fallo ? (
            <span className="inline-flex items-center gap-1 text-amberTexto"><WifiOff size={12} aria-hidden /> Sin conexión; reintentando…</span>
          ) : nAnalisis > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-amberTexto">
              <PulseDot color="amber" size={6} />
              En vivo: {plural(nAnalisis, "contrato en análisis", "contratos en análisis")}
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
            <span>Conectando…</span>
          )}
        </div>
      </div>

      {/* Lo último que se movió mientras esta página estuvo abierta. */}
      {ultimoCambio && (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 rounded-lg bg-granate-soft px-2.5 py-1.5 text-[12px] leading-snug text-ink">
          <span className="font-semibold">Recién:</span>
          <span className="min-w-0">{ultimoCambio.texto}</span>
          {ahora > 0 && <span className="text-[11px] tabular-nums text-inkSoft" suppressHydrationWarning>{haceCuanto(Math.max(0, ahora - ultimoCambio.at))}</span>}
        </p>
      )}

      {vacio ? (
        <VacioTablero fallo={fallo} codigo={codigo} ubigeo={ubigeo} filtrado={!!(desde || hasta || financiador)} compacto={compacto} conLlamita={conLlamita} />
      ) : (
        <div className="mt-3 space-y-3">
          {/* Nada en análisis (el estado normal): la última lectura real va primero. */}
          {conPanel && panelSecundario}

          <div className="overflow-hidden rounded-2xl border border-line bg-paper">
            {!compacto && <CabeceraFilas />}
            <div className={scroll}>
              {grupos.map((g) => {
                const listaCol = porColumna[g.key];
                const partes = composicion(listaCol);
                return (
                  <div key={g.key} role="group" aria-label={`${g.label}: ${numero(listaCol.length)}`} className="border-t border-line first:border-t-0">
                    {/* De qué está hecho el grupo, contado sobre estas mismas filas. Con un solo
                        estado no se desglosa: la píldora de cada fila ya lo nombra.
                        `top-[0px]` y no `top-0`: el layout baja 3 rem todo `.sticky.top-0` en el celular
                        (barra superior), y este encabezado vive en su propio scroll: bajado, tapaba la primera fila. */}
                    <div className={`sticky top-[0px] z-[1] flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line bg-paperSoft py-1.5 text-[12px] ${compacto ? "px-3" : "px-4"}`}>
                      <span className={`inline-flex items-center gap-1.5 font-semibold ${g.key === "procesando" && listaCol.length ? "text-amberTexto" : "text-inkSoft"}`}>
                        {g.icon} {g.label}
                        <span className="tabular-nums text-ink">{numero(listaCol.length)}</span>
                      </span>
                      {partes.length > 1 && (
                        <span className="text-[11.5px] text-mute">
                          {partes.map(([estado, n], i) => (
                            <span key={estado}>
                              {i > 0 && " · "}
                              <span className="font-semibold tabular-nums text-inkSoft">{numero(n)}</span> {etiquetaEstado(estado, n)}
                            </span>
                          ))}
                        </span>
                      )}
                      {listaCol.length === 0 && cargado && <span className="text-[11.5px] text-mute">{g.vacio}</span>}
                    </div>
                    <ul>
                      {listaCol.length === 0 && !cargado && <FilaSkeleton />}
                      {listaCol.map((p) => (
                        <li
                          key={p.ocid}
                          className="border-b border-line/70 last:border-b-0"
                          ref={(el) => {
                            if (el) filas.current.set(p.ocid, el);
                            else filas.current.delete(p.ocid);
                          }}
                        >
                          <FilaProcesamiento p={p} ahora={ahora} recien={!!recien[p.ocid]} compacto={compacto} />
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function VacioTablero({ fallo, codigo, ubigeo, filtrado, compacto, conLlamita }: { fallo: boolean; codigo?: string; ubigeo?: string; filtrado: boolean; compacto: boolean; conLlamita: boolean }) {
  if (fallo) {
    const texto = "Se vuelve a intentar solo, cada pocos segundos. Lo ya publicado sigue disponible en el mapa.";
    return conLlamita ? (
      <EstadoError titulo="El tablero en vivo no respondió" className="mt-4">{texto}</EstadoError>
    ) : (
      <AvisoSinLlamita tono="error" titulo="El tablero en vivo no respondió" className="mt-4">{texto}</AvisoSinLlamita>
    );
  }
  const copy = filtrado
    ? "Ningún contrato financiado coincide con la fecha o con quien lo pagó. Quita un filtro arriba para ver el resto."
    : codigo
      ? "Los contratos se asignan al confirmar el pago. Cuando el aporte esté validado, aquí verás cada uno pasar de la cola al análisis."
      : ubigeo
        ? "Cuando alguien financie esta zona, verás aquí cada contrato pasar de la cola al análisis y al dictamen."
        : "Cuando se confirme un aporte, sus contratos aparecerán aquí y podrás verlos avanzar paso por paso.";
  const titulo = filtrado ? "Nada coincide con estos filtros" : "Nada en proceso todavía";
  return conLlamita ? (
    <EstadoVacio compacto={compacto} titulo={titulo} className="mt-4">{copy}</EstadoVacio>
  ) : (
    <AvisoSinLlamita titulo={titulo} className="mt-4">{copy}</AvisoSinLlamita>
  );
}

/**
 * Vacío o error SIN llamita, con la misma forma que los patrones: para cuando la
 * pantalla ya tiene la suya (máximo una por pantalla). Lo reusa el histórico, que
 * vive en la misma página que el tablero.
 */
export function AvisoSinLlamita({
  titulo,
  children,
  accion,
  tono = "vacio",
  className = "",
}: {
  titulo: string;
  children?: React.ReactNode;
  accion?: React.ReactNode;
  tono?: "vacio" | "error";
  className?: string;
}) {
  const error = tono === "error";
  return (
    <div
      role={error ? "alert" : undefined}
      className={`rounded-2xl border px-5 py-6 text-center ${error ? "border-crimson/25 bg-crimson-soft/60" : "border-dashed border-line bg-paperSoft"} ${className}`}
    >
      <p className={`font-display text-[15px] font-bold text-balance ${error ? "text-crimsonTexto" : "text-ink"}`}>{titulo}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm leading-relaxed text-inkSoft text-pretty">{children}</div>}
      {accion && <div className="mt-3">{accion}</div>}
    </div>
  );
}
