"use client";

import { rutaContrato } from "@/lib/rutas";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Activity, ExternalLink, Play, RefreshCw, Repeat, RotateCcw, Search, X, Zap } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  Aviso,
  Badge,
  BarraProgreso,
  claseBoton,
  DataTable,
  EmptyState,
  ErrorBanner,
  FilterChips,
  MenuFila,
  PanelPestana,
  Pestanas,
  SkeletonPanel,
  TONO,
  mensajeError,
  plural,
  usePestana,
  type AccionMenu,
  type Columna,
  type OpcionChip,
  type PestanaPanel,
} from "@/components/admin/ui";
import { Ayuda } from "@/components/patrones/Ayuda";
import { adminFetch, PERFIL_LABEL, type Operacion } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { useDialog } from "@/components/admin/Dialog";
import { faseLabel, TOTAL_FASES } from "@/lib/auditoria";
import { AvisoDetenidos } from "@/components/admin/procesamiento/AvisoDetenidos";
import { Flujo } from "@/components/admin/procesamiento/Flujo";
import { agruparLotes, Lotes } from "@/components/admin/procesamiento/Lotes";
import { Masivo } from "@/components/admin/procesamiento/Masivo";
import { PedidosDescarga, usePedidos } from "@/components/admin/procesamiento/PedidosDescarga";
import { ProcesarLote } from "@/components/admin/procesamiento/ProcesarLote";
import { Partes } from "@/components/ui/Partes";
import {
  conteoDeCola,
  conteoVacio,
  DETENIDOS,
  esEstado,
  ESTADO_UI,
  FLUJO,
  fmtFechaHora,
  hace,
  MENU_A_LA_DERECHA,
  normalize,
  PERFILES,
  PISTA_ESTADO,
  SONDEO_OPERACION,
  TOPE_LISTA,
  type Estado,
  type Perfil,
  type ProcAdmin,
} from "@/components/admin/procesamiento/tipos";

/**
 * Procesamiento: lo que el dispatcher tiene entre manos, por contrato y por lote.
 *
 * Rediseño del 2026-10-30 (medía 5.3 pantallas en escritorio y 16.3 en el celular: 200 filas seguidas, dos botones
 * en cada una, una columna «Detalle» casi siempre vacía y párrafos que explicaban la lista). Ahora, de arriba abajo:
 *   1. Por qué algo está detenido (AvisoDetenidos): si hay contratos esperando documentos y el lote nocturno no corre,
 *      lo dice con la fecha y cómo destrabarlo; si hay errores, para re-encolarlos.
 *   2. Una franja con el flujo cola, procesando y procesados, y lo detenido aparte (Flujo). Cada cifra es un atajo al
 *      filtro de la lista.
 *   3. Pestañas en la URL (?tab=), sólo se pinta la activa: Contratos (filtros en una fila y la lista de a 25; la fila
 *      abre la traza y re-analizar o re-encolar van en su «⋯»), Lotes (lista compacta: elegir uno filtra los
 *      contratos) y Descargas (sólo si hay pedidos de descarga abiertos).
 * Lo que explica (qué trae la lista, qué es cada estado, cómo se cuentan los lotes) va en los ⓘ.
 *
 * Desde acá también se procesa un lote a nombre de Vigía Perú (botón de la cabecera): antes eso sólo existía en la
 * página pública de financiar, y al terminar mandaba a /app.
 *
 * Fuentes: GET /api/admin/procesamientos (cada 15 s con la pestaña visible), GET /api/admin/operacion (a lo más cada
 * minuto, caché compartida con el Resumen), GET /api/admin/pedidos, POST /api/admin/procesar-lote,
 * POST …/:ocid/reencolar, POST …/:ocid/reanalizar, POST …/reencolar-errores, POST /api/admin/dispatcher/run.
 * La lista pinta apenas llega /procesamientos: /operacion tarda segundos y no la frena.
 *
 * Los totales por estado salen de /operacion (`cola`, un conteo exacto): la lista trae a lo más 200 filas y contarlas
 * ahí se quedaba corto. Los filtros y la pestaña viven en la URL (?estado=, ?perfil=, ?lote=, ?tab=): un enlace del
 * menú a /admin/procesamientos los limpia.
 */

