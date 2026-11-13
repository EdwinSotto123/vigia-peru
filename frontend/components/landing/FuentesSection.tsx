import { ArrowUpRight, Gavel, Search } from "lucide-react";
import { ICONO_SEVERIDAD, veredictoMercado } from "@/components/charts/mercado";
import { cn } from "@/lib/utils";
import { ExploradorFuentes, type CifrasFlujo } from "./ExploradorFuentes";
import { NORMA } from "./fuentesFlujo";

/**
 * De dónde sale cada dato: la pestaña «De dónde sale» de «Cómo trabaja Vigía» (ComoFunciona). Hasta el 2026-11-13 era
 * una banda propia de 1,8 pantallas (3,6 en el celular) con su titular y dos párrafos; el titular «Vigía no inventa
 * nada» pasó a la sección, y la norma y lo que se consulta al momento, a dos cajas lado a lado más bajas.
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
    <div className="space-y-4">
      {/* ── 1. Las que se descargan ─────────────────────────────────── */}
      {/* La "próxima descarga" la calcula cada ficha con el reloj del navegador al abrirse: la portada es ISR y un
          `ahora` del servidor podía llegar con días de atraso. */}
      <ExploradorFuentes cifras={cifras} />

      {/* ── 2 y 3. La norma, y lo que se consulta en el momento ─────────── */}
      <div className="grid gap-4 lg:grid-cols-12">
        <section aria-labelledby="fuentes-norma" className="sobre-oscuro rounded-2xl bg-granate-deep p-4 text-paper sm:p-5 lg:col-span-7">
          <h3 id="fuentes-norma" className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Gavel size={16} className="shrink-0 text-maiz" aria-hidden />
            <span className="font-display text-bloque font-bold">La norma</span>
          </h3>
          <p className="mt-1 text-meta leading-relaxed text-paper/75">
            {/* Cifras de docs/design/RAG_NORMATIVO.md (contenido del bucket gs://vigia-peru-rag). */}
            Cuatro bibliotecas legales: 1,176 artículos y 721 opiniones del OECE. Por eso cada señal puede citar el artículo exacto.
          </p>
          <ul className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
            {NORMA.map((n) => (
              <li key={n.nombre} className="min-w-0 border-t border-paper/15 pt-2.5">
                <p className="font-display text-seccion font-bold leading-none text-maiz">{n.sigla}</p>
                {n.url ? (
                  <a
                    href={n.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group mt-2 inline-flex items-center gap-1 rounded-sm text-meta font-semibold underline decoration-maiz/50 underline-offset-4 transition-colors duration-rapido hover:decoration-maiz focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maiz focus-visible:ring-offset-2 focus-visible:ring-offset-granate-deep"
                  >
                    {n.nombre}
                    <ArrowUpRight size={13} className="transition-transform duration-rapido group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden />
                    <span className="sr-only">(se abre en una pestaña nueva)</span>
                  </a>
                ) : (
                  <p className="mt-2 text-meta font-semibold">{n.nombre}</p>
                )}
                <p className="mt-0.5 text-rotulo leading-snug text-paper/75">{n.aporta}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="fuentes-momento" className="rounded-2xl border border-line bg-paper p-4 sm:p-5 lg:col-span-5">
          <h3 id="fuentes-momento" className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Search size={16} className="shrink-0 text-granate" aria-hidden />
            <span className="font-display text-bloque font-bold text-ink">Al leer cada contrato</span>
          </h3>
          <p className="mt-1 text-meta leading-relaxed text-inkSoft">
            Dos fuentes no tienen calendario: se consultan en el momento, para el contrato que se está leyendo.
          </p>
          <ul className="mt-3 space-y-3">
            <li className="border-t border-line pt-2.5">
              <p className="text-dato font-semibold text-ink">Personal de entidades</p>
              <p className="mt-0.5 text-meta leading-relaxed text-inkSoft">
                Los designados de confianza, que no aparecen en ningún registro electoral. Se buscan en las resoluciones de
                la propia entidad.
              </p>
            </li>
            <li className="border-t border-line pt-2.5">
              <p className="text-dato font-semibold text-ink">Búsqueda de precios al momento</p>
              <p className="mt-0.5 text-meta leading-relaxed text-inkSoft">
                Precios reales peruanos para los ítems del contrato. Es lo único que no es un registro público, y por eso
                cada veredicto dice de dónde salió:
              </p>
              {/* Las dos pastillas son las del informe real (vocabulario de components/charts/mercado.ts), no una maqueta. */}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Veredicto clave="alineado" nota="medido con precios encontrados" />
                <Veredicto clave="estimado_ia" nota="cuando no aparecen suficientes precios" />
              </div>
            </li>
          </ul>
        </section>
      </div>
    </div>
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
      <p className="mt-1.5 text-rotulo leading-snug text-mute">{nota}</p>
    </div>
  );
}
