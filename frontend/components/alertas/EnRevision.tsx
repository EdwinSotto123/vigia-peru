import Link from "next/link";
import { ArrowRight, ShieldQuestion } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { EstadoVacio } from "@/components/patrones";
import { fechaCorta, numero, porcentaje, soles } from "@/lib/formato";
import type { AnalisisEnRevision, RevisionMotivo } from "@/lib/revision";

/**
 * "Financiados en revisión": los análisis financiados que terminaron y NO se
 * publicaron (la lista sale de los procesamientos, que sólo conocen lo financiado;
 * DESIGN_SYSTEM.md §10.1).
 *
 * Es la superficie de credibilidad del producto, y por eso está a un clic del
 * índice y no escondida: la fracción que la autoevaluación frena, dicha en voz
 * alta junto a las señales que sí se publicaron, prueba que el filtro existe.
 *
 * §10.4: de una alerta en revisión se dice "En revisión" y el motivo, nada más —
 * ni puntaje, ni señales, ni cuántas se detectaron—. Todo lo que se lee aquí sale
 * de `GET /alertas/:codigo/revision`: los motivos, los porcentajes, los umbrales y
 * las reglas sin respaldo vienen del API.
 */

const pct = (x: number | null) => (x == null ? null : porcentaje(x * 100));

