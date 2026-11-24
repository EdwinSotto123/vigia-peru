import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BellRing, Bot, Eye, KanbanSquare, Search } from "lucide-react";
import { Odometro } from "@/components/gobserva/portada/Odometro";
import { PestanasVivas } from "@/components/gobserva/portada/PestanasVivas";
import { RuedaAlVer } from "@/components/gobserva/portada/RuedaAlVer";
import { BuscadorPlazas } from "@/components/empleo/portada/BuscadorPlazas";
import { EscenaEmpleo } from "@/components/empleo/portada/EscenaEmpleo";
import { MaquetaAsistente, MaquetaAviso, MaquetaFicha, MaquetaParaTi, MaquetaTablero } from "@/components/empleo/portada/Maquetas";
import { PlanesCortos } from "@/components/empleo/portada/PlanesCortos";
import { PruebaEmpleo } from "@/components/empleo/portada/PruebaEmpleo";
import { Pixel } from "@/components/pixel/Pixel";
import { Puertas } from "@/components/pixel/Puertas";
import { planesEmpleo } from "@/components/empleo/planes";
import { Faq } from "@/components/licitaciones/Faq";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { canalAlertas, getResumenEmpleo, nombreRegion } from "@/lib/empleo";
import { numero } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { COBROS_EN_PAUSA, planesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Empleo: las plazas CAS del Estado que calzan contigo, antes de que cierren" },
  description:
    "Gobserva Empleo reúne las convocatorias CAS que el Estado publica en SERVIR, te muestra las que puedes postular según tus estudios, tu experiencia y dónde quieres trabajar, y te avisa antes de que cierren. Gratis.",
  alternates: { canonical: urlCanonica("empleo", "/") },
};

/** Lo que el buscador del héroe escribe solo mientras nadie lo toca: búsquedas que sí traen plazas. */
const EJEMPLOS_BUSQUEDA = ["Contador", "Enfermera", "Asistente administrativo", "Abogado", "Ingeniero civil", "Técnico en archivo", "Docente"];

/**
 * Portada de Gobserva Empleo. Rehecha el 2026-11-08 como relato, ajustada el 2026-11-21 y rehecha otra vez el 2026-11-22
 * (el usuario: «portadas vivas, más cortas, tarjetas que reaccionan; que llame a usarlo, entendible»; medía 10,590 px en
 * el celular y 5,829 en la computadora):
 * - el héroe: la frase, las cifras de hoy que ruedan (Odometro), «¿Hasta dónde estudiaste?» con lo que puedes postular
 *   hoy para cada respuesta (PruebaEmpleo, con datos reales y un caso real), el buscador que escribe solo ejemplos y la
 *   cuenta gratis;
 * - «¿Por dónde empiezas?»: cuatro puertas con su gente y su cifra de hoy, que rueda al verla; en el celular, en fila;
 * - lo que hace por ti: cinco pestañas que avanzan solas (Para ti, el aviso, la ficha, el tablero, el asistente y tu IA),
 *   cada una con su maqueta, en vez de cinco bloques apilados (el asistente y la franja del MCP eran secciones aparte);
 * - los planes, cortos (la lista completa, en /planes); las preguntas; el cierre.
 * Las cifras salen de GET /empleo/resumen (5 min en caché); sin ellas, la portada dice lo mismo sin números y en el
 * héroe queda la escena del postulante.
 */
