"use client";

import { Suspense, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, X } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { DONDE, estadoFuente, type EstadoFuente } from "../cobertura/Fuentes";
import { Ayuda } from "@/components/patrones/Ayuda";
import { useAdmin } from "@/lib/useAdmin";
import { cn } from "@/lib/utils";
import {
  Badge,
  Chip,
  claseBoton,
  DataTable,
  EmptyState,
  ErrorBanner,
  FilterChips,
  KeyValue,
  PageSection,
  Panel,
  PanelPestana,
  Pestanas,
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
  usePestana,
  type Columna,
  type PestanaPanel,
  type Tone,
} from "@/components/admin/ui";

/**
 * Fuentes y procesos: de dónde salen los datos de Vigía y en qué está cada pipeline, para auditarlo sin entrar a
 * Cloudflare. Cada corrida de vigia-scrapers (un Workflow) queda en la bitácora `corridas_fuente` (migración 74): quién
 * la lanzó, con qué parámetros, cuánto tardó y qué devolvió o en qué falló.
 *
 * Una pestaña por bloque (rediseño del 2026-10-30: apilados, con un párrafo encima de cada uno, medían 4.8 pantallas en
 * escritorio y 13.5 en el celular):
 *   - Fuentes: la agenda de cada una y su última corrida. Un clic en la fila lleva a sus corridas.
 *   - Corridas: las últimas 150, filtradas por estado y de a 20; el detalle de la elegida va al costado (abajo en el
 *     celular), con el error entero y lo que devolvió.
 *   - Documentos: lo único que se descarga (los expedientes de los contratos financiados) y sus corridas, con las
 *     seguidas e iguales («0 de 0, Completo» cada hora) juntas en una fila.
 *   - Base de contratos: por año de convocatoria.
 * Lo que explica cada bloque va en su ⓘ; las vistas derivadas, en la línea del pie.
 * Fuente: GET /api/admin/fuentes (caché de 1 min en el API): un solo pedido para las cuatro pestañas.
 */

/** Una fuente del catálogo de la API (lib/catalogoFuentes.ts) con su última corrida y su estado: la misma fila que Cobertura. */
type FilaAgenda = EstadoFuente;
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
    /** De cuándo son las cifras por año (se guardan y se recalculan cada 6 h). */
    calculadoAt?: string | null;
  };
  derivados: { nombre: string; refrescadoAt: string | null; duracionMs: number | null; refrescos: number }[];
  generadoAt: string;
}
type FilaAnio = Datos["base"]["porAnio"][number];

const SUBTITULO = "De dónde salen los datos, cuándo se cargaron y en qué está cada pipeline";

/** Las pestañas, en orden de lectura. Fuera del componente: `usePestana` las usa como dependencia. */
const PESTANAS = ["fuentes", "corridas", "documentos", "base"] as const;
type Pestana = (typeof PESTANAS)[number];

type FiltroCorridas = "todas" | "error" | "corriendo";

const ESTADO: Record<Corrida["estado"], { label: string; tono: Tone }> = {
  ok: { label: "Bien", tono: "ok" },
  error: { label: "Falló", tono: "danger" },
  corriendo: { label: "Corriendo", tono: "pending" },
};

/** Corridas por página: una pantalla y media en escritorio, unas tres en el celular. */
const POR_PAGINA = 20;

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

/** Los pedidos de descarga en palabras: «75 listos de financiados». [singular, plural] de cada estado. */
const ESTADO_PEDIDO: Record<string, [string, string]> = {
  pendiente: ["pendiente", "pendientes"],
  descargando: ["bajando", "bajando"],
  listo: ["listo", "listos"],
  fallido: ["fallido", "fallidos"],
};
const MOTIVO: Record<string, string> = { financiado: "de financiados", admin: "pedidos por el admin", reintento: "de reintentos", cola: "de la cola (ya no se usa)" };

