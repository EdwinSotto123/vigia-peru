import { ArrowUpRight, Gavel, Search } from "lucide-react";
import { ICONO_SEVERIDAD, veredictoMercado } from "@/components/charts/mercado";
import { cn } from "@/lib/utils";
import { ExploradorFuentes, type CifrasFlujo } from "./ExploradorFuentes";
import { NORMA } from "./fuentesFlujo";

/**
 * De dónde sale cada dato.
 *
 * Es la contracara obligatoria de la sección de agentes: diez agentes leyendo
 * no significa nada si lo que leen sale del modelo. Cada fuente nombrada acá
 * existe y lleva enlace sólo cuando su URL pública está verificada: inventar
 * un link a un portal es inventar un dato.
 *
 * Las fuentes se ordenan por CÓMO llegan:
 *  1. El mapa FUENTES → VIGÍA → RESULTADOS (ExploradorFuentes): cada nodo se
 *     abre en su lugar. Una fuente cuenta en palabras dónde está, en qué llega
 *     y qué se toma; un resultado muestra qué se obtiene, con un gráfico de
 *     cifras reales cuando la portada las tiene.
 *  2. La norma: bibliotecas fijas, no descargas.
 *  3. Las que se consultan en el momento, contrato por contrato.
 *
 * Antes eran catorce tarjetas iguales y el texto prometía "cada registro tiene
 * su propio calendario, marcado abajo" sin mostrar ninguno. Además ONPE
 * figuraba como "se descarga cada mes" junto a "se actualizan solos", y no es
 * así: su portal exige un navegador abierto y esa descarga la lanza una
 * persona. Acá se dice.
 */

