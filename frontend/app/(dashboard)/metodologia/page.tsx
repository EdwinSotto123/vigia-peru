import type { Metadata } from "next";
import Link from "next/link";
import { Database, FileSearch, Scale, ScanText, ShieldCheck } from "lucide-react";
import { EncabezadoPagina, Migas, Nota, Pagina, Seccion } from "@/components/patrones";
import { Severidad } from "@/components/ui/Severidad";
import { CORTE_ALTA, CORTE_MEDIA } from "@/lib/severidad";
import { canonica } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Metodología",
  description:
    "Cómo trabaja Vigía: qué es un dato oficial, qué es un cruce, qué lee la IA, cómo se calcula el puntaje de un dictamen y qué no prueba una señal.",
  alternates: canonica("/metodologia"),
};

const ENLACE = "font-medium text-ink underline underline-offset-2 transition-colors hover:text-granate";

/**
 * Los pesos del puntaje. Son los de `backend/agent/tools/persistence/shared.py` (`_PESOS` y `_PESOS_DEFAULT`): si cambian
 * allá, cambian acá. Los cortes no se escriben: salen de lib/severidad.ts, la única fuente.
 */
const PESOS: { origen: string; explica: string; alta: number; media: number; baja: number }[] = [
  { origen: "Reglas de cumplimiento de la norma", explica: "Plazos, topes, impedimentos y sanciones que se comprueban contra el registro oficial.", alta: 35, media: 18, baja: 8 },
  { origen: "Las demás señales", explica: "Precio frente al mercado, lectura de documentos, red del proveedor y prensa.", alta: 25, media: 12, baja: 5 },
];

/** Las cuatro clases de información que muestra Vigía, de la más firme a la más interpretada. */
const CLASES: { icono: typeof Database; titulo: string; texto: string; ejemplo: string }[] = [
  {
    icono: Database,
    titulo: "Dato oficial",
    texto: "Lo que publica una entidad del Estado, tal como lo publica. Vigía lo copia y enlaza al registro de origen.",
    ejemplo: "El monto adjudicado en el SEACE, una sanción del OECE, el presupuesto del MEF.",
  },
  {
    icono: Scale,
    titulo: "Cruce de registros",
    texto: "Una regla fija que compara dos registros oficiales. No interviene ningún modelo de IA y no lleva puntaje, solo una gravedad.",
    ejemplo: "El proveedor tiene una sanción vigente; la empresa se fundó poco antes de ganar.",
  },
  {
    icono: ScanText,
    titulo: "Lectura con IA",
    texto: "Un modelo lee el PDF del expediente y llena un formulario con lo que encuentra, con la página de donde lo sacó. La señal sale de una regla sobre ese formulario.",
    ejemplo: "Cuántos postores quedaron fuera según el acta, qué marca piden las bases.",
  },
  {
    icono: FileSearch,
    titulo: "Dictamen",
    texto: "El informe que redacta un modelo con todo lo anterior. Es una interpretación para orientar la revisión, y lleva el puntaje.",
    ejemplo: "«Qué pasó» y «Por qué importa» en la ficha de un contrato analizado.",
  },
];

const PASOS: { titulo: string; texto: string }[] = [
  { titulo: "Se copia el registro", texto: "Cada fuente se descarga con su frecuencia y se guarda con la fecha hasta la que llega." },
  { titulo: "Se cruzan los registros", texto: "Reglas fijas comparan contratos, proveedores, sanciones, socios, visitas y aportes de campaña." },
  { titulo: "Se leen los documentos", texto: "Actas, bases, consultas y contratos se leen con IA. Un documento con una posible señal se lee una segunda vez por separado." },
  { titulo: "Se comprueba cada señal", texto: "Antes de guardarse, cada señal se verifica contra su evidencia. Si no se sostiene, se descarta." },
  { titulo: "Se redacta y se controla el dictamen", texto: "El informe pasa por controles automáticos. Si no los pasa queda «En revisión» y no se publican su puntaje ni sus señales." },
];

/**
 * Metodología: cómo se llega de un registro público a una señal y a un puntaje. Antes esto estaba repartido entre el «?»
 * de cada cifra, las preguntas frecuentes, «Lo que leyó la IA» y la auditoría en vivo, y no había un solo lugar al que
 * enlazar desde una ficha (auditoría de producto del 2026-11-12, hallazgo 1).
 */
