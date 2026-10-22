import { Ayuda } from "@/components/patrones";
import { Badge } from "@/components/ui/Badge";
import { numero, plural } from "@/lib/formato";
import { TIPO_CRUCE } from "@/lib/cruces";
import { CORTO_EMPRESA, NIVEL, type GrupoPuntaje, type Nivel, type ReglasPuntaje } from "@/lib/empresas";
import { cn } from "@/lib/utils";

/**
 * El puntaje de antecedentes de una empresa (0 a 100, migración 109): cuánto pesa lo que otros registros públicos dicen
 * de ella. Cada antecedente suma según su gravedad y cada grupo tiene un tope, así una sola cosa repetida no llena el
 * puntaje. Gramática: el número siempre va con su nivel en palabras (nunca sólo el color); la barra marca los cortes
 * de 20 (medio) y 50 (alto). Server-safe.
 */

const RELLENO: Record<Nivel, string> = { alto: "bg-crimson", medio: "bg-amber", bajo: "bg-inkSoft/60", sin: "bg-inkSoft/30" };
const TEXTO: Record<Nivel, string> = { alto: "text-crimsonTexto", medio: "text-amberTexto", bajo: "text-ink", sin: "text-mute" };
const VARIANTE_SEV = { alta: "crimson", media: "amber", baja: "neutral" } as const;
const SEV = { alta: "Grave", media: "Para revisar", baja: "Leve" } as const;

/** La barra de 0 a 100 con los cortes de nivel. */
function Barra({ puntaje, nivel, alta = false }: { puntaje: number; nivel: Nivel; alta?: boolean }) {
  return (
    <span className={cn("relative block w-full overflow-hidden rounded-full bg-paperDeep", alta ? "h-2.5" : "h-1.5")} aria-hidden>
      <span className={cn("absolute inset-y-0 left-0 rounded-full", RELLENO[nivel])} style={{ width: `${Math.max(puntaje > 0 ? 3 : 0, puntaje)}%` }} />
      <span className="absolute inset-y-0 left-[20%] w-[2px] bg-paper" />
      <span className="absolute inset-y-0 left-[50%] w-[2px] bg-paper" />
    </span>
  );
}

/** En la tabla: el número, su nivel en palabras y la barra. */
export function PuntajeCelda({ puntaje, nivel }: { puntaje: number; nivel: Nivel }) {
  return (
    <span className="flex w-full min-w-0 flex-col gap-1" title={`${puntaje} de 100: ${NIVEL[nivel].titulo.toLowerCase()}`}>
      <span className="flex items-baseline gap-1.5">
        <span className={cn("font-mono text-[15px] font-semibold tabular-nums", TEXTO[nivel])}>{puntaje}</span>
        <span className="text-[12px] text-mute">{nivel === "sin" ? "sin antecedentes" : NIVEL[nivel].corto.toLowerCase()}</span>
      </span>
      <Barra puntaje={puntaje} nivel={nivel} />
    </span>
  );
}

/** La tarjeta de la ficha: "47 de 100", el nivel y la barra, con cómo se calcula. */
export function MedidorPuntaje({ puntaje, nivel, reglas }: { puntaje: number; nivel: Nivel; reglas: ReglasPuntaje | null }) {
  return (
    <section className="flex flex-col gap-3 self-start rounded-2xl border border-line bg-paper p-4" aria-labelledby="puntaje-titulo">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="puntaje-titulo" className="text-[13px] font-semibold text-inkSoft">Puntaje de antecedentes</h2>
        <ComoSeCalcula reglas={reglas} />
      </div>
      <p className="flex items-baseline gap-2">
        <span className={cn("font-display text-[40px] font-bold leading-none tabular-nums", TEXTO[nivel])}>{puntaje}</span>
        <span className="text-[14px] text-mute">de 100</span>
      </p>
      <Barra puntaje={puntaje} nivel={nivel} alta />
      <div className="flex justify-between text-[11px] tabular-nums text-mute" aria-hidden>
        <span>0</span>
        <span className="-ml-6">20 medio</span>
        <span className="-ml-6">50 alto</span>
        <span>100</span>
      </div>
      <p className="text-[14px] font-semibold text-ink">{NIVEL[nivel].titulo}</p>
      <p className="max-w-prose text-[13px] leading-relaxed text-inkSoft">
        Suma lo que otros registros públicos dicen de la empresa: sanciones, penalidades, vínculos con el partido que gobierna,
        postores con el mismo socio, visitas antes de la buena pro y más. No es una acusación: dice qué revisar primero.
      </p>
    </section>
  );
}

/** El ⓘ con cómo se calcula, en dos oraciones: las reglas completas van en `TablaReglas`. */
export function ComoSeCalcula({ reglas: _reglas }: { reglas?: ReglasPuntaje | null }) {
  return (
    <Ayuda titulo="¿Cómo se calcula el puntaje?">
      Cada antecedente suma puntos según su gravedad, y cada grupo de antecedentes tiene un tope: así diez penalidades no pesan
      lo mismo que una inhabilitación. El total llega como máximo a 100; desde 20 es «para revisar» y desde 50, «muchos
      antecedentes». Las reglas completas están en «Cómo se calcula el puntaje».
    </Ayuda>
  );
}