/** «OECE · contratos (OCDS)» → «OECE: contratos (OCDS)»: el API arma los nombres con «·», que el panel no usa de separador. */
const nombreFuente = (s: string) => s.replace(/\s*·\s*/g, ": ");

function EstadoBadge({ e, title }: { e: Corrida["estado"] | undefined; title?: string }) {
  if (!e) return <Badge tono="muted">Sin corridas</Badge>;
  return (
    <Badge tono={ESTADO[e].tono} punto title={title}>
      {ESTADO[e].label}
    </Badge>
  );
}

/** Los parámetros que importan de una corrida, en una línea ("2024-01-01 → 2024-01-31, relleno"). */
function paramsCortos(p: Record<string, unknown> | null | undefined): string {
  if (!p) return "";
  const partes: string[] = [];
  if (p.desde || p.hasta) partes.push(`${p.desde ?? "…"} → ${p.hasta ?? "…"}`);
  if (p.relleno) partes.push("relleno");
  if (p.seco) partes.push("en seco");
  if (p.forzar) partes.push("forzada");
  if (p.paso) partes.push(`paso ${p.paso}`);
  return partes.join(", ");
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
  return out.slice(0, 4).join(", ");
}

function Json({ valor }: { valor: unknown }) {
  return (
    <pre className="max-h-80 overflow-auto rounded-lg bg-paperDeep px-3 py-2 font-mono text-rotulo leading-relaxed text-inkSoft">
      {JSON.stringify(valor, null, 2)}
    </pre>
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

/** Un cero no dice nada en la fila compacta del celular: queda para la tabla de escritorio y el lector de pantalla. */
function CifraFila({ n, unidad }: { n: number; unidad: string }) {
  if (!n) return <span className="sr-only lg:not-sr-only">0</span>;
  return (
    <>
      {fmtNum(n)}
      <Unidad>{unidad}</Unidad>
    </>
  );
}

// ── Pestaña Fuentes ──────────────────────────────────────────────────────────

function TabFuentes({ d, cargando, onFuente }: { d?: Datos; cargando: boolean; onFuente: (fuente: string) => void }) {
  const columnas: Columna<FilaAgenda>[] = [
    {
      clave: "fuente",
      titulo: "Fuente",
      principal: true,
      celda: (a) => (
        <span>
          <span className="block font-medium text-ink">{nombreFuente(a.nombre)}</span>
          <span className="block font-mono text-micro text-mute">
            {a.fuente}
            {a.lanza?.length ? ` → ${a.lanza.join(", ")}` : ""}
          </span>
        </span>
      ),
    },
    {
      clave: "donde",
      titulo: "Dónde y cuándo",
      celda: (a) => (
        <span title={DONDE[a.donde].ayuda} className="inline-flex flex-wrap items-center gap-x-1.5 lg:block">
          <Badge tono={DONDE[a.donde].tono} punto>
            {DONDE[a.donde].label}
          </Badge>
          <span className="whitespace-nowrap text-micro text-mute lg:mt-0.5 lg:block">{a.agenda}</span>
        </span>
      ),
    },
    {
      clave: "estado",
      titulo: "Estado",
      celda: (a) => {
        const e = estadoFuente(a);
        return (
          <span className="inline-flex flex-wrap items-center gap-x-1.5 lg:block" title={e.pista}>
            <Badge tono={e.tono}>{e.label}</Badge>
          </span>
        );
      },
    },
    {
      clave: "ultima",
      titulo: "Última corrida",
      celda: (a) => (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* El error de la última corrida, al pasar el puntero; entero, en sus corridas (clic en la fila). */}
          <EstadoBadge e={a.ultima?.estado} title={a.ultima?.error ?? undefined} />
          {a.ultima?.inicio && (
            <span className="text-rotulo text-mute">
              {hace(a.ultima.inicio)}
              {a.ultima.segundos != null ? `, duró ${duracion(a.ultima.segundos)}` : ""}
            </span>
          )}
        </span>
      ),
    },
    {
      clave: "mes",
      titulo: "30 días",
      alinear: "derecha",
      celda: (a) =>
        a.ultima ? (
          // La columna va en mono (alineada a la derecha): sólo los números; las palabras, en la letra del texto.
          <span className="font-sans text-rotulo">
            <span className="font-mono text-ink">{fmtNum(a.ultima.ok30 ?? 0)}</span> bien
            {a.ultima.error30 ? (
              <span className="text-crimsonTexto">
                , <span className="font-mono">{fmtNum(a.ultima.error30)}</span> fallaron
              </span>
            ) : null}
          </span>
        ) : (
          // Sin corridas ya lo dice la etiqueta de al lado: en la fila del celular la raya sólo ensucia.
          <span className="hidden text-rotulo text-mute lg:inline">—</span>
        ),
    },
    { clave: "que", titulo: "Qué hace", soloEscritorio: true, className: "max-w-md text-rotulo text-inkSoft", celda: (a) => a.que },
  ];

  return (
    <PageSection
      titulo="Agenda de las fuentes"
      meta={d ? `${d.agenda.length} fuentes` : undefined}
      ayuda={
        <Ayuda titulo="¿De dónde sale esta agenda?">
          <span className="block">
            Todas las fuentes de Vigía, con su agenda en hora de Lima: las que corren solas en Cloudflare (vigia-scrapers) y las que se corren a mano
            desde tu PC. La última corrida y cuántas salieron bien en 30 días salen de la bitácora corridas_fuente; las de tu PC sólo anotan sus
            cargas (datasets_cargas).
          </span>
          <span className="mt-1.5 block">Toca una fuente para ver sus corridas. Qué hace cada una y cómo correrla: SCRAPERS.md, en la raíz del repo.</span>
        </Ayuda>
      }
    >
      {!d ? (
        cargando && <SkeletonTabla filas={8} columnas={5} />
      ) : (
        <DataTable
          etiqueta="Fuentes de datos y su última corrida"
          columnas={columnas}
          filas={d.agenda}
          claveFila={(a) => a.fuente}
          onFila={(a) => onFuente(a.fuente)}
          apilarHasta="lg"
          compactoMovil
        />
      )}
    </PageSection>
  );
}

// ── Pestaña Corridas ─────────────────────────────────────────────────────────

function DetalleCorrida({ c, onCerrar }: { c: Corrida; onCerrar: () => void }) {
  return (
    <Panel
      titulo={c.fuente}
      acciones={
        <>
          <EstadoBadge e={c.estado} />
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar detalle"
            className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink"
          >
            <X size={16} aria-hidden />
          </button>
        </>
      }
    >
      <KeyValue
        items={[
          { etiqueta: "Empezó", valor: fmtFechaHora(c.inicio) },
          { etiqueta: "Terminó", valor: fmtFechaHora(c.fin) },
          { etiqueta: "Duración", valor: duracion(c.segundos) ?? (c.estado === "corriendo" ? `en curso, empezó ${hace(c.inicio)}` : null) },
          { etiqueta: "Origen", valor: c.origen === "manual" ? "A mano (POST /correr)" : c.origen },
          { etiqueta: "Parámetros", valor: paramsCortos(c.params) || "los de su agenda", completo: true },
          { etiqueta: "Instancia", valor: c.instancia, mono: true, completo: true },
        ]}
      />
      {c.error && <p className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-crimson/10 px-3 py-2 text-meta text-crimsonTexto">{c.error}</p>}
      {c.resumen != null && (
        <div className="mt-3">
          <p className="mb-1 text-micro font-medium text-mute">Lo que devolvió</p>
          <Json valor={c.resumen} />
        </div>
      )}
    </Panel>
  );
}

function TabCorridas({ d, cargando, fuente, onQuitarFuente }: { d?: Datos; cargando: boolean; fuente: string | null; onQuitarFuente: () => void }) {
  const [filtro, setFiltro] = useState<FiltroCorridas>("todas");
  const [elegida, setElegida] = useState<string | null>(null);
  const detalleRef = useRef<HTMLElement>(null);

  const todas = d?.corridas ?? [];
  const deAgenda = fuente ? d?.agenda.find((a) => a.fuente === fuente) ?? null : null;
  // La fuente elegida en la pestaña Fuentes, con las que lanza (MEF presupuesto → su detalle y la carga del gasto).
  const deLaFuente = fuente ? todas.filter((c) => c.fuente === fuente || !!deAgenda?.lanza?.includes(c.fuente)) : todas;
  const fallaron = deLaFuente.filter((c) => c.estado === "error").length;
  const corriendo = deLaFuente.filter((c) => c.estado === "corriendo").length;
  const filas = deLaFuente.filter((c) => filtro === "todas" || c.estado === filtro);
  const detalle = todas.find((c) => c.instancia === elegida) ?? null;
  const fallaronTodas = todas.filter((c) => c.estado === "error").length;

  function elegir(c: Corrida) {
    const nueva = c.instancia === elegida ? null : c.instancia;
    setElegida(nueva);
    // Por debajo de xl el detalle va después de la lista: se lleva la vista hasta él.
    if (nueva && window.matchMedia("(max-width: 1279px)").matches) setTimeout(() => detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  // El estado junto al nombre: se lee primero, y en la fila del celular los parámetros vacíos no dejan un hueco al comienzo.
  const columnas: Columna<Corrida>[] = [
    {
      clave: "corrida",
      titulo: "Corrida",
      principal: true,
      celda: (c) => (
        <span>
          <span className="block font-medium text-ink">{c.fuente}</span>
          <span className="block text-micro text-mute">
            {fmtFechaHora(c.inicio)}, {c.origen === "manual" ? "a mano" : c.origen ?? "sin origen"}
          </span>
        </span>
      ),
    },
    { clave: "estado", titulo: "Estado", celda: (c) => <EstadoBadge e={c.estado} /> },
    {
      clave: "params",
      titulo: "Parámetros",
      className: "text-rotulo text-inkSoft",
      celda: (c) => paramsCortos(c.params) || <span className="hidden text-mute lg:inline">—</span>,
    },
    {
      clave: "dur",
      titulo: "Duración",
      alinear: "derecha",
      className: "whitespace-nowrap text-rotulo",
      celda: (c) => duracion(c.segundos) ?? (c.estado === "corriendo" ? hace(c.inicio) : "—"),
    },
    {
      clave: "res",
      titulo: "Resultado",
      // Con el detalle abierto al costado (xl), el resultado se lee ahí: la tabla suelta la columna y entra en lo que queda.
      className: cn("max-w-sm text-rotulo text-inkSoft", detalle && "xl:hidden"),
      celda: (c) =>
        c.error ? (
          // El error en dos líneas como mucho; entero al pasar el puntero o en el detalle (clic en la fila).
          <span className="line-clamp-2 break-words text-crimsonTexto" title={c.error}>
            {c.error}
          </span>
        ) : (
          // Lo que devolvió una corrida que salió bien no cabe en la fila del celular: se ve en el detalle.
          <span className="hidden lg:inline">{resumenCorto(c.resumen) || "—"}</span>
        ),
    },
  ];

  return (
    <PageSection
      titulo="Últimas corridas"
      meta={d && !d.sinBitacora ? `${fmtNum(todas.length)} corridas${fallaronTodas ? `, ${fmtNum(fallaronTodas)} fallaron` : ""}` : undefined}
      ayuda={
        <Ayuda titulo="¿Qué es una corrida?">
          Cada vez que corre una fuente de vigia-scrapers, por su agenda o a mano, queda en la bitácora corridas_fuente: quién la lanzó, con qué
          parámetros, cuánto tardó y qué devolvió o en qué falló. Aquí están las últimas 150; toca una para ver el detalle.
        </Ayuda>
      }
    >
      {!d ? (
        cargando && <SkeletonTabla filas={10} columnas={5} />
      ) : d.sinBitacora ? (
        <EmptyState titulo="Sin bitácora" descripcion="La base todavía no tiene corridas_fuente (migración 74)." />
      ) : (
        <div className="space-y-3">
          {/* Una sola fila que se desliza de costado en el celular: nunca dos o tres renglones de chips. */}
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {fuente && (
              <Chip activo onClick={onQuitarFuente} title="Quitar el filtro de fuente">
                {deAgenda ? nombreFuente(deAgenda.nombre) : fuente}
                <X size={12} aria-hidden />
              </Chip>
            )}
            <FilterChips
              etiqueta="Estado de la corrida"
              className="shrink-0 flex-nowrap"
              valor={filtro}
              onCambiar={setFiltro}
              opciones={[
                { valor: "todas", etiqueta: "Todas", cuenta: deLaFuente.length },
                { valor: "error", etiqueta: "Fallaron", cuenta: fallaron, tono: "danger" },
                { valor: "corriendo", etiqueta: "Corriendo", cuenta: corriendo, tono: "pending" },
              ]}
            />
          </div>
          <div className={detalle ? "grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]" : undefined}>
            <DataTable
              etiqueta="Corridas de vigia-scrapers"
              columnas={columnas}
              filas={filas}
              claveFila={(c) => c.instancia}
              onFila={elegir}
              filaActiva={(c) => c.instancia === elegida}
              apilarHasta="lg"
              porPagina={POR_PAGINA}
              compactoMovil
              vacio={<EmptyState compacto titulo="Ninguna corrida con ese filtro" />}
            />
            {detalle && (
              <aside ref={detalleRef} aria-label="Detalle de la corrida" className="scroll-mt-28 xl:sticky xl:top-24">
                <DetalleCorrida key={detalle.instancia} c={detalle} onCerrar={() => setElegida(null)} />
              </aside>
            )}
          </div>
        </div>
      )}
    </PageSection>
  );
}

// ── Pestaña Documentos ───────────────────────────────────────────────────────

function TabDocumentos({ d, cargando }: { d?: Datos; cargando: boolean }) {
  // Las corridas de cada hora suelen ser iguales («0 de 0, Completo»): las seguidas e idénticas van en una fila.
  const grupos = useMemo(
    () => agruparSeguidos(d?.documentos.lotes ?? [], (l) => [l.estado, l.ok, l.total, l.fallidos, l.error ?? ""].join("|")),
    [d],
  );
  const pedidos = d?.documentos.pedidos ?? [];
  const almacen = d?.documentos.almacen ?? null;
  const contar = (estado: string) => pedidos.filter((p) => p.estado === estado).reduce((s, p) => s + p.n, 0);
  const esperan = contar("pendiente") + contar("descargando");
  const fallidos = contar("fallido");

  const colLotes: Columna<Lote[]>[] = [
    {
      clave: "lote",
      titulo: "Corrida de documentos",
      principal: true,
      celda: (g) =>
        g.length === 1 ? (
          <span className="text-rotulo text-ink">{fmtFechaHora(g[0].iniciadoAt) ?? g[0].id}</span>
        ) : (
          <span>
            <span className="block text-rotulo font-medium text-ink">{g.length} corridas iguales</span>
            <span className="block text-micro text-mute">
              {fmtFechaHora(g[g.length - 1].iniciadoAt) ?? "sin fecha"} a {fmtFechaHora(g[0].iniciadoAt) ?? "sin fecha"}
            </span>
          </span>
        ),
    },
    {
      clave: "res",
      titulo: "Contratos",
      celda: (g) => (
        <span className="text-rotulo text-inkSoft">
          <span className="font-mono text-ink">{fmtNum(g[0].ok)}</span> de {fmtNum(g[0].total)}
          {g[0].fallidos ? <span className="text-crimsonTexto">, {fmtNum(g[0].fallidos)} sin bajar</span> : null}
          {g.length > 1 ? " en cada una" : null}
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
    { clave: "err", titulo: "Detalle", soloEscritorio: true, className: "text-rotulo text-mute", celda: (g) => g[0].error ?? "—" },
  ];

  return (
    <PageSection
      titulo="Documentos de los financiados"
      ayuda={
        <Ayuda titulo="¿Qué se descarga?">
          Sólo los expedientes (bases, actas, contratos) de los contratos que alguien financió: la fuente documentos corre cada hora y los guarda 90
          días. De la base se guarda el registro de cada contrato; el expediente, recién al financiarse.
        </Ayuda>
      }
    >
      {!d ? (
        cargando && (
          <div className="space-y-3">
            <SkeletonStats n={4} />
            <SkeletonTabla filas={4} columnas={4} />
          </div>
        )
      ) : (
        <div className="space-y-3">
          <StatGrid columnas={4}>
            <StatCard
              etiqueta="Documentos en el almacén"
              valor={almacen ? almacen.vigentes : null}
              pista={`${fmtBytes(almacen?.bytes) ?? "tamaño sin dato"}, vencen a los 90 días`}
            />
            <StatCard etiqueta="Contratos con documentos" valor={almacen ? almacen.contratos : null} tono="ok" />
            <StatCard etiqueta="Esperan su descarga" valor={esperan} tono={esperan ? "pending" : "neutral"} pista="pedidos de financiados abiertos" />
            <StatCard etiqueta="No se pudieron bajar" valor={fallidos} tono={fallidos ? "danger" : "neutral"} pista="tras 3 intentos" href="/admin/procesamientos" />
          </StatGrid>
          {pedidos.length > 0 && (
            <ul aria-label="Pedidos de descarga" className="flex flex-wrap gap-x-4 gap-y-1 text-rotulo text-inkSoft">
              <li aria-hidden className="font-medium text-mute">
                Pedidos de descarga:
              </li>
              {pedidos.map((p) => {
                const [uno, varios] = ESTADO_PEDIDO[p.estado] ?? [p.estado, p.estado];
                return (
                  <li key={`${p.estado}-${p.motivo}`}>
                    <span className="font-mono text-ink">{fmtNum(p.n)}</span> {p.n === 1 ? uno : varios} {MOTIVO[p.motivo] ?? p.motivo}
                  </li>
                );
              })}
            </ul>
          )}
          <DataTable
            etiqueta="Últimas corridas de documentos"
            columnas={colLotes}
            filas={grupos}
            claveFila={(g) => g[0].id}
            apilarHasta="md"
            porPagina={10}
            compactoMovil
            vacio={<EmptyState compacto titulo="Todavía no corrió" />}
          />
        </div>
      )}
    </PageSection>
  );
}

// ── Pestaña Base de contratos ────────────────────────────────────────────────

function TabBase({ d, cargando }: { d?: Datos; cargando: boolean }) {
  const procesosPorAnio = new Map((d?.base.procesos ?? []).map((p) => [p.anio, p]));
  const anios = (d?.base.porAnio ?? []).filter((a) => a.anio != null);
  const tot = anios.reduce(
    (s, a) => ({ contratos: s.contratos + a.contratos, ganador: s.ganador + (a.conGanador ?? 0) }),
    { contratos: 0, ganador: 0 },
  );

  const columnas: Columna<FilaAnio>[] = [
    { clave: "anio", titulo: "Año de convocatoria", principal: true, celda: (a) => <span className="font-medium text-ink">{a.anio}</span> },
    {
      clave: "contratos",
      titulo: "Contratos en la base",
      alinear: "derecha",
      celda: (a) => (
        <>
          {fmtNum(a.contratos)}
          <Unidad>contratos</Unidad>
        </>
      ),
    },
    {
      clave: "ganador",
      titulo: "Con ganador",
      alinear: "derecha",
      celda: (a) => (
        <span className="font-mono">
          {fmtNum(a.conGanador ?? 0)} <span className="font-sans text-micro text-mute">({pct(a.conGanador ?? 0, a.contratos)} %)</span>
          <Unidad>con ganador</Unidad>
        </span>
      ),
    },
    {
      clave: "procesos",
      titulo: "Procesos adjudicados",
      alinear: "derecha",
      celda: (a) => {
        const p = procesosPorAnio.get(a.anio!);
        if (!p) return <span className="hidden lg:inline">—</span>;
        return (
          <span title={`según ${p.fuente}`}>
            {fmtNum(p.procesos)}
            <Unidad>adjudicados</Unidad> <span className="text-micro text-mute">{p.fuente}</span>
          </span>
        );
      },
    },
    { clave: "cola", titulo: "En la cola", alinear: "derecha", celda: (a) => <CifraFila n={a.enCola} unidad="en la cola" /> },
    { clave: "leidos", titulo: "Leídos", alinear: "derecha", celda: (a) => <CifraFila n={a.leidos} unidad="leídos" /> },
  ];

  return (
    <PageSection
      titulo="Contratos por año"
      meta={d ? `${fmtNum(tot.contratos)} contratos` : undefined}
      descripcion={d?.base.calculadoAt ? `Cifras calculadas ${hace(d.base.calculadoAt)}` : undefined}
      ayuda={
        <Ayuda titulo="¿De dónde salen estas cifras?">
          Los contratos del OECE desde 2015 (el registro con su ganador), los procesos adjudicados por año (CONOSCE desde 2018, OCDS antes) y lo que entra
          a la cola de lectura. Contarlos recorre cientos de miles de filas, así que las cifras se guardan y se recalculan solas cada 6 horas.
        </Ayuda>
      }
    >
      {!d ? (
        cargando && (
          <div className="space-y-3">
            <SkeletonStats n={4} />
            <SkeletonTabla filas={8} columnas={6} />
          </div>
        )
      ) : (
        <div className="space-y-3">
          <StatGrid columnas={4}>
            <StatCard etiqueta="Contratos en la base" valor={tot.contratos} pista="desde 2015" />
            <StatCard etiqueta="Con ganador" valor={tot.ganador} tono="ok" pista={`${pct(tot.ganador, tot.contratos)} % del total`} />
            <StatCard etiqueta="Cola financiable" valor={d.base.cola?.financiable ?? null} tono="pending" pista="esperan quien financie su lectura" />
            <StatCard etiqueta="La cola empieza en" valor={d.base.cola?.desde ?? "todas las fechas"} pista="se cambia en Clasificación" href="/admin/clasificacion" />
          </StatGrid>
          <DataTable
            etiqueta="Contratos y procesos por año"
            columnas={columnas}
            filas={anios}
            claveFila={(a) => String(a.anio)}
            apilarHasta="lg"
            porPagina={15}
            compactoMovil
          />
        </div>
      )}
    </PageSection>
  );
}

// ── Pie ──────────────────────────────────────────────────────────────────────

/** Una línea al pie: cuándo se leyó, las vistas derivadas (el detalle de cada una en el ⓘ) y dónde ver las fuentes externas. */
function Pie({ d }: { d: Datos }) {
  const ultimo = d.derivados.reduce<string | null>(
    (max, v) => (v.refrescadoAt && (!max || new Date(v.refrescadoAt).getTime() > new Date(max).getTime()) ? v.refrescadoAt : max),
    null,
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-rotulo text-mute">
      <span>Actualizado {fmtFechaHora(d.generadoAt)}</span>
      {d.derivados.length > 0 && (
        <span className="inline-flex items-center gap-0.5">
          {ultimo ? `Vistas derivadas refrescadas ${hace(ultimo)}` : "Vistas derivadas sin refrescar"}
          <Ayuda titulo="¿Qué son las vistas derivadas?">
            <span className="block">Las vistas del mapa, el financiamiento y los contratos se refrescan solas cada 10 minutos cuando hay cambios.</span>
            {d.derivados.map((v) => (
              <span key={v.nombre} className="mt-1.5 block">
                <strong className="font-semibold text-ink">{NOMBRE_DERIVADO[v.nombre] ?? v.nombre}</strong>: {hace(v.refrescadoAt) ?? "nunca"}
                {v.duracionMs != null ? `, ${(v.duracionMs / 1000).toLocaleString("es-PE", { maximumFractionDigits: 1 })} s` : ""}, {fmtNum(v.refrescos)}{" "}
                refrescos
              </span>
            ))}
          </Ayuda>
        </span>
      )}
      <Link href="/admin/cobertura?tab=externas" className="underline underline-offset-2 hover:text-ink">
        Cargas de las fuentes externas, en Cobertura
      </Link>
    </div>
  );
}

// ── Página ───────────────────────────────────────────────────────────────────

function Page() {
  const [tab, setTab] = usePestana(PESTANAS);
  const q = useAdmin<Datos>("/fuentes", { refreshInterval: 60_000 });
  const d = q.data;
  // La fuente elegida en la pestaña Fuentes filtra la de Corridas: vive acá para sobrevivir al cambio de pestaña.
  const [fuente, setFuente] = useState<string | null>(null);
  const fallaron = (d?.corridas ?? []).filter((c) => c.estado === "error").length;
  const secciones = useRef<HTMLDivElement>(null);

  function verCorridas(f: string) {
    setFuente(f);
    setTab("corridas");
    // Desde una fila de abajo, las corridas empezarían fuera de la vista: se sube hasta las pestañas.
    requestAnimationFrame(() => {
      const el = secciones.current;
      if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }

  const pestanas: PestanaPanel<Pestana>[] = [
    { clave: "fuentes", etiqueta: "Fuentes", conteo: d ? d.agenda.length : null },
    // El punto rojo avisa que entre las últimas corridas hay fallas, sin abrir la pestaña.
    { clave: "corridas", etiqueta: "Corridas", conteo: d && !d.sinBitacora ? d.corridas.length : null, tono: fallaron ? "danger" : undefined },
    { clave: "documentos", etiqueta: "Documentos" },
    { clave: "base", etiqueta: "Base de contratos" },
  ];

  return (
    <AdminShell
      title="Fuentes y procesos"
      subtitle={SUBTITULO}
      actions={
        <button type="button" onClick={() => q.mutate()} className={claseBoton("secundario")}>
          <RefreshCw size={12} className={q.isValidating ? "animate-spin" : ""} aria-hidden /> Actualizar
        </button>
      }
    >
      <div className="space-y-4">
        <ErrorBanner error={q.error} titulo="No se pudo leer el estado de las fuentes" onReintentar={() => q.mutate()} />
        <div ref={secciones} className="scroll-mt-24">
          <Pestanas etiqueta="Secciones de Fuentes y procesos" pestanas={pestanas} activa={tab} onCambiar={setTab} />
          <PanelPestana clave={tab}>
            {tab === "fuentes" && <TabFuentes d={d} cargando={q.isLoading} onFuente={verCorridas} />}
            {tab === "corridas" && <TabCorridas d={d} cargando={q.isLoading} fuente={fuente} onQuitarFuente={() => setFuente(null)} />}
            {tab === "documentos" && <TabDocumentos d={d} cargando={q.isLoading} />}
            {tab === "base" && <TabBase d={d} cargando={q.isLoading} />}
          </PanelPestana>
        </div>
        {d && <Pie d={d} />}
      </div>
    </AdminShell>
  );
}

export default function FuentesPage() {
  // usePestana lee la pestaña de la URL (useSearchParams): pide un límite de Suspense; mientras tanto, el panel con su esqueleto.
  return (
    <Suspense
      fallback={
        <AdminShell title="Fuentes y procesos" subtitle={SUBTITULO}>
          <SkeletonTabla filas={8} columnas={5} />
        </AdminShell>
      }
    >
      <Page />
    </Suspense>
  );
}