export default function MetodologiaPage() {
  return (
    <Pagina ancho="lectura">
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Metodología", href: "/metodologia" }]} />
      <EncabezadoPagina
        titulo="Metodología"
        bajada="Cómo se llega de un registro público a una señal, y qué significa el puntaje de un dictamen."
      />

      <Nota icono={<ShieldCheck size={15} aria-hidden />}>
        Una señal es un indicio para revisar, no una acusación. Vigía no determina responsabilidades: eso le corresponde a
        la Contraloría, al Ministerio Público y al Poder Judicial.
      </Nota>

      <Seccion titulo="Cuatro clases de información" descripcion="No todo lo que ves pesa igual. De lo más firme a lo más interpretado.">
        <ul className="grid gap-3 sm:grid-cols-2">
          {CLASES.map(({ icono: Icono, titulo, texto, ejemplo }) => (
            <li key={titulo} className="rounded-xl border border-line bg-paper p-4">
              <p className="flex items-center gap-2 text-destacado font-semibold text-ink">
                <Icono size={16} className="shrink-0 text-granate" aria-hidden />
                {titulo}
              </p>
              <p className="mt-1.5 text-dato leading-relaxed text-inkSoft">{texto}</p>
              <p className="mt-2 text-meta text-mute">Por ejemplo: {ejemplo}</p>
            </li>
          ))}
        </ul>
      </Seccion>

      <Seccion titulo="Del registro a la señal" descripcion="Los cinco pasos, en orden. El orden lo fija el código, no un modelo.">
        <ol className="space-y-3">
          {PASOS.map((p, i) => (
            <li key={p.titulo} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-paperDeep font-mono text-rotulo font-semibold text-ink" aria-hidden>
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-dato font-semibold text-ink">{p.titulo}</span>
                <span className="block text-dato leading-relaxed text-inkSoft">{p.texto}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-meta text-inkSoft">
          Qué modelos leen y cuántos documentos van leídos está en{" "}
          <Link href="/app/ia" className={ENLACE}>Lo que leyó la IA</Link>.
        </p>
      </Seccion>

      <Seccion
        id="puntaje"
        titulo="Cómo se calcula el puntaje"
        descripcion="Solo los contratos con dictamen tienen puntaje. Va de 0 a 100 y no es una probabilidad."
      >
        <p className="text-dato leading-relaxed text-inkSoft">
          El puntaje suma el peso de cada señal del contrato, con tope de 100. El peso depende de la gravedad de la señal y
          de dónde sale:
        </p>
        <div className="mt-3 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-dato">
            <caption className="sr-only">Puntos que suma una señal según su origen y su gravedad</caption>
            <thead className="bg-paperSoft text-meta text-mute">
              <tr>
                <th scope="col" className="px-3.5 py-2 font-medium">De dónde sale la señal</th>
                <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3.5">Alta</th>
                <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3.5">Media</th>
                <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3.5">Baja</th>
              </tr>
            </thead>
            <tbody>
              {PESOS.map((p) => (
                <tr key={p.origen} className="border-t border-line">
                  <th scope="row" className="px-3.5 py-2.5 font-normal">
                    <span className="block font-semibold text-ink">{p.origen}</span>
                    <span className="block text-meta text-mute">{p.explica}</span>
                  </th>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-ink sm:px-3.5">{p.alta}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-ink sm:px-3.5">{p.media}</td>
                  <td className="px-2 py-2.5 text-right font-mono tabular-nums text-ink sm:px-3.5">{p.baja}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="mt-4 space-y-2 text-dato leading-relaxed text-inkSoft">
          <li>
            <strong className="font-semibold text-ink">Un mismo hecho no cuenta dos veces.</strong> «Único postor con oferta
            alta» y «Oferta igual al valor referencial» salen de la misma oferta: las dos se muestran, pero la de menor peso
            suma la mitad.
          </li>
          <li>
            <strong className="font-semibold text-ink">Hay señales que informan y no suman.</strong> Un dato de contexto se
            muestra en la ficha sin aportar al puntaje.
          </li>
        </ul>

        <h3 className="mt-6 text-destacado font-semibold text-ink">Los niveles</h3>
        <dl className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <dt><Severidad score={CORTE_ALTA} /></dt>
            <dd className="text-dato text-inkSoft">{CORTE_ALTA} puntos o más.</dd>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <dt><Severidad score={CORTE_MEDIA} /></dt>
            <dd className="text-dato text-inkSoft">De {CORTE_MEDIA} a {CORTE_ALTA - 1} puntos.</dd>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <dt><Severidad score={CORTE_MEDIA - 1} /></dt>
            <dd className="text-dato text-inkSoft">Menos de {CORTE_MEDIA} puntos.</dd>
          </div>
        </dl>
      </Seccion>

      <Seccion titulo="Lo que una señal no prueba">
        <ul className="space-y-2 text-dato leading-relaxed text-inkSoft">
          <li>No prueba un delito ni una infracción. Describe un hecho que conviene revisar con el expediente en la mano.</li>
          <li>Un puntaje alto dice que se juntaron varias señales, no que el contrato sea irregular.</li>
          <li>Un contrato sin señales no está «aprobado»: puede no haberse leído todavía o no tener documentos publicados.</li>
          <li>Los contratos con dictamen son una parte de los publicados, así que sus porcentajes no valen para todo el Estado.</li>
          <li>Un cruce por nombre, sin número de documento, puede ser un homónimo: confírmalo en la fuente antes de darlo por cierto.</li>
        </ul>
      </Seccion>

      <Seccion titulo="Fuentes, privacidad y correcciones">
        <ul className="space-y-2 text-dato leading-relaxed text-inkSoft">
          <li>
            Cada fuente, con la fecha hasta la que llega hoy, está en{" "}
            <Link href="/fuentes" className={ENLACE}>De dónde salen los datos</Link>.
          </li>
          <li>
            Vigía no muestra números de DNI, tapa un apellido de las personas naturales y no publica el RUC de una persona.
            El detalle está en <Link href="/privacidad" className={ENLACE}>Privacidad</Link>.
          </li>
          <li>
            Si un dato sobre ti es incorrecto, pide la corrección desde{" "}
            <Link href="/privacidad#pedido" className={ENLACE}>el formulario de privacidad</Link>.
          </li>
          <li>
            Los términos, uno por uno, están en el <Link href="/glosario" className={ENLACE}>Glosario</Link>.
          </li>
        </ul>
      </Seccion>
    </Pagina>
  );
}
