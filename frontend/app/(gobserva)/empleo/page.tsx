import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BloqueAsistente } from "@/components/gobserva/BloqueAsistente";
import { FranjaMCP } from "@/components/gobserva/BloqueMCP";
import { Planes } from "@/components/gobserva/Planes";
import { BuscadorPlazas } from "@/components/empleo/portada/BuscadorPlazas";
import { EscenaEmpleo } from "@/components/empleo/portada/EscenaEmpleo";
import { MaquetaAviso, MaquetaFicha, MaquetaParaTi, MaquetaTablero } from "@/components/empleo/portada/Maquetas";
import { Pixel } from "@/components/pixel/Pixel";
import { Puertas } from "@/components/pixel/Puertas";
import type { NombreSprite } from "@/components/pixel/sprites";
import { planesEmpleo } from "@/components/empleo/planes";
import { Faq } from "@/components/licitaciones/Faq";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { canalAlertas, getResumenEmpleo } from "@/lib/empleo";
import { numero } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { planesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Empleo: las plazas CAS del Estado que calzan contigo, antes de que cierren" },
  description:
    "Gobserva Empleo reúne las convocatorias CAS que el Estado publica en SERVIR, te muestra las que puedes postular según tus estudios, tu experiencia y dónde quieres trabajar, y te avisa antes de que cierren. Gratis.",
  alternates: { canonical: urlCanonica("empleo", "/") },
};

/**
 * Portada de Gobserva Empleo. Rehecha el 2026-11-08 como relato (antes un tablero de cifras) y ajustada el 2026-11-21
 * (el usuario: mejorar la UX/UI; medía 8,7 pantallas en la computadora y 14,8 en el celular, sin una forma de ver plazas
 * sin crear cuenta, y el problema, los cuatro pasos y «tu búsqueda, ordenada» decían casi lo mismo):
 * 1. el héroe: la frase, cuántas plazas hay hoy, el buscador (qué y dónde, a /plazas, sin cuenta) y la escena del
 *    postulante frente al tablero;
 * 2. «¿Por dónde empiezas?»: cuatro puertas con su gente y su cifra de hoy (egresé, estudios técnicos, mejor sueldo,
 *    postular ya), cada una a /plazas con su filtro;
 * 3. lo que hace por ti: el problema de buscar en el Estado y, en una grilla, cómo lo resuelve, cada cosa con su maqueta
 *    (Para ti, el aviso, la ficha, el tablero);
 * 4. el asistente; 5. los planes; 6. la franja del MCP; 7. las preguntas; 8. el cierre.
 * Las cifras salen de GET /empleo/resumen (5 min en caché); sin ellas, la portada dice lo mismo sin números.
 */
