import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { EstadoError } from "@/components/patrones";
import { ListaPaginada } from "@/components/listado";
import { numero, solesCompacto } from "@/lib/formato";
import { PERIODOS_GOBIERNO, type AnioGobierno, type FilaPartido, type RankingPartidos } from "@/lib/partidosApi";
import { Aviso } from "./AvisoPartido";

/**
 * "Contratos por partido" en /app/partidos: TODOS los partidos de un período (antes, los 12 primeros) por los procesos
 * adjudicados de sus gobiernos (CONOSCE, desde 2018: migración 65) y, si tienen, sus contratos en la base de Vigía.
 * Antes contaba sólo la base de Vigía, que es de 2026: para 2019-2022 decía que ningún contrato se asociaba a un partido.
 * La barra mide lo adjudicado contra el partido con más. Cada fila lleva a /app/partidos/[clave]?anio=. De a 20.
 * Server-safe: llega todo como datos planos (la paginación es un componente cliente que recibe nodos ya armados).
 */

const hrefPeriodo = (anio: number) => `/app/partidos?anio=${anio}&vista=contratos`;

export function ContratosPorPartido({ ranking, anio, sinNavegacion = false }: { ranking: RankingPartidos | null; anio: AnioGobierno; sinNavegacion?: boolean }) {
  const periodo = PERIODOS_GOBIERNO.find((p) => p.anio === anio)!;
  const filas = [...(ranking?.data ?? [])]
    .filter((f) => (f.procesos ?? 0) > 0 || f.contratos > 0)
    .sort((a, b) => (b.montoAdjudicadoPen ?? 0) - (a.montoAdjudicadoPen ?? 0) || (b.procesos ?? 0) - (a.procesos ?? 0) || b.contratos - a.contratos);
  const maximo = Math.max(1, ...filas.map((f) => f.montoAdjudicadoPen ?? 0));
  const totalProcesos = filas.reduce((s, f) => s + (f.procesos ?? 0), 0);
  const totalMonto = filas.reduce((s, f) => s + (f.montoAdjudicadoPen ?? 0), 0);
  return (
    <section aria-labelledby="contratos-partido-titulo" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="max-w-2xl">
          <h2 id="contratos-partido-titulo" className="font-display text-2xl font-bold leading-tight text-ink">Contratos por partido</h2>
          <p className="mt-1 text-[14.5px] leading-snug text-inkSoft">
            Los procesos adjudicados por los gobiernos de cada partido (SEACE, vía CONOSCE), cada uno con el partido que gobernaba la entidad el día en que se convocó.
          </p>
        </div>
        {!sinNavegacion && (
          <nav aria-label="Período de gobierno" className="flex flex-wrap items-center gap-2">
            {PERIODOS_GOBIERNO.map((p) => (
              <Link
                key={p.anio}
                href={hrefPeriodo(p.anio)}
                aria-current={p.anio === anio ? "page" : undefined}
                className={
                  "inline-flex min-h-[36px] items-center rounded-full border px-3.5 text-[13.5px] font-semibold transition-colors " +
                  (p.anio === anio ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink")
                }
              >
                {p.texto}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {!ranking ? (
        <EstadoError titulo="No pudimos leer los contratos por partido">El servidor no respondió. No mostramos nada en su lugar.</EstadoError>
      ) : filas.length === 0 ? (
        <p className="rounded-xl border border-line bg-paperSoft px-4 py-3 text-sm text-inkSoft">
          Ningún proceso adjudicado se asocia a un partido en {periodo.texto}.
        </p>
      ) : (
        <>
          <p className="text-[13px] text-inkSoft">
            {numero(filas.length)} partidos y movimientos, {numero(totalProcesos)} procesos, {solesCompacto(totalMonto)} adjudicados en soles
            {anio === 2014 ? " (sólo 2018: CONOSCE empieza ese año)" : ""}.
          </p>
          <ListaPaginada
            tam={20}
            nombre="partidos"
            className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper"
            items={filas.map((f, i) => ({ id: f.clave, contenido: <FilaPartidoEnlace f={f} i={i} anio={anio} maximo={maximo} /> }))}
          />
        </>
      )}
      <Aviso tono="neutro">
        Se asocia al partido que ganó la elección de ese período: una vacancia o un reemplazo dentro del período no está registrado. Una
        señal es un motivo para revisar un contrato, nunca una acusación contra un partido ni una persona.
      </Aviso>
    </section>
  );
}

function FilaPartidoEnlace({ f, i, anio, maximo }: { f: FilaPartido; i: number; anio: AnioGobierno; maximo: number }) {
  const procesos = f.procesos ?? 0;
  const monto = f.montoAdjudicadoPen ?? 0;
  const gobiernos = f.gobiernos.regional + f.gobiernos.provincial + f.gobiernos.distrital;
  return (
    <Link
      href={`/app/partidos/${f.clave}?anio=${anio}`}
      className="group grid min-h-[48px] items-center gap-x-4 gap-y-1 px-4 py-2 transition-colors hover:bg-granate-50 sm:grid-cols-[2.25rem_minmax(0,1.5fr)_minmax(0,1fr)_auto]"
    >
      <span className="hidden font-mono text-[13px] tabular-nums text-mute sm:block" aria-hidden>{i + 1}</span>
      <span className="min-w-0">
        <span className="block truncate text-[14.5px] font-semibold text-ink" title={f.nombre}>{f.nombre}</span>
        <span className="block truncate text-[12.5px] text-mute">
          {numero(gobiernos)} {gobiernos === 1 ? "gobierno" : "gobiernos"}, {numero(procesos)} {procesos === 1 ? "proceso" : "procesos"}
          {f.contratos > 0 ? ` · ${numero(f.contratos)} en Vigía, ${numero(f.leidos)} leídos` : ""}
        </span>
      </span>
      <span className="min-w-0" role="img" aria-label={`${solesCompacto(monto)} adjudicados, frente a ${solesCompacto(maximo)} del partido con más`}>
        <span className="block h-2 overflow-hidden rounded-full bg-granate/15">
          <span className="block h-full rounded-full bg-granate" style={{ width: `${Math.max(1.5, (monto / maximo) * 100)}%` }} />
        </span>
      </span>
      <span className="flex items-center justify-between gap-3 text-[13px] sm:justify-end">
        <span className="font-mono font-semibold tabular-nums text-ink">{solesCompacto(monto)}</span>
        <ChevronRight size={15} className="shrink-0 text-mute transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}