export default function AdminProcesamientosPage() {
  // Los filtros y la pestaña se leen con useSearchParams, que pide un límite de Suspense.
  return (
    <Suspense
      fallback={
        <AdminShell title="Procesamiento" subtitle="Lo que se está leyendo, lo que espera y lo que ya terminó.">
          <SkeletonPanel lineas={6} />
        </AdminShell>
      }
    >
      <Procesamientos />
    </Suspense>
  );
}

type Tab = "contratos" | "lotes" | "masivo" | "descargas";
/** Arreglos fijos, no armados en cada render: usePestana los usa como dependencia. */
const PESTANAS: readonly Tab[] = ["contratos", "lotes", "masivo"];
const PESTANAS_CON_DESCARGAS: readonly Tab[] = ["contratos", "lotes", "masivo", "descargas"];

function Procesamientos() {
  const procQ = useAdmin<{ data?: any[] } | any[]>("/procesamientos", { refreshInterval: 15_000 });
  const opQ = useAdmin<Operacion>("/operacion", SONDEO_OPERACION);
  const pedidos = usePedidos();
  // Sin datos y con error: tabla vacía con el mensaje arriba (como antes). Con datos
  // previos y un sondeo fallido, se conserva lo último que se vio.
  const rows = useMemo<ProcAdmin[] | null>(() => {
    const r = procQ.data;
    if (!r) return procQ.error ? [] : null;
    return (Array.isArray(r) ? r : (r.data ?? [])).map(normalize);
  }, [procQ.data, procQ.error]);
  const op = opQ.data ?? null;
  const loading = procQ.isValidating;
  // Filtros: se leen de la URL en cada cambio (antes, una sola vez al montar, y un enlace del menú
  // no limpiaba un ?estado= viejo). Vienen de enlaces del Resumen, de la bitácora y del lote recién creado.
  const params = useSearchParams();
  const pEstado = params.get("estado"), pPerfil = params.get("perfil");
  const estado: Estado | "todos" = esEstado(pEstado) ? pEstado : "todos";
  const perfil: Perfil | "todos" = pPerfil && (PERFILES as readonly string[]).includes(pPerfil) ? (pPerfil as Perfil) : "todos";
  const lote = params.get("lote") || null;
  // La pestaña de descargas aparece sólo si hay pedidos abiertos (o si no se pudieron leer: el aviso del error vive ahí).
  const hayDescargas = pedidos.abiertos.length > 0 || !!pedidos.q.error;
  const [tab, setTab] = usePestana(hayDescargas ? PESTANAS_CON_DESCARGAS : PESTANAS);
  /**
   * Cambia filtros en la URL sin ir al servidor (Next sincroniza history.replaceState con useSearchParams).
   * `tab: null` vuelve a la pestaña Contratos (la primera, que no lleva parámetro): un atajo que filtra la lista
   * tiene que mostrarla.
   */
  const filtrar = useCallback((cambios: { estado?: Estado | "todos"; perfil?: Perfil | "todos"; lote?: string | null; tab?: null }) => {
    const sp = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries(cambios)) {
      if (!v || v === "todos") sp.delete(k);
      else sp.set(k, v);
    }
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, []);
  const [q, setQ] = useState("");
  const [panelLote, setPanelLote] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  /** Tras una acción (o con "Actualizar"): la tabla y la salud, sin esperar al próximo sondeo. */
  const load = useCallback(() => {
    void refrescarAdmin("/procesamientos", "/operacion", "/pedidos");
  }, []);

  const { open, toast } = useDialog();

  function reencolar(p: ProcAdmin) {
    open({
      title: `Re-encolar ${p.ocid}`, confirmLabel: "Re-encolar",
      body: <>Se reinician los intentos y el dispatcher lo toma en su próxima corrida (cada 5 min).</>,
      onConfirm: async () => {
        try {
          await adminFetch(`/procesamientos/${encodeURIComponent(p.ocid)}/reencolar`, { method: "POST", body: "{}" });
        } catch (e) { throw new Error(mensajeError(e)); }
        toast(`${p.ocid} re-encolado`); load();
      },
    });
  }

  function reanalizar(p: ProcAdmin) {
    const activo = (rows ?? []).find((r) => r.estado === "procesando");
    open({
      title: `Re-analizar ${p.ocid}`, confirmLabel: activo ? "Hay uno en curso" : "Re-analizar", tone: "danger",
      body: activo
        ? <>No se puede lanzar ahora: <strong>{activo.ocid}</strong> está en análisis y el servicio de agentes lee un contrato a la vez. Espera a que termine.</>
        : <>Vuelve a leer el contrato completo: <strong>≈ US$ 0.25</strong> y <strong>~3 min</strong> (hasta 10 si el expediente es pesado). La alerta actual se reemplaza al guardar la nueva; si estaba en revisión, seguirá en revisión hasta que la publiques.</>,
      fields: activo ? [] : [{ name: "motivo", label: "Motivo (queda en la bitácora)", placeholder: "p. ej. se corrigió la lectura de documentos", required: true }],
      onConfirm: async (v) => {
        if (activo) throw new Error("Espera a que termine el análisis en curso.");
        try {
          await adminFetch(`/procesamientos/${encodeURIComponent(p.ocid)}/reanalizar`, { method: "POST", body: JSON.stringify({ motivo: v.motivo }) });
        } catch (e) { throw new Error(mensajeError(e)); }
        toast(`${p.ocid} re-encolado para re-análisis`); load();
      },
    });
  }

  function reencolarErrores() {
    open({
      title: "Re-encolar todos los contratos con error", tone: "danger", confirmLabel: "Re-encolar todos",
      body: <>Reinicia los intentos de todos los contratos con error. Úsalo después de arreglar la causa.</>,
      onConfirm: async () => {
        let r: { reencolados: number };
        try {
          r = await adminFetch<{ reencolados: number }>("/procesamientos/reencolar-errores", { method: "POST", body: "{}" });
        } catch (e) { throw new Error(mensajeError(e)); }
        toast(`${plural(r.reencolados, "contrato re-encolado", "contratos re-encolados")}`); load();
      },
    });
  }

  async function correrDispatcher() {
    setBusy("run");
    try {
      await adminFetch("/dispatcher/run", { method: "POST", body: "{}" });
      toast("El dispatcher arrancó: toma lo que está en cola en alrededor de un minuto");
      setTimeout(load, 8000);
    } catch (e) { toast(mensajeError(e), "error"); }
    finally { setBusy(null); }
  }

  // ¿La lista vino cortada? Con el tope justo puede faltar lo más viejo.
  const capada = (rows?.length ?? 0) >= TOPE_LISTA;
  /**
   * Totales por estado: los exactos de /operacion. Mientras no llega, los de la lista sólo si no
   * vino cortada (entonces son todos); si vino cortada, las cifras esperan en vez de mostrar de menos.
   * Si /operacion falló, quedan los de la lista y un aviso lo dice.
   */
  const exactos = !!op?.cola || !capada;
  const counts = useMemo(() => {
    if (op?.cola) return conteoDeCola(op.cola);
    if (!rows || (capada && !opQ.error)) return null;
    const c = conteoVacio();
    for (const r of rows) c[r.estado] = (c[r.estado] ?? 0) + 1;
    return c;
  }, [op?.cola, rows, capada, opQ.error]);
  const totalExacto = counts && exactos ? Object.values(counts).reduce((a, n) => a + n, 0) : null;
  // Las cifras cuentan sólo la lista cortada (y no porque /operacion esté cargando): eso se avisa, no va en un ⓘ.
  const cuentaParcial = capada && !op?.cola && !!opQ.error;

  const porPerfil = useMemo(() => {
    const c: Record<string, number> = { bienes: 0, servicios: 0, obras: 0, otros: 0 };
    for (const r of rows ?? []) if (r.perfil) c[r.perfil] = (c[r.perfil] ?? 0) + 1;
    return c;
  }, [rows]);

  const lotes = useMemo(() => agruparLotes(rows ?? []), [rows]);

  const visible = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (estado === "todos" || r.estado === estado) &&
        (perfil === "todos" || r.perfil === perfil) &&
        (!lote || r.contribucionCodigo === lote) &&
        (!t || r.ocid.toLowerCase().includes(t) || (r.titulo ?? "").toLowerCase().includes(t) || (r.entidad ?? "").toLowerCase().includes(t)),
    );
  }, [rows, estado, perfil, lote, q]);

  /** Un atajo de la franja: filtra la lista por ese estado y la muestra; tocar el elegido otra vez quita el filtro. */
  const elegirEstado = (e: Estado) => filtrar({ estado: tab === "contratos" && estado === e ? "todos" : e, tab: null });

  // Chips de estado: los que tienen contratos y el elegido (aunque esté en cero). Los siete juntos no entraban en
  // una fila con el tipo y la búsqueda; los que están en cero igual se ven en la franja de arriba.
  const opcionesEstado: OpcionChip<Estado | "todos">[] = [
    { valor: "todos", etiqueta: "Todos", cuenta: totalExacto },
    ...[...FLUJO, ...DETENIDOS]
      .filter((e) => e === estado || (counts ? counts[e] > 0 : (rows ?? []).some((r) => r.estado === e)))
      .map((e) => ({ valor: e, etiqueta: ESTADO_UI[e].label, cuenta: counts?.[e] ?? null, tono: ESTADO_UI[e].tono })),
  ];
  // Con muchos estados los chips no entran y se deslizan de costado: el elegido (al llegar con ?estado=error, o desde
  // un atajo de la franja) quedaba fuera de la vista. Se lo trae, moviendo sólo la fila de chips, nunca la página.
  const chipsRef = useRef<HTMLDivElement>(null);
  const nChips = opcionesEstado.length;
  useEffect(() => {
    const fila = chipsRef.current;
    const chip = fila?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]');
    if (!fila || !chip) return;
    const f = fila.getBoundingClientRect(), c = chip.getBoundingClientRect();
    if (c.left < f.left || c.right > f.right) fila.scrollLeft += c.left - f.left - 8;
  }, [estado, tab, nChips]);

  const pestanas: PestanaPanel<Tab>[] = [
    { clave: "contratos", etiqueta: "Contratos" },
    { clave: "lotes", etiqueta: "Lotes", conteo: rows ? lotes.length : null },
    { clave: "masivo", etiqueta: "Masivo" },
    ...(hayDescargas
      ? [
          {
            clave: "descargas" as const,
            etiqueta: "Descargas",
            conteo: pedidos.rows ? pedidos.abiertos.length : null,
            tono: pedidos.fallidos > 0 || pedidos.q.error ? ("danger" as const) : ("pending" as const),
          },
        ]
      : []),
  ];

  /** Lo secundario de cada fila, en su «⋯» (la acción principal, abrir la traza, es el clic en la fila). */
  const accionesDe = (p: ProcAdmin): AccionMenu[] => [
    ...(p.estado === "procesado" || p.estado === "error" || p.estado === "pendiente_de_procesamiento"
      ? [{ etiqueta: "Re-analizar (≈ US$ 0.25)", icono: <Repeat size={14} aria-hidden />, onClick: () => reanalizar(p) }]
      : []),
    ...(p.estado !== "procesado" && p.estado !== "procesando"
      ? [{ etiqueta: "Re-encolar", icono: <RotateCcw size={14} aria-hidden />, onClick: () => reencolar(p) }]
      : []),
  ];

  /**
   * Una línea por fila en escritorio; en el celular (compactoMovil), dos: el contrato y debajo el estado, el último
   * movimiento y el «⋯». Tipo, zona, lote y avance quedan para el escritorio (la traza tiene todo).
   */
  const columnas: Columna<ProcAdmin>[] = [
    {
      clave: "contrato",
      titulo: "Contrato",
      principal: true,
      // Toma el ancho que dejan las demás (max-w-0 + w-full): el objeto se corta con «…» y entero va en el title.
      className: "w-full max-w-0",
      celda: (p) => {
        const error = motivoError(p);
        return (
          <>
            <span className="flex min-w-0 items-baseline gap-2" title={p.titulo ?? undefined}>
              <span className="shrink-0 font-mono text-rotulo text-ink">{p.ocid}</span>
              <span className="truncate text-meta text-inkSoft">{p.titulo ?? "Sin título"}</span>
            </span>
            {/* En el celular el motivo de un error va bajo el título, a todo el ancho (en escritorio, bajo el estado). */}
            {error && (
              <span className="block truncate text-micro text-crimsonTexto lg:hidden" title={error}>
                {error}
              </span>
            )}
          </>
        );
      },
    },
    {
      clave: "origen",
      titulo: "Tipo y lote",
      soloEscritorio: true,
      className: "whitespace-nowrap text-rotulo text-inkSoft",
      celda: (p) => (
        <Partes
          partes={[
            p.perfil ? PERFIL_LABEL[p.perfil].split(" ")[0] : p.tipo,
            p.zona,
            p.contribucionCodigo && <span className="font-mono text-mute">{p.contribucionCodigo}</span>,
          ]}
        />
      ),
    },
    { clave: "estado", titulo: "Estado", celda: (p) => <EstadoFila p={p} /> },
    { clave: "avance", titulo: "Avance", soloEscritorio: true, className: "whitespace-nowrap", celda: (p) => <Avance p={p} /> },
    {
      clave: "movimiento",
      titulo: "Movimiento",
      className: "whitespace-nowrap text-rotulo text-mute",
      celda: (p) => {
        const t = p.latidoAt ?? p.finalizadoAt ?? p.encoladoAt;
        return <span title={fmtFechaHora(t) ?? undefined}>{hace(t) ?? "sin movimiento"}</span>;
      },
    },
    {
      // Una columna normal (no `acciones`): en el celular va en el segundo renglón, no en un tercero propio.
      clave: "menu",
      titulo: <span className="sr-only">Acciones</span>,
      etiquetaMovil: "Acciones",
      alinear: "derecha",
      // Menos relleno arriba y abajo: el «⋯» mide 32 px y, con el de siempre, cada fila crecía 10 px.
      className: "w-px py-1",
      celda: (p) => {
        const acciones = accionesDe(p);
        return acciones.length ? <MenuFila etiqueta={`Acciones de ${p.ocid}`} acciones={acciones} /> : null;
      },
    },
  ];

  return (
    <AdminShell
      title="Procesamiento"
      subtitle="Lo que se está leyendo, lo que espera y lo que ya terminó."
      actions={
        <>
          <button onClick={() => setPanelLote((v) => !v)} aria-expanded={panelLote} className={claseBoton(panelLote ? "secundario" : "marca")}>
            <Zap size={12} aria-hidden /> Procesar a nombre de Vigía
          </button>
          <button
            onClick={correrDispatcher}
            disabled={busy === "run"}
            title="Corre solo cada 5 minutos; esto lo adelanta."
            className={claseBoton("secundario")}
          >
            {busy === "run" ? <RefreshCw size={12} className="animate-spin" aria-hidden /> : <Play size={12} aria-hidden />} Correr ahora
          </button>
          <button onClick={load} className={claseBoton("secundario")}>
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} aria-hidden /> Actualizar
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <ErrorBanner error={procQ.error} titulo="No se pudo leer la lista de contratos" onReintentar={load} />

        {panelLote && (
          <ProcesarLote
            op={op}
            onCerrar={() => setPanelLote(false)}
            onCreado={(codigo) => {
              setPanelLote(false);
              filtrar({ lote: codigo, estado: "todos", tab: null });
              load();
            }}
          />
        )}

        <AvisoDetenidos
          op={op}
          cargandoOp={!op && !opQ.error}
          esperando={counts?.esperando_documentos ?? 0}
          errores={counts?.error ?? 0}
          onReencolarErrores={reencolarErrores}
          onVer={(e) => filtrar({ estado: e, tab: null })}
        />

        <Flujo
          counts={counts ?? conteoVacio()}
          total={counts ? Object.values(counts).reduce((a, n) => a + n, 0) : 0}
          activo={estado}
          onElegir={elegirEstado}
          cargando={counts === null}
        />

        {cuentaParcial && (
          <Aviso
            rol="note"
            tono="warn"
            titulo={`Las cifras cuentan sólo los ${TOPE_LISTA} contratos de la lista`}
            acciones={
              <button type="button" onClick={load} className={claseBoton("secundario", "sm")}>
                <RefreshCw size={12} aria-hidden /> Reintentar
              </button>
            }
          >
            No se pudo leer el estado del sistema, que trae el total exacto de cada estado.
          </Aviso>
        )}

        <div>
          <Pestanas etiqueta="Secciones de Procesamiento" pestanas={pestanas} activa={tab} onCambiar={setTab} />
          <PanelPestana clave={tab}>
            {tab === "lotes" ? (
              <Lotes lotes={rows === null ? null : lotes} activo={lote} incompletos={capada} onElegir={(c) => filtrar({ lote: c, estado: "todos", tab: null })} />
            ) : tab === "masivo" ? (
              <Masivo />
            ) : tab === "descargas" ? (
              <PedidosDescarga onChange={load} />
            ) : (
              <>
                {/* Filtros en una fila. En el celular, dos: los chips (se deslizan de costado) con el ⓘ y el tablero
                    público; debajo, tipo y búsqueda. En escritorio los grupos se disuelven (sm:contents) y `order`
                    deja chips, tipo, búsqueda, ⓘ y tablero, en ese orden. */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 items-center gap-2 sm:contents">
                    {/* Sin barra de scroll; el borde derecho se desvanece para que se note que hay más chips de costado. */}
                    <div
                      ref={chipsRef}
                      className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-0.5 [mask-image:linear-gradient(to_right,black_calc(100%_-_1.5rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    >
                      {lote && (
                        <span className={`inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-full border px-2.5 text-meta font-medium ${TONO.brand.badge}`}>
                          Lote {lote}
                          <button type="button" onClick={() => filtrar({ lote: null })} aria-label="Quitar filtro de lote" className="rounded-full p-0.5 hover:bg-granate/10">
                            <X size={11} aria-hidden />
                          </button>
                        </span>
                      )}
                      <FilterChips etiqueta="Estado del contrato" valor={estado} onCambiar={(v) => filtrar({ estado: v })} opciones={opcionesEstado} className="flex-nowrap" />
                    </div>
                    <Ayuda titulo="¿Qué contratos trae la lista?" className="sm:order-2">
                      {capada
                        ? `Los ${TOPE_LISTA} con movimiento más reciente${totalExacto != null ? `, de ${plural(totalExacto, "contrato", "contratos")} en total` : ""}. Las cifras de la franja y de cada estado cuentan todos.`
                        : "Todos los contratos en proceso."}{" "}
                      Toca uno para abrir su traza (qué hizo cada revisión, paso a paso); re-analizar y re-encolar van en su «⋯».
                    </Ayuda>
                    <Link
                      href="/app/auditoria"
                      target="_blank"
                      title="Tablero público (se abre en otra pestaña)"
                      className={claseBoton("fantasma", "sm", "px-2.5 sm:order-3 sm:px-3.5")}
                    >
                      <ExternalLink size={12} aria-hidden /> <span className="sr-only sm:not-sr-only">Tablero público</span>
                    </Link>
                  </div>
                  <div className="flex items-center gap-2 sm:contents">
                    <select
                      value={perfil}
                      onChange={(e) => filtrar({ perfil: e.target.value as Perfil | "todos" })}
                      aria-label="Tipo de contrato"
                      className="min-h-[34px] shrink-0 rounded-full border border-line bg-paperDeep px-3 text-meta text-ink focus:border-granate/60 sm:order-1"
                    >
                      <option value="todos">Todos los tipos</option>
                      {/* Con la lista cortada, contar ahí daría de menos: sin número. */}
                      {PERFILES.map((pf) => (
                        <option key={pf} value={pf}>
                          {`${PERFIL_LABEL[pf].split(" ")[0]}${capada ? "" : ` (${porPerfil[pf] ?? 0})`}`}
                        </option>
                      ))}
                    </select>
                    <label className="relative min-w-0 flex-1 sm:order-1 sm:w-56 sm:flex-none">
                      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
                      <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Código, objeto o entidad"
                        aria-label="Buscar contrato"
                        className="min-h-[34px] w-full rounded-full border border-line bg-paperDeep py-1 pl-8 pr-3 text-meta text-ink placeholder:text-mute focus:border-granate/60"
                      />
                    </label>
                  </div>
                </div>

                <DataTable
                  className={`mt-3 ${MENU_A_LA_DERECHA}`}
                  etiqueta="Contratos en procesamiento"
                  columnas={columnas}
                  filas={rows === null ? null : visible}
                  claveFila={(p) => p.ocid}
                  // La fila entera abre la traza (antes, el botón «Traza» de cada fila), en otra pestaña como antes.
                  hrefFila={(p) => rutaContrato(p.ocid, "vivo")}
                  externo
                  cargando={rows === null}
                  apilarHasta="lg"
                  anchoMinimo="min-w-[56rem]"
                  porPagina={25}
                  compactoMovil
                  // La lista se refresca cada 15 s: sólo un filtro o una búsqueda nueva vuelve a la primera página.
                  reinicio={`${estado}|${perfil}|${lote ?? ""}|${q}`}
                  vacio={
                    rows && rows.length === 0 && procQ.error ? (
                      // Sin datos por un error: no decir "no hay nada" cuando en realidad no sabemos.
                      <EmptyState compacto titulo="La lista no llegó" descripcion="Reintenta desde el aviso de arriba." />
                    ) : rows && rows.length === 0 ? (
                      <EmptyState compacto icono={<Activity size={18} />} titulo="No hay contratos en proceso" descripcion="Aparecen al validar un aporte o al procesar un lote." />
                    ) : (
                      <EmptyState compacto titulo="Ningún contrato con estos filtros" descripcion="Quita un filtro para ver el resto." />
                    )
                  }
                />
              </>
            )}
          </PanelPestana>
        </div>
      </div>
    </AdminShell>
  );
}

const etiquetaFila = (e: Estado) => (e === "procesado" ? "Procesado" : e === "esperando_documentos" ? "Esperando documentos" : ESTADO_UI[e]?.label ?? e);

/** El motivo de un error, si lo hay (como antes: esperar documentos o no tener revisiones no es un error). */
const motivoError = (p: ProcAdmin) => (p.error && p.estado !== "esperando_documentos" && p.estado !== "pendiente_de_procesamiento" ? p.error : null);

/**
 * El estado de la fila. Lo que antes iba en la columna «Detalle» (casi siempre «—»): el motivo de un error, debajo
 * de la etiqueta (en escritorio; en el celular va bajo el título); lo que quiere decir cada estado, en el title de la
 * etiqueta. En el celular no hay columna de avance: la fase del que se está leyendo va acá.
 */
function EstadoFila({ p }: { p: ProcAdmin }) {
  const error = motivoError(p);
  return (
    // En escritorio, un mínimo de 11rem: con sólo filas «Con error», la columna medía lo que su etiqueta y el motivo no
    // alcanzaba a leerse.
    <span className="flex min-w-0 flex-col items-start gap-0.5 lg:min-w-[11rem]">
      <span className="flex items-center gap-1 whitespace-nowrap">
        <Badge tono={ESTADO_UI[p.estado]?.tono ?? "muted"} title={PISTA_ESTADO[p.estado]}>
          {etiquetaFila(p.estado)}
        </Badge>
        {p.estado === "procesado" && p.alertaEstado === "revision" && (
          <Badge tono="pending" title="En revisión humana: la alerta espera una decisión">
            En revisión
          </Badge>
        )}
        {p.estado === "procesando" && (
          <span className="font-mono text-micro text-inkSoft lg:hidden">
            {p.faseIndex ?? 0}/{TOTAL_FASES}
          </span>
        )}
      </span>
      {/* w-0 + min-w-full: el motivo ocupa el ancho que ya tiene la columna y se corta ahí; si no, un error largo
          ensanchaba «Estado» y dejaba el objeto del contrato en diez letras. */}
      {error && (
        <span className="hidden w-0 min-w-full truncate text-micro text-crimsonTexto lg:block" title={error}>
          {error}
        </span>
      )}
    </span>
  );
}

/** Dónde va cada contrato, en una línea: la fase si se está leyendo, cuánto tardó y su puntaje si ya terminó. */
function Avance({ p }: { p: ProcAdmin }) {
  if (p.estado === "procesando") {
    const i = p.faseIndex ?? 0;
    return (
      <span className="flex w-44 items-center gap-2 text-rotulo text-inkSoft">
        <BarraProgreso pct={Math.max(6, Math.round((i / TOTAL_FASES) * 100))} tono="warn" alto="sm" etiqueta={`Avance: fase ${i} de ${TOTAL_FASES}`} className="w-14 shrink-0" />
        <span className="shrink-0 font-mono">
          {i}/{TOTAL_FASES}
        </span>
        <span className="truncate">{p.faseActual ? faseLabel(p.faseActual) : "Iniciando"}</span>
      </span>
    );
  }
  if (p.estado === "procesado") {
    const seg = p.iniciadoAt && p.finalizadoAt ? (new Date(p.finalizadoAt).getTime() - new Date(p.iniciadoAt).getTime()) / 1000 : null;
    return (
      <span className="text-rotulo text-inkSoft">
        {seg != null && seg > 0 ? `leído en ${seg < 90 ? `${Math.round(seg)} s` : `${Math.round(seg / 60)} min`}` : "terminado"}
        {p.score != null && <span className="text-mute">, puntaje {p.score}</span>}
      </span>
    );
  }
  if (p.intentos > 0) return <span className="text-rotulo text-mute">{plural(p.intentos, "intento", "intentos")}</span>;
  return <span className="text-rotulo text-mute">sin empezar</span>;
}
