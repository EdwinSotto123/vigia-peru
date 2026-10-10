import Link from "next/link";
import { FileSearch, HandCoins, Network, type LucideIcon } from "lucide-react";
import { PartidosExplorador } from "@/components/partidos/PartidosExplorador";

/**
 * Monitoreamos a los partidos políticos: quién gobierna cada región, provincia y distrito y
 * qué mira Vigía alrededor de la política. Va en la portada porque es lo que más curiosidad
 * da en época de elecciones: ¿qué partido ganó en mi región?, ¿y en mi distrito?
 *
 * Dos cosas, sin mezclarlas:
 *  1. Los resultados (explorador): quién ganó cada gobierno en las elecciones de 2014, 2018 y 2022, de la Plataforma Electoral
 *     del JNE. Un mapa, un ranking, un duelo y un buscador de distrito. Cuenta quién ganó, no
 *     qué hizo cada gobierno.
 *  2. Lo que Vigía cruza (tres tarjetas): los registros de campañas y candidaturas contra los
 *     contratos. Sólo lo que el producto ya hace hoy; sin cifras de maqueta.
 *
 * Reglas de siempre: una señal es un motivo para revisar, nunca una acusación; ningún color
 * imita el de un partido; y los resultados de 2026 se suman cuando el JNE los proclame.
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

export function PartidosSeccion() {
  return (
    <section id="partidos" aria-labelledby="partidos-titulo" className="relative scroll-mt-16 overflow-hidden bg-paper">
      <div aria-hidden className="fondo-puntos-tenue pointer-events-none absolute inset-0" />
      <div className="container-page relative py-20 sm:py-28">
        <div className="max-w-3xl">
          <p className="etiqueta-mono mb-4 text-granate">Elecciones</p>
          <h2 id="partidos-titulo" className="text-balance font-display text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
            Monitoreamos a los <span className="text-granate">partidos políticos.</span>
          </h2>
          <p className="mt-5 max-w-[58ch] text-pretty text-lg leading-relaxed text-inkSoft">
            ¿Qué partido ganó en tu región? ¿Y en tu distrito? Elige el período electoral, mira quién gobierna donde vives, compara a dos
            organizaciones y descubre qué cruza Vigía alrededor de la política.
          </p>
        </div>

        <div className="mt-10 sm:mt-12">
          <PartidosExplorador />
        </div>

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