export default async function InicioEmpleo() {
  const base = baseProducto("empleo");
  const [cat, e] = await Promise.all([planesServidor("empleo"), getResumenEmpleo()]);
  const ruta = (p: string) => rutaEn(base, p);
  // Crear la cuenta lleva a la entrevista (el onboarding de la app), y de ahí a «Para ti».
  const crear = ruta("/entrar?crear=1");
  const plazas = (n: number | undefined) => (e && n != null ? <b className="font-semibold text-ink">{numero(n)} {n === 1 ? "plaza" : "plazas"}</b> : null);

  return (
    <>
      {/* ── 1. La oferta y el buscador ───────────────────────────────────────── */}
      <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper" aria-labelledby="heroe-t">
        <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-40" />
        <div className="container-page relative grid gap-12 py-12 sm:py-16 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-center lg:gap-14 lg:py-20">
          <div className="min-w-0">
            <h1 id="heroe-t" className="max-w-[17ch] text-balance font-display text-portada font-bold leading-[1.04] tracking-[-0.025em] sm:text-cartel">
              Postula a las plazas del Estado antes de que cierren.
            </h1>
            <p className="mt-5 max-w-[56ch] text-pretty text-cuerpo leading-relaxed text-paper/80 sm:text-bloque">
              {e ? (
                <>
                  Hoy hay <b className="font-semibold text-paper">{numero(e.abiertas)} plazas CAS abiertas</b> en {numero(e.entidades)} entidades del
                  Estado. Te mostramos las que puedes postular según tus estudios y tu experiencia, y te avisamos antes de que cierren. Gratis.
                </>
              ) : (
                <>
                  Gobserva Empleo reúne las convocatorias CAS que el Estado publica en SERVIR, te muestra las que puedes postular según tus estudios y
                  tu experiencia, y te avisa a tiempo. Gratis.
                </>
              )}
            </p>
            <BuscadorPlazas accion={ruta("/plazas")} className="mt-7" />
            <div className="mt-5 flex flex-col gap-3 border-t border-paper/10 pt-5 sm:flex-row sm:items-center sm:gap-4">
              <Link href={crear} className={claseAccion("contornoOscuro", "self-start", "sm")}>
                Crear mi cuenta gratis <ArrowRight size={16} aria-hidden />
              </Link>
              <p className="text-dato leading-snug text-paper/70">Con tu cuenta te avisamos cuando salga una plaza para ti. Sin tarjeta.</p>
            </div>
          </div>
          <EscenaEmpleo className="lg:mt-4" />
        </div>
      </section>

      <div className="container-page space-y-20 pb-14 pt-14 sm:space-y-28 sm:pb-16 sm:pt-20">
        {/* ── 2. ¿Por dónde empiezas? ─────────────────────────────────────────── */}
        <section aria-labelledby="empiezas-t">
          <Cabecera
            id="empiezas-t"
            titulo="¿Por dónde empiezas?"
            bajada={e ? "Las plazas abiertas hoy, según lo que te pasa. Buscar no pide cuenta." : "Las plazas abiertas, según lo que te pasa. Buscar no pide cuenta."}
          />
          <Puertas
            etiqueta="Por dónde empezar a buscar"
            columnas={4}
            className="mt-8"
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
                    <Pixel nombre="emprendedora" escala={3} retardo={900} className="px-salta" />
                    <Pixel nombre="iconoMaletin" escala={3} acento="accion" className="max-sm:hidden" />
                  </>
                ),
                necesidad: "Estudié en un instituto o terminé el colegio",
                que: e ? <>{plazas(e.sinUniversidad)} piden secundaria o estudios técnicos, sin título universitario.</> : "Las plazas que piden secundaria o estudios técnicos.",
                accion: "Ver esas plazas",
                href: `${ruta("/plazas")}?tengo=tecnica`,
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

        {/* ── 3. Lo que hace por ti ───────────────────────────────────────────── */}
        <section aria-labelledby="ayuda-t">
          <Cabecera
            id="ayuda-t"
            titulo="Buscar trabajo en el Estado no debería ser otro trabajo"
            bajada="Las plazas son públicas y el concurso es abierto. Lo difícil es enterarte a tiempo de la que es para ti y saber si vale la pena. Para eso está Gobserva Empleo."
          />
          <ul className="mt-12 grid gap-x-12 gap-y-14 lg:grid-cols-2">
            <Ayuda sprite="entidad" titulo="Te juntamos las plazas que calzan contigo" maqueta={<MaquetaParaTi />}>
              Cada entidad publica por su lado y nadie revisa cientos de webs al día. Cuéntanos en siete preguntas qué buscas, tus estudios y dónde
              quieres trabajar: en «Para ti» quedan sólo las plazas abiertas que puedes postular.
            </Ayuda>
            <Ayuda sprite="iconoCampana" titulo="Te avisamos antes de que cierren" maqueta={<MaquetaAviso correo={cat.correoActivo} />}>
              Una convocatoria CAS recibe postulaciones por pocos días. Cuando sale una plaza que calza contigo te llega {canalAlertas(cat.correoActivo)}:
              cada semana con la cuenta gratis, cada mañana con un plan. Y 2 días antes de que cierre una que guardaste, te lo recordamos.
            </Ayuda>
            <Ayuda sprite="documento" titulo="Postulas sabiendo lo que nadie te dice" maqueta={<MaquetaFicha />}>
              Cada plaza te dice si cumples sus requisitos, cuánto pagan otras entidades por el mismo puesto y si pide experiencia en la misma entidad
              o ya hay alguien haciendo ese trabajo por órdenes de servicio.
            </Ayuda>
            <Ayuda
              sprite="tablero"
              titulo="Y llevas tus postulaciones en un tablero"
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
          </ul>
        </section>

        {/* ── 4. El asistente (con un plan) ──────────────────────────────────── */}
        <BloqueAsistente
          titulo="Pregúntale a tu asistente"
          bajada="Dentro de la app, un asistente con IA busca por ti en las plazas abiertas de hoy. Le cuentas tu carrera, tu experiencia y dónde quieres trabajar, y te responde con las que te calzan, lo que piden y el enlace para postular."
          pregunta="Soy contadora con 3 años de experiencia: ¿a qué puedo postular en Arequipa?"
          respuesta="Hay 4 plazas que te calzan. La primera cierra en 2 días:"
          filas={[
            { titulo: "Contador", quien: "Una UGEL de Arequipa", cifra: "S/ 3,200", nota: "Cierra en 2 días" },
            { titulo: "Analista en presupuesto", quien: "Un gobierno regional", cifra: "S/ 3,500", nota: "Cierra en 5 días" },
            { titulo: "Asistente contable", quien: "Una municipalidad", cifra: "S/ 2,600", nota: "Cierra en 6 días" },
          ]}
          creditos="300 créditos al mes con Alertas"
          planes={ruta("/planes")}
        />

        {/* ── 5. Planes ──────────────────────────────────────────────────────── */}
        <section aria-labelledby="planes-t">
          <Cabecera
            id="planes-t"
            titulo="Buscar es gratis. Que te avisen, casi."
            bajada="Todas las plazas, sus requisitos y lo que nadie te dice son gratis y lo seguirán siendo. Con tu cuenta gratis te avisamos cada semana; con Alertas, cada mañana, para postular antes que nadie."
            accion={{ href: ruta("/planes"), etiqueta: "Ver los planes" }}
          />
          <Planes className="mt-8" planes={planesEmpleo(base, cat)} />
        </section>

        {/* ── 6. Tu IA (MCP): la franja; los pasos están en /mcp ─────────────── */}
        <FranjaMCP que="plazas" href={ruta("/mcp")} />

        {/* ── 7. Preguntas ───────────────────────────────────────────────────── */}
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
              p: "¿Mi cuenta de Empleo sirve en Licitaciones?",
              r: "No. Cada app de Gobserva tiene su propia cuenta, con su correo y su contraseña. Así lo tuyo como postulante queda aparte.",
            },
            {
              p: "¿Qué hacen con mis datos?",
              r: "Los usamos sólo para tu cuenta y tus avisos. Nunca los vendemos, y puedes borrar tu cuenta tú mismo desde tu perfil.",
            },
          ]}
        />

        {/* ── 8. El cierre ───────────────────────────────────────────────────── */}
        <section aria-labelledby="cierre-t" className="sobre-oscuro relative overflow-hidden rounded-3xl border border-paper/10 bg-ink px-6 py-12 text-paper sm:px-12 sm:py-16">
          <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_auto] lg:items-end">
            <div className="min-w-0">
              <h2 id="cierre-t" className="max-w-[20ch] text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em] sm:text-vitrina">
                La próxima plaza para ti puede cerrar esta semana
              </h2>
              <p className="mt-4 max-w-[52ch] text-pretty text-cuerpo leading-relaxed text-paper/80">
                {e && e.cierranSemana > 0 ? `${numero(e.cierranSemana)} plazas cierran en los próximos 7 días. ` : ""}
                Crea tu cuenta, cuéntanos qué buscas y mira hoy mismo las plazas que puedes postular. Gratis y sin tarjeta.
              </p>
            </div>
            <div className="min-w-0">
              <div aria-hidden className="mb-5 flex items-end gap-3">
                <Pixel nombre="postulante" escala={4} retardo={1600} />
                <Pixel nombre="emprendedora" escala={4} retardo={300} />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <Link href={crear} className={claseAccion("oscuro", "", "lg")}>
                  Crear mi cuenta gratis <ArrowRight size={18} aria-hidden />
                </Link>
                <Link href={ruta("/plazas")} className={claseAccion("contornoOscuro", "", "lg")}>
                  Ver las plazas abiertas
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

