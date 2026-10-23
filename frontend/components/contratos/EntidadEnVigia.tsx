import Link from "next/link";
import { numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * "Esta entidad en Vigía": una placa con sus contratos en la base (desde 2015) y en qué va cada uno, en una barra
 * partida con su leyenda: leídos (y, dentro, los de riesgo medio o alto), en la cola esperando quien financie su
 * lectura, y fuera de la cola (otro tipo, otra etapa o anteriores a la ventana de la cola), con o sin documentos.
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
  /** Fuera de la cola, pero con sus documentos ya bajados. */
  listos?: number;
}) {
  // Lo que queda (fuera de la cola, sin documentos) se calcula: los estados de los no leídos suman el total.
  const fuera = Math.max(0, total - leidos - esperando - listos);
  const tramos = [
    { clave: "leidos", etiqueta: "Leídos", n: leidos, clase: "bg-granate", detalle: conSenales > 0 ? `${numero(conSenales)} de riesgo medio o alto` : null },
    { clave: "cola", etiqueta: "En la cola: esperan quien financie su lectura", n: esperando, clase: "bg-granate/45", detalle: null },
    { clave: "listos", etiqueta: "Fuera de la cola, con documentos", n: listos, clase: "bg-granate/20", detalle: null },
    { clave: "sin", etiqueta: "Fuera de la cola", n: fuera, clase: "bg-paperDeep", detalle: "otro tipo, otra etapa o de años anteriores" },
  ].filter((t) => t.n > 0);
  return (
    <section aria-labelledby="entidad-en-vigia" className="rounded-2xl border border-line bg-paper px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="entidad-en-vigia" className="font-display text-bloque font-bold text-ink">
          Esta entidad en Vigía
        </h2>
        <Link
          href={`/entidad/${ruc}`}
          className="text-meta font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          Ver su ficha
        </Link>
      </div>
      <p className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-2xl font-semibold tabular-nums text-ink">{numero(total)}</span>
        <span className="text-meta text-inkSoft">{total === 1 ? "contrato publicado" : "contratos publicados"}</span>
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
          <dl className="mt-3 space-y-1.5 text-meta">
            {tramos.map((t) => (
              <div key={t.clave} className="flex items-start justify-between gap-3">
                <dt className="flex min-w-0 items-start gap-2 text-inkSoft">
                  <span aria-hidden className={cn("mt-1 h-2.5 w-2.5 shrink-0 rounded-sm", t.clase, t.clave === "sin" && "border border-line")} />
                  <span>
                    {t.etiqueta}
                    {t.detalle && <span className={cn("block text-rotulo", t.clave === "leidos" ? "text-amberTexto" : "text-mute")}>{t.detalle}</span>}
                  </span>
                </dt>
                <dd className="font-mono font-semibold tabular-nums text-ink">{numero(t.n)}</dd>
              </div>
            ))}
          </dl>
          {leidos === 0 && esperando > 0 && (
            <p className="mt-2 text-rotulo text-mute">
              Ninguno leído todavía: {plural(esperando, "espera", "esperan")} que alguien financie su lectura.
            </p>
          )}
        </>
      )}
    </section>
  );
}
