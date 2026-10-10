import Link from "next/link";
import { FileSearch, HandCoins, Network, type LucideIcon } from "lucide-react";
import { PartidosExplorador } from "@/components/partidos/PartidosExplorador";
import { getEstadoGlobal } from "@/lib/financiamiento";
import { getContratosGeo, getResumenContratos } from "@/lib/contratos";
import { numero, porcentaje } from "@/lib/formato";
import type { Cobertura } from "@/lib/partidos";
import { EnlaceAccion } from "./EnlaceAccion";

/**
 * "Con tu ayuda, vigilamos a los partidos políticos." Quién gobierna cada región, provincia y
 * distrito, y lo que hace falta para vigilarlos de verdad: que se lean los contratos de cada
 * gobierno. Va en la portada porque en época de elecciones es lo que más curiosidad da (¿qué
 * partido ganó en mi región?, ¿y en mi distrito?) y porque conecta con lo que Vigía necesita:
 * lectores, o sea gente que financie la lectura.
 *
 * Tres bloques, sin mezclarlos:
 *  1. El explorador: quién ganó cada gobierno en 2014, 2018 y 2022 (JNE), y un segundo modo del
 *     mapa, "qué tanto vigilamos", con los contratos que Vigía ya leyó en cada región.
 *  2. Lo que falta, a detalle: cuántos contratos se leyeron, cuántos faltan, cuántos ya se
 *     pueden financiar y en cuántas regiones aún no se lee nada. Todo sale de la API.
 *  3. Lo que Vigía cruza al leer: aportes de campaña y autoridades contra proveedores.
 *
 * Reglas de siempre: una señal es para revisar, nunca una acusación; ningún color imita el de un
 * partido; los resultados de 2026 se suman cuando el JNE los proclame. Si la API de contratos no
 * responde, se omite la parte de lectura (nada se estima).
 */

