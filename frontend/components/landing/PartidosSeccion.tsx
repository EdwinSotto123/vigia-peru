import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { PartidosExplorador } from "@/components/partidos/PartidosExplorador";
import { EnlaceFuente, Nota } from "@/components/patrones";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado/Tabla";
import { getEstadoGlobal } from "@/lib/financiamiento";
import { getContratosGeo, getResumenContratos } from "@/lib/contratos";
import { numero, porcentaje } from "@/lib/formato";
import { INFOGOB_JNE } from "@/lib/fuentes";
import { EtiquetaPaso } from "@/components/landing/Recorrido";
import type { Cobertura } from "@/lib/partidos";
import { getRankingPartidos, type RankingPartidos } from "@/lib/partidosApi";

/**
 * "La respuesta", la segunda mitad del pitch (la primera es EscalaDinero: el problema). Un solo mapa
 * con tres lecturas, quién gobierna cada región, cuánto se contrata y qué tanto vigila Vigía, y
 * debajo los partidos en una fila de tarjetas que se desliza a los lados.
 *
 * Es UNA sección, no tres bloques apilados: el mapa y su panel (la ficha de la región y las 5
 * organizaciones con más gobiernos), la tabla de partidos y una sola nota al pie. Las cifras de lo
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
      <div className="container-page relative py-10 sm:py-12">
        <PartidosExplorador
          cobertura={cobertura}
          variante="portada"
          encabezado={
            <div className="max-w-2xl">
              <EtiquetaPaso id="partidos" />
              {/* El titular responde a la pregunta de la primera pantalla («¿En qué se gasta el dinero de tu región?»):
                  antes hablaba de partidos y la sección parecía cambiar de tema. */}
              <h2 id="partidos-titulo" className="text-balance font-display text-cifra font-bold leading-[1.08] sm:text-titulo">
                ¿Quién gobierna tu región y <span className="text-granate">cuánto contrata?</span>
              </h2>
              <p className="mt-2 hidden text-pretty text-cuerpo leading-relaxed text-inkSoft sm:block">
                Con tu ayuda vigilamos a los partidos políticos: quién gobierna cada región, cuánto se contrata en ella y qué
                tanto de eso ya leyó Vigía.
              </p>
            </div>
          }
        />

        {porPartido && porPartido.data.length > 0 && <PorPartido r={porPartido} />}

        <Nota className="mt-4 max-w-4xl">
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

/** Los partidos de la tabla: los que más contratos tienen en sus gobiernos; todos, con buscador, en /app/partidos. */
const TOPE_PARTIDOS = 5;

const COLUMNAS: Columna[] = [
  { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)" },
  { clave: "contratos", titulo: "Contratos", ancho: "110px", alinear: "der" },
  { clave: "leidos", titulo: "Leídos por Vigía", ancho: "180px", desde: "md", apilar: "con-rotulo", corto: "Leídos" },
  { clave: "cola", titulo: "Esperan lectura", ancho: "120px", alinear: "der", desde: "lg" },
];

/**
 * Qué tanto vigilamos a cada partido, en una tabla (2026-11-13; antes, una fila de tarjetas que se deslizaba y cortaba
 * la tercera en el borde). Cada contrato se asocia al partido que gobernaba la entidad el mes en que se convocó (2023 a
 * 2026). La barra de «Contratos» compara los partidos entre sí; la de «Leídos», qué parte de los suyos ya leyó Vigía. Lo
 * demás espera en la cola de lectura (lo más grave va primero). Cada fila abre la ficha del partido.
 */
function PorPartido({ r }: { r: RankingPartidos }) {
  const top = r.data.slice(0, TOPE_PARTIDOS);
  const filas: Fila[] = top.map((x) => {
    const parte = x.contratos > 0 ? x.leidos / x.contratos : 0;
    return {
      id: x.clave,
      href: `/app/partidos/${encodeURIComponent(x.clave)}?anio=${r.anio}`,
      celdas: {
        partido: <CeldaPrincipal titulo={x.nombre} meta={`Contratos de ${numero(x.gobiernosConContratos)} gobiernos`} />,
        contratos: <CeldaNumero>{numero(x.contratos)}</CeldaNumero>,
        leidos: (
          <span className="block w-full">
            <span className="flex items-baseline justify-between gap-2 font-mono text-meta tabular-nums">
              <span className="text-ink">{numero(x.leidos)}</span>
              <span className="text-mute">{porcentaje(parte * 100, { decimales: 1 })}</span>
            </span>
            <CeldaBarra parte={parte} resumen={`${numero(x.leidos)} de ${numero(x.contratos)} leídos`} className="mt-1" />
          </span>
        ),
        cola: <CeldaNumero>{numero(x.enCola)}</CeldaNumero>,
      },
      magnitudes: { contratos: x.contratos },
    };
  });
  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div className="min-w-0">
          <h3 className="font-display text-bloque font-bold leading-tight text-ink">Qué tanto vigilamos a cada partido</h3>
          <p className="mt-0.5 text-meta leading-snug text-inkSoft">
            Contratos de las entidades que gobernó cada uno, de {r.desde.slice(0, 4)} a {r.hasta.slice(0, 4)}.
          </p>
        </div>
        <Link href="/app/partidos" className="inline-flex min-h-10 shrink-0 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
          Ver los {numero(r.data.length)} partidos <ArrowRight size={14} aria-hidden />
        </Link>
      </div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Qué tanto vigilamos a cada partido" densidad="compacta" />
    </div>
  );
}
