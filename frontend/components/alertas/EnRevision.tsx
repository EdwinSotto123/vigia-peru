import Link from "next/link";
import { ArrowRight, ChevronRight, ShieldQuestion } from "lucide-react";
import { Skeleton } from "@/components/ui/Skeleton";
import { Revelar } from "@/components/ui/Revelar";
import { Ayuda, EstadoVacio } from "@/components/patrones";
import { fechaCorta, numero, porcentaje, soles } from "@/lib/formato";
import type { AnalisisEnRevision, RevisionMotivo } from "@/lib/revision";

/**
 * "Financiados en revisión": los análisis financiados que terminaron y NO se
 * publicaron (DESIGN_SYSTEM.md §10.1 y §10.4).
 *
 * Dato primero (§10.7): una fila por contrato —qué es, cuánto, cuándo y por qué
 * quedó en revisión, en chips— y el detalle de cada motivo (valor contra umbral,
 * reglas sin respaldo) a un clic, en el panel lateral. Antes cada contrato era una
 * tarjeta con el título entero, un párrafo por motivo y una barra: se leía como un
 * blog, no como una lista.
 *
 * Las columnas entran en `lg`, no en `md`: en `md` la barra lateral ya ocupa 256 px y
 * con columnas fijas el título quedaba en ~0 px.
 *
 * §10.4: de una alerta en revisión se dice "En revisión" y el motivo, nada más —ni
 * puntaje, ni señales—. Todo sale de `GET /alertas/:codigo/revision`.
 */

const pct = (x: number | null) => (x == null ? null : porcentaje(x * 100));

/** La cifra de la vista, con su explicación a un clic. Va junto al selector de vista. */
export function ResumenRevision({
  n,
  procesados,
  publicadas,
}: {
  n: number;
  /** Financiados ya leídos (el denominador). `null` si el tablero no respondió: sin fracción inventada. */
  procesados: number | null;
  publicadas: number;
}) {
  const conDenominador = procesados != null && procesados >= n;
  return (
    <p className="inline-flex items-center gap-1 text-[13px] tabular-nums text-inkSoft">
      <span>
        <strong className="font-semibold text-ink">{numero(n)}</strong>
        {conDenominador ? ` de ${numero(procesados)} financiados leídos` : " financiados"} en revisión
      </span>
      <Ayuda titulo="¿Por qué están en revisión?">
        <span className="block">
          El análisis terminó, pero la autoevaluación no alcanzó el umbral para publicarlo. Una persona lo revisa y decide
          publicar o descartar; mientras tanto no cuenta como señal hallada.
        </span>
        <span className="block mt-2 text-mute">
          Se muestran a propósito: las {numero(publicadas)} señales publicadas sólo significan algo si se sabe qué quedó
          fuera y por qué.
        </span>
      </Ayuda>
    </p>
  );
}