const CRUCES: { Icono: LucideIcon; titulo: string; texto: string }[] = [
  {
    Icono: HandCoins,
    titulo: "Quién aportó a la campaña",
    texto: "Los aportes declarados a ONPE se cruzan con quienes ganan contratos: una empresa que financió una campaña y luego gana en esa gestión.",
  },
  {
    Icono: Network,
    titulo: "Quién es quién en el municipio",
    texto: "Autoridades y candidatos del JNE se cruzan con socios y firmantes de los proveedores, y con el partido del municipio que contrata.",
  },
  {
    Icono: FileSearch,
    titulo: "Todo con su fuente",
    texto: "Cada cruce muestra el registro de donde sale. Un cruce es un motivo para mirar más de cerca, no una acusación.",
  },
];

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
  const cobertura = await leerCobertura();
  return (
    <section id="partidos" aria-labelledby="partidos-titulo" className="relative scroll-mt-16 overflow-hidden bg-paper">
      <div aria-hidden className="fondo-puntos-tenue pointer-events-none absolute inset-0" />
      <div className="container-page relative py-20 sm:py-28">
        <div className="max-w-3xl">
          <p className="etiqueta-mono mb-4 text-granate">El mapa</p>
          <h2 id="partidos-titulo" className="text-balance font-display text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
            Con tu ayuda, vigilamos a los <span className="text-granate">partidos políticos.</span>
          </h2>
          <p className="mt-5 max-w-[60ch] text-pretty text-lg leading-relaxed text-inkSoft">
            Un solo mapa con tres lecturas. Quién gobierna cada región, cuánto dinero se contrata en ella y qué tanto de eso ya leyó
            Vigía. Cambia de lectura arriba del mapa y toca tu región.
          </p>
        </div>

        <div className="mt-10 sm:mt-12">
          <PartidosExplorador cobertura={cobertura} />
        </div>

        {cobertura && <LoQueFalta c={cobertura} />}

        <ul className="mt-12 grid gap-3 md:grid-cols-3">
          {CRUCES.map(({ Icono, titulo, texto }) => (
            <li key={titulo} className="flex items-start gap-3.5 rounded-2xl border border-line bg-paperSoft p-4 sm:p-5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-granate-soft text-granate" aria-hidden>
                <Icono size={19} />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold leading-snug text-ink">{titulo}</span>
                <span className="mt-1 block text-[14px] leading-snug text-inkSoft">{texto}</span>
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-6 max-w-3xl text-[13px] leading-relaxed text-mute">
          Esto muestra quién ganó en las Elecciones Regionales y Municipales de 2014, 2018 y 2022, no qué hizo cada gobierno. Los resultados
          de 2026 se suman cuando el JNE los proclame. Una señal de Vigía es para revisar, nunca una acusación.{" "}
          <Link href="/preguntas" className="text-granate underline-offset-4 hover:underline">
            Cómo leemos las señales
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

/** Lo que falta, a detalle: cuánto se leyó, cuánto falta y qué se puede financiar hoy. */
function LoQueFalta({ c }: { c: Cobertura }) {
  const pct = c.publicados > 0 ? (c.leidos / c.publicados) * 100 : 0;
  const noFinanciables = Math.max(0, c.faltan - c.enColaHoy);
  const sinLectura = c.regionesTotal - c.regionesConLectura;
  const costoCola = c.precioPen != null ? c.precioPen * c.enColaHoy : null;
  const cifras: { valor: string; etiqueta: string; detalle: string; fuerte?: boolean }[] = [
    {
      valor: numero(c.leidos),
      etiqueta: "contratos leídos",
      detalle: `${porcentaje(pct, { decimales: 1 })} de los ${numero(c.publicados)} publicados`,
      fuerte: true,
    },
    {
      valor: numero(c.faltan),
      etiqueta: "faltan por leer",
      detalle: "Ahí están los contratos de los gobiernos que aún no podemos vigilar",
    },
    {
      valor: numero(c.enColaHoy),
      etiqueta: "se pueden financiar hoy",
      detalle: costoCola != null ? `Leerlos todos cuesta S/ ${numero(costoCola)}, a S/ ${numero(c.precioPen ?? 0)} cada uno` : "Ya tienen sus documentos y están adjudicados",
    },
    {
      valor: `${numero(c.regionesConLectura)} de ${numero(c.regionesTotal)}`,
      etiqueta: "regiones con lectura",
      detalle: sinLectura > 0 ? `En ${numero(sinLectura)} regiones todavía no se leyó ningún contrato` : "En todas hay al menos un contrato leído",
    },
  ];
  return (
    <div className="mt-8 rounded-2xl border border-granate/35 bg-granate-50 p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div className="max-w-2xl">
          <h3 className="font-display text-2xl font-bold leading-tight text-ink sm:text-3xl">Hoy vigilamos poco. Esto es lo que falta.</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-inkSoft">
            Cada contrato que se lee se cruza con aportes de campaña y con las autoridades electas. Mientras más se lee, más gobiernos y más
            partidos podemos mirar de cerca.
          </p>
        </div>
        <EnlaceAccion href="/app/financiar" tamano="lg">
          Financiar una lectura
        </EnlaceAccion>
      </div>

      {/* La barra: lo leído es una rendija. */}
      <div className="mt-6" aria-hidden>
        <div className="h-3 overflow-hidden rounded-full bg-paperDeep">
          <div className="h-full rounded-full bg-granate" style={{ width: `${Math.max(1.2, pct)}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[11.5px] tabular-nums text-mute">
          <span>0</span>
          <span>{numero(c.publicados)} contratos</span>
        </div>
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cifras.map((x) => (
          <div key={x.etiqueta} className="rounded-xl border border-line bg-paperSoft p-4">
            <dd className={"font-display text-3xl font-bold leading-none tabular-nums sm:text-4xl " + (x.fuerte ? "text-granate" : "text-ink")}>{x.valor}</dd>
            <dt className="mt-2 text-[14px] font-semibold text-ink">{x.etiqueta}</dt>
            <dd className="mt-1 text-[13px] leading-snug text-mute">{x.detalle}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[13px] leading-relaxed text-mute">
        De los {numero(c.faltan)} que faltan, {numero(c.enColaHoy)} ya pueden financiarse hoy y {numero(noFinanciables)} todavía no: les falta
        adjudicarse o que se descarguen sus documentos. La región es la sede de la entidad que contrata.
      </p>
    </div>
  );
}