export default async function InicioEmpleo() {
  const base = baseProducto("empleo");
  const [cat, e] = await Promise.all([planesServidor("empleo"), getResumenEmpleo()]);
  const ruta = (p: string) => rutaEn(base, p);
  // Crear la cuenta lleva a la entrevista (el onboarding de la app), y de ahí a «Para ti».
  const crear = ruta("/entrar?crear=1");
  const plazas = (n: number | undefined) =>
    e && n != null ? (
      <b className="font-semibold text-ink">
        <RuedaAlVer>
          <Odometro texto={numero(n)} />
        </RuedaAlVer>{" "}
        {n === 1 ? "plaza" : "plazas"}
      </b>
    ) : null;
  const regiones = (e?.porRegion ?? []).filter((r) => r.n > 0).slice(0, 3);
  const prueba = PruebaEmpleo({ e, plazas: ruta("/plazas") });
  return (
    <>
      {/* ── La oferta, lo que puedes postular hoy y el buscador ─────────────────────────────── */}
      <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper" aria-labelledby="heroe-t">
        <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-40" />
        <div className="container-page relative grid gap-x-14 gap-y-8 py-10 sm:py-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:py-14">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <h1 id="heroe-t" className="max-w-[17ch] text-balance font-display text-portada font-bold leading-[1.04] tracking-[-0.025em] sm:text-cartel">
              Postula a las plazas del Estado antes de que cierren.
            </h1>
            <p className="mt-5 max-w-[56ch] text-pretty text-cuerpo leading-relaxed text-paper/80 sm:text-bloque">
              {e ? (
                <>
                  Hoy hay{" "}
                  <b className="font-semibold text-paper">
                    <Odometro texto={numero(e.abiertas)} /> plazas CAS abiertas
                  </b>{" "}
                  en {numero(e.entidades)} entidades del Estado
                  {e.cierran2dias > 0 ? (
                    <>
                      , y{" "}
                      <b className="font-semibold text-paper">
                        <Odometro texto={numero(e.cierran2dias)} retardo={300} /> cierran en 2 días
                      </b>
                    </>
                  ) : null}
                  . Mira las que puedes postular y te avisamos antes de que cierren. Gratis.
                </>
              ) : (
                <>
                  Gobserva Empleo reúne las convocatorias CAS que el Estado publica en SERVIR, te muestra las que puedes postular según tus estudios y
                  tu experiencia, y te avisa a tiempo. Gratis.
                </>
              )}
            </p>
          </div>

          <div className="min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
            {prueba ? (
              <>
                <div aria-hidden className="flex items-end gap-3 pl-1 max-lg:hidden">
                  <Pixel nombre="postulante" escala={4} retardo={400} />
                  <Pixel nombre="tablero" escala={3.5} retardo={900} />
                </div>
                <div className="lg:mt-3">{prueba}</div>
              </>
            ) : (
              <EscenaEmpleo />
            )}
          </div>

          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
            <BuscadorPlazas accion={ruta("/plazas")} ejemplos={EJEMPLOS_BUSQUEDA} />
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <Link href={crear} className={claseAccion("contornoOscuro", "self-start", "sm")}>
                Crear mi cuenta gratis <ArrowRight size={16} aria-hidden />
              </Link>
              <p className="text-dato leading-snug text-paper/70">Te avisamos cuando salga una plaza para ti. Sin tarjeta.</p>
            </div>
          </div>
        </div>
      </section>

      <div className="container-page space-y-14 pb-14 pt-12 sm:space-y-16 sm:pb-16 sm:pt-14">
        {/* ── ¿Por dónde empiezas? ───────────────────────────────────────────── */}
        <section aria-labelledby="empiezas-t">
          <Cabecera id="empiezas-t" titulo="¿Por dónde empiezas?" bajada="Las plazas abiertas hoy, según lo que te pasa. Buscar no pide cuenta." />
          <Puertas
            etiqueta="Por dónde empezar a buscar"
            columnas={4}
            className={
              // En el celular, en fila: una puerta y el borde de la siguiente (apiladas eran 700 px).
              "mt-6 max-sm:-mx-4 max-sm:flex max-sm:snap-x max-sm:snap-mandatory max-sm:gap-3 max-sm:overflow-x-auto max-sm:scroll-px-4 max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:px-4 max-sm:pb-2 max-sm:[scrollbar-width:none] sm:mt-8 max-sm:[&::-webkit-scrollbar]:hidden max-sm:[&>li]:w-[86%] max-sm:[&>li]:shrink-0 max-sm:[&>li]:snap-start max-sm:[&>li]:overflow-hidden max-sm:[&>li]:rounded-3xl max-sm:[&>li]:border max-sm:[&>li]:border-line"
            }
            puertas={[
              {
                gente: (
                  <>
                    <Pixel nombre="postulante" escala={3} retardo={200} className="px-salta" />
                    <Pixel nombre="documento" escala={3} acento="accion" className="max-sm:hidden" />
                  </>
                ),
                necesidad: "Acabo de egresar",
                que: e ? <>{plazas(e.hasta1Anio)} piden un año de experiencia o menos.</> : "Las plazas que piden un año de experiencia o menos.",
                accion: "Ver esas plazas",
                href: `${ruta("/plazas")}?exp=1`,
              },
              {
                gente: (
                  <>
                    <Pixel nombre="doctora" escala={3} retardo={1500} className="px-salta" />
                    <Pixel nombre="entidad" escala={1.75} className="max-sm:hidden" />
                  </>
                ),
                necesidad: "Busco un mejor sueldo",
                que: e ? <>{plazas(e.mas5000)} pagan S/ 5,000 al mes o más.</> : "Las plazas que pagan S/ 5,000 al mes o más.",
                accion: "Ver las mejor pagadas",
                href: `${ruta("/plazas")}?sueldo=5000&orden=sueldo`,
              },
              {
                gente: (
                  <>
                    <Pixel nombre="emprendedora" escala={3} retardo={900} className="px-salta" />
                    <Pixel nombre="alfiler" escala={3} acento="accion" className="max-sm:hidden" />
                  </>
                ),
                necesidad: "Quiero trabajar cerca de casa",
                que: regiones.length ? (
                  <>
                    {regiones.map((r, i) => (
                      <span key={r.clave}>
                        {i ? (i === regiones.length - 1 ? " y " : ", ") : ""}
                        {nombreRegion(r.clave)} tiene <b className="font-semibold text-ink">{numero(r.n)}</b>
                      </span>
                    ))}
                    . Elige la tuya.
                  </>
                ) : (
                  "Las plazas abiertas de tu región, de las 25 del Perú."
                ),
                accion: "Elegir mi región",
                href: `${ruta("/plazas")}#filtros-plazas`,
              },
              {
                gente: (
                  <>
                    <Pixel nombre="vecinaCamina" escala={3} retardo={600} className="px-salta" />
                    <Pixel nombre="iconoCalendario" escala={3} acento="accion" className="max-sm:hidden" />
                  </>
                ),
                necesidad: "Necesito postular ya",
                que: e ? <>{plazas(e.cierranSemana)} cierran en los próximos 7 días: todavía estás a tiempo.</> : "Las plazas que cierran en los próximos 7 días.",
                accion: "Ver las que cierran",
                href: `${ruta("/plazas")}?cierra=semana`,
              },
            ]}
          />
        </section>

        {/* ── Lo que hace por ti: una maqueta a la vista, las demás a un toque (o solas) ─────────── */}
        <section aria-labelledby="ayuda-t">
          <Cabecera
            id="ayuda-t"
            titulo="Buscar trabajo en el Estado no debería ser otro trabajo"
            bajada="Lo difícil no es postular: es enterarte a tiempo de la plaza que es para ti y saber si vale la pena."
            ancha
          />
          <PestanasVivas
            etiqueta="Lo que hace Gobserva Empleo por ti"
            auto={6500}
            className="mt-5 sm:mt-6"
            pestanas={[
              { titulo: "Para ti", icono: <Search size={16} aria-hidden /> },
              { titulo: "Te avisamos", icono: <BellRing size={16} aria-hidden /> },
              { titulo: "La ficha", icono: <Eye size={16} aria-hidden /> },
              { titulo: "Tu tablero", icono: <KanbanSquare size={16} aria-hidden /> },
              { titulo: "Tu asistente", icono: <Bot size={16} aria-hidden /> },
            ]}
          >
            <Ayuda titulo="Las plazas que calzan contigo, juntas" maqueta={<MaquetaParaTi />}>
              Cada entidad publica por su lado y nadie revisa cientos de webs al día. Cuéntanos en siete preguntas qué buscas, tus estudios y dónde
              quieres trabajar: en «Para ti» quedan sólo las plazas abiertas que puedes postular.
            </Ayuda>
            <Ayuda titulo="Te avisamos antes de que cierren" maqueta={<MaquetaAviso correo={cat.correoActivo} />}>
              Una convocatoria CAS recibe postulaciones por pocos días. Cuando sale una plaza que calza contigo te llega {canalAlertas(cat.correoActivo)}
              {COBROS_EN_PAUSA ? " cada mañana, gratis con tu cuenta." : ": cada semana con la cuenta gratis, cada mañana con un plan."} Y 2 días antes de que
              cierre una que guardaste, te lo recordamos.
            </Ayuda>
            <Ayuda titulo="Postulas sabiendo lo que nadie te dice" maqueta={<MaquetaFicha />}>
              Cada plaza te dice si cumples sus requisitos, cuánto pagan otras entidades por el mismo puesto y si pide experiencia en la misma entidad
              o ya hay alguien haciendo ese trabajo por órdenes de servicio.
            </Ayuda>
            <Ayuda
              titulo="Tus postulaciones, en un tablero"
              maqueta={
                <div className="sobre-oscuro relative overflow-hidden rounded-2xl border border-paper/10 bg-ink p-4 text-paper sm:p-5">
                  <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-30" />
                  <div className="relative">
                    <MaquetaTablero />
                  </div>
                </div>
              }
            >
              De guardada a postulé, a entrevista y a «me eligieron», con una nota y el día en que cierra cada una. Y los cierres, en tu calendario.
              Nada se te queda en un papel.
            </Ayuda>
            <Ayuda
              titulo="Pregúntale en tus palabras"
              maqueta={<MaquetaAsistente />}
              enlaces={[
                COBROS_EN_PAUSA ? { href: crear, texto: "Gratis con tu cuenta" } : { href: ruta("/planes"), texto: "Viene con el plan Alertas" },
                { href: ruta("/mcp"), texto: "O conecta tu propia IA" },
              ]}
            >
              Dentro de la app, un asistente busca por ti en las plazas abiertas de hoy y te responde con las que te calzan, lo que piden y el enlace
              para postular. Y si ya usas ChatGPT u otra IA, le conectas las plazas con nuestro MCP.
            </Ayuda>
          </PestanasVivas>
        </section>

        {/* ── Planes ─────────────────────────────────────────────────────────── */}
        <section aria-labelledby="planes-t">
          <Cabecera
            id="planes-t"
            titulo={COBROS_EN_PAUSA ? "Buscar es gratis. Que te avisen, también." : "Buscar es gratis. Que te avisen, casi."}
            bajada={
              COBROS_EN_PAUSA
                ? "Crea tu cuenta gratis y confirma tu correo: te avisamos cada mañana, guardas tus plazas y las bajas en Excel."
                : "Las plazas, sus requisitos y lo que nadie te dice son gratis. Con un plan, te avisamos cada mañana."
            }
            accion={{ href: ruta("/planes"), texto: COBROS_EN_PAUSA ? "Todo lo que incluye tu cuenta" : "Todo lo que incluye cada plan" }}
          />
          <PlanesCortos className="mt-5 sm:mt-6" planes={planesEmpleo(base, cat)} />
        </section>

        {/* ── Preguntas ──────────────────────────────────────────────────────── */}
        <Faq
          preguntas={[
            {
              p: "¿Qué es una plaza CAS?",
              r: "Un puesto en el Estado con Contrato Administrativo de Servicios: sueldo mensual, vacaciones, aguinaldo y seguro. Cada entidad publica sus convocatorias en SERVIR y elige por concurso: evaluación curricular, examen y entrevista.",
            },
            {
              p: "¿Gobserva cobra por postular o elige a alguien?",
              r: "No. Postulas siempre en la web de la entidad o en SERVIR, gratis. Gobserva ordena lo que el Estado publica y te avisa a tiempo. Nadie te puede cobrar por una plaza del Estado.",
            },
            {
              p: "¿De dónde salen las plazas?",
              r: "De las ofertas laborales que las entidades publican en SERVIR, que Gobserva lee cada día. Cada plaza enlaza a su publicación oficial, donde están las bases completas.",
            },
            {
              p: "¿Qué significa «lo que nadie te dice»?",
              r: "Son datos públicos que Vigía, el proyecto cívico de Gobserva, cruza con cada plaza: por ejemplo, que pide experiencia en la misma entidad o que ya hay personas haciendo ese trabajo por órdenes de servicio. No prueban que la plaza esté arreglada: te ayudan a decidir dónde pones tu esfuerzo.",
            },
            {
              p: "¿Qué hacen con mis datos?",
              r: "Los usamos sólo para tu cuenta y tus avisos. Nunca los vendemos, y puedes borrar tu cuenta tú mismo desde tu perfil.",
            },
          ]}
        />

        {/* ── El cierre ──────────────────────────────────────────────────────── */}
        <section aria-labelledby="cierre-t" className="sobre-oscuro relative overflow-hidden rounded-3xl border border-paper/10 bg-ink px-6 py-8 text-paper sm:px-10 sm:py-10">
          <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative grid gap-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center lg:gap-10">
            <div aria-hidden className="flex items-end gap-2 max-lg:hidden">
              <Pixel nombre="postulante" escala={4} retardo={1600} />
              <Pixel nombre="emprendedora" escala={4} retardo={300} />
            </div>
            <div className="min-w-0">
              <h2 id="cierre-t" className="max-w-[24ch] text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em]">
                La próxima plaza para ti puede cerrar esta semana
              </h2>
              <p className="mt-3 max-w-[56ch] text-pretty text-dato leading-relaxed text-paper/80 sm:text-cuerpo">
                {e && e.cierranSemana > 0 ? `${numero(e.cierranSemana)} plazas cierran en los próximos 7 días. ` : ""}
                Crea tu cuenta, cuéntanos qué buscas y mira hoy las que puedes postular. Gratis y sin tarjeta.
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row lg:flex-col">
              <Link href={crear} className={claseAccion("oscuro", "", "lg")}>
                Crear mi cuenta gratis <ArrowRight size={18} aria-hidden />
              </Link>
              <Link href={ruta("/plazas")} className={claseAccion("contornoOscuro", "", "lg")}>
                Ver las plazas abiertas
              </Link>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function Cabecera({ id, titulo, bajada, ancha, accion }: { id: string; titulo: string; bajada?: string; ancha?: boolean; accion?: { href: string; texto: string } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
      <div className={ancha ? "min-w-0 max-w-5xl" : "min-w-0 max-w-3xl"}>
        <h2 id={id} className="max-w-3xl text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em] text-ink sm:text-vitrina">
          {titulo}
        </h2>
        {bajada && <p className="mt-3 max-w-[80ch] text-pretty text-cuerpo leading-relaxed text-inkSoft sm:mt-4">{bajada}</p>}
      </div>
      {accion && (
        <Link href={accion.href} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
          {accion.texto} <ArrowRight size={15} aria-hidden />
        </Link>
      )}
    </div>
  );
}

/**
 * Una pestaña de lo que Gobserva Empleo hace por ti: el título, una frase que empieza por el problema y, al lado (debajo
 * en el celular), la maqueta de cómo se ve (un EJEMPLO, marcado). Todas con el mismo alto mínimo para que, al avanzar
 * solas, no muevan lo que sigue.
 */
function Ayuda({ titulo, children, maqueta, enlaces }: { titulo: string; children: ReactNode; maqueta: ReactNode; enlaces?: { href: string; texto: string }[] }) {
  return (
    <div className="grid min-h-[42rem] content-start gap-5 sm:min-h-[35rem] lg:min-h-[26rem] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:gap-12">
      <div className="min-w-0">
        <h3 className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-cifra">{titulo}</h3>
        <p className="mt-2.5 max-w-[56ch] text-pretty text-dato leading-relaxed text-inkSoft sm:text-cuerpo">{children}</p>
        {enlaces?.length ? (
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
            {enlaces.map((x) => (
              <Link key={x.href} href={x.href} className="inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
                {x.texto} <ArrowRight size={15} aria-hidden />
              </Link>
            ))}
          </p>
        ) : null}
      </div>
      <div className="min-w-0">{maqueta}</div>
    </div>
  );
}
