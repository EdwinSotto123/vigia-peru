import Link from "next/link";
import { BarraPartes, PISTA } from "@/components/inicio/BarraPartes";
import { numero, plural } from "@/lib/formato";

/**
 * "Esta entidad en Vigía": una placa con sus contratos en la base (desde 2015) y en qué va cada uno, en una barra
 * partida con su leyenda (`BarraPartes`, la misma de «Sus contratos» en el Inicio de la entidad): leídos (y, dentro, los
 * de riesgo medio o alto), en la cola de lectura (lo más grave va primero), y fuera de la cola (otro tipo, otra etapa o
 * anteriores a la ventana de la cola), con o sin documentos. Antes eran cuatro renglones de texto sueltos. Sale de
 * /contratos/resumen?entidad=. Server-safe.
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
  /** En la cola de lectura (migración 206: se lee con el fondo común, lo más grave primero). */
  esperando: number;
  /** Fuera de la cola, pero con sus documentos ya bajados. */
  listos?: number;
}) {
  // Lo que queda (fuera de la cola, sin documentos) se calcula: los estados de los no leídos suman el total.
  const fuera = Math.max(0, total - leidos - esperando - listos);
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
        <span className="font-mono text-cifra font-semibold tabular-nums text-ink">{numero(total)}</span>
        <span className="text-meta text-inkSoft">{total === 1 ? "contrato publicado" : "contratos publicados"}</span>
      </p>
      {total > 0 && (
        <>
          <BarraPartes
            className="mt-2"
            etiqueta="En qué va cada contrato"
            total={total}
            partes={[
              {
                clave: "leidos",
                etiqueta: "Leídos",
                n: leidos,
                clase: "bg-granate",
                detalle: conSenales > 0 ? `${numero(conSenales)} de riesgo medio o alto` : null,
                tonoDetalle: "text-amberTexto",
              },
              { clave: "cola", etiqueta: "En la cola de lectura", n: esperando, clase: "bg-granate/45", detalle: "lo más grave va primero" },
              { clave: "listos", etiqueta: "Fuera de la cola, con documentos", n: listos, clase: "bg-granate/20" },
              { clave: "sin", etiqueta: "Fuera de la cola", n: fuera, clase: PISTA, detalle: "otro tipo, otra etapa o de años anteriores" },
            ]}
          />
          {leidos === 0 && esperando > 0 && (
            <p className="mt-2 text-rotulo text-mute">
              Ninguno leído todavía: {plural(esperando, "espera", "esperan")} en la cola de lectura.
            </p>
          )}
        </>
      )}
    </section>
  );
}
