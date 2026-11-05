import Link from "next/link";
import { BarraPartes, PISTA } from "@/components/inicio/BarraPartes";
import { numero } from "@/lib/formato";

/**
 * "Esta entidad en Vigía": una placa con sus contratos en la base (desde 2015) y en qué va cada uno, en una barra
 * partida con su leyenda (`BarraPartes`, la misma de «Sus contratos» en el Inicio de la entidad): leídos (y, dentro, los
 * de riesgo medio o alto), en la cola de lectura (lo más grave va primero), y fuera de la cola (otro tipo, otra etapa o
 * anteriores a la ventana de la cola), con o sin documentos. Antes eran cuatro renglones de texto sueltos. Sale de
 * /contratos/resumen?entidad=. Server-safe.
 *
 * Sin ninguno leído, la barra no dice nada (835 de 839 «fuera de la cola», un tramo de 1 en la cola que no se ve) y
 * debajo se repetía «Ninguno leído todavía: 1 espera en la cola» junto a «En la cola de lectura 1»: en ese caso va una
 * sola línea de cifras (pedido del usuario del 2026-11-05). Lleva UN enlace, a sus contratos: el nombre de la entidad ya
 * lleva a su ficha desde el encabezado, y «Mira más contratos de esta entidad» (OtrosContratosEntidad) ya no va debajo.
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
          href={total > 0 ? `/entidad/${ruc}?seccion=contratos` : `/entidad/${ruc}`}
          prefetch={false}
          className="text-meta font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          {total > 0 ? "Ver sus contratos" : "Ver su ficha"}
        </Link>
      </div>
      {leidos === 0 ? (
        // Nada leído: las cifras en una línea, sin barra.
        <dl className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
          <Cuenta n={total} texto={total === 1 ? "contrato publicado" : "contratos publicados"} />
          {esperando > 0 && <Cuenta n={esperando} texto="en la cola de lectura" />}
          {listos > 0 && <Cuenta n={listos} texto="con documentos, fuera de la cola" />}
          <div>
            <dt className="sr-only">Leídos</dt>
            <dd className="text-meta text-mute">Ninguno leído todavía</dd>
          </div>
        </dl>
      ) : (
        <>
          <p className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-cifra font-semibold tabular-nums text-ink">{numero(total)}</span>
            <span className="text-meta text-inkSoft">{total === 1 ? "contrato publicado" : "contratos publicados"}</span>
          </p>
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
        </>
      )}
    </section>
  );
}

/** Una cifra de la línea: el número y lo que cuenta, en la misma línea. */
function Cuenta({ n, texto }: { n: number; texto: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd className="order-1 font-mono text-destacado font-semibold tabular-nums text-ink">{numero(n)}</dd>
      <dt className="order-2 text-meta text-inkSoft">{texto}</dt>
    </div>
  );
}
