import Link from "next/link";
import { PartidosExplorador } from "@/components/partidos/PartidosExplorador";
import { EnlaceFuente, Nota } from "@/components/patrones";
import { Carrusel } from "@/components/ui/Carrusel";
import { getEstadoGlobal } from "@/lib/financiamiento";
import { getContratosGeo, getResumenContratos } from "@/lib/contratos";
import { numero } from "@/lib/formato";
import { INFOGOB_JNE } from "@/lib/fuentes";
import type { Cobertura } from "@/lib/partidos";
import { getRankingPartidos, type RankingPartidos } from "@/lib/partidosApi";

/**
 * "La respuesta", la segunda mitad del pitch (la primera es EscalaDinero: el problema). Un solo mapa
 * con tres lecturas, quién gobierna cada región, cuánto se contrata y qué tanto vigila Vigía, y
 * debajo los partidos en una fila de tarjetas que se desliza a los lados.
 *
 * Es UNA sección, no tres bloques apilados: el mapa y su panel (la ficha de la región y las 5
 * organizaciones con más gobiernos), el carrusel de partidos y una sola nota al pie. Las cifras de lo
 * que falta ya las cuenta la sección anterior.
 *
 * Reglas de siempre: una señal es para revisar, nunca una acusación; ningún color imita el de un
 * partido; los resultados de 2026 se suman cuando el JNE los proclame. Si la API de contratos no
 * responde, se omite la parte de lectura (nada se estima).
 */

export async function leerCobertura(): Promise<Cobertura | null> {
  const [resumen, regiones, estado] = await Promise.all([
    getResumenContratos().catch(() => null),
    getContratosGeo({ nivel: "departamento" }).catch(() => null),
    getEstadoGlobal().catch(() => null),
  ]);
  if (!resumen || !regiones?.length) return null;
  const porRegion: Cobertura["porRegion"] = {};
  for (const z of regiones) porRegion[z.ubigeo.slice(0, 2)] = {
      total: z.total, leidos: z.procesados, enCola: z.enCola, monto: z.montoPen ?? 0, conSenales: z.conSenales ?? 0,
    };
  const publicados = resumen.total;
  const sinLeer = resumen.porRiesgo.sin_analizar ?? 0;
  const leidos = Math.max(0, publicados - sinLeer);
  return {
    publicados,
    leidos,
    faltan: sinLeer,
    enColaHoy: estado?.colaGlobal ?? 0,
    precioPen: estado?.tarifa.precioPen ?? null,
    regionesConLectura: Object.values(porRegion).filter((r) => r.leidos > 0).length,
    regionesTotal: 25,
    porRegion,
  };
}

export async function PartidosSeccion() {
  const [cobertura, porPartido] = await Promise.all([leerCobertura(), getRankingPartidos(2022)]);
  return (
    <section id="partidos" aria-labelledby="partidos-titulo" className="relative scroll-mt-16 overflow-hidden bg-paper">
      <div aria-hidden className="fondo-puntos-tenue pointer-events-none absolute inset-0" />
      <div className="container-page relative py-12 sm:py-14">
        <PartidosExplorador
          cobertura={cobertura}
          variante="portada"
          encabezado={
            <div className="max-w-2xl">
              <h2 id="partidos-titulo" className="text-balance font-display text-titulo font-bold leading-[1.06] sm:text-vitrina lg:text-portada">
                Con tu ayuda, vigilamos a los <span className="text-granate">partidos políticos.</span>
              </h2>
              <p className="mt-3 hidden text-pretty text-destacado leading-relaxed text-inkSoft sm:block sm:text-bloque">
                Quién gobierna cada región, cuánto se contrata en ella y qué tanto de eso ya leyó Vigía.
              </p>
            </div>
          }
        />

        {porPartido && porPartido.data.length > 0 && <PorPartido r={porPartido} />}

        <Nota className="mt-6 max-w-4xl">
          Cada contrato se asocia al partido que ganó la elección de ese período, sin vacancias ni reemplazos. Resultados de 2026 pendientes.
          Fuente: <EnlaceFuente href={INFOGOB_JNE}>JNE (Infogob)</EnlaceFuente>. Una señal es para revisar, nunca una acusación.{" "}
          <Link href="/preguntas" className="text-granate underline-offset-4 hover:underline">
            Cómo leemos las señales
          </Link>
          .
        </Nota>
      </div>
    </section>
  );
}

/**
 * Qué tanto vigilamos a cada partido, en una fila que se desliza. Cada contrato se asocia al partido
 * que gobernaba la entidad el mes en que se convocó (2023 a 2026). La barra muestra lo leído sobre lo
 * publicado; lo demás espera a que alguien lo financie.
 */
function PorPartido({ r }: { r: RankingPartidos }) {
  const top = r.data.slice(0, 12);
  const maximo = Math.max(...top.map((x) => x.contratos), 1);
  return (
    <div className="mt-7">
      <div className="mb-3 flex items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 max-w-2xl">
          <h3 className="font-display text-xl font-bold leading-tight text-ink sm:text-3xl">Qué tanto vigilamos a cada partido</h3>
          <p className="mt-1 text-dato leading-snug text-inkSoft">
            Contratos de las entidades que gobernó cada uno, de {r.desde.slice(0, 4)} a {r.hasta.slice(0, 4)}.
          </p>
        </div>
        <Link href="/app/partidos" className="inline-flex min-h-11 shrink-0 items-center text-dato font-semibold text-granate underline-offset-4 hover:underline">
          Ver todos
        </Link>
      </div>
      <Carrusel etiqueta="Partidos y sus contratos" anchoTarjeta="w-[82%] sm:w-[17.5rem]" flechas="lateral">
        {top.map((x) => (
          <Link
            key={x.clave}
            href={`/app/partidos/${x.clave}?anio=${r.anio}`}
            className="group flex h-full flex-col rounded-2xl border border-line bg-paperSoft p-4 transition-colors hover:border-granate/50"
          >
            <span className="line-clamp-2 min-h-[2.6rem] text-cuerpo font-semibold leading-snug text-ink group-hover:text-granate">{x.nombre}</span>
            <span className="mt-3 block h-2.5 overflow-hidden rounded-full bg-paperDeep" style={{ width: `${Math.max(14, (x.contratos / maximo) * 100)}%` }} aria-hidden>
              <span className="block h-full rounded-full bg-granate" style={{ width: `${Math.max(x.leidos > 0 ? 5 : 0, (x.leidos / Math.max(x.contratos, 1)) * 100)}%` }} />
            </span>
            <span className="mt-3 font-mono text-meta tabular-nums text-mute">
              {numero(x.contratos)} contratos en {numero(x.gobiernosConContratos)} gobiernos
            </span>
            <span className="mt-1 text-dato text-inkSoft">
              <span className="font-semibold text-ink">{numero(x.leidos)}</span> leídos, <span className="font-semibold text-ink">{numero(x.enCola)}</span> esperando lectura
            </span>
          </Link>
        ))}
      </Carrusel>
    </div>
  );
}
