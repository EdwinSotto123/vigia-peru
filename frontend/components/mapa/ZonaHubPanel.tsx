"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PresupuestoRegional } from "@/components/PresupuestoRegional";
import { REGION_TO_MEF_DEPT } from "@/lib/peru-data";
import {
  X,
  MapPin,
  LineChart,
  Layers,
  Building2,
  AlertTriangle,
  MessageSquareWarning,
  Heart,
  Camera,
  Activity,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Landmark,
} from "lucide-react";
import {
  getZona,
  ESTADO_FILL,
  ESTADO_LABEL,
  formatPEN,
  pct,
  type ZonaDetalle,
} from "@/lib/financiamiento";
import { CATEGORIA_META, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { cn } from "@/lib/utils";
import { EntidadesDeZona } from "./EntidadesDeZona";
import { AlertasDeZona } from "./AlertasDeZona";
import { belongsToRegion } from "./region-match";

export type ZonaTab = "resumen" | "cola" | "entidades" | "alertas" | "denuncias" | "presupuesto";

export interface ZonaHubPanelProps {
  /** Slug de `lib/peru-data` (p. ej. "ancash"). */
  regionId: string;
  /** Ubigeo INEI del departamento (2 dígitos). */
  ubigeo: string;
  nombre: string;
  onClose?: () => void;
  /** Alertas ya cargadas por el mapa (se filtran por región acá). */
  alertas?: any[];
  /** Reportes ciudadanos ya cargados por el mapa. */
  reportes?: any[];
  provinciaActiva?: { nombre: string; alertas?: number } | null;
  onClearProvincia?: () => void;
  initialTab?: ZonaTab;
}

/**
 * Panel lateral del mapa cuando hay una región elegida. Es el "hub" de la zona:
 * qué espera auditoría, qué se encontró, quién contrata, qué denuncian los vecinos,
 * y las dos acciones que una persona puede tomar: financiar o denunciar.
 */
export function ZonaHubPanel({
  regionId,
  ubigeo,
  nombre,
  onClose,
  alertas = [],
  reportes = [],
  provinciaActiva,
  onClearProvincia,
  initialTab = "resumen",
}: ZonaHubPanelProps) {
  const [tab, setTab] = useState<ZonaTab>(initialTab);
  const [detalle, setDetalle] = useState<ZonaDetalle | null | undefined>(undefined);

  // Al cambiar de región volvemos al resumen y recargamos financiamiento.
  useEffect(() => {
    setTab(initialTab);
    setDetalle(undefined);
    let alive = true;
    if (!ubigeo) {
      setDetalle(null);
      return;
    }
    getZona(ubigeo).then((d) => alive && setDetalle(d));
    return () => {
      alive = false;
    };
  }, [ubigeo, regionId, initialTab]);

  const alertasRegion = useMemo(
    () => alertas.filter((a) => belongsToRegion(a, regionId)),
    [alertas, regionId],
  );
  const reportesRegion = useMemo(
    () => reportes.filter((r) => belongsToRegion(r, regionId)),
    [reportes, regionId],
  );

  const zona = detalle?.zona ?? null;
  const financiarHref = ubigeo ? `/app/financiar/${ubigeo}` : "/app/financiar";
  const denunciarHref = `/reporte/nuevo?region=${encodeURIComponent(regionId)}`;
  const enVivoHref = ubigeo ? `/app/auditoria?ubigeo=${ubigeo}` : "/app/auditoria";

  return (
    <div className="flex h-full flex-col overflow-hidden bg-paperSoft">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-line bg-paperDeep px-5 py-4">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-clay">Región</div>
          <h3 className="mt-1 font-serif text-2xl font-bold leading-tight text-ink">{nombre}</h3>
          {zona && (
            <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-mute">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: ESTADO_FILL[zona.estado] }} />
              {ESTADO_LABEL[zona.estado]}
            </div>
          )}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-paperSoft text-mute hover:bg-paper hover:text-ink"
            aria-label="Cerrar"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Provincia activa (clic en el mapa) */}
      {provinciaActiva && (
        <div className="animate-slideIn border-b border-line bg-paper px-5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-mute">
                <MapPin size={11} /> Provincia
              </div>
              <div className="font-serif text-base font-bold text-ink">{provinciaActiva.nombre}</div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/reporte/nuevo?region=${encodeURIComponent(regionId)}&provincia=${encodeURIComponent(provinciaActiva.nombre)}`}
                className="rounded-full bg-clay px-2.5 py-1 text-[10px] font-medium text-paper hover:bg-clay/90"
              >
                Denunciar aquí
              </Link>
              {onClearProvincia && (
                <button onClick={onClearProvincia} className="text-[10px] text-mute hover:underline">
                  limpiar
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="scrollbar-none flex shrink-0 items-stretch overflow-x-auto border-b border-line bg-paperSoft">
        <TabBtn active={tab === "resumen"} onClick={() => setTab("resumen")} icon={<LineChart size={12} />}>
          Resumen
        </TabBtn>
        <TabBtn
          active={tab === "cola"}
          onClick={() => setTab("cola")}
          icon={<Layers size={12} />}
          count={zona?.totalCola}
        >
          Cola
        </TabBtn>
        <TabBtn active={tab === "entidades"} onClick={() => setTab("entidades")} icon={<Building2 size={12} />}>
          Entidades
        </TabBtn>
        <TabBtn
          active={tab === "alertas"}
          onClick={() => setTab("alertas")}
          icon={<AlertTriangle size={12} />}
          count={alertasRegion.length}
        >
          Alertas
        </TabBtn>
        <TabBtn
          active={tab === "denuncias"}
          onClick={() => setTab("denuncias")}
          icon={<MessageSquareWarning size={12} />}
          count={reportesRegion.length}
        >
          Denuncias
        </TabBtn>
        <TabBtn active={tab === "presupuesto"} onClick={() => setTab("presupuesto")} icon={<Landmark size={12} />}>
          Presupuesto
        </TabBtn>
      </div>

      {/* Contenido */}
      <div className="scrollbar-warm flex-1 overflow-y-auto px-5 py-4">
        {tab === "resumen" && (
          <ResumenTab
            nombre={nombre}
            detalle={detalle}
            nAlertas={alertasRegion.length}
            nReportes={reportesRegion.length}
            regionId={regionId}
            financiarHref={financiarHref}
            denunciarHref={denunciarHref}
            enVivoHref={enVivoHref}
            goTo={setTab}
          />
        )}
        {tab === "cola" && <ColaTab nombre={nombre} detalle={detalle} financiarHref={financiarHref} />}
        {tab === "entidades" && <EntidadesDeZona regionId={regionId} nombre={nombre} />}
        {tab === "alertas" && <AlertasDeZona regionId={regionId} nombre={nombre} alertas={alertas} />}
        {tab === "denuncias" && (
          <DenunciasTab nombre={nombre} reportes={reportesRegion} denunciarHref={denunciarHref} />
        )}
        {tab === "presupuesto" && <PresupuestoRegional mefDept={REGION_TO_MEF_DEPT[regionId] ?? null} regionId={regionId} />}
      </div>

      {/* Footer: las dos acciones siempre a mano (el resumen ya las muestra en grande) */}
      {tab !== "resumen" && (
        <div className="shrink-0 grid grid-cols-2 gap-2 border-t border-line bg-paperDeep px-5 py-3">
          <Link
            href={financiarHref}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-ink px-3 py-2.5 text-[12px] font-semibold text-paper shadow-card transition-transform hover:scale-[1.01]"
          >
            <Heart size={13} className="text-amber" /> Financiar
          </Link>
          <Link
            href={denunciarHref}
            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-rust/40 bg-crimson-soft px-3 py-2.5 text-[12px] font-semibold text-rust transition-colors hover:bg-rust hover:text-paper"
          >
            <Camera size={13} /> Denunciar
          </Link>
        </div>
      )}
    </div>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────

function ResumenTab({
  nombre,
  detalle,
  nAlertas,
  nReportes,
  regionId,
  financiarHref,
  denunciarHref,
  enVivoHref,
  goTo,
}: {
  nombre: string;
  detalle: ZonaDetalle | null | undefined;
  nAlertas: number;
  nReportes: number;
  regionId: string;
  financiarHref: string;
  denunciarHref: string;
  enVivoHref: string;
  goTo: (t: ZonaTab) => void;
}) {
  const zona = detalle?.zona ?? null;
  const loading = detalle === undefined;
  const financiadoPct = zona ? pct(zona.financiados, zona.totalCola) : 0;
  const procesadoPct = zona ? pct(zona.procesados, zona.totalCola) : 0;
  const restantes = zona ? Math.max(0, zona.totalCola - zona.financiados) : 0;

  return (
    <div className="space-y-4">
      {/* Capacidad de auditoría */}
      <section className="rounded-2xl border border-line bg-paper p-3.5">
        <div className="flex items-center justify-between">
          <h4 className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-mute">
            <Landmark size={11} className="text-clay" /> Auditoría de {nombre}
          </h4>
          {zona && zona.precioPen > 0 && (
            <span className="font-mono text-[10px] text-mute">{formatPEN(zona.precioPen)} / contrato</span>
          )}
        </div>

        {loading ? (
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-paperDeep" />
            ))}
          </div>
        ) : zona ? (
          <>
            <div className="mt-3 grid grid-cols-4 gap-1.5">
              <MiniKpi label="En cola" value={zona.totalCola} tone="ink" />
              <MiniKpi label="Financiados" value={zona.financiados} tone="amber" />
              <MiniKpi label="Procesados" value={zona.procesados} tone="moss" />
              <MiniKpi label="Señales" value={zona.senales} tone="rust" />
            </div>
            {zona.totalCola > 0 ? (
              <div className="mt-3">
                <div className="flex justify-between text-[10px] text-mute">
                  <span>financiado {financiadoPct}%</span>
                  <span>procesado {procesadoPct}%</span>
                </div>
                <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-paperDeep">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-amber" style={{ width: `${financiadoPct}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-moss" style={{ width: `${procesadoPct}%` }} />
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-mute">
                  {restantes > 0 ? (
                    <>
                      <strong className="text-ink">{restantes.toLocaleString("es-PE")}</strong> contrato
                      {restantes === 1 ? "" : "s"} de {nombre} esperan que alguien financie su lectura.
                    </>
                  ) : (
                    <>Toda la cola de {nombre} está financiada. Los contratos se procesan en orden de llegada.</>
                  )}
                </p>
              </div>
            ) : (
              <p className="mt-3 text-[11px] leading-relaxed text-mute">
                Todavía no ingresamos contratos de {nombre}. La ingesta diaria del OECE los irá sumando.
              </p>
            )}
          </>
        ) : (
          <p className="mt-3 text-[11px] text-mute">No se pudo cargar el estado de financiamiento de la zona.</p>
        )}
      </section>

      {/* CTAs */}
      <div className="space-y-2">
        <Link
          href={financiarHref}
          className="group flex items-center justify-between rounded-2xl bg-ink px-4 py-3 text-paper shadow-card transition-transform hover:scale-[1.01]"
        >
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-paper/10 text-amber">
              <Heart size={15} />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold">Financiar auditoría de {nombre}</span>
              <span className="block text-[10px] text-paper/60">Capacidad de lectura, no resultados</span>
            </span>
          </span>
          <ArrowRight size={16} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
        </Link>
        <Link
          href={denunciarHref}
          className="group flex items-center justify-between rounded-2xl border border-rust/40 bg-crimson-soft px-4 py-3 text-ink transition-colors hover:border-rust"
        >
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rust text-paper">
              <Camera size={15} />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold">Denunciar una obra en {nombre}</span>
              <span className="block text-[10px] text-mute">Foto + ubicación · anónimo por defecto</span>
            </span>
          </span>
          <ArrowRight size={16} className="shrink-0 text-rust transition-transform group-hover:translate-x-0.5" />
        </Link>
        {zona && zona.financiados > 0 ? (
          <Link
            href={enVivoHref}
            className="group flex items-center justify-between rounded-2xl border border-line bg-paper px-4 py-3 text-ink transition-colors hover:border-moss/60"
          >
            <span className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-moss/10 text-moss">
                <Activity size={15} />
              </span>
              <span className="leading-tight">
                <span className="block text-sm font-semibold">Ver en vivo</span>
                <span className="block text-[10px] text-mute">Cola → procesando → procesado</span>
              </span>
            </span>
            <ArrowUpRight size={16} className="shrink-0 text-mute group-hover:text-moss" />
          </Link>
        ) : (
          zona && (
            <p className="px-1 text-[10px] leading-relaxed text-mute">
              Cuando alguien financie esta zona, verás aquí cada contrato pasar de la cola al análisis.
            </p>
          )
        )}
      </div>

      {/* Lo que ya se sabe */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => goTo("alertas")}
          className="group rounded-xl border border-line bg-paper p-3 text-left transition-colors hover:border-clay/60 hover:bg-paperDeep"
        >
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-amber">
            <AlertTriangle size={11} /> Señales
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-ink">{nAlertas}</div>
          <div className="text-[10px] text-mute">alertas publicadas</div>
        </button>
        <button
          onClick={() => goTo("denuncias")}
          className="group rounded-xl border border-line bg-paper p-3 text-left transition-colors hover:border-clay/60 hover:bg-paperDeep"
        >
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-rust">
            <MessageSquareWarning size={11} /> Denuncias
          </div>
          <div className="mt-1 font-mono text-xl font-bold text-ink">{nReportes}</div>
          <div className="text-[10px] text-mute">reportes ciudadanos</div>
        </button>
      </div>

      <button
        type="button"
        onClick={() => goTo("presupuesto")}
        className="group flex w-full items-center justify-between rounded-xl border border-dashed border-line bg-paperDeep px-3 py-2.5 text-xs transition-colors hover:border-clay hover:bg-paper"
      >
        <span className="text-mute">
          Presupuesto MEF de <strong className="text-ink">{nombre}</strong>: PIA, PIM y ejecución
        </span>
        <span className="inline-flex items-center gap-0.5 font-semibold text-clay">
          Ver
          <ArrowRight size={11} className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </button>
    </div>
  );
}

