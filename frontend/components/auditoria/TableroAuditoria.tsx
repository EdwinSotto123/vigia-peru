"use client";

/**
 * Tablero público "en vivo": los contratos asignados a aportes confirmados, sobre la `Tabla`
 * del kit con `grupos` (DESIGN_SYSTEM.md §14): En análisis → En espera → Leídos, cada grupo
 * con su conteo en el rótulo. Una fila por contrato: estado (chip) · el contrato · valor ·
 * tiempo · ›, y la fila entera lleva a su página. Hace polling al API cada `autoRefreshMs`
 * sólo con la pestaña visible. Si el API no responde, conserva lo último que mostró y lo
 * dice en voz baja; nunca rompe.
 *
 * Vive en tres lugares, con la misma API de props: /app/auditoria (la pieza viva del
 * Tablero), /app/financiar/[ubigeo] (`compacto`, en un panel lateral) e /impacto/[codigo].
 *
 *  · `verMasHref`: la página ya tiene su propio listado de lo leído más abajo, así que el
 *    grupo "Leídos" no se repite acá, y "En espera" se muestra de a `TOPE` filas: 47 filas
 *    empujaban ese listado tres pantallas hacia abajo. El resto, a un clic.
 *  · Los filtros NO viven acá: llegan como props (en /app/auditoria, de la URL). Por eso el
 *    tablero se monta con `key` por filtro y el sondeo nunca pelea con el estado de la URL.
 *
 * El grupo se llama "En espera" y no "En cola" a propósito: agrupa cuatro estados (en cola,
 * esperando documentos, con error, sin análisis aplicable) y "en cola" es uno solo de ellos.
 * Cada fila lleva su estado exacto en la píldora; el rótulo del grupo dice de qué está hecho.
 *
 * Honestidad del "en vivo":
 *  · El punto pulsante sólo aparece cuando hay algo en análisis. Si nada se movió, la línea
 *    de estado dice "Sin cambios desde {el último evento real}", no la hora del último sondeo.
 *  · Cada fila que espera documentos lleva su antigüedad real, con un reloj que avanza.
 *  · Cuando un sondeo trae un cambio de estado real, la fila viaja a su nuevo grupo (FLIP,
 *    sin movimiento si el sistema pide menos movimiento) y se anuncia UNA vez en la única
 *    región viva de la página.
 *
 * Datos: GET /financiamiento/procesamientos?ubigeo=&codigo=&desde=&hasta=&financiador=&limit=
 * El backend ordena procesando → encolado → procesado → error → el resto (esperando
 * documentos incluido) y su filtro `estado` no acepta `esperando_documentos`. Si la primera
 * página no trae todo, se pide la cola del listado con un offset calculado, para que los que
 * esperan no se caigan del tablero detrás de los procesados.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Cpu, WifiOff } from "lucide-react";
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
import { Tabla, TablaSkeleton, type Fila, type GrupoFilas } from "@/components/listado";
import { AvisoSinLlamita } from "./AvisoSinLlamita";
import {
  COLUMNAS_VIVO,
  COLUMNAS_VIVO_COMPACTO,
  CeldaContrato,
  CeldaTiempo,
  CeldaValor,
  EstadoProcesamiento,
  hrefProcesamiento,
} from "./CeldasProcesamiento";

type Grupo = "encolado" | "procesando" | "procesado";

/** Orden de la lista: lo que se mueve ahora arriba, después lo que espera, al final lo leído. */
const GRUPOS: { key: Grupo; label: string; icon: React.ReactNode; vacio: string }[] = [
  { key: "procesando", label: "En análisis", icon: <Cpu size={13} aria-hidden />, vacio: "ninguno ahora mismo" },
  { key: "encolado", label: "En espera", icon: <Clock size={13} aria-hidden />, vacio: "nada en espera" },
  { key: "procesado", label: "Leídos", icon: <CheckCircle2 size={13} aria-hidden />, vacio: "todavía ningún resultado" },
];

/** Filas de "En espera" a la vista cuando la página sigue con su propio listado de lo leído. */
const TOPE = 8;

// error y pendiente_de_procesamiento van en el grupo "En espera" con su propia píldora.
// Recibe el estado CRUDO (`p.estado`): "revision" no es un grupo, es un procesado.
const grupoDe = (estado: EstadoProc): Grupo =>
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

interface Cambio { ocid: string; titulo: string; de: EstadoProc | null; a: EstadoProc; grupoDe: Grupo | null; grupoA: Grupo }

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

