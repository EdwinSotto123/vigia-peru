"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, RefreshCw, Save } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminFetch } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { useSesionEquipo } from "@/lib/useEquipo";
import { puede } from "@/lib/permisos";
import { etapaLabel, motivoLabel, tipoLabel } from "@/lib/contratos";
import {
  Aviso,
  Badge,
  Card,
  Chip,
  claseBoton,
  EmptyState,
  ErrorBanner,
  Expandable,
  PageSection,
  Panel,
  SkeletonPanel,
  SkeletonStats,
  SkeletonTabla,
  StatCard,
  StatGrid,
  fmtFechaHora,
  fmtNum,
  humanizar,
} from "@/components/admin/ui";

/**
 * Clasificación: cada contrato ingerido lleva un tipo (bienes, obras…) y una etapa (convocada,
 * contratada…). Arriba, qué combinaciones entran hoy a la cola financiable (migración 19); abajo,
 * la matriz tipo × etapa con la cuenta de contratos (docs/design/MATRIZ_TIPO_ETAPA.md) y por qué
 * algunos no se pueden analizar todavía.
 * Fuente: GET /api/admin/clasificacion/resumen · GET/PUT /api/admin/config/procesamiento
 */

interface Celda { tipo: string; etapa: string; procesable: boolean | null; n: number }
interface Resumen {
  totales: { total: number; clasificadas: number; procesables: number; noProcesables: number; pendientesDeProcesamiento: number; ultimaClasificacion: string | null };
  celdas: Celda[];
  porTipo: Record<string, number>;
  porEtapa: Record<string, number>;
  motivosNoProcesable: { motivo: string; n: number }[];
  validacionesPendientes: { validacion: string; n: number }[];
}
interface ProcConfig { valor: { tipos_activos: string[]; etapas_activas: string[]; nota?: string }; updatedAt?: string; updatedBy?: string; cola: number | null }

const TIPOS = ["bienes", "servicios", "consultoria", "obras", "convenio", "directa", "otro", "sin_clasificar"];
const ETAPAS = ["planificacion", "convocada", "adjudicada", "contratada", "en_ejecucion", "finalizada", "desierta", "cancelada", "nula", "desconocida", "sin_clasificar"];
const TIPOS_CFG = ["bienes", "servicios", "consultoria", "obras", "convenio", "directa"];
const ETAPAS_CFG = ["convocada", "adjudicada", "contratada", "en_ejecucion", "finalizada"];

const tipoTxt = (t: string) => (t === "sin_clasificar" ? "Sin clasificar" : tipoLabel(t) ?? humanizar(t) ?? t);
const etapaTxt = (e: string) => (e === "sin_clasificar" ? "Sin clasificar" : etapaLabel(e) ?? humanizar(e) ?? e);

/** Lo que el agente no pudo verificar por falta de datos (backend/core/clasificacion.py · VALIDACIONES). */
const VALIDACION: Record<string, string> = {
  infobras_avance: "Sin avance físico ni financiero de la obra (INFOBRAS): no se verificó la ejecución",
  market_sin_items_fisicos: "Sin ítems con cantidad y unidad: no se comparó el precio de mercado",
  sin_documentos_descargables: "Sin bases, buena pro ni contrato publicados: no se leyeron documentos",
  proveedor_sin_ruc: "El expediente no trae el RUC del proveedor: no se investigó a la empresa ni su red",
  entidad_sin_ruc: "Sin RUC de la entidad: no se investigó a sus funcionarios",
};
const MOTIVO: Record<string, string> = { etapa_planificacion: "En planificación: todavía no hay bases ni postores" };

