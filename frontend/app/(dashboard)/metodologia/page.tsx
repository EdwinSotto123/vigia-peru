import type { Metadata } from "next";
import Link from "next/link";
import { Database, FileSearch, ListChecks, Scale, ScanText, ShieldCheck, Sigma, TriangleAlert } from "lucide-react";
import { EncabezadoPagina, Migas, Nota, Pagina, Pestanas } from "@/components/patrones";
import { VistasComoTrabaja } from "@/components/sitio/VistasSeccion";
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
const CAJA = "rounded-2xl border border-line bg-paper p-4 sm:p-5";

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

const NO_PRUEBA: { titulo: string; texto: string }[] = [
  { titulo: "No prueba un delito", texto: "Describe un hecho que conviene revisar con el expediente en la mano. No es una infracción ni una acusación." },
  { titulo: "Un puntaje alto no es un veredicto", texto: "Dice que se juntaron varias señales, no que el contrato sea irregular." },
  { titulo: "Sin señales no es «aprobado»", texto: "El contrato puede no haberse leído todavía o no tener documentos publicados." },
  { titulo: "No vale para todo el Estado", texto: "Los contratos con dictamen son una parte de los publicados: sus porcentajes no se pueden proyectar." },
  { titulo: "Un cruce por nombre puede ser un homónimo", texto: "Sin número de documento, confírmalo en la fuente antes de darlo por cierto." },
];

const DONDE: { titulo: string; texto: string; href: string; enlace: string }[] = [
  { titulo: "Las fuentes", texto: "Cada registro, con la fecha hasta la que llega hoy.", href: "/fuentes", enlace: "Ver las fuentes" },
  { titulo: "Las métricas", texto: "Cuánto aciertan los agentes, cuánto se equivocan y cuánto cuesta, con fecha.", href: "/metricas", enlace: "Ver las métricas" },
  { titulo: "La privacidad", texto: "Sin DNI, con un apellido tapado y sin el RUC de una persona.", href: "/privacidad", enlace: "Ver la política" },
  { titulo: "Las correcciones", texto: "Si un dato sobre ti es incorrecto, pídelo desde el formulario.", href: "/privacidad#pedido", enlace: "Pedir una corrección" },
  { titulo: "Los términos", texto: "Cada palabra que usa Vigía, explicada en simple.", href: "/glosario", enlace: "Abrir el glosario" },
];

function Clases() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {CLASES.map(({ icono: Icono, titulo, texto, ejemplo }, i) => (
        <li key={titulo} className={CAJA}>
          <p className="flex items-center gap-2 text-rotulo font-semibold text-mute">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-paperDeep font-mono text-ink" aria-hidden>{i + 1}</span>
            {i === 0 ? "Lo más firme" : i === CLASES.length - 1 ? "Lo más interpretado" : null}
          </p>
          <p className="mt-3 flex items-center gap-2 text-destacado font-semibold text-ink">
            <Icono size={16} className="shrink-0 text-granate" aria-hidden />
            {titulo}
          </p>
          <p className="mt-1.5 text-meta leading-relaxed text-inkSoft">{texto}</p>
          <p className="mt-3 border-t border-line pt-2 text-rotulo leading-relaxed text-mute">Por ejemplo: {ejemplo}</p>
        </li>
      ))}
    </ul>
  );
}

function Pasos() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <ol className="divide-y divide-line rounded-2xl border border-line bg-paper">
        {PASOS.map((p, i) => (
          <li key={p.titulo} className="flex gap-3 px-4 py-3 sm:px-5">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-granate font-mono text-rotulo font-semibold text-paper" aria-hidden>
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-dato font-semibold text-ink">{p.titulo}</span>
              <span className="block text-meta leading-relaxed text-inkSoft">{p.texto}</span>
            </span>
          </li>
        ))}
      </ol>
      <aside className="h-fit rounded-2xl border border-line bg-paperSoft p-4 sm:p-5">
        <p className="text-dato font-semibold text-ink">El orden lo fija el código</p>
        <p className="mt-1 text-meta leading-relaxed text-inkSoft">Ningún modelo decide qué paso sigue ni qué se analiza primero.</p>
        <Link href="/app/ia" className={`${ENLACE} mt-3 inline-block text-meta`}>Qué modelos leen y cuánto llevan leído</Link>
      </aside>
    </div>
  );
}