function ColaTab({
  nombre,
  detalle,
  financiarHref,
}: {
  nombre: string;
  detalle: ZonaDetalle | null | undefined;
  financiarHref: string;
}) {
  if (detalle === undefined) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-xl bg-paperDeep" />
        ))}
      </div>
    );
  }
  if (!detalle) {
    return <EmptyTab text="No se pudo cargar la cola de auditoría de esta zona." />;
  }
  const { zona, cola, hijas, aliados } = detalle;
  const provinciasConCola = hijas.filter((h) => h.totalCola > 0).sort((a, b) => b.totalCola - a.totalCola);
  const costoTotal = zona.totalCola * zona.precioPen;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-paper p-3.5">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">Qué hay en la cola</h4>
        {zona.totalCola > 0 ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
            <Row k="Contratos" v={`${cola.contratos.toLocaleString("es-PE")}`} />
            <Row k="Monto contratado" v={cola.montoReferencial > 0 ? formatPEN(cola.montoReferencial) : "—"} />
            <Row k="Entidades" v={`${cola.entidades.toLocaleString("es-PE")}`} />
            <Row k="Costo de auditarla" v={costoTotal > 0 ? formatPEN(costoTotal) : "—"} />
          </dl>
        ) : (
          <p className="mt-2 text-[11px] leading-relaxed text-mute">
            Todavía no ingresamos contratos de {nombre}. La ingesta diaria del OECE los irá sumando.
          </p>
        )}
        <p className="mt-3 text-[10px] leading-relaxed text-mute">
          No se lista contrato por contrato a propósito: quien financia no elige qué se analiza. La cola se
          procesa en orden de llegada.
        </p>
      </section>

      {provinciasConCola.length > 0 && (
        <section>
          <div className="mb-1.5 flex items-baseline justify-between">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-mute">Provincias con contratos en cola</h4>
            <span className="text-[10px] text-mute">{provinciasConCola.length}</span>
          </div>
          <ul className="space-y-1.5">
            {provinciasConCola.slice(0, 12).map((h) => {
              const p = pct(h.financiados, h.totalCola);
              return (
                <li key={h.ubigeo}>
                  <Link
                    href={`/app/financiar/${h.ubigeo}`}
                    className="group block rounded-xl border border-line bg-paper p-2.5 transition-colors hover:border-clay/60 hover:bg-paperDeep"
                  >
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="flex items-center gap-1.5 font-medium text-ink">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: ESTADO_FILL[h.estado] }} />
                        {h.nombre}
                      </span>
                      <span className="font-mono text-[10px] text-mute">
                        {h.financiados}/{h.totalCola}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-paperDeep">
                      <div className="h-full rounded-full bg-amber" style={{ width: `${p}%` }} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {aliados.length > 0 && (
        <section>
          <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-mute">Auditoría financiada por</h4>
          <ul className="space-y-1">
            {aliados.slice(0, 6).map((a, i) => (
              <li key={`${a.nombre}-${i}`} className="flex items-center justify-between rounded-lg bg-paper px-2.5 py-1.5 text-[11px]">
                {a.slug ? (
                  <Link href={`/aliado/${a.slug}`} className="font-medium text-ink hover:underline">
                    {a.nombre}
                  </Link>
                ) : (
                  <span className="font-medium text-ink">{a.nombre}</span>
                )}
                <span className="font-mono text-[10px] text-mute">{a.contratos} contratos</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link
        href={financiarHref}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-semibold text-paper shadow-card transition-transform hover:scale-[1.01]"
      >
        <Heart size={14} className="text-amber" />
        {zona.totalCola - zona.financiados > 0
          ? `Financiar · quedan ${(zona.totalCola - zona.financiados).toLocaleString("es-PE")} contratos`
          : `Ver la auditoría de ${nombre}`}
      </Link>
    </div>
  );
}

function DenunciasTab({
  nombre,
  reportes,
  denunciarHref,
}: {
  nombre: string;
  reportes: any[];
  denunciarHref: string;
}) {
  const rows = [...reportes].sort((a, b) => String(b.fecha || "").localeCompare(String(a.fecha || "")));
  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-paper p-6 text-center">
          <Camera size={18} className="mx-auto text-mute" />
          <p className="mt-2 text-sm text-mute">Nadie reportó todavía una obra en {nombre}. Sé la primera persona.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {rows.slice(0, 20).map((r) => {
            const meta = CATEGORIA_META[r.categoria as CategoriaDenuncia];
            const Icon = meta?.icon ?? MessageSquareWarning;
            return (
              <li key={r.id}>
                <Link
                  href={`/app/denuncias/${r.id}`}
                  className="group flex items-start gap-2.5 rounded-xl border border-line bg-paper p-2.5 transition-colors hover:border-clay/60 hover:bg-paperDeep"
                >
                  <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border", meta?.tone ?? "bg-paperDeep text-mute border-line")}>
                    <Icon size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[10px] text-mute">
                      <span>{meta?.label ?? "Reporte"}</span>
                      {r.confirmado && (
                        <span className="inline-flex items-center gap-0.5 text-moss">
                          <CheckCircle2 size={10} /> confirmado
                        </span>
                      )}
                      {r.fecha && <span>· {String(r.fecha).slice(0, 10)}</span>}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink">{r.descripcion}</span>
                  </span>
                  <ArrowUpRight size={13} className="mt-1 shrink-0 text-mute opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[10px] leading-relaxed text-mute">
        Un reporte aparece como confirmado cuando dos personas distintas reportan el mismo punto en 30 días. Sin foto
        no se publica en el mapa.
      </p>
      <div className="flex flex-col gap-1.5">
        <Link
          href={denunciarHref}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-rust px-4 py-2.5 text-sm font-semibold text-paper shadow-card transition-transform hover:scale-[1.01]"
        >
          <Camera size={14} /> Denunciar una obra en {nombre}
        </Link>
        <Link href="/app/denuncias" className="text-center text-[11px] text-mute hover:text-clay hover:underline">
          Ver todas las denuncias del país →
        </Link>
      </div>
    </div>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────

function TabBtn({
  active,
  onClick,
  icon,
  children,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex flex-1 items-center justify-center gap-1 px-1 py-2.5 text-[11px] font-medium transition-colors",
        active ? "text-ink" : "text-mute hover:text-ink",
      )}
    >
      <span className={active ? "text-clay" : ""}>{icon}</span>
      <span>{children}</span>
      {count !== undefined && count > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0 text-[9px] font-bold",
            active ? "bg-clay text-paper" : "bg-paperDeep text-mute",
          )}
        >
          {count > 999 ? "999+" : count}
        </span>
      )}
      {active && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-clay" />}
    </button>
  );
}

function MiniKpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ink" | "amber" | "moss" | "rust";
}) {
  const accent = { ink: "text-ink", amber: "text-amber", moss: "text-moss", rust: "text-rust" }[tone];
  return (
    <div className="rounded-lg bg-paperDeep px-2 py-1.5">
      <div className={cn("font-mono text-base font-bold leading-tight tabular-nums", accent)}>
        {value.toLocaleString("es-PE")}
      </div>
      <div className="text-[9px] uppercase tracking-wider text-mute">{label}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-mute">{k}</dt>
      <dd className="font-mono text-[13px] text-ink">{v}</dd>
    </div>
  );
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-paper p-8 text-center">
      <p className="text-sm text-mute">{text}</p>
    </div>
  );
}
