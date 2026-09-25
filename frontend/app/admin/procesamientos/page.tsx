"use client";

import { Suspense, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Activity,
  ExternalLink,
  Eye,
  Play,
  RefreshCw,
  Repeat,
  RotateCcw,
  Search,
  X,
  Zap,
} from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Badge, BarraProgreso, claseBoton, EmptyState, ErrorBanner, PageSection, SkeletonFilas, SkeletonPanel, TONO, fmtNum, mensajeError, plural } from "@/components/admin/ui";
import { adminFetch, PERFIL_LABEL, type Operacion } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { useDialog } from "@/components/admin/Dialog";
import { faseLabel, TOTAL_FASES } from "@/lib/auditoria";
import { AvisoDetenidos } from "@/components/admin/procesamiento/AvisoDetenidos";
import { Flujo } from "@/components/admin/procesamiento/Flujo";
import { agruparLotes, Lotes } from "@/components/admin/procesamiento/Lotes";
import { PedidosDescarga } from "@/components/admin/procesamiento/PedidosDescarga";
import { ProcesarLote } from "@/components/admin/procesamiento/ProcesarLote";
import {
  conteoDeCola,
  conteoVacio,
  esEstado,
  ESTADO_UI,
  hace,
  normalize,
  PERFILES,
  SONDEO_OPERACION,
  TOPE_LISTA,
  type Estado,
  type Perfil,
  type ProcAdmin,
} from "@/components/admin/procesamiento/tipos";

/**
 * Procesamiento: lo que el dispatcher tiene entre manos, por lote y por contrato.
 *
 * Arriba, por qué algo está detenido (si hay contratos esperando documentos y el
 * lote nocturno no corre, lo dice con la fecha y cómo destrabarlo). Después el
 * flujo cola → procesando → procesados como cajas que filtran la tabla al
 * tocarlas, los lotes con su avance, y la tabla.
 *
 * Desde acá también se procesa un lote a nombre de Vigía Perú: antes eso sólo
 * existía en la página pública de financiar, y al terminar mandaba a /app.
 *
 * Fuentes: GET /api/admin/procesamientos (cada 15 s con la pestaña visible),
 * GET /api/admin/operacion (a lo más cada minuto, caché compartida con el Resumen),
 * POST /api/admin/procesar-lote, POST …/:ocid/reencolar, POST …/:ocid/reanalizar.
 * La tabla pinta apenas llega /procesamientos: /operacion tarda segundos y no la frena.
 *
 * Los totales por estado salen de /operacion (`cola`, un conteo exacto): la lista trae a lo más
 * 200 filas y contarlas ahí se quedaba corto. Los filtros viven en la URL (?estado=, ?perfil=,
 * ?lote=): un enlace del menú a /admin/procesamientos los limpia.
 */