function Puntaje() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="overflow-hidden rounded-2xl border border-line bg-paper">
        <p className="border-b border-line px-4 py-3 text-meta leading-relaxed text-inkSoft sm:px-5">
          El puntaje suma el peso de cada señal del contrato, con tope de 100. <strong className="font-semibold text-ink">No es una probabilidad.</strong>
        </p>
        <table className="w-full text-left text-dato">
          <caption className="sr-only">Puntos que suma una señal según su origen y su gravedad</caption>
          <thead className="bg-paperSoft text-rotulo text-mute">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium sm:px-5">De dónde sale la señal</th>
              <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3.5">Alta</th>
              <th scope="col" className="px-2 py-2 text-right font-medium sm:px-3.5">Media</th>
              <th scope="col" className="px-2 py-2 pr-4 text-right font-medium sm:px-3.5 sm:pr-5">Baja</th>
            </tr>
          </thead>
          <tbody>
            {PESOS.map((p) => (
              <tr key={p.origen} className="border-t border-line">
                <th scope="row" className="px-4 py-2.5 font-normal sm:px-5">
                  <span className="block font-semibold text-ink">{p.origen}</span>
                  <span className="block text-rotulo text-mute">{p.explica}</span>
                </th>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums text-ink sm:px-3.5">{p.alta}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums text-ink sm:px-3.5">{p.media}</td>
                <td className="px-2 py-2.5 pr-4 text-right font-mono tabular-nums text-ink sm:px-3.5 sm:pr-5">{p.baja}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-4">
        <div className={CAJA}>
          <p className="text-dato font-semibold text-ink">Los niveles</p>
          <dl className="mt-2 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <dt><Severidad score={CORTE_ALTA} /></dt>
              <dd className="font-mono text-meta tabular-nums text-inkSoft">{CORTE_ALTA} o más</dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <dt><Severidad score={CORTE_MEDIA} /></dt>
              <dd className="font-mono text-meta tabular-nums text-inkSoft">{CORTE_MEDIA} a {CORTE_ALTA - 1}</dd>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <dt><Severidad score={CORTE_MEDIA - 1} /></dt>
              <dd className="font-mono text-meta tabular-nums text-inkSoft">menos de {CORTE_MEDIA}</dd>
            </div>
          </dl>
        </div>
        <div className="rounded-2xl border border-line bg-paperSoft p-4 sm:p-5">
          <p className="text-dato font-semibold text-ink">Dos reglas más</p>
          <ul className="mt-1.5 space-y-2 text-meta leading-relaxed text-inkSoft">
            <li>
              <strong className="font-semibold text-ink">Un mismo hecho no cuenta dos veces.</strong> «Único postor con oferta alta» y «Oferta igual al valor
              referencial» salen de la misma oferta: la de menor peso suma la mitad.
            </li>
            <li>
              <strong className="font-semibold text-ink">Hay señales que informan y no suman.</strong> Un dato de contexto se muestra sin aportar al puntaje.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Tarjetas({ items }: { items: { titulo: string; texto: string; href?: string; enlace?: string }[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((x) => (
        <li key={x.titulo} className={CAJA}>
          <p className="text-dato font-semibold text-ink">{x.titulo}</p>
          <p className="mt-1 text-meta leading-relaxed text-inkSoft">{x.texto}</p>
          {x.href && (
            <Link href={x.href} className={`${ENLACE} mt-2 inline-block text-meta`}>{x.enlace}</Link>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Metodología: cómo se llega de un registro público a una señal y a un puntaje. Una pestaña por pregunta, cada una en
 * sus cajas (2026-11-12, pedido del usuario: nada de secciones apiladas de arriba abajo). La franja de arriba es la de
 * todo «Cómo trabaja Vigía».
 */
export default function MetodologiaPage({ searchParams }: { searchParams?: { seccion?: string | string[] } }) {
  const seccion = Array.isArray(searchParams?.seccion) ? searchParams?.seccion[0] : searchParams?.seccion;
  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Cómo trabaja Vigía", href: "/metodologia" }]} />
      <EncabezadoPagina
        titulo="Cómo trabaja Vigía"
        bajada="Cómo se llega de un registro público a una señal, y qué significa el puntaje de un dictamen."
      />
      <VistasComoTrabaja activa="metodologia" />

      <Nota icono={<ShieldCheck size={15} aria-hidden />}>
        Una señal es un indicio para revisar, no una acusación. Vigía no determina responsabilidades: eso le corresponde a
        la Contraloría, al Ministerio Público y al Poder Judicial.
      </Nota>

      <Pestanas
        variante="segunda"
        etiqueta="Partes de la metodología"
        activa={seccion}
        pestanas={[
          { clave: "datos", etiqueta: "Qué es cada dato", conteo: CLASES.length, icono: <Database size={15} aria-hidden />, contenido: <Clases /> },
          { clave: "pasos", etiqueta: "Del registro a la señal", conteo: PASOS.length, icono: <ListChecks size={15} aria-hidden />, contenido: <Pasos /> },
          { clave: "puntaje", etiqueta: "El puntaje", icono: <Sigma size={15} aria-hidden />, contenido: <Puntaje /> },
          { clave: "limites", etiqueta: "Lo que no prueba", conteo: NO_PRUEBA.length, icono: <TriangleAlert size={15} aria-hidden />, contenido: <Tarjetas items={NO_PRUEBA} /> },
          { clave: "mas", etiqueta: "Fuentes y correcciones", icono: <Scale size={15} aria-hidden />, contenido: <Tarjetas items={DONDE} /> },
        ]}
      />
    </Pagina>
  );
}
