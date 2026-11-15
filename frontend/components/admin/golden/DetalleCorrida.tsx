"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Aviso, Badge, DataTable, EmptyState, Expandable, FilterChips, Panel, SinDato, SkeletonPanel, StatCard, StatGrid, claseBoton, plural, type Columna, type Tone } from "@/components/admin/ui";
import { Ayuda } from "@/components/patrones";
import { useAdmin } from "@/lib/useAdmin";
import { cn } from "@/lib/utils";
import { CitasLegales, MetricasRecuperacion } from "./Conjuntos";
import { ErrorGolden } from "./comunes";
import {
  QUE_MIDE,
  diferencia,
  fmtEjecutada,
  fmtF1,
  fmtPct,
  fmtSeg,
  fmtUsd,
  nombreRegimen,
  nombreRegla,
  type CitaLegal,
  type Esperado,
  type QueMide,
  type RespuestaCorrida,
  type Resultado,
} from "./tipos";

/**
 * El detalle de una corrida (`?corrida=<id>`): sus cifras frente a la corrida anterior, en qué regla acierta y en cuál
 * falla, y caso por caso (primero los que fallan) lo ESPERADO por la referencia frente a lo EMITIDO por el agente. Es
 * la pantalla para responder «¿esta imagen es mejor o peor que la anterior, en qué regla y en qué contrato?».
 */
export function DetalleCorrida({ id, onVolver }: { id: string; onVolver: () => void }) {
  const { data, error, isLoading, mutate } = useAdmin<RespuestaCorrida>(`/golden/corridas/${encodeURIComponent(id)}`);
  const volver = (
    <button type="button" onClick={onVolver} className={claseBoton("secundario")}>
      <ArrowLeft size={14} aria-hidden /> Volver a las corridas
    </button>
  );
  if (error)
    return (
      <div className="space-y-3">
        {volver}
        <ErrorGolden error={error} titulo="No se pudo leer la corrida" onReintentar={() => mutate()} />
      </div>
    );
  if (!data)
    return (
      <div className="space-y-3">
        {volver}
        {isLoading ? <SkeletonPanel lineas={8} /> : <EmptyState titulo="La corrida no llegó" descripcion="Vuelve a la lista y ábrela otra vez." />}
      </div>
    );

  const c = data.corrida;
  const ant = data.anterior;
  const que = QUE_MIDE[c.queMide] ?? QUE_MIDE.banderas;
  const contra = ant ? `${ant.imagen ?? "la corrida anterior"}${ant.ejecutada ? `, del ${fmtEjecutada(ant.ejecutada)}` : ""}` : null;
  const comparar = (ahora: number | null, antes: number | null | undefined, como: "f1" | "pct", escribir: (n: number | null | undefined) => string | null) => {
    const d = diferencia(ahora, antes, como);
    if (!ant) return { pista: "Sin corrida anterior con qué comparar", tono: "neutral" as Tone };
    if (!d) return { pista: undefined, tono: "neutral" as Tone };
    return { pista: d.texto === "igual" ? `Igual que antes (${escribir(antes)})` : `${d.texto} frente a ${escribir(antes)} de antes`, tono: d.tono };
  };
  const f1 = comparar(c.f1, ant?.f1, "f1", fmtF1);
  const precision = comparar(c.precision, ant?.precision, "pct", fmtPct);
  const exhaustividad = comparar(c.exhaustividad, ant?.exhaustividad, "pct", fmtPct);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {volver}
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-meta text-inkSoft">
          <span className="font-semibold text-ink">{c.conjuntoNombre ?? c.conjunto}</span>
          <Badge tono="brand">{que.nombre}</Badge>
          <span className="break-all font-mono text-ink">{c.imagen ?? "Sin imagen"}</span>
          {c.variante && <span>variante {c.variante}</span>}
          <span>{fmtEjecutada(c.ejecutada) ?? "Sin fecha"}</span>
        </p>
      </div>

      {contra && (
        <p className="text-rotulo text-mute">
          Se compara con <span className="font-mono text-inkSoft">{contra}</span>.
        </p>
      )}

      <StatGrid columnas={3}>
        <StatCard etiqueta={c.queMide === "recuperacion" ? "MRR" : "F1"} valor={fmtF1(c.f1)} pista={f1.pista} tono={f1.tono} />
        {c.queMide !== "recuperacion" && <StatCard etiqueta="Precisión" valor={fmtPct(c.precision)} pista={precision.pista} tono={precision.tono} />}
        <StatCard
          etiqueta={c.queMide === "recuperacion" ? "Acierto en los 8 primeros" : "Exhaustividad"}
          valor={fmtPct(c.exhaustividad)}
          pista={exhaustividad.pista}
          tono={exhaustividad.tono}
        />
        <StatCard
          etiqueta={que.casos === "preguntas" ? "Preguntas" : "Contratos"}
          valor={c.contratos}
          pista={c.errores ? `${plural(c.errores, "corte", "cortes")} (errores)` : "Sin cortes"}
          tono={c.errores ? "danger" : "neutral"}
        />
        <StatCard etiqueta="Costo medio" valor={fmtUsd(c.usdMedio)} pista={`por ${que.caso}`} />
        <StatCard etiqueta="Tiempo medio" valor={fmtSeg(c.segundosMedio)} pista={`por ${que.caso}`} />
      </StatGrid>

      {c.nota && <Aviso tono="neutral" titulo="Nota de la corrida">{c.nota}</Aviso>}

      {c.queMide === "citas_legales" && (
        <Panel titulo="Citas legales de la corrida" descripcion="Qué parte de las normas que citó el agente existe y rige para la fecha del contrato.">
          <div className="[&>div]:border-t-0 [&>div]:pt-0">
            <CitasLegales m={c.metricas} />
          </div>
        </Panel>
      )}
      {c.queMide === "recuperacion" && (
        <Panel titulo="Medidas de recuperación">
          <div className="[&>div]:border-t-0 [&>div]:pt-0">
            <MetricasRecuperacion m={c.metricas} />
          </div>
        </Panel>
      )}

      <PorRegla porRegla={c.porRegla} />
      <Resultados resultados={data.resultados ?? []} queMide={c.queMide} />
    </div>
  );
}