function Cabecera({ id, titulo, bajada, accion }: { id: string; titulo: string; bajada?: string; accion?: { href: string; etiqueta: string } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0 max-w-3xl">
        <h2 id={id} className="text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em] text-ink sm:text-vitrina">
          {titulo}
        </h2>
        {bajada && <p className="mt-4 max-w-[62ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">{bajada}</p>}
      </div>
      {accion && (
        <Link href={accion.href} className="inline-flex min-h-11 shrink-0 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
          {accion.etiqueta} <ArrowRight size={15} aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** El tamaño de cada viñeta de píxeles en su cuadro de 56 px (el edificio y el tablero son anchos). */
const ESCALA_AYUDA: Partial<Record<NombreSprite, number>> = { entidad: 1.4, tablero: 1.8, iconoCampana: 3.25, documento: 3 };

/**
 * Lo que Gobserva Empleo hace por ti: la viñeta de píxeles en su cuadro, el título, una frase que empieza por el problema
 * y la maqueta de cómo se ve (un EJEMPLO, marcado). La viñeta es quieta: la grilla se lee, no se mira.
 */
function Ayuda({ sprite, titulo, children, maqueta }: { sprite: NombreSprite; titulo: string; children: ReactNode; maqueta: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col">
      <div className="flex items-start gap-4">
        <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-xl border border-line bg-paper">
          <Pixel nombre={sprite} escala={ESCALA_AYUDA[sprite] ?? 3} acento="accion" animado={false} />
        </span>
        <div className="min-w-0">
          <h3 className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-cifra">{titulo}</h3>
          <p className="mt-2.5 max-w-[56ch] text-pretty text-dato leading-relaxed text-inkSoft sm:text-cuerpo">{children}</p>
        </div>
      </div>
      <div className="mt-6 min-w-0">{maqueta}</div>
    </li>
  );
}
