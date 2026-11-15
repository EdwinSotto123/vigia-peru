"use client";

import { ArrowRight, FlaskConical } from "lucide-react";
import { Badge, Card, EmptyState, KeyValue, SkeletonPanel, claseBoton, plural, type ParClave } from "@/components/admin/ui";
import { BarraSegmentada, Medidor, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { Delta, SerieF1 } from "./comunes";
import { QUE_MIDE, fmtEjecutada, fmtF1, fmtMetrica, fmtPct, fmtSeg, fmtUsd, numeroDe, type Conjunto, type Corrida, type ResumenCitas } from "./tipos";

/**
 * Pestaña «Conjuntos»: una tarjeta por conjunto de prueba con qué mide, cuántos casos tiene y cómo le fue a la última
 * imagen del agente (F1, precisión, exhaustividad, cortes, tiempo y costo), la diferencia con la corrida anterior y la
 * serie de F1. Cada tarjeta lleva a sus corridas y a sus casos.
 */
export function ConjuntosGolden({ conjuntos, cargando, onCorridas, onCasos }: { conjuntos: Conjunto[] | undefined; cargando: boolean; onCorridas: (clave: string) => void; onCasos: (clave: string) => void }) {
  if (!conjuntos) return cargando ? <SkeletonPanel lineas={6} /> : null;
  if (!conjuntos.length)
    return (
      <Card relleno="none">
        <EmptyState icono={<FlaskConical size={16} />} titulo="Todavía no hay conjuntos de prueba" descripcion="Aparecen aquí cuando se sube el primer conjunto con sus casos de referencia." />
      </Card>
    );
  return (
    <ul className="grid gap-3 xl:grid-cols-2">
      {conjuntos.map((c) => (
        <li key={c.clave} className="min-w-0">
          <TarjetaConjunto c={c} onCorridas={() => onCorridas(c.clave)} onCasos={() => onCasos(c.clave)} />
        </li>
      ))}
    </ul>
  );
}

function TarjetaConjunto({ c, onCorridas, onCasos }: { c: Conjunto; onCorridas: () => void; onCasos: () => void }) {
  const u = c.ultima;
  const que = QUE_MIDE[c.queMide] ?? QUE_MIDE.banderas;
  // La corrida de antes de la última, para decir si la imagen mejoró o empeoró.
  const previa = c.serie.length >= 2 ? c.serie[c.serie.length - 2] : null;
  return (
    <Card className="flex h-full flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <h3 className="text-cuerpo font-semibold leading-snug text-ink">{c.nombre}</h3>
          {c.descripcion && <p className="mt-0.5 text-meta leading-snug text-mute text-pretty">{c.descripcion}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tono="brand">{que.nombre}</Badge>
          <Badge>{plural(c.casos, "caso", "casos")}</Badge>
        </div>
      </header>

      {u ? (
        <>
          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)]">
            <div className="min-w-0">
              <p className="text-rotulo font-medium text-mute">{c.queMide === "recuperacion" ? "MRR de la última corrida" : "F1 de la última corrida"}</p>
              <p className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-display text-cifra font-bold leading-none tracking-tight tabular-nums text-ink">{fmtF1(u.f1) ?? "Sin dato"}</span>
                <Delta ahora={u.f1} antes={previa?.f1} contra={previa?.imagen} />
              </p>
            </div>
            <div className="min-w-0 space-y-2">
              {c.queMide === "recuperacion" ? (
                <FilaMedida etiqueta="Acierto en los 8 primeros" valor={u.exhaustividad} que="preguntas en que salió la norma esperada" />
              ) : (
                <>
                  <FilaMedida etiqueta="Precisión" valor={u.precision} que="de lo que marcó, cuánto era cierto" />
                  <FilaMedida etiqueta="Exhaustividad" valor={u.exhaustividad} que="de lo que había, cuánto encontró" />
                </>
              )}
            </div>
          </div>

          {c.queMide === "citas_legales" && <CitasLegales m={u.metricas} />}
          {c.queMide === "recuperacion" && <MetricasRecuperacion m={u.metricas} />}

          <KeyValue columnas={3} items={datosDe(u, que.casos)} />
          <SerieF1 serie={c.serie} />
        </>
      ) : (
        <EmptyState compacto className="px-0" titulo="Todavía no se subió ninguna corrida" descripcion="Corre el conjunto contra una imagen del agente y sube el resultado para verlo aquí." />
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button type="button" onClick={onCorridas} disabled={!c.corridas} className={claseBoton("secundario")}>
          {c.corridas ? `Ver ${c.corridas === 1 ? "su corrida" : `sus ${c.corridas} corridas`}` : "Sin corridas"} <ArrowRight size={14} aria-hidden />
        </button>
        <button type="button" onClick={onCasos} className={claseBoton("fantasma")}>
          Ver los casos
        </button>
        {c.actualizado && <span className="ml-auto text-rotulo text-mute">Conjunto actualizado el {fmtEjecutada(c.actualizado)}</span>}
      </footer>
    </Card>
  );
}

/** Una medida de 0 a 100 con su barra. */
function FilaMedida({ etiqueta, valor, que }: { etiqueta: string; valor: number | null; que: string }) {
  return (
    <div className="min-w-0">
      <p className="flex items-baseline justify-between gap-2 text-meta">
        <span className="text-inkSoft" title={que}>
          {etiqueta}
        </span>
        <span className="font-mono font-semibold tabular-nums text-ink">{fmtPct(valor) ?? "Sin dato"}</span>
      </p>
      {valor != null && <Medidor parte={valor / 100} etiqueta={`${etiqueta}: ${fmtPct(valor)}, ${que}`} className="mt-1" />}
    </div>
  );
}

function datosDe(u: Corrida, casos: string): ParClave[] {
  return [
    { etiqueta: "Imagen del agente", valor: u.imagen, mono: true, pista: u.variante ? `variante ${u.variante}` : undefined },
    { etiqueta: "Ejecutada", valor: fmtEjecutada(u.ejecutada) },
    { etiqueta: casos === "preguntas" ? "Preguntas" : "Contratos", valor: u.contratos != null ? u.contratos.toLocaleString("es-PE") : null, pista: u.errores ? `${plural(u.errores, "corte", "cortes")} (errores)` : "sin cortes" },
    { etiqueta: "Tiempo medio", valor: fmtSeg(u.segundosMedio), pista: `por ${casos === "preguntas" ? "pregunta" : "contrato"}` },
    { etiqueta: "Costo medio", valor: fmtUsd(u.usdMedio), pista: `por ${casos === "preguntas" ? "pregunta" : "contrato"}` },
  ];
}

/** El conjunto legal: qué parte de las citas que dio el agente existe y rige, cuál es de la otra ley y cuál no existe. */
export function CitasLegales({ m }: { m: Record<string, unknown> | null }) {
  const citas = (m?.citas ?? null) as Partial<ResumenCitas> | null;
  const ok = numeroDe(m?.citas_ok_pct);
  const otro = numeroDe(m?.citas_otro_regimen_pct);
  const noExiste = numeroDe(m?.citas_no_existe_pct);
  if (ok == null && otro == null && noExiste == null && !citas) return null;
  const partes = [
    { clave: "ok", nombre: "Válidas", valor: citas?.ok ?? 0, pct: ok },
    { clave: "otro", nombre: "Del régimen equivocado", valor: citas?.otro_regimen ?? 0, pct: otro },
    { clave: "no", nombre: "No existen en el corpus", valor: citas?.no_existe ?? 0, pct: noExiste },
  ];
  return (
    <div className="min-w-0 border-t border-line pt-3">
      <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-meta">
        <span className="font-semibold text-ink">Citas legales del agente</span>
        {citas?.total != null && <span className="text-rotulo text-mute">{plural(citas.total, "cita", "citas")}</span>}
      </p>
      <BarraSegmentada
        className="mt-2"
        etiqueta="Citas legales por estado"
        partes={partes.map((p) => ({ clave: p.clave, nombre: p.nombre, valor: p.valor, texto: plural(p.valor, "cita", "citas") }))}
      />
      <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-3">
        {partes.map((p, i) => (
          <li key={p.clave} className="flex min-w-0 items-baseline gap-1.5 text-meta">
            <MuestraSerie i={i} className="translate-y-px" />
            <span className="min-w-0 text-inkSoft">{p.nombre}</span>
            <span className="ml-auto shrink-0 font-mono font-semibold tabular-nums text-ink">{fmtPct(p.pct) ?? p.valor.toLocaleString("es-PE")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** El conjunto del RAG: las medidas de recuperación tal como las da la corrida. */
export function MetricasRecuperacion({ m }: { m: Record<string, unknown> | null }) {
  if (!m) return null;
  const items: ParClave[] = [
    { etiqueta: "Acierto en los 8 primeros", valor: fmtMetrica(m["acierto@8"]), pista: "la norma esperada salió entre los 8" },
    ...(m["acierto@10"] != null ? [{ etiqueta: "Acierto en lo que recibe el agente", valor: fmtMetrica(m["acierto@10"]), pista: "hasta 10: los dos últimos son criterios de la otra ley" }] : []),
    { etiqueta: "MRR", valor: fmtMetrica(m.MRR), pista: "qué tan arriba sale la esperada" },
    { etiqueta: "Norma en primer lugar", valor: fmtMetrica(m.norma_primero) },
    { etiqueta: "Régimen equivocado", valor: fmtMetrica(m.regimen_equivocado), pista: "resultados de la ley que no rige" },
  ];
  return (
    <div className="min-w-0 border-t border-line pt-3">
      <KeyValue columnas={4} items={items} />
    </div>
  );
}