/** De qué está hecho un grupo, contado sobre las MISMAS filas que se ven debajo. */
function composicion(filas: Procesamiento[]): [EstadoProc, number][] {
  const m = new Map<EstadoProc, number>();
  for (const p of filas) {
    const s = estadoVisible(p);
    m.set(s, (m.get(s) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

interface Props {
  ubigeo?: string;
  codigo?: string;
  /** Mismos filtros que el listado de lo leído. YYYY-MM-DD sobre la entrada a la cola. */
  desde?: string;
  hasta?: string;
  financiador?: string;
  titulo?: string;
  autoRefreshMs?: number;
  /** Filas por consulta (el API acepta hasta 300). */
  limit?: number;
  /** Datos ya cargados en el servidor (evita el parpadeo inicial y sirve de respaldo si el API cae). */
  initial?: Procesamiento[] | null;
  /** Para contenedores angostos (panel lateral): menos columnas. El panel ya tiene su propio scroll. */
  compacto?: boolean;
  /**
   * Si se pasa, esta página YA tiene su propio listado de lo leído más abajo (p.ej. /app/auditoria):
   * el grupo "Leídos" no se repite acá; solo queda un enlace a ese listado. Sin esto (p.ej.
   * /financiar/[ubigeo] compacto, /impacto/[codigo]), "Leídos" es la ÚNICA vista de resultados
   * que tiene esa página, así que se muestra completo.
   */
  verMasHref?: string;
  /**
   * Qué mostrar en lugar del grupo "En análisis" cuando no hay nada en análisis, que es el
   * estado NORMAL de esta pantalla, no la excepción. ReactNode ya renderizado (puede venir de
   * un server component); jamás una función: eso compila y rompe sólo en producción.
   */
  panelSecundario?: React.ReactNode;
  /**
   * El vacío y el error del tablero llevan la llamita (patrones EstadoVacio/EstadoError).
   * Apagado por defecto: va una sola por pantalla (DESIGN_SYSTEM.md §2.4) y las tres páginas
   * que usan el tablero ya tienen la suya en otro lado.
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
  const [todaLaEspera, setTodaLaEspera] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Estado conocido de cada fila (crudo y visible), para detectar cambios reales entre sondeos.
  const conocido = useRef<Map<string, { crudo: EstadoProc; visible: EstadoProc }> | null>(
    initial ? new Map(initial.map((p) => [p.ocid, { crudo: p.estado, visible: estadoVisible(p) }])) : null,
  );
  const raiz = useRef<HTMLDivElement>(null);
  const rectsAntes = useRef<Map<string, DOMRect> | null>(null);
  const menosMovimiento = useRef(false);

  const filtros: ProcesamientosQuery = useMemo(() => ({ ubigeo, codigo, desde, hasta, financiador }), [ubigeo, codigo, desde, hasta, financiador]);

  useEffect(() => {
    try {
      menosMovimiento.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch { /* sin matchMedia: se anima */ }
  }, []);

  /** La fila (el `<li>` de la Tabla) de un contrato: la celda del contrato lleva `data-fila`. */
  const filaDe = useCallback((ocid: string): HTMLElement | null => {
    const celda = raiz.current?.querySelector(`[data-fila="${CSS.escape(ocid)}"]`);
    return (celda?.closest("li") as HTMLElement | null) ?? null;
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
          if (!antes) cambios.push({ ocid: p.ocid, titulo: p.titulo ?? p.ocid, de: null, a: visible, grupoDe: null, grupoA: grupoDe(p.estado) });
          else if (antes.visible !== visible) {
            cambios.push({ ocid: p.ocid, titulo: p.titulo ?? p.ocid, de: antes.visible, a: visible, grupoDe: grupoDe(antes.crudo), grupoA: grupoDe(p.estado) });
          }
        }
      }
      conocido.current = new Map(data.map((p) => [p.ocid, { crudo: p.estado, visible: estadoVisible(p) }]));

      if (cambios.length) {
        // FLIP, primer paso: dónde estaba cada fila que cambia de grupo.
        if (!menosMovimiento.current) {
          const rects = new Map<string, DOMRect>();
          for (const c of cambios) {
            if (c.grupoDe === null || c.grupoDe === c.grupoA) continue;
            const el = filaDe(c.ocid);
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
        // lo ya leído) quedó viejo. Se refresca sin recargar.
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
  }, [filtros, limit, router, filaDe]);

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
      const el = filaDe(ocid);
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

  const porGrupo = useMemo(() => {
    const m: Record<Grupo, Procesamiento[]> = { encolado: [], procesando: [], procesado: [] };
    for (const p of items) m[grupoDe(p.estado)].push(p);
    return m;
  }, [items]);
  const movido = useMemo(() => ultimoMovimiento(items), [items]);

  // El API puede no devolverlo todo: si faltan filas, se dice cuántas se muestran de cuántas (§10.5, parcial).
  const truncado = cargado && total > items.length;
  const nAnalisis = porGrupo.procesando.length;
  const conPanel = !!panelSecundario && nAnalisis === 0;
  // Con verMasHref, "Leídos" ya vive (completo, filtrable) en el listado de abajo. Nada en
  // análisis + hay algo mejor que un grupo vacío → el panel ocupa su lugar.
  const visibles = GRUPOS.filter((g) => !(verMasHref && g.key === "procesado") && !(conPanel && g.key === "procesando"));
  const conTope = !!verMasHref && !compacto && !todaLaEspera;
  const nEspera = porGrupo.encolado.length;

  const fila = (p: Procesamiento): Fila => ({
    id: p.ocid,
    href: hrefProcesamiento(p.ocid),
    // "En curso" o recién cambiado: la marca de la tabla (barra granate a la izquierda).
    resaltada: p.estado === "procesando" || !!recien[p.ocid],
    celdas: {
      estado: <EstadoProcesamiento p={p} />,
      contrato: <CeldaContrato p={p} ahora={ahora} />,
      valor: <CeldaValor p={p} />,
      tiempo: <CeldaTiempo p={p} ahora={ahora} />,
    },
  });

  const grupos: GrupoFilas[] = visibles.map((g) => {
    const filas = porGrupo[g.key];
    const partes = composicion(filas);
    const aVista = g.key === "encolado" && conTope ? filas.slice(0, TOPE) : filas;
    return {
      clave: g.key,
      titulo: (
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`inline-flex items-center gap-1.5 ${g.key === "procesando" && filas.length ? "text-amberTexto" : ""}`}>
            {g.icon}
            {g.label} · <span className="tabular-nums text-ink">{numero(filas.length)}</span>
          </span>
          {/* De qué está hecho el grupo, contado sobre estas mismas filas. Con un solo estado
              no se desglosa: la píldora de cada fila ya lo nombra. */}
          {partes.length > 1 && (
            <span className="text-[11.5px] font-normal text-mute">
              {partes.map(([estado, n], i) => (
                <span key={estado}>
                  {i > 0 && " · "}
                  <span className="tabular-nums">{numero(n)}</span> {etiquetaEstado(estado, n)}
                </span>
              ))}
            </span>
          )}
          {filas.length === 0 && cargado && <span className="text-[11.5px] font-normal text-mute">{g.vacio}</span>}
        </span>
      ),
      filas: aVista.map(fila),
    };
  });
  const sinFilas = cargado && grupos.every((g) => g.filas.length === 0);
  const columnas = compacto ? COLUMNAS_VIVO_COMPACTO : COLUMNAS_VIVO;
  const filtrado = !!(desde || hasta || financiador);

  return (
    <section aria-label={titulo ?? "Tablero de auditoría en vivo"}>
      {/* La ÚNICA región viva del tablero: anuncia cambios de estado reales, una vez cada uno. */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">{anuncio}</p>

      {titulo && <h2 className="font-display text-2xl font-bold text-ink">{titulo}</h2>}

      {/* Una línea de estado: enlace a lo ya leído y qué tan vivo está esto de verdad. Los
          conteos van en el rótulo de cada grupo, una sola vez. */}
      <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[12px] text-mute ${titulo ? "mt-1" : ""}`}>
        {verMasHref && porGrupo.procesado.length > 0 ? (
          <a href={verMasHref} className="inline-flex min-h-[24px] items-center gap-1 font-medium text-granate underline-offset-2 hover:underline">
            Ver lo ya leído <span aria-hidden>↓</span>
          </a>
        ) : (
          <span />
        )}
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-0.5">
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
        </span>
      </div>

      {/* Lo último que se movió mientras esta página estuvo abierta. */}
      {ultimoCambio && (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 rounded-lg bg-granate-soft px-2.5 py-1.5 text-[12px] leading-snug text-ink">
          <span className="font-semibold">Recién:</span>
          <span className="min-w-0">{ultimoCambio.texto}</span>
          {ahora > 0 && <span className="text-[11px] tabular-nums text-inkSoft" suppressHydrationWarning>{haceCuanto(Math.max(0, ahora - ultimoCambio.at))}</span>}
        </p>
      )}

      {cargado && items.length === 0 ? (
        <VacioTablero fallo={fallo} codigo={codigo} ubigeo={ubigeo} filtrado={filtrado} compacto={compacto} conLlamita={conLlamita} />
      ) : (
        <div ref={raiz} className="mt-3 space-y-3">
          {/* Nada en análisis (el estado normal): la última lectura real va primero. */}
          {conPanel && panelSecundario}

          {!cargado ? (
            <TablaSkeleton columnas={columnas} filas={4} />
          ) : sinFilas ? (
            // Todo lo de esta vista ya se leyó (y "Leídos" vive más abajo): una línea, no una tabla vacía.
            <p className="rounded-xl border border-dashed border-line bg-paperSoft px-4 py-3 text-[13px] text-inkSoft">
              Nada en espera ni en análisis{filtrado || ubigeo ? " con estos filtros" : ""}.
            </p>
          ) : (
            <Tabla columnas={columnas} grupos={grupos} etiqueta="Contratos financiados en vivo" />
          )}

          {!!verMasHref && !compacto && nEspera > TOPE && (
            <button
              type="button"
              onClick={() => setTodaLaEspera((v) => !v)}
              aria-expanded={todaLaEspera}
              className="inline-flex min-h-[36px] items-center rounded-full border border-line bg-paper px-4 text-[13px] font-medium text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
            >
              {todaLaEspera ? `Ver sólo los primeros ${TOPE}` : `Ver los ${numero(nEspera)} en espera`}
            </button>
          )}
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
    ? "Ningún contrato financiado coincide con la fecha o con quien lo pagó. Quita un filtro para ver el resto."
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