export function EnRevision({ items }: { items: AnalisisEnRevision[] }) {
  if (items.length === 0) {
    return (
      <EstadoVacio titulo="Ningún contrato financiado está en revisión" compacto>
        Cuando la autoevaluación frena un análisis, aparece aquí con su motivo.
      </EstadoVacio>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div
        className="hidden grid-cols-[minmax(0,1fr)_128px_88px_minmax(0,300px)_20px] items-center gap-4 border-b border-line bg-paperSoft px-4 py-2 text-[11px] font-semibold text-mute lg:grid"
        aria-hidden
      >
        <span>Contrato</span>
        <span className="text-right">Valor referencial</span>
        <span>Leído</span>
        <span>Motivo</span>
        <span />
      </div>
      <ul>
        {items.map((item) => (
          <li key={item.procesamiento.ocid} className="border-b border-line/70 last:border-b-0">
            <Fila item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fila({ item: { procesamiento: p, revision } }: { item: AnalisisEnRevision }) {
  const motivos = revision?.motivos ?? [];
  const leido = revision?.analizadoEn ?? p.finalizadoAt;
  const titulo = p.titulo ?? "Contrato sin título en el registro";
  return (
    <Revelar
      titulo={titulo}
      etiqueta={`Ver por qué está en revisión: ${titulo}`}
      descripcion={
        <span className="flex flex-wrap gap-x-3">
          <span>{p.entidad ?? "Entidad no registrada"}</span>
          <span className="font-mono">{p.alertaCodigo ?? p.ocid}</span>
        </span>
      }
      ancho="lg"
      className="px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft"
      detalle={<DetalleMotivos titulo={titulo} motivos={motivos} />}
      pie={
        <Link href={`/app/auditoria/${p.ocid}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-granate hover:underline">
          Ver el análisis completo, fase por fase <ArrowRight size={13} aria-hidden />
        </Link>
      }
    >
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 lg:grid-cols-[minmax(0,1fr)_128px_88px_minmax(0,300px)_20px] lg:items-center">
        <div className="min-w-0">
          <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-ink lg:truncate" title={titulo}>
            {titulo}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-mute">
            {p.entidad ?? "Entidad no registrada"} · {p.zona}
          </p>
        </div>
        <span className="font-mono text-[12.5px] tabular-nums text-inkSoft lg:text-right">
          {p.montoPen != null && p.montoPen > 0 ? soles(p.montoPen) : "Sin dato"}
        </span>
        <span className="text-[12.5px] tabular-nums text-mute">{leido ? fechaCorta(leido) : "Sin fecha"}</span>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {motivos.length === 0 ? (
            <span className="pill border-dashed border-line text-mute">Motivo sin leer</span>
          ) : (
            motivos.map((m) => (
              <span key={m.clave} className="pill border-line bg-paperSoft text-inkSoft">
                {m.titulo}
                {m.valor != null && <span className="font-semibold tabular-nums text-ink">{pct(m.valor)}</span>}
              </span>
            ))
          )}
        </div>
        <ChevronRight size={16} className="hidden text-mute lg:block" aria-hidden />
      </div>
    </Revelar>
  );
}

/** El panel: cada motivo con su medida contra el umbral y las reglas sin respaldo. */
function DetalleMotivos({ titulo, motivos }: { titulo: string; motivos: RevisionMotivo[] }) {
  // La cabecera del panel recorta el título a una línea; el objeto completo va aquí.
  const objeto = titulo.length > 70 ? <p className="mb-4 text-[13px] leading-snug text-inkSoft">{titulo}</p> : null;
  if (motivos.length === 0) {
    return (
      <>
        {objeto}
        <p className="flex items-start gap-2 text-[13px] text-mute">
          <ShieldQuestion size={14} className="mt-0.5 shrink-0" aria-hidden />
          El motivo detallado no se pudo leer. El análisis sigue sin publicarse.
        </p>
      </>
    );
  }
  return (
    <div>
      {objeto}
      <div className="space-y-5">
        {motivos.map((m) => (
          <Motivo key={m.clave} m={m} />
        ))}
      </div>
    </div>
  );
}

/**
 * Un motivo: la medida y su umbral en la misma línea ("33 % · mínimo 60 %"), la
 * barra y lo que lo explica. El número sin su umbral no significa nada.
 */
function Motivo({ m }: { m: RevisionMotivo }) {
  const tieneMedida = m.valor != null && m.umbral != null;
  return (
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="text-[14px] font-semibold text-ink">{m.titulo}</h3>
        {tieneMedida && (
          <span className="text-[12.5px] tabular-nums text-mute">
            <span className="font-semibold text-ink">{pct(m.valor)}</span> · mínimo {pct(m.umbral)}
          </span>
        )}
      </div>
      {tieneMedida && <Medidor valor={m.valor as number} umbral={m.umbral as number} titulo={m.titulo} />}
      <p className="mt-2 text-[13px] leading-relaxed text-inkSoft">{m.detalle}</p>
      {m.reglasEtiquetas && m.reglasEtiquetas.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-mute">
          <span>Sin respaldo localizable:</span>
          {m.reglasEtiquetas.map((r) => (
            <span key={r} className="pill border-line bg-paperSoft text-inkSoft">
              {r}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Valor contra umbral. Barra neutra, no roja: quedar debajo del umbral no es un
 * error del producto, es el control de calidad haciendo su trabajo.
 */
function Medidor({ valor, umbral, titulo }: { valor: number; umbral: number; titulo: string }) {
  const v = Math.max(0, Math.min(1, valor));
  const u = Math.max(0, Math.min(1, umbral));
  return (
    <div
      className="relative mt-2 h-2 w-full overflow-hidden rounded-full bg-paperDeep"
      role="img"
      aria-label={`${titulo}: ${Math.round(v * 100)} por ciento, umbral mínimo ${Math.round(u * 100)} por ciento`}
    >
      <div className="h-full rounded-full bg-mute" style={{ width: `${v * 100}%` }} />
      <span className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `calc(${u * 100}% - 1px)` }} aria-hidden />
    </div>
  );
}

/** Misma forma que la tabla real. */
export function EnRevisionSkeleton({ filas = 6 }: { filas?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line bg-paperSoft px-4 py-2.5">
        <Skeleton className="h-3 w-40" />
      </div>
      <ul>
        {Array.from({ length: filas }).map((_, i) => (
          <li key={i} className="grid grid-cols-1 items-center gap-3 border-b border-line/70 px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_128px_88px_minmax(0,300px)]">
            <div className="space-y-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-5 w-48 rounded-full" />
          </li>
        ))}
      </ul>
    </div>
  );
}
