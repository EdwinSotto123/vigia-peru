import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bot, MessageCircleQuestion, Search, Sparkles } from "lucide-react";
import { BloqueAsistente } from "@/components/gobserva/BloqueAsistente";
import { FranjaMCP } from "@/components/gobserva/BloqueMCP";
import { EscribeSolo } from "@/components/gobserva/portada/EscribeSolo";
import { Odometro } from "@/components/gobserva/portada/Odometro";
import { PestanasVivas } from "@/components/gobserva/portada/PestanasVivas";
import { Faq } from "@/components/licitaciones/Faq";
import { ComoFunciona } from "@/components/obras/portada/ComoFunciona";
import { DondeLaPlata } from "@/components/obras/portada/DondeLaPlata";
import { LoQueSeViene } from "@/components/obras/portada/LoQueSeViene";
import { PruebaObras } from "@/components/obras/portada/PruebaObras";
import { Calle } from "@/components/pixel/Escena";
import { Pixel } from "@/components/pixel/Pixel";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { fechaCorta, numero } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { BUSQUEDAS_EJEMPLO, getResumenObras } from "@/lib/gobserva-obras";
import { planesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Obras: las obras públicas que se vienen, antes de que se liciten" },
  description:
    "Los proyectos de inversión pública viables o con expediente técnico que todavía no tienen contratista, y las obras en marcha con su plata, su avance y quién las construye. Invierte.pe, INFOBRAS y el SEACE en un solo lugar.",
  alternates: { canonical: urlCanonica("obras", "/") },
};

/**
 * Portada de Gobserva Obras. Rehecha el 2026-11-22 (el usuario: «portadas vivas, más cortas, tarjetas que reaccionan; que
 * llame a usarlo, entendible»; medía 15,549 px en el celular y 9,534 en la computadora):
 * - el héroe: la frase, cuántos proyectos se vienen (la cifra rueda), el buscador que escribe solo ejemplos reales y
 *   «¿Qué construyes?», que para cada respuesta muestra lo que se viene hoy de eso, el más grande y el enlace a la lista;
 * - «Llega antes de que se licite»: el camino de una obra en pestañas (con expediente, licitándose, recién viables, en
 *   ejecución), cada una con los primeros y el enlace a su lista;
 * - «Dónde está la plata»: por región, por sector y para quién es, en pestañas;
 * - «Cómo funciona», en pestañas que avanzan solas, con la cuenta gratis y los planes (de Gobserva Licitaciones);
 * - las preguntas, el asistente y el MCP en una sola fila de pestañas.
 * Las cifras salen de GET /proyectos/resumen (10 min en caché); sin ellas, la portada dice lo mismo sin números.
 */
