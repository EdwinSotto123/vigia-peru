import { LUGAR_LIBRE, PodioRanking } from "@/components/aliados/Podio";
import { clasificar } from "@/components/aliados/ranking";
import { getEstadoGlobal, getRankingPaginado } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";
import { EnlaceAccion } from "./EnlaceAccion";

/**
 * El podio, arriba (iteración 2 de la identidad Píxel): quienes hacen posible que Vigía
 * lea. Va justo después de la escala del dinero, porque es la respuesta a "¿quién paga
 * esto?" y lo primero que quien llega quiere saber para sumarse.
 *
 * Es el mismo `PodioRanking` de /app/aliados, en su versión `destacado`: más grande, con
 * halo lima y chispas de píxel, y cada puesto se toca para ver QUIÉN es el aliado sin salir
 * de la portada (panel con su descripción, sus enlaces y lo que hizo leer).
 *
 * Mismas reglas que el ranking: se cuenta en CONTRATOS, nunca en soles; sólo aliados reales
 * (los puestos que faltan se ven libres, que es una invitación); y si el registro no
 * responde, la sección no se dibuja: una portada que estima lo que no sabe es lo que este
 * producto le reprocha al Estado.
 */

/** Filas que se piden: los aportes sin nombre no ocupan puesto, y el podio necesita tres con nombre. */
const TOPE = 12;

export async function PodioPortada() {
  const [ranking, estado] = await Promise.all([
    getRankingPaginado({ periodo: "todo", limit: TOPE }),
    getEstadoGlobal().catch(() => null),
  ]);
  if (ranking == null) return null;
  const podio = clasificar(ranking.data ?? []).slice(0, 3);

  const cifras: { valor: number; etiqueta: string }[] = estado
    ? [
        { valor: estado.contratosFinanciados, etiqueta: "contratos pagados por aliados" },
        { valor: estado.contratosProcesados, etiqueta: "de ellos, ya leídos" },
        { valor: estado.senalesHalladas, etiqueta: "señales para revisar" },
      ]
    : [];

  return (
    <section
      id="podio"
      data-tema="oscuro"
      aria-labelledby="podio-portada-titulo"
      className="sobre-oscuro relative scroll-mt-16 overflow-hidden bg-ink text-paper"
    >
      <div aria-hidden className="fondo-puntos-tenue pointer-events-none absolute inset-0" />
      <div className="container-page relative py-16 sm:py-24">
        <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="max-w-3xl">
            <p className="etiqueta-mono mb-4 text-maiz">Nos financiamos con donaciones</p>
            <h2
              id="podio-portada-titulo"
              className="text-balance font-display text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl"
            >
              Quienes hacen posible que Vigía <span className="text-maiz">lea.</span>
            </h2>
            <p className="mt-5 max-w-[56ch] text-pretty text-lg leading-relaxed text-paper/75">
              Ver todo en Vigía es gratis: cada contrato leído lo pagó una persona, un colectivo o una empresa. Tú también puedes
              poner tu granito de arena. Toca un nombre para ver quién es y qué hizo leer.
            </p>
          </div>
        </div>

        {cifras.length > 0 && (
          <dl className="mt-10 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-paper/15 bg-paper/15">
            {cifras.map((c) => (
              <div key={c.etiqueta} className="bg-ink p-4 sm:p-6">
                <dd className="font-display text-3xl font-bold leading-none tabular-nums text-maiz sm:text-5xl">{numero(c.valor)}</dd>
                <dt className="mt-2 text-[13px] leading-snug text-paper/70 sm:text-[15px]">{c.etiqueta}</dt>
              </div>
            ))}
          </dl>
        )}

        <div className="mt-10 sm:mt-12">
          <PodioRanking
            filas={podio}
            titulo="Quienes más contratos hicieron leer"
            nivel={3}
            lugarLibre={LUGAR_LIBRE}
            destacado
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {podio.length > 0 && (
            <EnlaceAccion href="/app/aliados" variante="oscuro" tamano="lg">
              Ver el ranking completo
            </EnlaceAccion>
          )}
        </div>
      </div>
    </section>
  );
}
