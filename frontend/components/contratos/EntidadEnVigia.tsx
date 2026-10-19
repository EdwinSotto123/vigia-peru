import Link from "next/link";
import { numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * "Esta entidad en Vigía": una placa con sus contratos en la base y en qué va cada uno, en una barra partida (leídos,
 * en cola, con documentos listos, sin documentos) con su leyenda; los de riesgo medio o alto, dentro de los leídos.
 * Antes eran cuatro renglones de texto sueltos. Sale de /contratos/resumen?entidad=. Server-safe.
 */
export function EntidadEnVigia({
  ruc,
  total,
  leidos,
  conSenales,
  esperando,
  listos = 0,
}: {
  ruc: string;
  total: number;
  leidos: number;
  conSenales: number;
  /** En cola: esperan quien financie su lectura. */
  esperando: number;
  /** Con sus documentos ya bajados, la lectura en preparación. */
  listos?: number;
}) {
  // Lo que queda (sin documentos todavía) se calcula: los estados de los no leídos suman el total.
  const sinDocumentos = Math.max(0, total - leidos - esperando - listos);
  const tramos = [
    { clave: "leidos", etiqueta: "Leídos", n: leidos, clase: "bg-granate", detalle: conSenales > 0 ? `${numero(conSenales)} de riesgo medio o alto` : null },
    { clave: "cola", etiqueta: "Esperan quien financie su lectura", n: esperando, clase: "bg-granate/45", detalle: null },
    { clave: "listos", etiqueta: "Con documentos, lectura en preparación", n: listos, clase: "bg-granate/20", detalle: null },
    { clave: "sin", etiqueta: "Sin documentos todavía", n: sinDocumentos, clase: "bg-paperDeep", detalle: null },
  ].filter((t) => t.n > 0);
  return (
    <section aria-labelledby="entidad-en-vigia" className="rounded-2xl border border-line bg-paper px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="entidad-en-vigia" className="text-[15px] font-semibold text-ink">
          Esta entidad en Vigía
        </h2>
        <Link
          href={`/entidad/${ruc}`}
          className="text-[13px] font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          Ver su ficha
        </Link>
      </div>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-semibold tabular-nums text-ink">{numero(total)}</span>
        <span className="text-[13px] text-inkSoft">{total === 1 ? "contrato publicado" : "contratos publicados"}</span>
      </p>
      {total > 0 && (
        <>
          <div
            className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-paperDeep"
            role="img"
            aria-label={tramos.map((t) => `${t.etiqueta}: ${numero(t.n)}`).join("; ")}
          >
            {tramos.map((t) => (
              <span key={t.clave} className={cn("h-full", t.clase)} style={{ width: `${(t.n / total) * 100}%` }} />
            ))}
          </div>
          <dl className="mt-3 space-y-1.5 text-[13px]">
            {tramos.map((t) => (
              <div key={t.clave} className="flex items-start justify-between gap-3">
                <dt className="flex min-w-0 items-start gap-2 text-inkSoft">
                  <span aria-hidden className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-sm", t.clase, t.clave === "sin" && "border border-line")} />
                  <span>
                    {t.etiqueta}
                    {t.detalle && <span className="block text-[12px] text-amberTexto">{t.detalle}</span>}
                  </span>
                </dt>
                <dd className="font-mono font-semibold tabular-nums text-ink">{numero(t.n)}</dd>
              </div>
            ))}
          </dl>
          {leidos === 0 && esperando > 0 && (
            <p className="mt-2 text-[12px] text-mute">
              Ninguno leído todavía: {plural(esperando, "espera", "esperan")} que alguien financie su lectura.
            </p>
          )}
        </>
      )}
    </section>
  );
}