/** Qué tipos × etapas entran hoy a la cola financiable. Lo demás se descarga y clasifica igual. */
function ProcesamientoActivo() {
  const { data, error, isLoading, mutate } = useAdmin<ProcConfig>("/config/procesamiento", { revalidateOnFocus: false });
  // Qué se procesa lo decide un admin (cambia la cola y lo que se gasta); el revisor lo ve.
  const editable = puede(useSesionEquipo().rol, "editar_alcance");
  const [v, setV] = useState<ProcConfig["valor"] | null>(null);
  const [sucio, setSucio] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; error?: unknown } | null>(null);
  useEffect(() => { if (data && !sucio) setV(data.valor); }, [data, sucio]);

  if (error && !data) return <ErrorBanner error={error} titulo="No se pudo leer qué se procesa hoy" onReintentar={() => mutate()} />;
  if (!v || !data) return isLoading ? <SkeletonPanel lineas={3} /> : null;

  const toggle = (k: "tipos_activos" | "etapas_activas", x: string) => {
    const cur = new Set(v[k] ?? []); cur.has(x) ? cur.delete(x) : cur.add(x);
    setV({ ...v, [k]: Array.from(cur) }); setSucio(true); setMsg(null);
  };
  async function guardar() {
    if (!v) return;
    setSaving(true); setMsg(null);
    try {
      await adminFetch("/config/procesamiento", { method: "PUT", body: JSON.stringify({ tipos_activos: v.tipos_activos, etapas_activas: v.etapas_activas, nota: v.nota ?? "" }) });
      await mutate({ ...data!, valor: v }, { revalidate: false });
      setSucio(false); setMsg({ ok: true });
      refrescarAdmin("/config/procesamiento");
      refrescarAdmin("/clasificacion");
    } catch (e) { setMsg({ ok: false, error: e }); } finally { setSaving(false); }
  }

  return (
    <Card>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="space-y-3">
          <div role="group" aria-label="Tipos de contratación activos" className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 w-14 text-[12px] font-medium text-inkSoft">Tipos</span>
            {TIPOS_CFG.map((t) => editable
              ? <Chip key={t} activo={!!v.tipos_activos?.includes(t)} onClick={() => toggle("tipos_activos", t)}>{tipoTxt(t)}</Chip>
              : <Badge key={t} tono={v.tipos_activos?.includes(t) ? "ok" : "muted"} punto={!!v.tipos_activos?.includes(t)}>{tipoTxt(t)}</Badge>)}
          </div>
          <div role="group" aria-label="Etapas activas" className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 w-14 text-[12px] font-medium text-inkSoft">Etapas</span>
            {ETAPAS_CFG.map((e) => editable
              ? <Chip key={e} activo={!!v.etapas_activas?.includes(e)} onClick={() => toggle("etapas_activas", e)}>{etapaTxt(e)}</Chip>
              : <Badge key={e} tono={v.etapas_activas?.includes(e) ? "ok" : "muted"} punto={!!v.etapas_activas?.includes(e)}>{etapaTxt(e)}</Badge>)}
          </div>
          {v.nota && <p className="text-[12px] text-mute">{v.nota}</p>}
        </div>
        <div className="flex flex-col justify-between gap-3 rounded-xl bg-paperSoft p-3">
          <div>
            <p className="text-[12px] font-medium text-inkSoft">Cola financiable hoy</p>
            <p className="font-mono text-2xl font-semibold text-ink">{fmtNum(data.cola) ?? "—"}</p>
            <p className="text-[11.5px] text-mute">
              {data.updatedAt ? `Editada ${fmtFechaHora(data.updatedAt)}${data.updatedBy ? ` por ${data.updatedBy}` : ", sin autor registrado"}` : "Nunca editada"}
            </p>
          </div>
          {editable ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={guardar} disabled={saving || !sucio} className={claseBoton("primario")}>
                {saving ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Save size={12} aria-hidden />} {saving ? "Guardando…" : "Guardar"}
              </button>
              {sucio && <Badge tono="warn" punto>Sin guardar</Badge>}
            </div>
          ) : (
            <p className="text-[11.5px] text-inkSoft">Qué se procesa lo cambia un administrador.</p>
          )}
        </div>
      </div>
      {msg?.ok && <Aviso tono="ok" titulo="Guardado. La cola financiable se recalculó." className="mt-4" />}
      {msg && !msg.ok && <ErrorBanner error={msg.error} titulo="No se guardó el cambio" className="mt-4" />}
    </Card>
  );
}

