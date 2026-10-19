"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useAdmin } from "@/lib/useAdmin";
import {
  Badge,
  Card,
  claseBoton,
  DataTable,
  EmptyState,
  ErrorBanner,
  FilterChips,
  KeyValue,
  PageSection,
  SkeletonStats,
  SkeletonTabla,
  StatCard,
  StatGrid,
  estadoLote,
  fmtBytes,
  fmtFechaHora,
  fmtNum,
  hace,
  pct,
  type Columna,
  type Tone,
} from "@/components/admin/ui";

/**
 * Fuentes y procesos: de dónde salen los datos de Vigía y en qué está cada pipeline, para auditarlo sin entrar a
 * Cloudflare. Cada corrida de vigia-scrapers (un Workflow) queda en la bitácora `corridas_fuente` (migración 74): quién
 * la lanzó, con qué parámetros, cuánto tardó y qué devolvió o en qué falló. Debajo, los documentos de los contratos
 * financiados (lo único que se descarga), la base de contratos por año y las vistas derivadas.
 * Fuente: GET /api/admin/fuentes (caché de 1 min en el API).
 */

interface Ultima {
  fuente: string;
  instancia?: string;
  estado?: "corriendo" | "ok" | "error";
  inicio?: string;
  fin?: string | null;
  segundos?: number | null;
  error?: string | null;
  ok30?: number;
  error30?: number;
}
interface FilaAgenda { fuente: string; nombre: string; agenda: string; que: string; lanza?: string[]; ultima: Ultima | null; lanzadas: Ultima[] }
interface Corrida {
  instancia: string;
  fuente: string;
  origen: string | null;
  params: Record<string, unknown>;
  estado: "corriendo" | "ok" | "error";
  inicio: string;
  fin: string | null;
  segundos: number | null;
  resumen: unknown;
  error: string | null;
}
interface Lote { id: string; estado: string; total: number; ok: number; fallidos: number; iniciadoAt: string | null; finalizadoAt: string | null; error: string | null }
interface Datos {
  agenda: FilaAgenda[];
  corridas: Corrida[];
  sinBitacora: boolean;
  documentos: {
    pedidos: { estado: string; motivo: string; n: number; ultimo: string | null }[];
    lotes: Lote[];
    almacen: { vigentes: number; bytes: number | string; contratos: number; deCloudflare: number } | null;
  };
  base: {
    porAnio: { anio: number | null; contratos: number; enCola: number; leidos: number; conGanador: number | null }[];
    procesos: { anio: number; procesos: number; fuente: string }[];
    cola: { desde: string | null; financiable: number | null } | null;
  };
  derivados: { nombre: string; refrescadoAt: string | null; duracionMs: number | null; refrescos: number }[];
  generadoAt: string;
}

const ESTADO: Record<Corrida["estado"], { label: string; tono: Tone }> = {
  ok: { label: "Bien", tono: "ok" },
  error: { label: "Falló", tono: "danger" },
  corriendo: { label: "Corriendo", tono: "pending" },
};