export default function AdminProcesamientosPage() {
  // Los filtros se leen con useSearchParams, que pide un límite de Suspense.
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

function Procesamientos() {
  const procQ = useAdmin<{ data?: any[] } | any[]>("/procesamientos", { refreshInterval: 15_000 });
  const opQ = useAdmin<Operacion>("/operacion", SONDEO_OPERACION);
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
  /** Cambia filtros en la URL sin ir al servidor (Next sincroniza history.replaceState con useSearchParams). */
  const filtrar = useCallback((cambios: { estado?: Estado | "todos"; perfil?: Perfil | "todos"; lote?: string | null }) => {
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
   * vino cortada (entonces son todos); si vino cortada, las cajas esperan en vez de mostrar de menos.
   * Si /operacion falló, quedan los de la lista y la nota de abajo lo dice.
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

  const alternarEstado = (e: Estado) => filtrar({ estado: estado === e ? "todos" : e });
  const hayOtrosFiltros = perfil !== "todos" || !!lote || !!q.trim();
  // En la lista: con tope y sin filtros que no sean de estado, se sabe de cuántos es la muestra.
  const totalDelFiltro = counts && exactos ? (estado === "todos" ? totalExacto : counts[estado]) : null;
  const metaLista = !rows
    ? undefined
    : !capada
      ? `${fmtNum(visible.length)} de ${fmtNum(rows.length)}`
      : !hayOtrosFiltros && totalDelFiltro != null
        ? `Mostrando ${fmtNum(visible.length)} de ${fmtNum(totalDelFiltro)}`
        : `${fmtNum(visible.length)} de los ${fmtNum(rows.length)} más recientes`;

  return (
    <AdminShell
      title="Procesamiento"
      subtitle="Lo que se está leyendo, lo que espera y lo que ya terminó."
      actions={
        <>
          <button onClick={() => setPanelLote((v) => !v)} aria-expanded={panelLote} className={claseBoton("marca")}>
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
      <ErrorBanner error={procQ.error} titulo="No se pudo leer la lista de contratos" onReintentar={load} className="mb-4" />

      {panelLote && (
        <ProcesarLote
          op={op}
          onCerrar={() => setPanelLote(false)}
          onCreado={(codigo) => {
            setPanelLote(false);
            filtrar({ lote: codigo, estado: "todos" });
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
        onVer={(e) => filtrar({ estado: e })}
      />

      <Flujo
        counts={counts ?? conteoVacio()}
        total={counts ? Object.values(counts).reduce((a, n) => a + n, 0) : 0}
        activo={estado}
        onElegir={alternarEstado}
        cargando={counts === null}
      />

      {lotes.length > 0 && <Lotes lotes={lotes} activo={lote} incompletos={capada} onElegir={(c) => filtrar({ lote: lote === c ? null : c })} />}

      <PageSection titulo="Contratos" meta={metaLista} className="mt-6">
        {/* ── Filtros de la tabla ── */}
        <div className="flex flex-wrap items-center gap-2">
          {lote && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${TONO.brand.badge}`}>
              Lote {lote}
              <button onClick={() => filtrar({ lote: null })} aria-label="Quitar filtro de lote" className="rounded-full p-0.5 hover:bg-granate/10">
                <X size={11} aria-hidden />
              </button>
            </span>
          )}
          {estado !== "todos" && (
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${ESTADO_UI[estado].badge}`}>
              {ESTADO_UI[estado].label}
              <button onClick={() => filtrar({ estado: "todos" })} aria-label="Quitar filtro de estado" className="rounded-full p-0.5 hover:bg-ink/10">
                <X size={11} aria-hidden />
              </button>
            </span>
          )}
          <select
            value={perfil}
            onChange={(e) => filtrar({ perfil: e.target.value as Perfil | "todos" })}
            aria-label="Tipo de contrato"
            className="rounded-full border border-line bg-paper px-3 py-1 text-xs text-ink"
          >
            <option value="todos">Todos los tipos</option>
            {/* Con la lista cortada, contar ahí daría de menos: sin número. */}
            {PERFILES.map((pf) => (
              <option key={pf} value={pf}>
                {`${PERFIL_LABEL[pf].split(" ")[0]}${capada ? "" : ` (${porPerfil[pf] ?? 0})`}`}
              </option>
            ))}
          </select>
          <label className="relative ml-auto">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Código, objeto o entidad"
              aria-label="Buscar contrato"
              className="w-56 rounded-full border border-line bg-paper py-1 pl-8 pr-3 text-xs text-ink"
            />
          </label>
          <Link href="/app/auditoria" target="_blank" className={claseBoton("fantasma")}>
            <ExternalLink size={12} aria-hidden /> Tablero público
          </Link>
        </div>

        {capada && (
          <p className="mt-2 text-[12px] text-inkSoft">
            La lista trae los {TOPE_LISTA} contratos con movimiento más reciente
            {totalExacto != null ? ` de ${plural(totalExacto, "contrato", "contratos")} en total` : ""}.{" "}
            {exactos ? "Los totales de arriba sí cuentan todos." : "No se pudo leer el estado del sistema: los totales de arriba cuentan sólo esta lista."}
          </p>
        )}

        <section className="mt-3 overflow-x-auto rounded-2xl border border-line bg-paper" aria-busy={rows === null || undefined}>
          {rows === null ? (
            <SkeletonFilas filas={6} columnas={6} />
          ) : visible.length === 0 ? (
            rows.length === 0 && procQ.error ? (
              // Sin datos por un error: no decir "no hay nada" cuando en realidad no sabemos.
              <EmptyState compacto titulo="La lista no llegó" descripcion="Reintenta desde el aviso de arriba." />
            ) : rows.length === 0 ? (
              <EmptyState compacto icono={<Activity size={18} />} titulo="No hay contratos en proceso" descripcion="Aparecen al validar un aporte o al procesar un lote." />
            ) : (
              <EmptyState compacto titulo="Ningún contrato con estos filtros" descripcion="Quita un filtro para ver el resto." />
            )
          ) : (
            <table className="w-full min-w-[900px] text-sm">
              <caption className="sr-only">Contratos en procesamiento</caption>
              <thead className="text-left text-[11px] text-mute">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">Contrato</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">Estado</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">Avance</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">Último movimiento</th>
                  <th scope="col" className="px-2 py-2.5 font-medium">Detalle</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.ocid} className="border-t border-line align-top">
                    <td className="px-4 py-2.5">
                      <div className="font-mono text-xs text-ink">{p.ocid}</div>
                      {p.titulo && <div className="mt-0.5 line-clamp-1 max-w-[340px] text-[12px] text-inkSoft">{p.titulo}</div>}
                      <div className="text-[11px] text-mute">
                        {[p.perfil ? PERFIL_LABEL[p.perfil].split(" ")[0] : p.tipo, p.zona, p.contribucionCodigo].filter(Boolean).join(" · ")}
                      </div>
                    </td>
                    <td className="px-2 py-2.5">
                      <Badge tono={ESTADO_UI[p.estado]?.tono ?? "muted"}>{etiquetaFila(p.estado)}</Badge>
                      {p.estado === "procesado" && p.alertaEstado === "revision" && (
                        <div className="mt-1">
                          <Badge tono="pending">En revisión humana</Badge>
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <Avance p={p} />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-[12px] text-mute">{hace(p.latidoAt ?? p.finalizadoAt ?? p.encoladoAt) ?? "sin movimiento"}</td>
                    <td className="max-w-[240px] px-2 py-2.5 text-[12px]">
                      <Detalle p={p} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1">
                        <Link
                          href={`/app/auditoria/${encodeURIComponent(p.ocid)}`}
                          target="_blank"
                          className={claseBoton("secundario", "xs")}
                          title="Qué hizo cada revisión, paso a paso"
                        >
                          <Eye size={11} aria-hidden /> Traza
                        </Link>
                        {(p.estado === "procesado" || p.estado === "error" || p.estado === "pendiente_de_procesamiento") && (
                          <button onClick={() => reanalizar(p)} className={claseBoton("secundario", "xs")} title="Vuelve a leer el contrato (≈ US$ 0.25, ~3 min)">
                            <Repeat size={11} aria-hidden /> Re-analizar
                          </button>
                        )}
                        {p.estado !== "procesado" && p.estado !== "procesando" && (
                          <button onClick={() => reencolar(p)} disabled={busy === p.ocid} className={claseBoton("secundario", "xs")}>
                            <RotateCcw size={11} className={busy === p.ocid ? "animate-spin" : ""} aria-hidden /> Re-encolar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </PageSection>

      <PedidosDescarga onChange={load} />
    </AdminShell>
  );
}

const etiquetaFila = (e: Estado) => (e === "procesado" ? "Procesado" : e === "esperando_documentos" ? "Esperando documentos" : ESTADO_UI[e]?.label ?? e);

/** Dónde va cada contrato: fase actual si se está leyendo, cuánto tardó si ya terminó. */
function Avance({ p }: { p: ProcAdmin }) {
  if (p.estado === "procesando") {
    const i = p.faseIndex ?? 0;
    return (
      <div className="w-40">
        <div className="flex justify-between text-[11px] text-inkSoft">
          <span className="truncate">{p.faseActual ? faseLabel(p.faseActual) : "Iniciando"}</span>
          <span className="font-mono">{i}/{TOTAL_FASES}</span>
        </div>
        <BarraProgreso pct={Math.max(6, Math.round((i / TOTAL_FASES) * 100))} tono="warn" alto="sm" etiqueta={`Avance: fase ${i} de ${TOTAL_FASES}`} className="mt-1" />
      </div>
    );
  }
  if (p.estado === "procesado") {
    const seg = p.iniciadoAt && p.finalizadoAt ? (new Date(p.finalizadoAt).getTime() - new Date(p.iniciadoAt).getTime()) / 1000 : null;
    return (
      <span className="text-[12px] text-inkSoft">
        {seg != null && seg > 0 ? `leído en ${seg < 90 ? `${Math.round(seg)} s` : `${Math.round(seg / 60)} min`}` : "terminado"}
        {p.score != null && <span className="text-mute"> · puntaje {p.score}</span>}
      </span>
    );
  }
  if (p.intentos > 0) return <span className="text-[12px] text-mute">{p.intentos} {p.intentos === 1 ? "intento" : "intentos"}</span>;
  return <span className="text-[12px] text-mute">sin empezar</span>;
}

/** El motivo, con el color que corresponde: esperar documentos no es un error. */
function Detalle({ p }: { p: ProcAdmin }) {
  if (p.estado === "esperando_documentos") return <span className="text-clayTexto">Espera sus documentos para poder leerlo.</span>;
  if (p.estado === "pendiente_de_procesamiento") return <span className="text-mute">Su tipo o etapa no tiene revisiones que aplicar.</span>;
  if (p.error) return <span className="line-clamp-2 text-crimsonTexto">{p.error}</span>;
  return <span className="text-mute">—</span>;
}