// ─── Por regla ───────────────────────────────────────────────────────────────────

interface FilaRegla {
  regla: string;
  aciertos: number;
  falsas: number;
  omisiones: number;
}

function PorRegla({ porRegla }: { porRegla: Record<string, [number, number, number]> | null | undefined }) {
  const filas = useMemo<FilaRegla[]>(
    () =>
      Object.entries(porRegla ?? {})
        .map(([regla, v]) => ({ regla, aciertos: v?.[0] ?? 0, falsas: v?.[1] ?? 0, omisiones: v?.[2] ?? 0 }))
        // Primero las que más fallan; a igual falla, la que menos acierta.
        .sort((a, b) => b.falsas + b.omisiones - (a.falsas + a.omisiones) || a.aciertos - b.aciertos || a.regla.localeCompare(b.regla)),
    [porRegla],
  );
  if (!filas.length) return null;
  const cifra = (n: number, tono: string) => (n ? <span className={cn("font-semibold", tono)}>{n.toLocaleString("es-PE")}</span> : <span className="text-mute">0</span>);
  const columnas: Columna<FilaRegla>[] = [
    {
      clave: "regla",
      titulo: "Regla",
      principal: true,
      celda: (f) => (
        <span className="block min-w-0">
          <span className="block text-dato font-medium text-ink">{nombreRegla(f.regla)}</span>
          <span className="block break-all font-mono text-rotulo text-mute">{f.regla}</span>
        </span>
      ),
    },
    { clave: "aciertos", titulo: "Aciertos", alinear: "derecha", celda: (f) => cifra(f.aciertos, "text-mossTexto") },
    { clave: "falsas", titulo: "Falsas alarmas", alinear: "derecha", celda: (f) => cifra(f.falsas, "text-crimsonTexto") },
    { clave: "omisiones", titulo: "Omisiones", alinear: "derecha", celda: (f) => cifra(f.omisiones, "text-amberTexto") },
  ];
  return (
    <Panel
      titulo="Por regla"
      descripcion="Ordenada por las que más fallan."
      sinRelleno
      ayuda={
        <Ayuda titulo="¿Qué cuenta cada columna?">
          <span className="block">
            <b>Acierto</b>: la referencia dice que la regla se dispara y el agente la emitió. <b>Falsa alarma</b>: el agente la
            emitió y la referencia dice que no. <b>Omisión</b>: debía dispararse y el agente no la emitió.
          </span>
        </Ayuda>
      }
    >
      <DataTable columnas={columnas} filas={filas} claveFila={(f) => f.regla} etiqueta="Aciertos, falsas alarmas y omisiones por regla" porPagina={25} className="rounded-none border-0" />
    </Panel>
  );
}