export function EnRevision({
  items,
  procesados,
  publicadas,
}: {
  items: AnalisisEnRevision[];
  /**
   * Análisis terminados en total — el denominador. Si el tablero no responde llega
   * `null` y el titular se queda sin fracción: "12 de 12" sería una cifra inventada,
   * y aquí el denominador es justo lo que hace verificable la afirmación.
   */
  procesados: number | null;
  /** Señales que sí se publicaron, para que las dos cifras se lean juntas. */
  publicadas: number;
}) {
  const queSignifica = items.find((i) => i.revision?.queSignifica)?.revision?.queSignifica ?? null;
  const conDenominador = procesados != null && procesados >= items.length;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-paperEdge bg-paperDeep p-5">
        <h2 className="font-display text-lg font-bold leading-tight text-ink tabular-nums">
          {conDenominador
            ? `${numero(items.length)} de ${numero(procesados)} contratos financiados ya leídos están en revisión`
            : `${numero(items.length)} ${items.length === 1 ? "contrato financiado está" : "contratos financiados están"} en revisión`}
        </h2>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-inkSoft">
          {queSignifica ??
            "El análisis terminó, pero la autoevaluación (jueces independientes y comprobaciones en código) no alcanzó el umbral para publicarlo. Una persona lo revisa y decide publicar o descartar. Mientras tanto no cuenta como señal hallada."}
        </p>
        <p className="mt-2 max-w-[70ch] text-[13.5px] leading-relaxed text-mute">
          Están a la vista a propósito. Las {numero(publicadas)} señales publicadas sólo significan algo si se sabe qué se
          quedó fuera y por qué: un motor que publica todo lo que encuentra no tiene control de calidad, tiene volumen.
        </p>
      </section>

      {items.length === 0 ? (
        <EstadoVacio titulo="Ningún contrato financiado está en revisión ahora mismo">
          Cada análisis que termina pasa por la autoevaluación antes de publicarse. Cuando no alcanza el umbral, el
          contrato aparece en esta lista con el motivo exacto hasta que una persona decide.
        </EstadoVacio>
      ) : (
        <ul className="space-y-3">
          {items.map(({ procesamiento: p, revision }) => (
            <li key={p.ocid} className="rounded-2xl border border-line bg-paper p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h3 className="min-w-0 flex-1 text-[14.5px] font-semibold leading-snug text-ink">
                  {p.titulo ?? "Contrato sin título en el registro"}
                </h3>
                <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-mute">
                  {p.alertaCodigo ?? p.ocid}
                </span>
              </div>

              <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11.5px] text-mute">
                <span className="font-medium text-inkSoft">{p.entidad ?? "Entidad no registrada"}</span>
                <span>{p.zona}</span>
                {p.montoPen != null && p.montoPen > 0 && (
                  <span className="font-mono tabular-nums">valor referencial {soles(p.montoPen)}</span>
                )}
                {/* §10.4: ni el número de señales se publica antes de que lo mire una persona. */}
                {(revision?.analizadoEn ?? p.finalizadoAt) && (
                  <span className="tabular-nums">leído el {fechaCorta(revision?.analizadoEn ?? p.finalizadoAt)}</span>
                )}
              </p>

              <div className="mt-3 space-y-2.5 border-t border-line pt-3">
                {(revision?.motivos ?? []).length === 0 ? (
                  <p className="flex items-start gap-2 text-[13px] leading-relaxed text-mute">
                    <ShieldQuestion size={14} className="mt-0.5 shrink-0" aria-hidden />
                    El motivo detallado de esta revisión no se pudo leer. El análisis sigue sin publicarse.
                  </p>
                ) : (
                  (revision?.motivos ?? []).map((m) => <Motivo key={m.clave} m={m} />)
                )}
              </div>

              <Link
                href={`/app/auditoria/${p.ocid}`}
                className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-granate hover:underline"
              >
                Ver el análisis completo, fase por fase <ArrowRight size={13} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Un motivo de bloqueo. Cuando trae valor y umbral se dibuja el contraste en la
 * misma línea —"33 % de respaldo, mínimo 60 %"— en vez de una cifra suelta en una
 * caja: el número sin su umbral no significa nada, y el umbral es justo lo que hace
 * auditable la decisión.
 */
function Motivo({ m }: { m: RevisionMotivo }) {
  const tieneMedida = m.valor != null && m.umbral != null;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h4 className="text-[13.5px] font-semibold text-ink">{m.titulo}</h4>
        {tieneMedida && (
          <span className="text-[12px] tabular-nums text-mute">
            <span className="font-semibold text-ink">{pct(m.valor)}</span> contra un mínimo de {pct(m.umbral)}
          </span>
        )}
      </div>
      <p className="mt-0.5 max-w-[78ch] text-[13px] leading-relaxed text-inkSoft">{m.detalle}</p>
      {tieneMedida && <Medidor valor={m.valor as number} umbral={m.umbral as number} titulo={m.titulo} />}
      {m.reglasEtiquetas && m.reglasEtiquetas.length > 0 && (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-mute">
          <span>Sin respaldo localizable:</span>
          {m.reglasEtiquetas.map((r) => (
            <span key={r} className="pill border-line bg-paperSoft text-inkSoft">
              {r}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * Valor contra umbral. Barra neutra, no roja: quedarse por debajo del umbral no es
 * un error del producto, es el control de calidad haciendo su trabajo. El umbral se
 * marca con una línea sólida y su etiqueta, así la barra se lee sin leyenda.
 */
function Medidor({ valor, umbral, titulo }: { valor: number; umbral: number; titulo: string }) {
  const v = Math.max(0, Math.min(1, valor));
  const u = Math.max(0, Math.min(1, umbral));
  return (
    <div
      className="relative mt-2 h-2 w-full max-w-[28rem] overflow-hidden rounded-full bg-paperDeep"
      role="img"
      aria-label={`${titulo}: ${Math.round(v * 100)} por ciento, umbral mínimo ${Math.round(u * 100)} por ciento`}
    >
      <div className="h-full rounded-full bg-mute" style={{ width: `${v * 100}%` }} />
      <span className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `calc(${u * 100}% - 1px)` }} aria-hidden />
    </div>
  );
}

/** Mismo esqueleto que la lista real: tres bloques de motivo por análisis. */
export function EnRevisionSkeleton({ filas = 4 }: { filas?: number }) {
  return (
    <div className="space-y-5">
      <div className="space-y-2 rounded-2xl border border-paperEdge bg-paperDeep p-5">
        <Skeleton className="h-5 w-80 max-w-full" />
        <Skeleton className="h-3.5 w-full max-w-[70ch]" />
        <Skeleton className="h-3.5 w-4/5 max-w-[60ch]" />
      </div>
      <ul className="space-y-3">
        {Array.from({ length: filas }).map((_, i) => (
          <li key={i} className="space-y-2 rounded-2xl border border-line bg-paper p-4">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-2 w-72 max-w-full rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}