export default async function InicioObras() {
  const base = baseProducto("obras");
  // Obras viene incluido en los planes de Gobserva Licitaciones (2026-11-07): sus planes, con enlaces a licitaciones.gobserva.cloud.
  const [r, cat] = await Promise.all([getResumenObras(), planesServidor("licitaciones")]);
  const ruta = (p: string) => rutaEn(base, p);
  const lista = (qs: string) => `${ruta("/proyectos")}${qs}`;

  return (
    <>
      <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper">
        <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-50" />
        <div aria-hidden className="pointer-events-none absolute -right-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-maiz/10 blur-3xl" />
        <div className="container-page relative grid gap-8 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start lg:gap-12">
          <div className="min-w-0">
            <h1 className="text-balance font-display text-portada font-bold leading-[1.04] tracking-tight sm:text-cartel">
              Las obras públicas que se vienen, <span className="text-maiz">antes de que se liciten.</span>
            </h1>
            <p className="mt-5 max-w-[56ch] text-pretty text-cuerpo leading-relaxed text-paper/75 sm:text-bloque">
              {r ? (
                <>
                  <Odometro texto={numero(r.seVienen)} className="font-semibold text-paper" /> proyectos del Estado
                </>
              ) : (
                "Miles de proyectos del Estado"
              )}{" "}
              ya son viables o tienen expediente técnico y todavía no tienen quién los construya. Aquí están, con su plata, su
              entidad y su avance.
            </p>
            <form method="get" action={ruta("/proyectos")} role="search" className="mt-6 flex flex-col gap-2 sm:flex-row">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">Qué construyes</span>
                <Search size={19} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink/50" />
                <input
                  id="obras-q"
                  name="q"
                  placeholder="¿Qué construyes? agua potable, pistas, colegios, riego…"
                  maxLength={120}
                  className="h-14 w-full rounded-2xl border border-paper/20 bg-paper pl-12 pr-4 text-destacado text-ink placeholder:text-ink/45 focus:outline-none focus:ring-4 focus:ring-maiz/40"
                />
              </label>
              <button type="submit" className={claseAccion("oscuro", "h-14 px-7", "md")}>
                Buscar proyectos <ArrowRight size={17} aria-hidden />
              </button>
            </form>
            <EscribeSolo para="obras-q" prefijo="¿Qué construyes? " ejemplos={BUSQUEDAS_EJEMPLO} />
            {!r && (
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Búsquedas de ejemplo">
                {BUSQUEDAS_EJEMPLO.slice(0, 6).map((x) => (
                  <li key={x}>
                    <Link
                      href={lista(`?q=${encodeURIComponent(x)}`)}
                      className="inline-flex min-h-11 items-center rounded-full border border-paper/20 px-3.5 text-meta font-medium text-paper/85 transition-colors duration-rapido hover:border-maiz/60 hover:bg-paper/10 hover:text-paper sm:min-h-9"
                    >
                      {x}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {r?.estado && (
              <p className="mt-5 flex items-start gap-2 text-meta leading-relaxed text-paper/65">
                <span aria-hidden className="relative mt-[0.4375rem] inline-flex h-2 w-2 shrink-0">
                  <span className="absolute inset-0 rounded-full bg-maiz opacity-60 motion-safe:animate-ping" />
                  <span className="relative h-2 w-2 rounded-full bg-maiz" />
                </span>
                <span>
                  {r.estado.inversionesAl ? `Invierte.pe al ${fechaCorta(r.estado.inversionesAl)}` : "Invierte.pe"},{" "}
                  {r.estado.infobrasAl ? `INFOBRAS al ${fechaCorta(r.estado.infobrasAl)}` : "INFOBRAS"} y el SEACE, a diario.{" "}
                  {numero(r.nuevos30)} proyectos se declararon viables en los últimos 30 días.
                </span>
              </p>
            )}
          </div>
          <div className="min-w-0 lg:mt-2">
            <PruebaObras r={r} base={base} />
            {/* La obra con su grúa y el obrero: en la computadora, bajo «¿Qué construyes?» (en el celular, la pantalla es
                para la pregunta). Se arma a pasos una vez; después el obrero parpadea y la carga sube y baja. */}
            <Calle
              className="mt-6 select-none max-lg:hidden"
              izquierda={<Pixel nombre="obrero" escala={5} className="h-auto w-20" />}
              derecha={
                <div className="flex items-end">
                  <Pixel nombre="obra" escala={5} retardo={500} className="relative z-[1] -mr-[2.1875rem] h-auto w-[8.125rem]" />
                  <span className="relative block">
                    <Pixel nombre="grua" escala={5} retardo={900} className="h-auto w-[10rem]" />
                    <Pixel nombre="cono" escala={5} className="absolute bottom-0 left-[68.75%] h-auto w-[2.5rem]" />
                  </span>
                </div>
              }
            />
          </div>
        </div>
      </section>

      <div className="container-page space-y-14 py-12 sm:py-14">
        {r && <LoQueSeViene r={r} base={base} />}
        {r && <DondeLaPlata r={r} base={base} />}
        <ComoFunciona correo={cat.correoActivo} crear={ruta("/entrar?crear=1")} planes={urlCanonica("licitaciones", "/planes")} />

        {/* Las preguntas, el asistente y el MCP: una fila de pestañas (antes, tres secciones de 1,900 px en el celular). */}
        <div>
          <div aria-hidden className="mb-3 w-fit select-none max-sm:hidden">
            <div className="flex items-end gap-2 px-2">
              <Pixel nombre="obrero" escala={3} retardo={1600} />
              <Pixel nombre="cono" escala={3} />
            </div>
          </div>
          <PestanasVivas
            etiqueta="Preguntas, asistente y tu IA"
            pestanas={[
              { titulo: "Preguntas", icono: <MessageCircleQuestion size={16} aria-hidden /> },
              { titulo: "Tu asistente", icono: <Sparkles size={16} aria-hidden /> },
              { titulo: "Con tu IA", icono: <Bot size={16} aria-hidden /> },
            ]}
          >
            <Faq titulo="Lo que más nos preguntan" preguntas={PREGUNTAS} />
            <BloqueAsistente
              titulo="Pregúntale a tu asistente"
              bajada="Con un plan de Licitaciones, que trae Obras, un asistente con IA te dice qué obras se vienen, cuánto cuestan, cómo avanzan y quién las gana. Le preguntas como a un colega."
              pregunta="¿Qué obras de agua potable de más de S/ 5 millones se vienen en Puno?"
              respuesta="Hay 3 con expediente técnico que todavía no se licitan:"
              filas={[
                { titulo: "Agua potable y alcantarillado", quien: "Una municipalidad provincial", cifra: "S/ 12.4 M", nota: "Con expediente" },
                { titulo: "Mejoramiento del servicio de agua", quien: "Una municipalidad distrital", cifra: "S/ 7.9 M", nota: "Con expediente" },
                { titulo: "Saneamiento rural", quien: "Un gobierno regional", cifra: "S/ 5.6 M", nota: "Viable" },
              ]}
              creditos="1,500 créditos al mes con Inicia"
              descargas
              planes={ruta("/planes")}
            />
            <FranjaMCP que="obras, licitaciones y tu mercado" href={ruta("/mcp")} />
          </PestanasVivas>
        </div>
      </div>
    </>
  );
}

const PREGUNTAS = [
  {
    p: "¿De dónde salen los datos?",
    r: "De fuentes públicas del Estado: las inversiones de Invierte.pe (MEF), con su CUI, sus montos, su fase y su gasto; el avance de cada obra en INFOBRAS (Contraloría), con sus paralizaciones y su contratista; y los procesos del SEACE y de CONOSCE (OECE) que citan el CUI, con quién los ganó. Cada ficha enlaza a la fuente oficial.",
  },
  {
    p: "¿Qué quiere decir que un proyecto «se viene»?",
    r: "Que es viable o está aprobado, se declaró en los últimos tres años (o tiene presupuesto este año) y todavía no tiene obra en ejecución ni contrato de obra: es el pipeline antes de la licitación. Si ya tiene expediente técnico, lo siguiente es convocar la obra.",
  },
  {
    p: "¿Qué tan al día está?",
    r: "Invierte.pe e INFOBRAS se cargan cada semana y las convocatorias del SEACE, a diario. El avance de una obra lo registra cada entidad en INFOBRAS y puede llegar con meses de atraso: cada ficha dice a qué fecha corresponde.",
  },
  {
    p: "¿Puedo saber quién construye una obra?",
    r: "Sí, cuando es una empresa (RUC 20): INFOBRAS y el SEACE lo publican, y de un consorcio mostramos sus empresas integrantes. De las personas naturales no mostramos nombres.",
  },
  { p: "¿Reemplaza al SEACE?", r: "No. Las ofertas se presentan en el SEACE, como siempre. Gobserva Obras te avisa antes y te da contexto para decidir; cada proyecto enlaza a sus procesos y a sus fichas oficiales." },
  { p: "¿Es legal usar esta información?", r: "Sí. Son datos públicos que el Estado publica por ley (transparencia y datos abiertos). Gobserva los ordena y los cruza; no vende datos personales ni nombra a personas naturales." },
  {
    p: "¿Cómo pago un plan?",
    r: "Con tarjeta de crédito o débito por Mercado Pago, que se cobra cada mes, o con Yape o Plin por 1, 3, 6 o 12 meses. Cada pago queda en tu cuenta con su comprobante; si necesitas factura para tu empresa, escríbenos.",
  },
];