export default function ClasificacionPage() {
  const { data: r, error, isLoading, isValidating, mutate } = useAdmin<Resumen>("/clasificacion/resumen");

  const grid = useMemo(() => {
    const m = new Map<string, { n: number; np: number }>();
    for (const c of r?.celdas ?? []) {
      const k = `${c.tipo}|${c.etapa}`;
      const cur = m.get(k) ?? { n: 0, np: 0 };
      cur.n += c.n;
      if (c.procesable === false) cur.np += c.n;
      m.set(k, cur);
    }
    return m;
  }, [r]);
  const tipos = TIPOS.filter((t) => (r?.porTipo[t] ?? 0) > 0);
  const etapas = ETAPAS.filter((e) => (r?.porEtapa[e] ?? 0) > 0);
  const max = Math.max(1, ...Array.from(grid.values()).map((v) => v.n));
  const fondo = (n: number) => `rgba(190,123,38,${0.08 + 0.5 * (n / max)})`; // amber, más intenso cuanto más contratos

  return (
    <AdminShell
      title="Clasificación"
      subtitle="Tipo de contratación × etapa: qué se puede analizar y qué queda pendiente"
      actions={
        <button onClick={() => mutate()} className={claseBoton("secundario")}>
          <RefreshCw size={12} className={isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      }
    >
      <div className="space-y-10">
        <PageSection titulo="Qué entra a la cola" descripcion="Solo los tipos y etapas marcados se pueden financiar. Los demás se descargan y clasifican igual, y aparecen como “documentos listos”.">
          <ProcesamientoActivo />
        </PageSection>

        <ErrorBanner error={error} titulo="No se pudo leer la clasificación" onReintentar={() => mutate()} />

        <PageSection
          titulo="Contratos por tipo y etapa"
          meta={r ? `${fmtNum(r.totales.total)} contratos` : undefined}
          descripcion={r ? `Toca una cifra para ver esos contratos · última clasificación ${fmtFechaHora(r.totales.ultimaClasificacion) ?? "sin fecha"}` : undefined}
        >
          {!r ? (
            isLoading && <div className="space-y-3"><SkeletonStats n={5} /><SkeletonTabla filas={6} columnas={8} /></div>
          ) : (
            <div className="space-y-3">
              <StatGrid columnas={5}>
                <StatCard etiqueta="Contratos" valor={r.totales.total} />
                <StatCard etiqueta="Clasificados" valor={r.totales.clasificadas} pista={r.totales.total ? `${Math.round((r.totales.clasificadas / r.totales.total) * 100)} % del total` : undefined} />
                <StatCard etiqueta="Procesables" valor={r.totales.procesables} tono="ok" />
                <StatCard etiqueta="No procesables" valor={r.totales.noProcesables} tono={r.totales.noProcesables ? "warn" : "neutral"} pista="su tipo o etapa no tiene revisiones" />
                <StatCard etiqueta="Pendientes en cola" valor={r.totales.pendientesDeProcesamiento} tono={r.totales.pendientesDeProcesamiento ? "pending" : "neutral"} pista="financiados sin análisis aplicable" />
              </StatGrid>

              {/* Escritorio: la matriz completa. */}
              <div className="hidden overflow-x-auto rounded-2xl border border-line bg-paper md:block">
                <table className="w-full text-sm">
                  <caption className="sr-only">Contratos por tipo de contratación y etapa</caption>
                  <thead className="text-left text-[11px] text-mute">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 font-medium">Tipo · etapa</th>
                      {etapas.map((e) => <th key={e} scope="col" className="px-2 py-2.5 text-right font-medium">{etapaTxt(e)}</th>)}
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tipos.map((t) => (
                      <tr key={t} className="border-t border-line">
                        <th scope="row" className="px-4 py-2 text-left font-medium text-ink">{tipoTxt(t)}</th>
                        {etapas.map((e) => {
                          const v = grid.get(`${t}|${e}`);
                          if (!v) return <td key={e} className="px-2 py-2 text-right font-mono text-xs text-mute">0</td>;
                          return (
                            <td key={e} className="px-2 py-2 text-right font-mono text-xs" style={{ background: fondo(v.n) }}>
                              <Link href={`/app/contratos?tipo=${t}&etapa=${e}`} className="text-ink hover:underline" title={`${tipoTxt(t)} · ${etapaTxt(e)}: ver contratos`}>{fmtNum(v.n)}</Link>
                              {v.np > 0 && <span className="ml-1 text-[10px] text-amberTexto" title="no procesables">({fmtNum(v.np)})</span>}
                            </td>
                          );
                        })}
                        <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-ink">{fmtNum(r.porTipo[t] ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-line bg-paperSoft">
                      <th scope="row" className="px-4 py-2 text-left text-[12px] font-medium text-inkSoft">Total</th>
                      {etapas.map((e) => <td key={e} className="px-2 py-2 text-right font-mono text-xs text-ink">{fmtNum(r.porEtapa[e] ?? 0)}</td>)}
                      <td className="px-4 py-2 text-right font-mono text-xs font-semibold text-ink">{fmtNum(r.totales.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Teléfono: un bloque plegable por tipo, con sus etapas adentro. */}
              <div className="space-y-2 md:hidden">
                {tipos.map((t) => (
                  <Expandable key={t} resumen={tipoTxt(t)} meta={<span className="font-mono text-ink">{fmtNum(r.porTipo[t] ?? 0)}</span>}>
                    <ul className="space-y-1.5 text-[13px]">
                      {etapas.filter((e) => grid.get(`${t}|${e}`)).map((e) => {
                        const v = grid.get(`${t}|${e}`)!;
                        return (
                          <li key={e}>
                            <Link href={`/app/contratos?tipo=${t}&etapa=${e}`} className="flex items-center gap-2 rounded-lg hover:bg-paperSoft">
                              <span className="w-24 shrink-0 text-inkSoft">{etapaTxt(e)}</span>
                              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-paperDeep" aria-hidden><span className="block h-full rounded-full bg-amber" style={{ width: `${(v.n / (r.porTipo[t] || 1)) * 100}%` }} /></span>
                              <span className="w-14 text-right font-mono text-ink">{fmtNum(v.n)}</span>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </Expandable>
                ))}
              </div>
              {Array.from(grid.values()).some((v) => v.np > 0) && <p className="text-[12px] text-inkSoft">Entre paréntesis: cuántos de la celda no se pueden procesar.</p>}
            </div>
          )}
        </PageSection>

        {r && (
          <div className="grid gap-4 md:grid-cols-2">
            <Lista
              titulo="Por qué no se pueden procesar"
              rows={r.motivosNoProcesable.map((m) => ({ codigo: m.motivo, texto: MOTIVO[m.motivo] ?? motivoLabel(m.motivo), n: m.n }))}
              vacio="Todo lo clasificado se puede procesar."
            />
            <Lista
              titulo="Lo que los agentes no pudieron verificar"
              descripcion="Contratos donde faltó un dato y se omitió esa parte del análisis."
              rows={r.validacionesPendientes.map((v) => ({ codigo: v.validacion, texto: VALIDACION[v.validacion] ?? humanizar(v.validacion) ?? v.validacion, n: v.n }))}
              vacio="Ningún análisis quedó incompleto por falta de datos."
            />
          </div>
        )}

        <Expandable variante="linea" resumen="Cómo volver a clasificar todo">
          <p className="max-w-3xl leading-relaxed text-inkSoft">
            La clasificación corre sola con cada ingesta. Para rehacerla completa (por ejemplo, tras cambiar las reglas), desde la carpeta del proyecto:
          </p>
          <code className="mt-2 inline-block rounded-lg bg-ink px-3 py-2 font-mono text-[12px] text-paper">python -m backend.core.clasificacion --reclasificar</code>
        </Expandable>
      </div>
    </AdminShell>
  );
}

function Lista({ titulo, descripcion, rows, vacio }: { titulo: string; descripcion?: string; rows: { codigo: string; texto: string; n: number }[]; vacio: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Panel titulo={titulo} descripcion={descripcion}>
      {!rows.length ? (
        <EmptyState compacto icono={<CheckCircle2 size={18} />} titulo={vacio} className="py-4" />
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.codigo} title={r.codigo}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-ink">{r.texto}</span>
                <span className="shrink-0 font-mono text-ink">{fmtNum(r.n)}</span>
              </div>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
                <span className="block h-full rounded-full bg-amber" style={{ width: `${(r.n / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