/** Las reglas completas, plegadas: cada grupo con su tope y los puntos de cada antecedente según su gravedad. */
export function TablaReglas({ reglas }: { reglas: ReglasPuntaje | null }) {
  if (!reglas) return null;
  const pts = (g: ReglasPuntaje["grupos"][number], tipo: string, sev: "alta" | "media" | "baja") =>
    g.reglas.find((r) => r.tipo === tipo && r.severidad === sev)?.puntos ?? 0;
  return (
    <details className="group rounded-2xl border border-line bg-paper">
      <summary className="cursor-pointer select-none px-4 py-3 text-[14px] font-semibold text-granate">Cómo se calcula el puntaje</summary>
      <div className="space-y-3 px-4 pb-4">
        <p className="max-w-prose text-[13px] leading-relaxed text-inkSoft">
          Cada vez que un registro público nombra a la empresa (una sanción, una penalidad, un aporte al partido que gobierna…)
          suma los puntos de su gravedad. Lo que suma cada grupo no pasa de su tope, y el total no pasa de 100.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-[13px]">
            <thead className="bg-paperSoft text-left text-[12px] text-mute">
              <tr>
                <th className="px-3 py-2 font-medium">Grupo</th>
                <th className="px-3 py-2 font-medium">Antecedente</th>
                <th className="px-3 py-2 text-right font-medium">Grave</th>
                <th className="px-3 py-2 text-right font-medium">Para revisar</th>
                <th className="px-3 py-2 text-right font-medium">Leve</th>
                <th className="px-3 py-2 text-right font-medium">Tope del grupo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {reglas.grupos.flatMap((g) => {
                const tipos = [...new Set(g.reglas.map((r) => r.tipo))];
                return tipos.map((t, k) => (
                  <tr key={`${g.grupo}-${t}`}>
                    {k === 0 && <td rowSpan={tipos.length} className="px-3 py-2 align-top font-semibold text-ink">{g.titulo}</td>}
                    <td className="px-3 py-2 text-inkSoft">{CORTO_EMPRESA[t] ?? TIPO_CRUCE[t]?.corto ?? g.reglas.find((r) => r.tipo === t)?.etiqueta ?? t}</td>
                    {(["alta", "media", "baja"] as const).map((sev) => (
                      <td key={sev} className="px-3 py-2 text-right font-mono tabular-nums">{String(pts(g, t, sev)).replace(".", ",")}</td>
                    ))}
                    {k === 0 && <td rowSpan={tipos.length} className="px-3 py-2 text-right align-top font-mono font-semibold tabular-nums">{g.tope}</td>}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}

/**
 * El desglose: cada grupo que suma, numerado, con sus puntos frente a su tope y de qué antecedentes salen (cuántos y de
 * qué gravedad). Los grupos que no suman no se listan.
 */
export function DesglosePuntaje({ grupos, verTodo }: { grupos: GrupoPuntaje[]; verTodo?: string }) {
  const conPuntos = grupos.filter((g) => g.cruces.length > 0);
  if (!conPuntos.length) return null;
  return (
    <ol className="space-y-2.5">
      {conPuntos.map((g, i) => (
        <li key={g.grupo} className="flex gap-3 rounded-xl border border-line/80 bg-paperSoft p-3.5">
          <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-paperDeep px-1.5 font-mono text-[12px] font-semibold tabular-nums text-ink" aria-hidden>
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h4 className="text-[15px] font-semibold text-ink">{g.titulo}</h4>
              <span className="font-mono text-[13px] tabular-nums text-inkSoft">
                <b className="text-ink">{numero(Math.round(g.puntos))}</b> de {g.tope} puntos
              </span>
            </div>
            <span className="relative block h-1.5 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
              <span className="absolute inset-y-0 left-0 rounded-full bg-granate" style={{ width: `${Math.min(100, (g.puntos / g.tope) * 100)}%` }} />
            </span>
            {g.explica && <p className="max-w-prose text-[13px] leading-relaxed text-inkSoft">{g.explica}</p>}
            <ul className="flex flex-wrap gap-1.5">
              {g.cruces.map((c) => (
                <li key={`${c.tipo}-${c.severidad}`}>
                  <Badge variant={VARIANTE_SEV[c.severidad]}>
                    {`${CORTO_EMPRESA[c.tipo] ?? TIPO_CRUCE[c.tipo]?.corto ?? c.etiqueta}: ${plural(c.n, "vez", "veces")}, ${SEV[c.severidad].toLowerCase()}`}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        </li>
      ))}
      {verTodo && (
        <li className="pl-9 text-[13px]">
          <a href={verTodo} className="font-semibold text-granate underline-offset-2 hover:underline">Ver cada antecedente con su fuente</a>
        </li>
      )}
    </ol>
  );
}
