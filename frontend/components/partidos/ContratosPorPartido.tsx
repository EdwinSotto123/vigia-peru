import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { EstadoError } from "@/components/patrones";
import { numero } from "@/lib/formato";
import { PERIODOS_GOBIERNO, type AnioGobierno, type RankingPartidos } from "@/lib/partidosApi";
import { Aviso } from "./AvisoPartido";

/**
 * "Contratos por partido" en /app/partidos: el ranking de los partidos de un período por contratos de sus
 * gobiernos, con cuántos ya leyó Vigía y cuántos esperan. Cada fila lleva a /app/partidos/[clave]?anio=.
 * La barra mide los contratos del partido contra el partido con más contratos; la parte oscura son los leídos.
 * Server-safe: llega todo como datos planos.
 */

const TOPE = 12;
const hrefPeriodo = (anio: number) => `/app/partidos?anio=${anio}`;

export function ContratosPorPartido({ ranking, anio }: { ranking: RankingPartidos | null; anio: AnioGobierno }) {
  const periodo = PERIODOS_GOBIERNO.find((p) => p.anio === anio)!;
  const filas = (ranking?.data ?? []).slice(0, TOPE);
  const maximo = Math.max(1, ...filas.map((f) => f.contratos));
  return (
    <section aria-labelledby="contratos-partido-titulo" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="max-w-2xl">
          <h2 id="contratos-partido-titulo" className="font-display text-2xl font-bold leading-tight text-ink">Contratos por partido</h2>
          <p className="mt-1 text-[14.5px] leading-snug text-inkSoft">
            Cada contrato se asocia al partido que gobernaba la entidad el mes en que se convocó, según la elección de ese período.
          </p>
        </div>
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
      </div>

      {!ranking ? (
        <EstadoError titulo="No pudimos leer los contratos por partido">El servidor no respondió. No mostramos nada en su lugar.</EstadoError>
      ) : filas.length === 0 ? (
        <p className="rounded-xl border border-line bg-paperSoft px-4 py-3 text-sm text-inkSoft">
          Ningún contrato de la base de Vigía se asocia a un partido en {periodo.texto}.
        </p>
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
          {filas.map((f, i) => (
            <li key={f.clave}>
              <Link
                href={`/app/partidos/${f.clave}?anio=${anio}`}
                className="group grid min-h-[44px] items-center gap-x-4 gap-y-0.5 px-4 py-1.5 transition-colors hover:bg-granate-50 sm:grid-cols-[1.75rem_minmax(0,1.5fr)_minmax(0,1fr)_auto]"
              >
                <span className="hidden font-mono text-[13px] tabular-nums text-mute sm:block" aria-hidden>{i + 1}</span>
                <span className="min-w-0 sm:flex sm:items-baseline sm:gap-x-3">
                  <span className="block truncate text-[14.5px] font-semibold text-ink sm:max-w-[68%] sm:shrink-0" title={f.nombre}>{f.nombre}</span>
                  <span className="block truncate text-[12.5px] text-mute sm:min-w-0">
                    {numero(f.gobiernos.regional + f.gobiernos.provincial + f.gobiernos.distrital)} gobiernos, {numero(f.contratos)} contratos
                  </span>
                </span>
                <span
                  className="min-w-0"
                  role="img"
                  aria-label={`${numero(f.contratos)} contratos, ${numero(f.leidos)} leídos, frente a ${numero(maximo)} del partido con más`}
                >
                  <span className="block h-2 overflow-hidden rounded-full bg-granate/15">
                    <span className="block h-full rounded-full bg-granate/30" style={{ width: `${Math.max(2, (f.contratos / maximo) * 100)}%` }}>
                      <span className="block h-full rounded-full bg-granate" style={{ width: `${f.contratos > 0 ? (f.leidos / f.contratos) * 100 : 0}%` }} />
                    </span>
                  </span>
                </span>
                <span className="flex items-center justify-between gap-3 text-[12.5px] text-inkSoft sm:justify-end">
                  <span>
                    <span className="font-mono tabular-nums text-ink">{numero(f.leidos)}</span> leídos,{" "}
                    <span className="font-mono tabular-nums text-ink">{numero(f.enCola)}</span> en cola
                  </span>
                  <ChevronRight size={15} className="shrink-0 text-mute transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
      {ranking && ranking.data.length > TOPE && (
        <p className="text-[12.5px] text-mute">Los {TOPE} partidos con más contratos, de {numero(ranking.data.length)}.</p>
      )}
      <Aviso tono="neutro">
        Se asocia al partido que ganó la elección de ese período: una vacancia o un reemplazo dentro del período no está registrado. Una
        señal es un motivo para revisar un contrato, nunca una acusación contra un partido ni una persona.
      </Aviso>
    </section>
  );
}
