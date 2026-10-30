"use client";

import { Suspense, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Ayuda } from "@/components/patrones/Ayuda";
import { type ProgresoDocumentos } from "@/lib/admin";
import { useAdmin } from "@/lib/useAdmin";
import {
  Aviso,
  Badge,
  claseBoton,
  DataTable,
  EmptyState,
  ErrorBanner,
  Expandable,
  PageSection,
  Panel,
  PanelPestana,
  Pestanas,
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
  usePestana,
  type Columna,
  type PestanaPanel,
} from "@/components/admin/ui";
import { Progreso } from "./Progreso";
import { Fuentes, totalFuentes, type Fuente } from "./Fuentes";

/**
 * Cobertura: qué tiene Vigía de cada mes, a ciencia cierta. Sale de las tablas que escribe el pipeline (migración 16),
 * no de estimaciones.
 *
 * Tres pestañas (rediseño del 2026-10-30): Documentos (el avance de las descargas, lo que hay en el almacén y el historial
 * de lotes), Contratos por mes y Fuentes externas. Sólo se pinta la activa, y cada bloque lleva su propio esqueleto, un
 * aviso si tarda y su error con reintentar: antes las tres secciones colgaban de los dos pedidos a la vez y la página
 * entera quedaba en esqueleto mientras el más lento no volvía (en DEV, más de 33 s y contando).
 *
 * Por qué tardan: /cobertura (cobertura_resumen()) y /cobertura/progreso suman sobre la vista cobertura_contratos
 * (migración 16), que no está materializada: por CADA convocatoria abre su ocds_payload para contar los documentos
 * publicados y hace cuatro subconsultas (documentos_gcs dos veces, alertas, procesamientos). Se pensó con ~18 mil
 * convocatorias; con el relleno desde 2015 son ~830 mil, y en la base micro de DEV la cuenta pasa los 120 s del rol del
 * panel. /cobertura/progreso no atrapa ese error (responde 500 a los ~2 min y SWR reintenta dos veces); /cobertura sí, y
 * vuelve con los meses vacíos. Las fuentes externas, el almacén y los lotes viajan en el mismo /cobertura, así que esperan
 * a esa cuenta: separarlos o materializar la vista es trabajo del API.
 *
 * Fuente: GET /api/admin/cobertura (las tres pestañas) y GET /api/admin/cobertura/progreso (sólo Documentos), los dos con
 * caché de 1 min en el API.
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

const SUBTITULO = "Qué tenemos de cada mes: expedientes, documentos y análisis, según la base de datos";

/** Las pestañas, en orden de lectura. Fuera del componente: `usePestana` las usa como dependencia. */
const PESTANAS = ["documentos", "meses", "externas"] as const;
type Pestana = (typeof PESTANAS)[number];