/** 118 → "1 min 58 s". */
function duracion(s: number | null | undefined): string | null {
  if (s == null) return null;
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min ${s % 60} s`;
}

const NOMBRE_DERIVADO: Record<string, string> = {
  financiamiento: "Mapa y financiamiento (zona_estado, ranking)",
  contratos: "Contratos y entidades (contratos_agregado, entidad_stats)",
  vencimientos: "Vencimiento de documentos",
};

const MOTIVO: Record<string, string> = { financiado: "Financiado", admin: "Pedido del admin", reintento: "Reintento", cola: "Cola (ya no se usa)" };

function EstadoBadge({ e }: { e: Corrida["estado"] | undefined }) {
  if (!e) return <Badge tono="muted">Sin corridas</Badge>;
  return <Badge tono={ESTADO[e].tono} punto>{ESTADO[e].label}</Badge>;
}

/** Los parámetros que importan de una corrida, en una línea ("2024-01-01 → 2024-01-31 · relleno"). */
function paramsCortos(p: Record<string, unknown> | null | undefined): string {
  if (!p) return "";
  const partes: string[] = [];
  if (p.desde || p.hasta) partes.push(`${p.desde ?? "…"} → ${p.hasta ?? "…"}`);
  if (p.relleno) partes.push("relleno");
  if (p.seco) partes.push("en seco");
  if (p.forzar) partes.push("forzada");
  if (p.paso) partes.push(`paso ${p.paso}`);
  return partes.join(" · ");
}

/** El resumen que devolvió la fuente: sus números en una línea, sin listas largas. */
function resumenCorto(r: unknown): string {
  if (!r || typeof r !== "object") return "";
  const o = r as Record<string, unknown>;
  const claves = ["convocatorias", "adjudicados", "contratos", "archivos", "filas", "procesos", "cargadas", "mb", "releases", "paginas"];
  const out: string[] = [];
  for (const k of claves) {
    const v = o[k];
    if (typeof v === "number") out.push(`${k} ${fmtNum(v)}`);
    else if (v && typeof v === "object" && typeof (v as Record<string, unknown>).convocatorias === "number") out.push(`cargadas ${fmtNum((v as Record<string, number>).convocatorias)}`);
  }
  return out.slice(0, 4).join(" · ");
}

function Json({ valor }: { valor: unknown }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-lg bg-paperDeep px-3 py-2 font-mono text-[11.5px] leading-relaxed text-inkSoft">
      {JSON.stringify(valor, null, 2)}
    </pre>
  );
}

export default function FuentesPage() {
  const q = useAdmin<Datos>("/fuentes", { refreshInterval: 60_000 });
  const d = q.data;
  const [filtro, setFiltro] = useState<"todas" | "error" | "corriendo">("todas");
  const [elegida, setElegida] = useState<string | null>(null);

  const corridas = useMemo(() => (d?.corridas ?? []).filter((c) => filtro === "todas" || c.estado === filtro), [d, filtro]);
  const detalle = (d?.corridas ?? []).find((c) => c.instancia === elegida) ?? null;
  const conError = (d?.corridas ?? []).filter((c) => c.estado === "error").length;
  const corriendo = (d?.corridas ?? []).filter((c) => c.estado === "corriendo").length;

  const colAgenda: Columna<FilaAgenda>[] = [
    {
      clave: "fuente",
      titulo: "Fuente",
      principal: true,
      celda: (a) => (
        <span>
          <span className="block font-medium text-ink">{a.nombre}</span>
          <span className="block font-mono text-[11px] text-mute">{a.fuente}{a.lanza?.length ? ` → ${a.lanza.join(", ")}` : ""}</span>
        </span>
      ),
    },
    { clave: "agenda", titulo: "Cuándo corre", className: "whitespace-nowrap text-[12px] text-inkSoft", celda: (a) => a.agenda },
    {
      clave: "ultima",
      titulo: "Última corrida",
      celda: (a) => (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <EstadoBadge e={a.ultima?.estado} />
          {a.ultima?.inicio && <span className="text-[12px] text-mute">{hace(a.ultima.inicio)}{a.ultima.segundos != null ? ` · ${duracion(a.ultima.segundos)}` : ""}</span>}
        </span>
      ),
    },
    {
      clave: "mes",
      titulo: "30 días",
      alinear: "derecha",
      celda: (a) =>
        a.ultima ? (
          <span className="text-[12px]">
            <span className="font-mono text-ink">{fmtNum(a.ultima.ok30 ?? 0)}</span> bien
            {a.ultima.error30 ? <span className="text-crimsonTexto"> · {fmtNum(a.ultima.error30)} fallaron</span> : null}
          </span>
        ) : (
          <span className="text-[12px] text-mute">—</span>
        ),
    },
    { clave: "que", titulo: "Qué hace", soloEscritorio: true, className: "max-w-md text-[12px] text-inkSoft", celda: (a) => a.que },
  ];

  const colCorridas: Columna<Corrida>[] = [
    {
      clave: "corrida",
      titulo: "Corrida",
      principal: true,
      celda: (c) => (
        <span>
          <span className="block font-medium text-ink">{c.fuente}</span>
          <span className="block text-[11px] text-mute">{fmtFechaHora(c.inicio)} · {c.origen === "manual" ? "a mano" : c.origen ?? "sin origen"}</span>
        </span>
      ),
    },
    { clave: "params", titulo: "Parámetros", className: "text-[12px] text-inkSoft", celda: (c) => paramsCortos(c.params) || <span className="text-mute">—</span> },
    { clave: "estado", titulo: "Estado", celda: (c) => <EstadoBadge e={c.estado} /> },
    { clave: "dur", titulo: "Duración", alinear: "derecha", className: "whitespace-nowrap text-[12px]", celda: (c) => duracion(c.segundos) ?? (c.estado === "corriendo" ? hace(c.inicio) : "—") },
    {
      clave: "res",
      titulo: "Resultado",
      soloEscritorio: true,
      className: "max-w-sm text-[12px] text-inkSoft",
      celda: (c) => (c.error ? <span className="text-crimsonTexto">{c.error.slice(0, 120)}</span> : resumenCorto(c.resumen) || "—"),
    },
  ];

  const procesosPorAnio = new Map((d?.base.procesos ?? []).map((p) => [p.anio, p]));
  const anios = (d?.base.porAnio ?? []).filter((a) => a.anio != null);
  const totBase = anios.reduce((s, a) => ({ contratos: s.contratos + a.contratos, ganador: s.ganador + (a.conGanador ?? 0), leidos: s.leidos + a.leidos }), { contratos: 0, ganador: 0, leidos: 0 });
  const colAnios: Columna<Datos["base"]["porAnio"][number]>[] = [
    { clave: "anio", titulo: "Año de convocatoria", principal: true, celda: (a) => <span className="font-medium text-ink">{a.anio}</span> },
    { clave: "contratos", titulo: "Contratos en la base", alinear: "derecha", celda: (a) => fmtNum(a.contratos) },
    {
      clave: "ganador",
      titulo: "Con ganador",
      alinear: "derecha",
      celda: (a) => <span className="font-mono">{fmtNum(a.conGanador ?? 0)} <span className="font-sans text-[11px] text-mute">({pct(a.conGanador ?? 0, a.contratos)} %)</span></span>,
    },
    {
      clave: "procesos",
      titulo: "Procesos adjudicados",
      alinear: "derecha",
      celda: (a) => {
        const p = procesosPorAnio.get(a.anio!);
        return p ? <span title={`según ${p.fuente}`}>{fmtNum(p.procesos)} <span className="text-[11px] text-mute">{p.fuente}</span></span> : "—";
      },
    },
    { clave: "cola", titulo: "En la cola", alinear: "derecha", celda: (a) => fmtNum(a.enCola) },
    { clave: "leidos", titulo: "Leídos", alinear: "derecha", celda: (a) => fmtNum(a.leidos) },
  ];

  const pedidos = d?.documentos.pedidos ?? [];
  const contar = (estado: string) => pedidos.filter((p) => p.estado === estado).reduce((s, p) => s + p.n, 0);
  const colLotes: Columna<Lote>[] = [
    { clave: "lote", titulo: "Corrida de documentos", principal: true, celda: (l) => <span className="text-[12px] text-ink">{fmtFechaHora(l.iniciadoAt) ?? l.id}</span> },
    {
      clave: "res",
      titulo: "Contratos",
      celda: (l) => (
        <span className="text-[12px] text-inkSoft">
          <span className="font-mono text-ink">{fmtNum(l.ok)}</span> de {fmtNum(l.total)}
          {l.fallidos ? <span className="text-crimsonTexto">, {fmtNum(l.fallidos)} sin bajar</span> : null}
        </span>
      ),
    },
    { clave: "estado", titulo: "Estado", celda: (l) => { const e = estadoLote(l.estado); return <Badge tono={e.tono}>{e.label}</Badge>; } },
    { clave: "err", titulo: "Detalle", soloEscritorio: true, className: "text-[12px] text-mute", celda: (l) => l.error ?? "—" },
  ];

  return (
    <AdminShell
      title="Fuentes y procesos"
      subtitle="De dónde salen los datos, cuándo se cargaron y en qué está cada pipeline"
      actions={
        <button onClick={() => q.mutate()} className={claseBoton("secundario")}>
          <RefreshCw size={12} className={q.isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      }
    >
      <div className="space-y-5">
        <ErrorBanner error={q.error} titulo="No se pudo leer el estado de las fuentes" onReintentar={() => q.mutate()} />

        <PageSection
          titulo="Fuentes"
          descripcion="Cada fuente es un proceso de vigia-scrapers (Cloudflare) con su agenda en hora de Lima. La última corrida y cuántas salieron bien en 30 días salen de la bitácora."
          meta={d ? `${d.agenda.length} fuentes` : undefined}
        >
          {!d ? (
            q.isLoading && <SkeletonTabla filas={8} columnas={5} />
          ) : (
            <DataTable etiqueta="Fuentes de datos y su última corrida" columnas={colAgenda} filas={d.agenda} claveFila={(a) => a.fuente} apilarHasta="lg" />
          )}
        </PageSection>

        <PageSection
          titulo="Corridas"
          descripcion="Las últimas 150, de la bitácora corridas_fuente. Toca una para ver sus parámetros, lo que devolvió o el error."
          meta={d ? `${fmtNum(d.corridas.length)} corridas${conError ? ` · ${conError} fallaron` : ""}` : undefined}
        >
          {d?.sinBitacora && <EmptyState titulo="Sin bitácora" descripcion="La base todavía no tiene corridas_fuente (migración 74)." />}
          {d && !d.sinBitacora && (
            <div className="space-y-3">
              <FilterChips
                etiqueta="Estado de la corrida"
                valor={filtro}
                onCambiar={setFiltro}
                opciones={[
                  { valor: "todas", etiqueta: "Todas", cuenta: d.corridas.length },
                  { valor: "error", etiqueta: "Fallaron", cuenta: conError, tono: "danger" },
                  { valor: "corriendo", etiqueta: "Corriendo", cuenta: corriendo, tono: "pending" },
                ]}
              />
              <DataTable
                etiqueta="Corridas de vigia-scrapers"
                columnas={colCorridas}
                filas={corridas}
                claveFila={(c) => c.instancia}
                onFila={(c) => setElegida(c.instancia === elegida ? null : c.instancia)}
                filaActiva={(c) => c.instancia === elegida}
                apilarHasta="lg"
                vacio={<EmptyState titulo="Ninguna corrida con ese estado" />}
              />
              {detalle && (
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold text-ink">{detalle.fuente}</p>
                    <EstadoBadge e={detalle.estado} />
                  </div>
                  <KeyValue
                    className="mt-3"
                    columnas={3}
                    items={[
                      { etiqueta: "Instancia", valor: detalle.instancia, mono: true },
                      { etiqueta: "Origen", valor: detalle.origen === "manual" ? "A mano (POST /correr)" : detalle.origen },
                      { etiqueta: "Duración", valor: duracion(detalle.segundos) ?? (detalle.estado === "corriendo" ? `corriendo desde ${hace(detalle.inicio)}` : null) },
                      { etiqueta: "Empezó", valor: fmtFechaHora(detalle.inicio) },
                      { etiqueta: "Terminó", valor: fmtFechaHora(detalle.fin) },
                      { etiqueta: "Parámetros", valor: paramsCortos(detalle.params) || "los de su agenda" },
                    ]}
                  />
                  {detalle.error && <p className="mt-3 rounded-lg bg-crimson/10 px-3 py-2 text-[13px] text-crimsonTexto">{detalle.error}</p>}
                  {detalle.resumen != null && (
                    <div className="mt-3">
                      <p className="mb-1 text-[11px] font-medium text-mute">Lo que devolvió</p>
                      <Json valor={detalle.resumen} />
                    </div>
                  )}
                </Card>
              )}
            </div>
          )}
        </PageSection>

        <PageSection
          titulo="Documentos de los contratos financiados"
          descripcion="Sólo se descargan los expedientes de los contratos que alguien financió (fuente documentos, cada hora). De la base se guarda el registro de cada contrato; el expediente, recién al financiarse."
        >
          {!d ? (
            q.isLoading && <SkeletonStats n={4} />
          ) : (
            <div className="space-y-3">
              <StatGrid columnas={4}>
                <StatCard etiqueta="Documentos en el almacén" valor={fmtNum(d.documentos.almacen?.vigentes) ?? "—"} pista={`${fmtBytes(d.documentos.almacen?.bytes) ?? "sin dato"} · vencen a los 90 días`} />
                <StatCard etiqueta="Contratos con documentos" valor={fmtNum(d.documentos.almacen?.contratos) ?? "—"} tono="ok" />
                <StatCard etiqueta="Esperan su descarga" valor={fmtNum(contar("pendiente") + contar("descargando")) ?? "0"} tono={contar("pendiente") + contar("descargando") ? "pending" : "neutral"} pista="pedidos de financiados abiertos" />
                <StatCard etiqueta="No se pudieron bajar" valor={fmtNum(contar("fallido")) ?? "0"} tono={contar("fallido") ? "danger" : "neutral"} pista="tras 3 intentos" href="/admin/procesamientos" />
              </StatGrid>
              {pedidos.length > 0 && (
                <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-inkSoft">
                  {pedidos.map((p) => (
                    <li key={`${p.estado}-${p.motivo}`}>
                      <span className="font-mono text-ink">{fmtNum(p.n)}</span> {p.estado} · {MOTIVO[p.motivo] ?? p.motivo}
                    </li>
                  ))}
                </ul>
              )}
              <DataTable etiqueta="Últimas corridas de documentos" columnas={colLotes} filas={d.documentos.lotes} claveFila={(l) => l.id} apilarHasta="md" vacio={<EmptyState titulo="Todavía no corrió" />} />
            </div>
          )}
        </PageSection>

        <PageSection
          titulo="Base de contratos"
          descripcion="Los contratos del OECE desde 2015 (registro con su ganador), los procesos adjudicados por año (CONOSCE desde 2018, OCDS antes) y lo que entra a la cola."
          meta={d ? `${fmtNum(totBase.contratos)} contratos` : undefined}
        >
          {!d ? (
            q.isLoading && <SkeletonTabla filas={8} columnas={6} />
          ) : (
            <div className="space-y-3">
              <StatGrid columnas={4}>
                <StatCard etiqueta="Contratos en la base" valor={totBase.contratos} pista="desde 2015" />
                <StatCard etiqueta="Con ganador" valor={totBase.ganador} tono="ok" pista={`${pct(totBase.ganador, totBase.contratos)} % del total`} />
                <StatCard etiqueta="Cola financiable" valor={fmtNum(d.base.cola?.financiable) ?? "—"} tono="pending" pista="esperan quien financie su lectura" />
                <StatCard
                  etiqueta="La cola empieza en"
                  valor={d.base.cola?.desde ?? "todas las fechas"}
                  pista="se cambia en Clasificación"
                  href="/admin/clasificacion"
                />
              </StatGrid>
              <DataTable etiqueta="Contratos y procesos por año" columnas={colAnios} filas={anios} claveFila={(a) => String(a.anio)} apilarHasta="lg" />
            </div>
          )}
        </PageSection>

        <PageSection titulo="Vistas derivadas" descripcion="Las vistas del mapa, el financiamiento y los contratos se refrescan solas cada 10 minutos cuando hay cambios.">
          {d && (
            <ul className="divide-y divide-line rounded-xl border border-line bg-paper text-[13px]">
              {d.derivados.map((v) => (
                <li key={v.nombre} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2">
                  <span className="text-ink">{NOMBRE_DERIVADO[v.nombre] ?? v.nombre}</span>
                  <span className="text-[12px] text-mute">
                    {hace(v.refrescadoAt) ?? "nunca"}
                    {v.duracionMs != null ? ` · ${(v.duracionMs / 1000).toFixed(1)} s` : ""} · {fmtNum(v.refrescos)} refrescos
                  </span>
                </li>
              ))}
            </ul>
          )}
          {d && (
            <p className="mt-2 text-[11.5px] text-mute">
              Actualizado {fmtFechaHora(d.generadoAt)}. Las cargas de cada fuente externa (filas, último archivo) están en{" "}
              <Link href="/admin/cobertura" className="underline underline-offset-2">Cobertura</Link>.
            </p>
          )}
        </PageSection>
      </div>
    </AdminShell>
  );
}
