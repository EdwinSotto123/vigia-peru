import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  Coins,
  Activity,
  AlertTriangle,
  Flag,
  ExternalLink,
  FileText,
  Users,
  MapPin,
} from "lucide-react";
import { entidadById, TIPO_LABELS, type Entidad } from "@/lib/mock-entities";
import { formatSoles, severidadColor } from "@/lib/mock-data";
import { Sparkline } from "@/components/charts/Sparkline";
import { MESES_SERIE } from "@/lib/peru-data";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { EjecucionPresupuestal } from "@/components/EjecucionPresupuestal";
import { AnalizarOtraConvocatoria } from "@/components/AnalizarOtraConvocatoria";
import { Suspense } from "react";
import { getEntidad } from "@/lib/api-client";

export default async function EntidadProfile({
  params,
}: {
  params: { ruc: string };
}) {
  // 1. Intentar la API real primero (Cloud SQL)
  let ent: Entidad | null = null;
  let alertasRel: any[] = [];
  let source: "api" | "mock" = "api";

  try {
    const apiResp = await getEntidad(params.ruc);
    if (apiResp?.entidad) {
      const e = apiResp.entidad;
      ent = {
        id: e.ruc,
        ruc: e.ruc,
        nombre: e.nombre,
        tipo: e.tipo || "organismo_autonomo",
        region: e.region || "—",
        provincia: e.provincia || "",
        distrito: e.distrito || "",
        alertas: Number(e.alertas || (apiResp.alertas || []).length),
        reportes: 0,
        contratos: 0,
        contratosVigilados: 0,
        monto: Number(e.monto || 0),
        scorePromedio: (apiResp.alertas || []).reduce(
          (a: number, x: any) => a + (Number(x.score) || 0), 0
        ) / Math.max((apiResp.alertas || []).length, 1) || 0,
        serie: [0, 0, 0, 0, 0, 0],
      } as Entidad;
      alertasRel = (apiResp.alertas || []).map((a: any) => ({
        id: a.id,
        codigoconvocatoria: a.codigo_convocatoria || a.codigo,
        score: a.score,
        montoSoles: Number(a.monto_adjudicado || 0),
        fechaBuenaPro: (a.fecha_buena_pro || "").slice(0, 10),
        objeto: a.objeto || "",
        proveedor: a.proveedor_nombre || "",
        proveedorRuc: a.proveedor_ruc || "",
        banderas: a.banderas || [],
      }));
    }
  } catch (e) {
    console.error("[entidad page] API falló:", (e as Error).message);
  }

  // 2. Fallback al mock si no hay datos en la API
  if (!ent) {
    const mock = entidadById(params.ruc);
    if (!mock) notFound();
    ent = mock;
    source = "mock";
    const { ALERTAS_MOCK } = await import("@/lib/mock-data");
    alertasRel = ALERTAS_MOCK.filter((a) => a.rucEntidad === ent!.ruc);
  }

  return (
    <div className="container-page space-y-8 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-mute hover:text-ink"
      >
        <ArrowLeft size={16} /> Volver al ranking
      </Link>

      {/* Header */}
      <header className="surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-line bg-paperDeep px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-clay">
              <Building2 size={11} /> {TIPO_LABELS[ent.tipo]}
            </div>
            <h1 className="font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
              {ent.nombre}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-mute">
              <span className="font-mono">RUC {ent.ruc}</span>
              <span className="flex items-center gap-1">
                <MapPin size={11} /> {ent.region}
                {ent.provincia && ` · ${ent.provincia}`}
                {ent.distrito && ` · ${ent.distrito}`}
              </span>
            </div>
          </div>
          <Link
            href={`/reporte/nuevo?modo=entidad&ruc=${ent.ruc}`}
            className="inline-flex items-center gap-2 rounded-full bg-rust px-4 py-2.5 text-sm font-medium text-paper shadow-card hover:bg-rust/90"
          >
            <Flag size={15} /> Reportar irregularidad en esta entidad
          </Link>
        </div>
      </header>

      <DisclaimerBanner />

      {/* KPIs */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI
          icon={<AlertTriangle size={16} />}
          label="Alertas automáticas"
          value={ent.alertas}
          hint="banderas detectadas"
          tone="amber"
        />
        <KPI
          icon={<Users size={16} />}
          label="Reportes ciudadanos"
          value={ent.reportes}
          hint="sobre esta entidad"
          tone="crimson"
        />
        <KPI
          icon={<FileText size={16} />}
          label="Contratos vigilados"
          value={`${ent.contratosVigilados} / ${ent.contratos}`}
          hint="con seguimiento activo"
          tone="ink"
        />
        <KPI
          icon={<Coins size={16} />}
          label="Monto vigilado"
          value={formatSoles(ent.monto)}
          hint={`score promedio ${ent.scorePromedio}/100`}
          tone="clay"
        />
      </section>

      {/* Sparkline + score */}
      <section className="grid gap-4 lg:grid-cols-3">
        <div className="surface lg:col-span-2 p-5">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-serif text-lg font-bold text-ink">
                Alertas activadas — últimos 6 meses
              </h3>
              <p className="text-xs text-mute">
                Cada barra suma las banderas duras (C1-C8) que se dispararon ese mes.
              </p>
            </div>
            <Activity size={18} className="text-clay" />
          </div>
          <Sparkline
            values={ent.serie}
            labels={MESES_SERIE}
            color="#A0512D"
            width={520}
            height={120}
          />
        </div>
        <div className="surface p-5">
          <h3 className="font-serif text-lg font-bold text-ink">Score</h3>
          <p className="text-xs text-mute">Promedio ponderado de banderas por severidad.</p>
          <div className="mt-4 flex items-baseline gap-2">
            <span className="font-mono text-6xl font-bold text-ink">
              {ent.scorePromedio}
            </span>
            <span className="text-mute">/100</span>
          </div>
          <ScoreBar value={ent.scorePromedio} />
          <p className="mt-3 text-xs text-mute">
            {ent.scorePromedio >= 80
              ? "Alto riesgo. Casos requieren revisión inmediata."
              : ent.scorePromedio >= 60
                ? "Riesgo medio. Patrones sospechosos detectados."
                : ent.scorePromedio >= 30
                  ? "Riesgo bajo. Algunas señales aisladas."
                  : "Sin riesgo agregado significativo."}
          </p>
        </div>
      </section>

      {/* Ejecución presupuestal MEF (real) */}
      <Suspense
        fallback={
          <div className="surface flex h-40 items-center justify-center text-sm text-mute">
            Consultando MEF — Datos Abiertos…
          </div>
        }
      >
        <EjecucionPresupuestal
          query={mefSearchKeywordFor(ent)}
          ruc={ent.ruc}
          title="Ejecución presupuestal"
          subtitle={`${ent.nombre} · datos reales de MEF`}
        />
      </Suspense>

      {/* Analizar otra convocatoria de la entidad */}
      <AnalizarOtraConvocatoria
        rucEntidad={ent.ruc}
        nombreEntidad={ent.nombre}
      />

      {/* Alertas asociadas — convocatorias ya analizadas */}
      <section className="surface overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-line bg-paperDeep px-6 py-4">
          <div>
            <h3 className="font-serif text-xl font-bold text-ink">
              Convocatorias ya analizadas ({alertasRel.length})
            </h3>
            <p className="text-sm text-mute">
              Contratos procesados por el pipeline agéntico de Vigía. Para analizar
              uno nuevo, usá el bloque de arriba.
            </p>
          </div>
        </div>
        {alertasRel.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-mute">
            Sin alertas automáticas registradas a la fecha. Esto puede cambiar tras
            cada ingesta diaria o tras un reporte ciudadano.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {alertasRel.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/alerta/${a.id}`}
                  className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-paperDeep"
                >
                  <div className="flex h-12 w-12 flex-col items-center justify-center rounded-xl bg-ink text-paper">
                    <span className="text-xl font-bold leading-none">{a.score}</span>
                    <span className="text-[9px] uppercase tracking-wider opacity-70">
                      score
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-mute">
                      <span className="font-mono">{a.codigoconvocatoria}</span>
                      <span>·</span>
                      <span>{a.fechaBuenaPro}</span>
                    </div>
                    <div className="truncate text-sm font-semibold text-ink">
                      {a.objeto}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {a.banderas.slice(0, 3).map((b: any, bi: number) => (
                        <span
                          key={`${b.regla}-${bi}`}
                          className={"pill border " + severidadColor(b.severidad)}
                        >
                          {b.regla.replaceAll("_", " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="hidden text-right md:block">
                    <div className="font-mono text-sm font-semibold text-ink">
                      {formatSoles(a.montoSoles)}
                    </div>
                    <div className="text-xs text-mute">
                      {a.proveedor
                        ? `ganó: ${a.proveedor.length > 22 ? a.proveedor.slice(0, 22) + "…" : a.proveedor}`
                        : a.proveedorRuc
                        ? `ganó: RUC ${a.proveedorRuc}`
                        : "proveedor no identificado"}
                    </div>
                  </div>
                  <ExternalLink size={16} className="text-mute" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KPI({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint: string;
  tone: "amber" | "crimson" | "ink" | "clay";
}) {
  const styles = {
    amber: "bg-amber-soft text-amber",
    crimson: "bg-crimson-soft text-rust",
    ink: "bg-paperDeep text-ink",
    clay: "bg-paperDeep text-clay",
  }[tone];
  return (
    <div className="surface p-5">
      <span
        className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${styles}`}
      >
        {icon}
      </span>
      <div className="mt-3 font-mono text-2xl font-bold text-ink">
        {typeof value === "number" ? value.toLocaleString("es-PE") : value}
      </div>
      <div className="text-sm font-medium text-ink">{label}</div>
      <div className="text-xs text-mute">{hint}</div>
    </div>
  );
}

/** Convierte el nombre de la entidad en un keyword que MEF entiende. */
function mefSearchKeywordFor(e: ReturnType<typeof entidadById>): string {
  if (!e) return "";
  const n = e.nombre.toUpperCase();
  // Gobiernos regionales: "Gob. Reg. de Cusco" → "REGIONAL DEL DEPARTAMENTO DE CUSCO"
  if (n.includes("GOBIERNO REGIONAL") || n.includes("GOB. REG")) {
    const m = e.nombre.match(/de ([A-Za-záéíóúñÁÉÍÓÚÑ ]+)$/);
    if (m) return `REGIONAL DEL DEPARTAMENTO DE ${m[1].trim().toUpperCase()}`;
  }
  // Municipalidades distritales/provinciales: usar el distrito/provincia clave
  if (n.includes("MUNICIPALIDAD") || n.includes("MUN.")) {
    const m = e.nombre.match(/de ([A-Za-záéíóúñÁÉÍÓÚÑ]+)\s*$/);
    if (m) return `MUNICIPALIDAD ${n.includes("DISTRITAL") || n.includes("DIST") ? "DISTRITAL" : n.includes("PROVINCIAL") || n.includes("PROV") ? "PROVINCIAL" : ""} DE ${m[1].trim().toUpperCase()}`.replace(/\s+/g, " ").trim();
  }
  // Ministerios: dejar tal cual mayúsculas
  return e.nombre.toUpperCase();
}

function ScoreBar({ value }: { value: number }) {
  const color =
    value >= 80
      ? "#7A2E18"
      : value >= 60
        ? "#A05A1F"
        : value >= 30
          ? "#C28840"
          : "#3D5C2D";
  return (
    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-paperDeep">
      <div
        className="h-full transition-[width] duration-700 ease-out"
        style={{ width: `${value}%`, background: color }}
      />
    </div>
  );
}