const nombreMes = (iso: string) => {
  const t = new Date(iso.slice(0, 10) + "T12:00:00").toLocaleDateString("es-PE", { month: "long", year: "numeric" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** Colores de la barra de formatos: tinta en escalones (no son estados, así que no usan tonos). */
const TINTA = ["bg-ink/75", "bg-ink/50", "bg-ink/30", "bg-ink/20", "bg-ink/10"];

// ── Cada bloque con su pedido ────────────────────────────────────────────────

/** Lo que un bloque usa de un pedido de useAdmin (SWR): los datos, el error y cómo volver a pedirlo. */
interface Consulta<T> { data?: T; error?: unknown; mutate: () => unknown }

/** true cuando `esperando` lleva más de `ms` en pie: un pedido que no vuelve se dice, en vez de dejar el esqueleto mudo. */
function useTarda(esperando: boolean, ms = 10_000): boolean {
  const [tarda, setTarda] = useState(false);
  useEffect(() => {
    setTarda(false);
    if (!esperando) return;
    const t = setTimeout(() => setTarda(true), ms);
    return () => clearTimeout(t);
  }, [esperando, ms]);
  return tarda;
}

/**
 * Un bloque que depende de un pedido. Mientras no vuelve, su esqueleto (y a los 10 s un aviso de que la cuenta es lenta);
 * si falla, el error con reintentar; con datos, el contenido (con el error encima si falló el último refresco). Así un
 * pedido lento deja en espera sólo su bloque, no la página.
 */
function SegunPedido<T>({ q, que, esqueleto, children }: { q: Consulta<T>; que: string; esqueleto: React.ReactNode; children: (datos: T) => React.ReactNode }) {
  const tarda = useTarda(!q.data && !q.error);
  const error = <ErrorBanner error={q.error} titulo={`No se pudo leer ${que}`} onReintentar={() => void q.mutate()} />;
  if (q.data)
    return (
      <div className="space-y-3">
        {q.error ? error : null}
        {children(q.data)}
      </div>
    );
  if (q.error) return error;
  return (
    <div className="space-y-3">
      {tarda && (
        <Aviso tono="pending" rol="status" titulo={`Sigue cargando ${que}`}>
          La cuenta recorre todos los contratos de la base y puede tardar un par de minutos.
        </Aviso>
      )}
      {esqueleto}
    </div>
  );
}

/** Filas seguidas con la misma firma, juntas: [a, a, a, b, a] → [[a, a, a], [b], [a]]. */
function agruparSeguidos<T>(filas: T[], firma: (f: T) => string): T[][] {
  const grupos: T[][] = [];
  for (const f of filas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && firma(ultimo[0]) === firma(f)) ultimo.push(f);
    else grupos.push([f]);
  }
  return grupos;
}

/** En el celular la fila va compacta y sin encabezados: el número lleva al lado qué es (en escritorio lo dice la columna). */
function Unidad({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="font-sans text-mute lg:hidden">
      {" "}
      {children}
    </span>
  );
}

// ── Pestaña Documentos ───────────────────────────────────────────────────────

/** Qué hay en el almacén: una barra partida por formato y su leyenda, con el vencimiento (el porqué de los plazos, en el ⓘ). */
function Almacen({ documentos, porFormato }: { documentos: Cobertura["documentos"]; porFormato: Cobertura["porFormato"] }) {
  const total = porFormato.reduce((a, f) => a + f.n, 0);
  return (
    <Panel
      titulo={
        documentos ? (
          <>
            En el almacén: {fmtNum(documentos.vigentes)} documentos
            <span className="font-normal text-mute"> ({fmtBytes(documentos.bytesVigentes) ?? "tamaño sin dato"})</span>
          </>
        ) : (
          "En el almacén"
        )
      }
      descripcion={documentos ? (documentos.proximaExpiracion ? `El primero vence el ${fmtDia(documentos.proximaExpiracion)}` : "Ninguno por vencer") : undefined}
      ayuda={
        <Ayuda titulo="¿Cuánto duran los documentos?">
          Pasan a almacenamiento frío a los 30 días y se borran a los 90. Si alguien financia un contrato con documentos vencidos, se vuelven a bajar en
          la hora siguiente.
        </Ayuda>
      }
    >
      {!documentos ? (
        // El API devuelve null cuando esa consulta no respondió (la atrapa en vez de fallar): se dice, no se pinta un cero.
        <p className="text-meta text-mute">La base no respondió esta parte en la última lectura; vuelve a intentarlo con Actualizar.</p>
      ) : total === 0 ? (
        <p className="text-meta text-mute">No hay documentos vigentes.</p>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-paperDeep" aria-hidden>
            {porFormato.map((f, i) => (
              <span key={f.formato ?? i} className={TINTA[Math.min(i, TINTA.length - 1)]} style={{ width: `${(f.n / total) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-rotulo text-inkSoft">
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
    </Panel>
  );
}

/** Los últimos lotes de ingesta, plegados: los seguidos e iguales (el lote de cada hora, «0 de 0») en una sola fila. */
function HistorialLotes({ lotes }: { lotes: Lote[] }) {
  const grupos = agruparSeguidos(lotes, (l) => [l.tipo, l.estado, l.ok, l.total, l.fallidos, l.error ?? ""].join("|"));
  const columnas: Columna<Lote[]>[] = [
    {
      clave: "lote",
      titulo: "Lote",
      principal: true,
      celda: (g) => (
        <span title={g.length === 1 ? g[0].id : undefined}>
          <span className="block font-medium text-ink">
            {tipoLoteLabel(g[0].tipo)}
            {g.length > 1 ? `, ${g.length} lotes iguales` : ""}
          </span>
          <span className="block text-micro text-mute">
            {g.length > 1 ? `${fmtFechaHora(g[g.length - 1].iniciadoAt ?? g[g.length - 1].finalizadoAt) ?? "sin fecha"} a ` : ""}
            {fmtFechaHora(g[0].iniciadoAt ?? g[0].finalizadoAt) ?? "sin fecha"}
          </span>
        </span>
      ),
    },
    {
      clave: "resultado",
      titulo: "Resultado",
      celda: (g) => (
        <span className="text-rotulo text-inkSoft">
          <span className="font-mono text-ink">{fmtNum(g[0].ok)}</span> de {fmtNum(g[0].total)}
          {g[0].fallidos ? <span className="text-crimsonTexto">, {fmtNum(g[0].fallidos)} fallidos</span> : null}
          {g.length > 1 ? " en cada uno" : null}
        </span>
      ),
    },
    {
      clave: "estado",
      titulo: "Estado",
      celda: (g) => {
        const e = estadoLote(g[0].estado);
        return <Badge tono={e.tono}>{e.label}</Badge>;
      },
    },
    { clave: "cuando", titulo: "Terminó", className: "whitespace-nowrap text-rotulo text-mute", celda: (g) => hace(g[0].finalizadoAt) ?? "sin terminar" },
  ];
  return (
    <Expandable variante="linea" resumen={`Historial de lotes (${fmtNum(lotes.length)} más recientes)`}>
      <DataTable
        etiqueta="Lotes ingeridos"
        columnas={columnas}
        filas={grupos}
        claveFila={(g) => g[0].id}
        apilarHasta="md"
        porPagina={10}
        compactoMovil
        vacio={<EmptyState compacto titulo="Todavía no se ingirió ningún lote" />}
      />
    </Expandable>
  );
}

function TabDocumentos({ cob, pro }: { cob: Consulta<Cobertura>; pro: Consulta<ProgresoDocumentos> }) {
  return (
    <PageSection
      titulo="Documentos del SEACE"
      ayuda={
        <Ayuda titulo="¿Qué documentos se bajan?">
          Sólo los de contratos financiados: la fuente documentos (cada hora) los baja por el relay, porque el SEACE no deja entrar a la nube, y los
          guarda 90 días. «Faltan» y «Fin estimado» cuentan todo lo que el SEACE publica, también lo de contratos que nadie financió.
        </Ayuda>
      }
    >
      <div className="space-y-4">
        <SegunPedido
          q={pro}
          que="el avance de las descargas"
          esqueleto={
            <>
              <SkeletonStats n={4} />
              <SkeletonPanel lineas={3} />
            </>
          }
        >
          {(pr) => <Progreso pr={pr} />}
        </SegunPedido>
        <SegunPedido q={cob} que="el almacén y los lotes" esqueleto={<SkeletonPanel lineas={2} />}>
          {(d) => (
            <>
              <Almacen documentos={d.documentos} porFormato={d.porFormato} />
              <HistorialLotes lotes={d.lotes} />
            </>
          )}
        </SegunPedido>
      </div>
    </PageSection>
  );
}

// ── Pestaña Contratos por mes ────────────────────────────────────────────────

/** Cantidad con su proporción sobre un total y una barra chica; en la fila del celular, sólo el porcentaje y qué es. */
function Proporcion({ a, b, unidad }: { a: number; b: number; unidad: string }) {
  const p = pct(a, b);
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden font-mono lg:inline">{fmtNum(a)}</span>
      <span className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-paperDeep lg:inline-block" aria-hidden>
        <span className="block h-full rounded-full bg-moss" style={{ width: `${p}%` }} />
      </span>
      <span className="text-right font-sans lg:w-10 lg:text-micro lg:text-mute">
        {p} %<Unidad>{unidad}</Unidad>
      </span>
    </span>
  );
}

function TabMeses({ cob }: { cob: Consulta<Cobertura> }) {
  const d = cob.data;
  const meses = (d?.meses ?? []).filter((m) => m.mes);
  const sinMes = (d?.meses ?? []).find((m) => !m.mes);
  const tot = meses.reduce(
    (a, m) => ({ contratos: a.contratos + m.contratos, conRecord: a.conRecord + m.conRecord, conDocs: a.conDocs + m.conDocs, analizados: a.analizados + m.analizados, enCola: a.enCola + m.enCola }),
    { contratos: 0, conRecord: 0, conDocs: 0, analizados: 0, enCola: 0 },
  );

  // En el celular, la fila de cada mes: contratos, expediente, documentos y clasificados; el resto, en escritorio.
  const columnas: Columna<Mes>[] = [
    { clave: "mes", titulo: "Mes de convocatoria", principal: true, celda: (m) => <span className="font-medium text-ink">{nombreMes(m.mes!)}</span> },
    {
      clave: "contratos",
      titulo: "Contratos",
      alinear: "derecha",
      celda: (m) => (
        <>
          {fmtNum(m.contratos)}
          <Unidad>contratos</Unidad>
        </>
      ),
    },
    { clave: "record", titulo: "Expediente completo", alinear: "derecha", celda: (m) => <Proporcion a={m.conRecord} b={m.contratos} unidad="con expediente" /> },
    {
      clave: "docs",
      titulo: "Documentos bajados",
      alinear: "derecha",
      celda: (m) => (
        <span title={`${fmtNum(m.docsVigentes)} de ${fmtNum(m.docsPublicados)} publicados`}>
          <Proporcion a={m.docsVigentes} b={m.docsPublicados} unidad="docs bajados" />
        </span>
      ),
    },
    { clave: "condocs", titulo: "Contratos con documentos", alinear: "derecha", soloEscritorio: true, celda: (m) => fmtNum(m.conDocs) },
    { clave: "clasif", titulo: "Clasificados", alinear: "derecha", celda: (m) => <Proporcion a={m.clasificados} b={m.contratos} unidad="clasificados" /> },
    { clave: "analizados", titulo: "Analizados", alinear: "derecha", soloEscritorio: true, celda: (m) => fmtNum(m.analizados) },
    { clave: "cola", titulo: "En proceso", alinear: "derecha", soloEscritorio: true, celda: (m) => fmtNum(m.enCola) },
  ];

  return (
    <PageSection
      titulo="Cobertura por mes"
      meta={meses.length ? `${fmtNum(tot.contratos)} contratos` : undefined}
      descripcion={d ? `Cifras de la base, actualizadas ${fmtFechaHora(d.generadoAt)}` : undefined}
      ayuda={
        <Ayuda titulo="¿Qué mide cada columna?">
          <span className="block">
            <strong className="font-semibold text-ink">Expediente completo</strong>: bajamos el expediente entero del OECE (partes, adjudicaciones y
            contratos); sin él sólo tenemos el aviso de convocatoria.
          </span>
          <span className="mt-1.5 block">
            <strong className="font-semibold text-ink">Documentos bajados</strong>: los guardados y vigentes frente a los que el SEACE publica para ese mes.
          </span>
          <span className="mt-1.5 block">
            <strong className="font-semibold text-ink">Clasificados</strong>: contratos a los que ya se les asignó tipo y etapa.
          </span>
          <span className="mt-1.5 block">
            <strong className="font-semibold text-ink">En proceso</strong>: financiados en cola, leyéndose o esperando documentos.
          </span>
        </Ayuda>
      }
    >
      <SegunPedido
        q={cob}
        que="la cobertura por mes"
        esqueleto={
          <>
            <SkeletonStats n={4} />
            <SkeletonTabla filas={6} columnas={6} />
          </>
        }
      >
        {() => (
          <>
            {meses.length > 0 && (
              <StatGrid columnas={4}>
                <StatCard etiqueta="Expediente completo" valor={tot.conRecord} tono="ok" pista={`${pct(tot.conRecord, tot.contratos)} % del total`} />
                <StatCard etiqueta="Con documentos" valor={tot.conDocs} tono={tot.conDocs ? "ok" : "warn"} pista={`${pct(tot.conDocs, tot.contratos)} % tiene al menos uno bajado`} />
                <StatCard etiqueta="En proceso" valor={tot.enCola} tono={tot.enCola ? "pending" : "neutral"} pista="financiados en camino" href="/admin/procesamientos" />
                <StatCard etiqueta="Analizados" valor={tot.analizados} tono="ok" pista="con informe de la revisión" />
              </StatGrid>
            )}
            {/* Un año por página: los meses desde 2015 eran una tabla de más de cien filas. */}
            <DataTable
              etiqueta="Cobertura por mes de convocatoria"
              columnas={columnas}
              filas={meses}
              claveFila={(m) => m.mes!}
              apilarHasta="lg"
              anchoMinimo="min-w-[860px]"
              porPagina={12}
              compactoMovil
              vacio={
                <EmptyState
                  compacto
                  titulo="Sin cifras por mes"
                  descripcion="O no hay contratos todavía, o la cuenta no alcanzó a terminar (se corta a los 2 minutos)."
                  accion={
                    <button type="button" onClick={() => void cob.mutate()} className={claseBoton("secundario", "sm")}>
                      <RefreshCw size={12} aria-hidden /> Reintentar
                    </button>
                  }
                />
              }
            />
            {sinMes && sinMes.contratos > 0 && (
              <p className="text-rotulo text-mute">{fmtNum(sinMes.contratos)} contratos no tienen fecha de convocatoria: no entran en esta tabla ni en los totales.</p>
            )}
          </>
        )}
      </SegunPedido>
    </PageSection>
  );
}

// ── Pestaña Fuentes externas ─────────────────────────────────────────────────

function TabExternas({ cob }: { cob: Consulta<Cobertura> }) {
  const d = cob.data;
  return (
    <PageSection
      titulo="Cargas de las fuentes externas"
      meta={d ? `${totalFuentes(d.fuentes ?? [])} fuentes` : undefined}
      ayuda={
        <Ayuda titulo="¿Qué son las fuentes externas?">
          Datos que no vienen del SEACE y se cruzan con cada contrato: visitas, aportes de campaña, autoridades, declaraciones de intereses. Las filas,
          la última carga y los errores salen del registro de cargas (datasets_cargas); un proceso que no anota sus cargas aparece «Sin registro».
        </Ayuda>
      }
    >
      <SegunPedido q={cob} que="las fuentes externas" esqueleto={<SkeletonTabla filas={6} columnas={5} />}>
        {(datos) => <Fuentes fuentes={datos.fuentes ?? []} />}
      </SegunPedido>
    </PageSection>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

function Page() {
  const [tab, setTab] = usePestana(PESTANAS);
  // /cobertura sirve a las tres pestañas (los meses, las fuentes externas, el almacén y los lotes); el avance de las
  // descargas, sólo a Documentos: se pide con esa pestaña abierta y deja de sondearse al salir de ella.
  const cob = useAdmin<Cobertura>("/cobertura", { refreshInterval: 60_000 });
  const pro = useAdmin<ProgresoDocumentos>(tab === "documentos" ? "/cobertura/progreso" : null, { refreshInterval: 60_000 });
  const externasConError = (cob.data?.fuentes ?? []).some((f) => f.cargasConError > 0);

  function refrescar() {
    void cob.mutate();
    if (tab === "documentos") void pro.mutate();
  }

  const pestanas: PestanaPanel<Pestana>[] = [
    { clave: "documentos", etiqueta: "Documentos" },
    { clave: "meses", etiqueta: "Contratos por mes" },
    // El punto rojo avisa que alguna fuente externa tiene cargas con error, sin abrir la pestaña.
    { clave: "externas", etiqueta: "Fuentes externas", conteo: cob.data ? totalFuentes(cob.data.fuentes ?? []) : null, tono: externasConError ? "danger" : undefined },
  ];

  return (
    <AdminShell
      title="Cobertura"
      subtitle={SUBTITULO}
      actions={
        <button type="button" onClick={refrescar} className={claseBoton("secundario")}>
          <RefreshCw size={12} className={cob.isValidating || pro.isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      }
    >
      <Pestanas etiqueta="Secciones de Cobertura" pestanas={pestanas} activa={tab} onCambiar={setTab} />
      <PanelPestana clave={tab}>
        {tab === "documentos" && <TabDocumentos cob={cob} pro={pro} />}
        {tab === "meses" && <TabMeses cob={cob} />}
        {tab === "externas" && <TabExternas cob={cob} />}
      </PanelPestana>
    </AdminShell>
  );
}

export default function CoberturaPage() {
  // usePestana lee la pestaña de la URL (useSearchParams): pide un límite de Suspense; mientras tanto, el panel con su esqueleto.
  return (
    <Suspense
      fallback={
        <AdminShell title="Cobertura" subtitle={SUBTITULO}>
          <SkeletonPanel lineas={4} />
        </AdminShell>
      }
    >
      <Page />
    </Suspense>
  );
}