export function FuentesSection({ cifras }: { cifras: CifrasFlujo | null }) {
  return (
    <section id="fuentes" aria-labelledby="fuentes-titulo" className="scroll-mt-16 bg-paperSoft py-20 sm:py-24">
      <div className="container-page max-w-[1400px]">
        <h2 id="fuentes-titulo" className="max-w-[30ch] text-balance font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
          Vigía no inventa nada.{" "}
          <span className="text-heroGreenTexto">Cada señal sale de un registro público que puedes revisar.</span>
        </h2>
        <p className="mt-4 max-w-[68ch] text-base leading-relaxed text-inkSoft">
          Si una señal dice que el gerente del proveedor aportó a la campaña del alcalde, hay un registro de ONPE
          detrás. Si dice que el requisito direcciona, hay un artículo de ley citado y la página exacta del documento
          donde está. Y cuando algo es una estimación, lo dice. Toca una fuente para ver dónde está y qué tomamos de ella, o un resultado para ver qué
          información sale de todo eso.
        </p>

        {/* ── 1. Las que se descargan ─────────────────────────────────── */}
        {/* La "próxima descarga" la calcula cada ficha con el reloj del
            navegador al abrirse: la portada es ISR y un `ahora` del servidor
            podía llegar con días de atraso. */}
        <ExploradorFuentes cifras={cifras} />

        {/* ── 2 y 3. La norma, y lo que se consulta en el momento ─────────── */}
        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <section aria-labelledby="fuentes-norma" className="rounded-2xl bg-heroViolet-deep p-6 text-paper sm:p-8 lg:col-span-7">
            <h3 id="fuentes-norma" className="flex items-center gap-2.5">
              <Gavel size={17} className="shrink-0 text-heroGreen" aria-hidden />
              <span className="font-serif text-2xl font-bold">La norma</span>
              <span className="ml-auto font-mono text-[12px] font-normal text-paper/60">{NORMA.length}</span>
            </h3>
            <p className="mt-2 max-w-[54ch] text-sm leading-relaxed text-paper/75">
              {/* Cifras de docs/design/RAG_NORMATIVO.md (contenido del bucket gs://vigia-peru-rag). */}
              Cuatro bibliotecas legales: 1,176 artículos y 721 opiniones del OECE. Por eso cada señal puede
              citar el artículo exacto.
            </p>
            <ul className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2">
              {NORMA.map((n) => (
                <li key={n.nombre} className="border-t border-paper/15 pt-4">
                  <p className="font-serif text-3xl font-bold leading-none">{n.sigla}</p>
                  {n.url ? (
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group mt-3 inline-flex items-center gap-1 rounded-sm text-[13px] font-semibold underline decoration-paper/30 underline-offset-4 transition-colors duration-rapido hover:decoration-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroGreen focus-visible:ring-offset-2 focus-visible:ring-offset-heroViolet-deep"
                    >
                      {n.nombre}
                      <ArrowUpRight size={13} className="transition-transform duration-rapido group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
                      <span className="sr-only">(se abre en una pestaña nueva)</span>
                    </a>
                  ) : (
                    <p className="mt-3 text-[13px] font-semibold">{n.nombre}</p>
                  )}
                  <p className="mt-1 text-[12.5px] leading-relaxed text-paper/70">{n.aporta}</p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="fuentes-momento" className="rounded-2xl border border-line bg-paper p-6 shadow-card sm:p-8 lg:col-span-5">
            <h3 id="fuentes-momento" className="flex items-center gap-2.5">
              <Search size={17} className="shrink-0 text-heroViolet" aria-hidden />
              <span className="font-serif text-2xl font-bold text-ink">Al leer cada contrato</span>
              <span className="ml-auto font-mono text-[12px] font-normal text-mute">2</span>
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-inkSoft">
              Dos fuentes no tienen calendario: se consultan en el momento, para el contrato que se está leyendo.
            </p>
            <ul className="mt-6 space-y-5">
              <li className="border-t border-line pt-4">
                <p className="text-[14px] font-semibold text-ink">Personal de entidades</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
                  Los designados de confianza, que no aparecen en ningún registro electoral. Se buscan en las
                  resoluciones de la propia entidad.
                </p>
              </li>
              <li className="border-t border-line pt-4">
                <p className="text-[14px] font-semibold text-ink">Búsqueda de precios al momento</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-mute">
                  Precios reales peruanos para los ítems del contrato. Es lo único que no es un registro público, y
                  por eso cada veredicto dice de dónde salió:
                </p>
                {/* Las dos pastillas son las del informe real (vocabulario de
                    components/charts/mercado.ts), no una maqueta. */}
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <Veredicto clave="alineado" nota="medido con precios encontrados" />
                  <Veredicto clave="estimado_ia" nota="cuando no aparecen suficientes precios" />
                </div>
              </li>
            </ul>
          </section>
        </div>

        {/* La promesa cierra la sección: es la regla que sostiene a todas. */}
        <div className="mt-12 border-t border-line pt-8 sm:mt-14">
          <p className="max-w-[34ch] text-balance font-serif text-2xl font-bold leading-snug text-ink sm:text-3xl">
            Si un dato no está, queda vacío.
          </p>
          <p className="mt-3 max-w-[65ch] text-base leading-relaxed text-inkSoft">
            No se rellena el hueco con un valor plausible: un dato inventado en una herramienta anticorrupción vale
            lo mismo que una acusación inventada.
          </p>
        </div>
      </div>
    </section>
  );
}

/** Una pastilla de veredicto tal como sale en el informe, con una línea de qué significa. */
function Veredicto({ clave, nota }: { clave: string; nota: string }) {
  const v = veredictoMercado(clave);
  const Icono = ICONO_SEVERIDAD[v.ui.icono];
  return (
    <div className="rounded-xl bg-paperSoft px-3 py-2.5">
      <span className={cn("pill", v.ui.fondo, v.ui.texto, v.ui.borde)}>
        <Icono size={11} aria-hidden />
        {v.etiqueta}
      </span>
      <p className="mt-1.5 text-[11.5px] leading-snug text-mute">{nota}</p>
    </div>
  );
}
