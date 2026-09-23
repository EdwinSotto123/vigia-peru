import Link from "next/link";
import { ArrowRight, Inbox, ShieldQuestion } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { soles, type AnalisisEnRevision, type RevisionMotivo } from "@/lib/revision";

/**
 * "En revisión humana": los análisis que terminaron y NO se publicaron.
 *
 * Es la superficie de credibilidad del producto, y por eso está a un clic del
 * índice y no escondida. La autoevaluación —4 jueces independientes más 4
 * comprobaciones en código— bloquea el 36 % de los análisis que corren, y esa
 * fracción, dicha en voz alta junto a las señales que sí se publicaron, vale más
 * que cualquier promesa de rigor: prueba que el filtro existe y que muerde.
 *
 * Todo lo que se lee aquí sale de `GET /alertas/:codigo/revision`, un endpoint que
 * el backend tenía implementado y que el frontend nunca había llamado. Ni un solo
 * texto de esta pantalla está escrito a mano sobre datos que no existen: los
 * motivos, los porcentajes, los umbrales y las reglas sin respaldo vienen del API.
 */

const fechaHora = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "2-digit" });
};

const pct = (x: number | null) => (x == null ? null : `${Math.round(x * 100)} %`);

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
        <h2 className="font-serif text-lg font-bold leading-tight text-ink">
          {conDenominador
            ? `${items.length} de ${procesados} análisis terminados no llegaron a publicarse`
            : `${items.length} ${items.length === 1 ? "análisis terminado no llegó" : "análisis terminados no llegaron"} a publicarse`}
        </h2>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-inkSoft">
          {queSignifica ??
            "El análisis terminó, pero la autoevaluación (4 jueces independientes + 4 comprobaciones en código) no alcanzó el umbral para publicarlo. Una persona lo revisa y decide publicar o descartar. Mientras tanto no cuenta como señal hallada."}
        </p>
        <p className="mt-2 max-w-[70ch] text-[13.5px] leading-relaxed text-mute">
          Están a la vista a propósito. Las {publicadas.toLocaleString("es-PE")} señales publicadas sólo significan algo
          si se sabe qué se quedó fuera y por qué: un motor que publica todo lo que encuentra no tiene control de
          calidad, tiene volumen.
        </p>
      </section>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line bg-paperSoft/60 px-6 py-10 text-center">
          <span className="inline-flex text-mute" aria-hidden><Inbox size={18} /></span>
          <h3 className="mt-2 font-serif text-lg font-bold text-ink">Ningún análisis está en revisión ahora mismo</h3>
          <p className="mx-auto mt-1 max-w-[60ch] text-[13.5px] leading-relaxed text-mute">
            Cada análisis que termina pasa por ocho evaluadores antes de publicarse. Cuando alguno queda por debajo del
            umbral, el contrato aparece en esta lista con el motivo exacto hasta que una persona decide.
          </p>
        </div>
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
                {p.montoPen != null && <span className="font-mono tabular-nums">{soles(p.montoPen)}</span>}
                {/* La API deja de devolver el conteo de lo que está en revisión:
                    ni siquiera el número se publica antes de que lo mire una persona. */}
                {p.banderas != null && (
                  <span>
                    {p.banderas} {p.banderas === 1 ? "señal detectada" : "señales detectadas"}, ninguna publicada
                  </span>
                )}
                <span>analizado el {fechaHora(revision?.analizadoEn ?? p.finalizadoAt)}</span>
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
                className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-heroViolet hover:underline"
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
          <span className="font-mono text-[12px] tabular-nums text-mute">
            <span className="text-ink">{pct(m.valor)}</span> contra un mínimo de {pct(m.umbral)}
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
