"use client";

import { RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { type ProgresoDocumentos } from "@/lib/admin";
import { useAdmin } from "@/lib/useAdmin";
import {
  Badge,
  claseBoton,
  DataTable,
  EmptyState,
  ErrorBanner,
  Expandable,
  PageSection,
  Card,
  SkeletonPanel,
  SkeletonStats,
  SkeletonTabla,
  StatCard,
  StatGrid,
  estadoLote,
  fmtBytes,
  fmtDia,
  fmtFechaHora,
  fmtNum,
  hace,
  pct,
  tipoLoteLabel,
  type Columna,
} from "@/components/admin/ui";
import { Progreso } from "./Progreso";
import { Fuentes, totalFuentes, type Fuente } from "./Fuentes";

/**
 * Cobertura: qué tiene Vigía de cada mes, a ciencia cierta. Sale de las tablas que escribe el
 * pipeline (migración 16), no de estimaciones: documentos del SEACE en el almacén (lote
 * nocturno), contratos por mes, fuentes externas y el historial de lotes.
 * Fuente: GET /api/admin/cobertura · GET /api/admin/cobertura/progreso (ambas con caché de 1 min en el API)
 */

interface Mes { mes: string | null; contratos: number; conRecord: number; conDocs: number; docsPublicados: number; docsVigentes: number; clasificados: number; analizados: number; enCola: number }
interface Lote { id: string; tipo: string; estado: string; total: number; ok: number; fallidos: number; iniciadoAt: string | null; finalizadoAt: string | null; error: string | null }
interface Cobertura {
  meses: Mes[];
  lotes: Lote[];
  documentos: { total: number; vigentes: number; bytesVigentes: number | string; proximaExpiracion: string | null } | null;
  porFormato: { formato: string | null; n: number; bytes: number | string }[];
  fuentes?: Fuente[];
  generadoAt: string;
}

const nombreMes = (iso: string) => {
  const t = new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-PE", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Colores de la barra de formatos: tinta en escalones (no son estados, así que no usan tonos). */
const TINTA = ["bg-ink/75", "bg-ink/50", "bg-ink/30", "bg-ink/20", "bg-ink/10"];

/** Qué hay en el almacén: una barra partida por formato y su leyenda, con el vencimiento. */
function Almacen({ documentos, porFormato }: { documentos: Cobertura["documentos"]; porFormato: Cobertura["porFormato"] }) {
  const total = porFormato.reduce((a, f) => a + f.n, 0);
  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-semibold text-ink">
          En el almacén: {fmtNum(documentos?.vigentes) ?? "sin dato"} documentos
          {documentos && <span className="font-normal text-mute"> · {fmtBytes(documentos.bytesVigentes) ?? "tamaño sin dato"}</span>}
        </p>
        <p className="text-[12px] text-mute">{documentos?.proximaExpiracion ? `El primero vence el ${fmtDia(documentos.proximaExpiracion)}` : "Ninguno por vencer"}</p>
      </div>
      {total > 0 && (
        <>
          <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-paperDeep" aria-hidden>
            {porFormato.map((f, i) => <span key={f.formato ?? i} className={TINTA[Math.min(i, TINTA.length - 1)]} style={{ width: `${(f.n / total) * 100}%` }} />)}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-inkSoft">
            {porFormato.map((f, i) => (
              <li key={f.formato ?? i} className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${TINTA[Math.min(i, TINTA.length - 1)]}`} aria-hidden />
                <span className="font-medium uppercase text-ink">{f.formato ?? "sin formato"}</span>
                <span className="font-mono">{fmtNum(f.n)}</span>
                <span className="text-mute">({fmtBytes(f.bytes)})</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-3 text-[11.5px] leading-snug text-mute">Pasan a almacenamiento frío a los 30 días y se borran a los 90. Si alguien financia un contrato con documentos vencidos, se vuelven a bajar esa noche.</p>
    </Card>
  );
}

/** Cantidad con su proporción sobre un total, y una barra chica. */
function Proporcion({ a, b }: { a: number; b: number }) {
  const p = pct(a, b);
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="font-mono">{fmtNum(a)}</span>
      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-paperDeep sm:inline-block" aria-hidden>
        <span className="block h-full rounded-full bg-moss" style={{ width: `${p}%` }} />
      </span>
      <span className="w-10 text-right font-sans text-[11px] text-mute">{p} %</span>
    </span>
  );
}

export default function CoberturaPage() {
  const cob = useAdmin<Cobertura>("/cobertura", { refreshInterval: 60_000 });
  const pro = useAdmin<ProgresoDocumentos>("/cobertura/progreso", { refreshInterval: 60_000 });
  const d = cob.data;
  const pr = pro.data;
  const refrescar = () => { cob.mutate(); pro.mutate(); };

  const meses = (d?.meses ?? []).filter((m) => m.mes);
  const sinMes = (d?.meses ?? []).find((m) => !m.mes);
  const tot = meses.reduce(
    (a, m) => ({ contratos: a.contratos + m.contratos, conRecord: a.conRecord + m.conRecord, conDocs: a.conDocs + m.conDocs, analizados: a.analizados + m.analizados, enCola: a.enCola + m.enCola }),
    { contratos: 0, conRecord: 0, conDocs: 0, analizados: 0, enCola: 0 },
  );

  const colMeses: Columna<Mes>[] = [
    { clave: "mes", titulo: "Mes de convocatoria", principal: true, celda: (m) => <span className="font-medium text-ink">{nombreMes(m.mes!)}</span> },
    { clave: "contratos", titulo: "Contratos", alinear: "derecha", celda: (m) => fmtNum(m.contratos) },
    { clave: "record", titulo: "Expediente completo", alinear: "derecha", celda: (m) => <Proporcion a={m.conRecord} b={m.contratos} /> },
    { clave: "docs", titulo: "Documentos bajados", alinear: "derecha", celda: (m) => <span title={`${fmtNum(m.docsVigentes)} de ${fmtNum(m.docsPublicados)} publicados`}><Proporcion a={m.docsVigentes} b={m.docsPublicados} /></span> },
    { clave: "condocs", titulo: "Contratos con documentos", alinear: "derecha", celda: (m) => fmtNum(m.conDocs) },
    { clave: "clasif", titulo: "Clasificados", alinear: "derecha", celda: (m) => <Proporcion a={m.clasificados} b={m.contratos} /> },
    { clave: "analizados", titulo: "Analizados", alinear: "derecha", celda: (m) => fmtNum(m.analizados) },
    { clave: "cola", titulo: "En proceso", alinear: "derecha", celda: (m) => fmtNum(m.enCola) },
  ];

  const colLotes: Columna<Lote>[] = [
    {
      clave: "lote",
      titulo: "Lote",
      principal: true,
      celda: (l) => (
        <span title={l.id}>
          <span className="block font-medium text-ink">{tipoLoteLabel(l.tipo)}</span>
          <span className="block text-[11px] text-mute">{fmtFechaHora(l.iniciadoAt ?? l.finalizadoAt) ?? "sin fecha"}</span>
        </span>
      ),
    },
    {
      clave: "resultado",
      titulo: "Resultado",
      celda: (l) => (
        <span className="text-[12px] text-inkSoft">
          <span className="font-mono text-ink">{fmtNum(l.ok)}</span> de {fmtNum(l.total)}
          {l.fallidos ? <span className="text-crimsonTexto">, {fmtNum(l.fallidos)} fallidos</span> : null}
        </span>
      ),
    },
    { clave: "estado", titulo: "Estado", celda: (l) => { const e = estadoLote(l.estado); return <Badge tono={e.tono}>{e.label}</Badge>; } },
    { clave: "cuando", titulo: "Terminó", className: "whitespace-nowrap text-[12px] text-mute", celda: (l) => hace(l.finalizadoAt) ?? "sin terminar" },
  ];

  return (
    <AdminShell
      title="Cobertura"
      subtitle="Qué tenemos de cada mes: expedientes, documentos y análisis, según la base de datos"
      actions={
        <button onClick={refrescar} className={claseBoton("secundario")}>
          <RefreshCw size={12} className={cob.isValidating || pro.isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      }
    >
      <div className="space-y-10">
        <PageSection titulo="Documentos del SEACE" descripcion="El lote nocturno los baja desde una conexión peruana (el SEACE no deja entrar a la nube) y los guarda en el almacén 90 días.">
          <ErrorBanner error={pro.error} titulo="No se pudo leer el avance del lote nocturno" onReintentar={() => pro.mutate()} className="mb-3" />
          {pr ? <Progreso pr={pr} /> : pro.isLoading && <div className="space-y-3"><SkeletonPanel lineas={2} /><SkeletonStats n={4} /></div>}
          {d ? <Almacen documentos={d.documentos} porFormato={d.porFormato} /> : cob.isLoading && <SkeletonPanel lineas={2} className="mt-3" />}
        </PageSection>

        <ErrorBanner error={cob.error} titulo="No se pudo leer la cobertura" onReintentar={() => cob.mutate()} />

        <PageSection
          titulo="Contratos por mes"
          meta={d ? `${fmtNum(tot.contratos)} contratos` : undefined}
          descripcion={d ? `Cifras de la base, actualizadas ${fmtFechaHora(d.generadoAt)}` : undefined}
        >
          {!d ? (
            cob.isLoading && <div className="space-y-3"><SkeletonStats n={5} /><SkeletonTabla filas={6} columnas={6} /></div>
          ) : (
            <div className="space-y-3">
              <StatGrid columnas={5}>
                <StatCard etiqueta="Contratos" valor={tot.contratos} pista="con mes de convocatoria" />
                <StatCard etiqueta="Expediente completo" valor={tot.conRecord} tono="ok" pista={`${pct(tot.conRecord, tot.contratos)} % del total`} />
                <StatCard etiqueta="Con documentos" valor={tot.conDocs} tono={tot.conDocs ? "ok" : "warn"} pista={`${pct(tot.conDocs, tot.contratos)} % tiene al menos uno bajado`} />
                <StatCard etiqueta="En proceso" valor={tot.enCola} tono={tot.enCola ? "pending" : "neutral"} pista="financiados: en cola, leyéndose o esperando documentos" href="/admin/procesamientos" />
                <StatCard etiqueta="Analizados" valor={tot.analizados} tono="ok" pista="con informe de la revisión" />
              </StatGrid>

              <DataTable
                etiqueta="Cobertura por mes de convocatoria"
                columnas={colMeses}
                filas={meses}
                claveFila={(m) => m.mes!}
                apilarHasta="lg"
                anchoMinimo="min-w-[860px]"
                vacio={<EmptyState compacto titulo="Todavía no hay contratos ingeridos" descripcion="Aparecen cuando corre la ingesta diaria de convocatorias." />}
              />
              {sinMes && sinMes.contratos > 0 && (
                <p className="text-[12px] text-inkSoft">{fmtNum(sinMes.contratos)} contratos no tienen fecha de convocatoria: no entran en esta tabla ni en los totales.</p>
              )}
              <Expandable variante="linea" resumen="Qué mide cada columna">
                <dl className="grid max-w-4xl gap-x-6 gap-y-2 text-[12.5px] leading-relaxed text-inkSoft md:grid-cols-2">
                  <div><dt className="font-semibold text-ink">Expediente completo</dt><dd>Bajamos el expediente entero del OECE (partes, adjudicaciones y contratos). Sin él solo tenemos el aviso de convocatoria. <span className="font-mono text-[11px] text-mute">/record/&lt;ocid&gt; frente a /releasesAfter</span></dd></div>
                  <div><dt className="font-semibold text-ink">Documentos bajados</dt><dd>Documentos guardados y vigentes frente a los que el SEACE publica para ese mes. <span className="font-mono text-[11px] text-mute">gs://vigia-peru-batch/batch/documentos/</span></dd></div>
                  <div><dt className="font-semibold text-ink">Clasificados</dt><dd>Contratos a los que ya se les asignó tipo y etapa.</dd></div>
                  <div><dt className="font-semibold text-ink">En proceso</dt><dd>Financiados y en camino: en cola, leyéndose o esperando documentos.</dd></div>
                </dl>
              </Expandable>
            </div>
          )}
        </PageSection>

        <PageSection
          titulo="Fuentes externas"
          meta={d ? `${totalFuentes(d.fuentes ?? [])} fuentes` : undefined}
          descripcion="Datos que no vienen del SEACE y se cruzan con cada contrato: visitas, aportes de campaña, autoridades, declaraciones de intereses."
        >
          {d ? <Fuentes fuentes={d.fuentes ?? []} /> : cob.isLoading && <SkeletonTabla filas={5} columnas={5} />}
        </PageSection>

        {d && (
          <PageSection titulo="Historial de lotes" meta={`${d.lotes.length} más recientes`} descripcion="Lo que corre cada noche: convocatorias nuevas, expedientes completos y documentos." plegable abierto={false}>
            <DataTable
              etiqueta="Lotes ingeridos"
              columnas={colLotes}
              filas={d.lotes}
              claveFila={(l) => l.id}
              vacio={<EmptyState compacto titulo="Todavía no se ingirió ningún lote" />}
            />
          </PageSection>
        )}
      </div>
    </AdminShell>
  );
}