// ─── Caso por caso ───────────────────────────────────────────────────────────────

type Filtro = "todos" | "fallan" | "bien";

const falla = (r: Resultado) => r.estado === "error" || (r.falsasAlarmas?.length ?? 0) + (r.omisiones?.length ?? 0) > 0;
const peso = (r: Resultado) => (r.estado === "error" ? 1000 : 0) + (r.falsasAlarmas?.length ?? 0) + (r.omisiones?.length ?? 0);

function Resultados({ resultados, queMide }: { resultados: Resultado[]; queMide: QueMide }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const que = QUE_MIDE[queMide] ?? QUE_MIDE.banderas;
  const orden = useMemo(() => [...resultados].sort((a, b) => peso(b) - peso(a) || a.caso.localeCompare(b.caso)), [resultados]);
  const conFalla = orden.filter(falla).length;
  const vistos = filtro === "todos" ? orden : orden.filter((r) => (filtro === "fallan" ? falla(r) : !falla(r)));
  return (
    <Panel
      titulo={que.casos === "preguntas" ? "Pregunta por pregunta" : "Contrato por contrato"}
      descripcion="Primero los que fallan. Abre uno para ver lo esperado frente a lo emitido."
      sinRelleno
      acciones={
        <FilterChips<Filtro>
          etiqueta="Qué casos ver"
          valor={filtro}
          onCambiar={setFiltro}
          opciones={[
            { valor: "todos", etiqueta: "Todos", cuenta: orden.length },
            { valor: "fallan", etiqueta: "Con fallas", cuenta: conFalla, tono: conFalla ? "danger" : undefined },
            { valor: "bien", etiqueta: "Sin fallas", cuenta: orden.length - conFalla },
          ]}
        />
      }
    >
      {vistos.length === 0 ? (
        <EmptyState compacto titulo={orden.length ? "Ningún caso con este filtro" : "La corrida no trae resultados por caso"} />
      ) : (
        <ul className="divide-y divide-line">
          {vistos.map((r) => (
            <li key={r.caso} className="px-4 py-3 sm:px-5">
              <FilaResultado r={r} queMide={queMide} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function FilaResultado({ r, queMide }: { r: Resultado; queMide: QueMide }) {
  const esContrato = queMide !== "recuperacion";
  const fallas = [...(r.falsasAlarmas ?? []).map((regla) => ({ regla, tipo: "falsa" as const })), ...(r.omisiones ?? []).map((regla) => ({ regla, tipo: "omision" as const }))];
  const legal = r.detalle?.banderas_legales?.length || r.detalle?.citas?.length;
  const hayDetalle = fallas.length > 0 || !!legal || (r.aciertos?.length ?? 0) > 0;
  if (!esContrato) return <FilaPregunta r={r} />;
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {esContrato ? (
          <Link
            href={`/app/contratos/${encodeURIComponent(r.caso)}`}
            target="_blank"
            className="inline-flex items-center gap-1 font-mono text-meta font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate"
          >
            {r.caso} <ExternalLink size={12} aria-hidden />
            <span className="sr-only">(se abre en otra pestaña)</span>
          </Link>
        ) : (
          <span className="font-mono text-meta font-semibold text-ink">{r.caso}</span>
        )}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-rotulo text-mute">
          {r.fecha && <span>{fmtEjecutada(r.fecha)}</span>}
          {nombreRegimen(r.regimen) && <span>{nombreRegimen(r.regimen)}</span>}
          {r.perfil && <span>perfil {r.perfil}</span>}
          {fmtSeg(r.segundos) && <span className="font-mono tabular-nums">{fmtSeg(r.segundos)}</span>}
          {fmtUsd(r.usd) && <span className="font-mono tabular-nums">{fmtUsd(r.usd)}</span>}
        </span>
      </div>
      {r.titulo && <p className="text-dato leading-snug text-ink text-pretty">{r.titulo}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {r.estado === "error" && (
          <Badge tono="danger" punto>
            Se cortó (error)
          </Badge>
        )}
        {(r.aciertos?.length ?? 0) > 0 && (
          <Badge tono="ok" title={r.aciertos.map(nombreRegla).join(", ")}>
            {plural(r.aciertos.length, "acierto", "aciertos")}
          </Badge>
        )}
        {(r.falsasAlarmas ?? []).map((regla) => (
          <Badge key={`f-${regla}`} tono="danger" title="Falsa alarma: la emitió y la referencia dice que no" className="max-w-full whitespace-normal">
            Falsa alarma: {nombreRegla(regla)}
          </Badge>
        ))}
        {(r.omisiones ?? []).map((regla) => (
          <Badge key={`o-${regla}`} tono="warn" title="Omisión: debía dispararse y no la emitió" className="max-w-full whitespace-normal">
            Omisión: {nombreRegla(regla)}
          </Badge>
        ))}
        {r.estado !== "error" && !fallas.length && !(r.aciertos?.length ?? 0) && <Badge tono="muted">Nada que marcar, y no marcó nada</Badge>}
      </div>
      {hayDetalle && (
        <Expandable variante="linea" resumen={fallas.length ? "Ver lo esperado frente a lo emitido" : "Ver el detalle"}>
          <div className="space-y-3">
            {fallas.map((f) => (
              <EsperadoEmitido key={`${f.tipo}-${f.regla}`} regla={f.regla} tipo={f.tipo} esperado={r.esperado?.[f.regla]} emitido={r.detalle?.emitidas?.[f.regla]} />
            ))}
            {(r.aciertos?.length ?? 0) > 0 && (
              <p className="text-meta leading-relaxed text-inkSoft">
                <span className="font-semibold text-ink">Acertó en:</span> {r.aciertos.map(nombreRegla).join(", ")}.
              </p>
            )}
            {legal ? <DetalleLegal r={r} /> : null}
          </div>
        </Expandable>
      )}
    </div>
  );
}

/** Una pregunta del conjunto de recuperación: en qué puesto salió la norma esperada y qué salió primero. */
function FilaPregunta({ r }: { r: Resultado }) {
  const puesto = typeof r.detalle?.puesto === "number" ? r.detalle.puesto : null;
  const primeros = r.detalle?.primeros ?? [];
  const esperado = (r.esperado as { esperado?: string[] } | null)?.esperado ?? [];
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-mono text-meta font-semibold text-ink">{r.caso}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-rotulo text-mute">
          {r.fecha && <span>proceso del {fmtEjecutada(r.fecha)}</span>}
          {nombreRegimen(r.regimen) && <span>{nombreRegimen(r.regimen)}</span>}
        </span>
      </div>
      {r.titulo && <p className="text-dato leading-snug text-ink text-pretty">{r.titulo}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {puesto ? (
          <Badge tono={puesto <= 3 ? "ok" : "warn"} title="El puesto en que salió la norma esperada entre los 8 primeros">
            Salió en el puesto {puesto}
          </Badge>
        ) : (
          <Badge tono="danger" punto>
            No salió entre los 8 primeros
          </Badge>
        )}
      </div>
      {(primeros.length > 0 || esperado.length > 0) && (
        <Expandable variante="linea" resumen="Ver lo esperado y lo que salió">
          <div className="grid gap-x-5 gap-y-2 pt-1 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-rotulo font-medium text-mute">Esperado (cualquiera de estos)</p>
              <ul className="mt-1 space-y-0.5 text-meta leading-relaxed text-inkSoft">
                {esperado.map((e) => (
                  <li key={e} className="break-words font-mono">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
            <div className="min-w-0">
              <p className="text-rotulo font-medium text-mute">Lo que recibió el agente, en orden</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-meta leading-relaxed text-inkSoft">
                {primeros.map((p, i) => (
                  <li key={`${i}-${p}`} className="break-words">
                    {p}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Expandable>
      )}
    </div>
  );
}

const ESTADO_ESPERADO: Record<Esperado["estado"], { nombre: string; tono: Tone }> = {
  disparada: { nombre: "Debe dispararse", tono: "warn" },
  no_disparada: { nombre: "No debe dispararse", tono: "neutral" },
  sin_dato: { nombre: "Sin dato para decidir", tono: "muted" },
};

/** Una regla que falló: a la izquierda lo que dice la referencia, a la derecha lo que dijo el agente. */
function EsperadoEmitido({ regla, tipo, esperado, emitido }: { regla: string; tipo: "falsa" | "omision"; esperado: Esperado | undefined; emitido: string | null | undefined }) {
  const est = esperado ? ESTADO_ESPERADO[esperado.estado] : null;
  return (
    <section className="min-w-0 border-l-2 border-line pl-3">
      <h4 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-dato font-semibold text-ink">
        {nombreRegla(regla)}
        <Badge tono={tipo === "falsa" ? "danger" : "warn"}>{tipo === "falsa" ? "Falsa alarma" : "Omisión"}</Badge>
      </h4>
      <div className="mt-1.5 grid gap-x-5 gap-y-2 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-rotulo font-medium text-mute">
            Esperado (la referencia)
            {est && <Badge tono={est.tono}>{est.nombre}</Badge>}
            {esperado?.severidad && <Badge>severidad {esperado.severidad}</Badge>}
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-meta leading-relaxed text-inkSoft">
            {esperado?.evidencia?.trim() || (esperado ? "La referencia no trae evidencia para esta regla." : "La referencia no menciona esta regla.")}
          </p>
        </div>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-1.5 text-rotulo font-medium text-mute">
            Emitido (el agente)
            <Badge tono={tipo === "falsa" ? "danger" : "muted"}>{tipo === "falsa" ? "La emitió" : "No la emitió"}</Badge>
          </p>
          <p className="mt-1 whitespace-pre-wrap break-words text-meta leading-relaxed text-inkSoft">
            {emitido?.trim() || (tipo === "falsa" ? "La corrida no guardó la evidencia que dio el agente." : "El agente no dijo nada sobre esta regla.")}
          </p>
        </div>
      </div>
    </section>
  );
}

const ESTADO_CITA: Record<CitaLegal["estado"], { nombre: string; tono: Tone }> = {
  ok: { nombre: "Válida", tono: "ok" },
  otro_regimen: { nombre: "De la otra ley", tono: "warn" },
  no_existe: { nombre: "No existe en el corpus", tono: "danger" },
};

/** Conjunto legal: las banderas legales que dijo el agente y cada cita con su estado. */
function DetalleLegal({ r }: { r: Resultado }) {
  const banderas = r.detalle?.banderas_legales ?? [];
  const citas = r.detalle?.citas ?? [];
  const columnas: Columna<CitaLegal & { i: number }>[] = [
    { clave: "cita", titulo: "Cita", principal: true, celda: (c) => <span className="block break-words text-meta text-ink">{c.cita ?? <SinDato />}</span> },
    { clave: "norma", titulo: "Norma", celda: (c) => c.norma ?? <SinDato /> },
    { clave: "articulo", titulo: "Artículo", celda: (c) => c.articulo ?? <SinDato /> },
    { clave: "estado", titulo: "Estado", celda: (c) => <Badge tono={(ESTADO_CITA[c.estado] ?? ESTADO_CITA.no_existe).tono}>{(ESTADO_CITA[c.estado] ?? { nombre: c.estado }).nombre}</Badge> },
  ];
  return (
    <div className="space-y-3">
      {banderas.length > 0 && (
        <section className="min-w-0">
          <h4 className="text-dato font-semibold text-ink">Banderas legales que dijo el agente</h4>
          <ul className="mt-1.5 space-y-2">
            {banderas.map((b, i) => (
              <li key={i} className="min-w-0 border-l-2 border-line pl-3">
                <p className="flex flex-wrap items-center gap-1.5 text-meta font-medium text-ink">
                  {b.vector ? nombreRegla(b.vector) : "Sin vector"}
                  {b.severidad && <Badge>severidad {b.severidad}</Badge>}
                </p>
                {b.descripcion && <p className="mt-0.5 whitespace-pre-wrap break-words text-meta leading-relaxed text-inkSoft">{b.descripcion}</p>}
                {b.norma && <p className="mt-0.5 break-words text-rotulo text-mute">Norma citada: {b.norma}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {citas.length > 0 && (
        <section className="min-w-0">
          <h4 className="mb-1.5 text-dato font-semibold text-ink">Citas y su estado</h4>
          <DataTable columnas={columnas} filas={citas.map((c, i) => ({ ...c, i }))} claveFila={(c) => String(c.i)} etiqueta="Citas legales del agente en este caso" compactoMovil />
        </section>
      )}
    </div>
  );
}
