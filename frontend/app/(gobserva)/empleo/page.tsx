import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Bot, CalendarDays, Check, EyeOff, Map, Search, Sparkles, Timer } from "lucide-react";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { Planes } from "@/components/gobserva/Planes";
import { AvisosDeLaManana } from "@/components/empleo/portada/AvisosDeLaManana";
import { MaquetaAviso, MaquetaEntrevista, MaquetaFicha, MaquetaParaTi, MaquetaTablero } from "@/components/empleo/portada/Maquetas";
import { planesEmpleo } from "@/components/empleo/planes";
import { Faq } from "@/components/licitaciones/Faq";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { planesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Empleo: las plazas CAS del Estado que calzan contigo, antes de que cierren" },
  description:
    "Gobserva Empleo lee cada día todas las convocatorias CAS de SERVIR, te muestra las que puedes postular según tus estudios, tu experiencia y dónde quieres trabajar, y te avisa antes de que cierren. Gratis.",
  alternates: { canonical: urlCanonica("empleo", "/") },
};

/**
 * Portada de Gobserva Empleo (rehecha el 2026-11-08: el usuario, «se ve horrible, no comunica, no dice nada»; antes era un
 * tablero de cifras y listas). Un relato, como la de Licitaciones y sin buscador ni cifras vivas: la oferta con lo
 * memorable (el celular al que le llegan las plazas a las 7:00), el problema de buscar trabajo en el Estado, cómo
 * funciona en cuatro pasos con su maqueta, el tablero de postulaciones, los planes, la IA, las preguntas y el cierre.
 * Las búsquedas y los datos viven en Plazas y en la app. Lo único que pide a la API son los planes.
 */
export default async function InicioEmpleo() {
  const base = baseProducto("empleo");
  const cat = await planesServidor("empleo");
  const ruta = (p: string) => rutaEn(base, p);
  // Crear la cuenta lleva a la entrevista (el onboarding de la app), y de ahí a «Para ti».
  const crear = ruta("/entrar?crear=1");

  return (
    <>
      {/* ── 1. La oferta ─────────────────────────────────────────────────────── */}
      <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper">
        <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-40" />
        <div className="container-page relative grid gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-16 lg:py-24">
          <div className="min-w-0">
            <h1 className="max-w-[17ch] text-balance font-display text-portada font-bold leading-[1.04] tracking-[-0.025em] sm:text-cartel">
              Postula a las plazas del Estado antes de que cierren.
            </h1>
            <p className="mt-6 max-w-[54ch] text-pretty text-bloque leading-relaxed text-paper/80">
              Gobserva Empleo lee cada día todas las convocatorias CAS del Perú, te muestra las que puedes postular según tus estudios y tu experiencia,
              y te avisa a tiempo. Gratis.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={crear} className={claseAccion("oscuro", "", "lg")}>
                Crear mi cuenta gratis <ArrowRight size={18} aria-hidden />
              </Link>
              <Link href={ruta("/plazas")} className={claseAccion("contornoOscuro", "", "lg")}>
                Ver las plazas abiertas
              </Link>
            </div>
            <ul className="mt-8 grid gap-2.5 text-dato text-paper/80 sm:grid-cols-2">
              {["Gratis y sin tarjeta", "Todas las convocatorias CAS de SERVIR", "Avisos por correo y en tu celular", "Postulas en la entidad, como siempre"].map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <Check size={16} aria-hidden className="shrink-0 text-maiz" /> {x}
                </li>
              ))}
            </ul>
          </div>
          <AvisosDeLaManana />
        </div>
      </section>

      <div className="container-page space-y-24 pb-14 pt-16 sm:space-y-32 sm:pb-16 sm:pt-24">
        {/* ── 2. El problema ─────────────────────────────────────────────────── */}
        <section aria-labelledby="problema-t" className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <div className="min-w-0">
            <h2 id="problema-t" className="text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em] text-ink sm:text-vitrina">
              Buscar trabajo en el Estado no debería ser otro trabajo
            </h2>
            <p className="mt-5 max-w-[48ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">
              Las plazas son públicas y el concurso es abierto. Enterarte a tiempo de la que es para ti, y saber si vale la pena, es lo difícil.
            </p>
          </div>
          <ul className="min-w-0 divide-y divide-line border-y border-line">
            <Problema Icono={Map} titulo="Las plazas están regadas">
              Cada entidad publica sus convocatorias en su web y en SERVIR. Revisar cientos de entidades cada día no es posible, y la plaza que era
              para ti pasa de largo.
            </Problema>
            <Problema Icono={Timer} titulo="Cierran en pocos días">
              Una convocatoria CAS recibe postulaciones por unos pocos días. Si te enteras el último, ya no alcanzas a juntar tus papeles.
            </Problema>
            <Problema Icono={EyeOff} titulo="Postulas sin saber lo que pasa adentro">
              No sabes si cumples lo que piden, si el sueldo es bueno para ese puesto ni si la plaza ya tiene a alguien de la casa esperándola.
            </Problema>
          </ul>
        </section>

        {/* ── 3. Cómo funciona ───────────────────────────────────────────────── */}
        <section aria-labelledby="como-t">
          <Cabecera id="como-t" titulo="Cómo funciona" bajada="Lo primero lo haces tú, una sola vez y en dos minutos. Lo demás corre solo todos los días." />
          <ol className="relative mt-12 space-y-14 sm:space-y-20">
            <Paso n={1} titulo="Cuéntanos qué buscas" maqueta={<MaquetaEntrevista />}>
              Siete preguntas en un chat: qué trabajo buscas, hasta dónde estudiaste, cuánta experiencia tienes, dónde quieres trabajar y desde qué
              sueldo. Tocas las respuestas o las escribes.
            </Paso>
            <Paso n={2} titulo="Te mostramos las plazas para ti" maqueta={<MaquetaParaTi />}>
              En «Para ti» están solo las plazas abiertas que puedes postular, de las que cierran primero a las últimas, con lo que pagan y lo que
              piden. Guardas las que te interesan con una estrella.
            </Paso>
            <Paso n={3} titulo="Te avisamos a tiempo" maqueta={<MaquetaAviso correo={cat.correoActivo} />}>
              Cuando sale una plaza nueva que calza contigo, te llega {cat.correoActivo ? "a tu correo" : "a tu cuenta"} y a tu celular: cada semana
              con la cuenta gratis, cada mañana con un plan. Y 2 días antes de que cierre una plaza que guardaste, te lo recordamos.
            </Paso>
            <Paso n={4} titulo="Postulas sabiendo lo que nadie te dice" maqueta={<MaquetaFicha />} ultimo>
              Cada plaza te dice si cumples sus requisitos, cuánto pagan otras entidades por el mismo puesto y lo que conviene saber antes de postular:
              si pide experiencia en la misma entidad o si ya hay alguien haciendo ese trabajo por órdenes de servicio.
            </Paso>
          </ol>
        </section>

        {/* ── 4. Tus postulaciones y lo que trae la cuenta ───────────────────── */}
        <section aria-labelledby="cuenta-t">
          <Cabecera id="cuenta-t" titulo="Tu búsqueda, ordenada" bajada="Todo lo que necesitas para postular, en una cuenta gratis." />
          <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="sobre-oscuro relative flex min-w-0 flex-col overflow-hidden rounded-3xl border border-paper/10 bg-ink p-6 text-paper sm:p-8">
              <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-30" />
              <h3 className="relative text-balance font-display text-seccion font-bold leading-tight sm:text-titulo">Tus postulaciones en un tablero</h3>
              <p className="relative mt-3 max-w-[46ch] text-dato leading-relaxed text-paper/80">
                Lleva cada plaza de guardada a postulé, a entrevista y a «me eligieron», con una nota y el día en que cierra. Nada se te queda en un
                papel.
              </p>
              <div className="relative mt-6">
                <MaquetaTablero />
              </div>
            </div>
            <ul className="min-w-0 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-paper">
              <Incluye href={crear} Icono={Sparkles} titulo="«Para ti»">
                Las plazas que calzan con tu perfil, sin buscarlas.
              </Incluye>
              <Incluye href={ruta("/plazas")} Icono={Search} titulo="Todas las plazas, con filtros">
                Por puesto, región, tus estudios, tu experiencia, el sueldo y cuándo cierran.
              </Incluye>
              <Incluye href={crear} Icono={CalendarDays} titulo="Tu calendario">
                Los días en que cierran tus plazas guardadas, para bajarlos a Google Calendar o a tu celular.
              </Incluye>
              <Incluye href={ruta("/#mcp")} Icono={Bot} titulo="Tu IA, conectada">
                Pregúntale a Claude o a ChatGPT por plazas en tus palabras, con el servidor MCP de Gobserva.
              </Incluye>
            </ul>
          </div>
        </section>

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

        {/* ── 6. MCP ─────────────────────────────────────────────────────────── */}
        <BloqueMCP
          id="mcp"
          titulo="Busca trabajo hablando con tu IA"
          bajada="Conecta Claude, ChatGPT o Cursor a Gobserva y pregúntale por plazas en tus palabras: te responde con las convocatorias abiertas de hoy, lo que pagan y el enlace oficial de cada una. Tu asistente consulta los datos en vivo en vez de inventarlos."
          ejemplos={[
            "¿Qué plazas CAS de abogado hay abiertas en Cusco que paguen más de S/ 4,000?",
            "Soy técnica en enfermería con un año de experiencia: ¿a qué puedo postular esta semana en Lima?",
            "¿Cuáles cierran mañana y no piden estudios universitarios?",
          ]}
          herramientas={[
            { nombre: "buscar_plazas_cas", descripcion: "Las plazas abiertas con filtros: puesto, región, sueldo, estudios, experiencia y cierre." },
            { nombre: "ficha_plaza_cas", descripcion: "Una plaza completa: requisitos, sueldo frente a otras entidades, señales y enlace oficial." },
          ]}
        />

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
              r: "De las ofertas laborales que las entidades publican en SERVIR, que Gobserva lee todos los días. Cada plaza enlaza a su publicación oficial, donde están las bases completas.",
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
                Crea tu cuenta, cuéntanos qué buscas y mira hoy mismo las plazas que puedes postular. Gratis y sin tarjeta.
              </p>
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

/** Un problema de hoy: el título fuerte a la izquierda y la explicación al lado (desde sm), separados por filetes. */
function Problema({ Icono, titulo, children }: { Icono: typeof Timer; titulo: string; children: ReactNode }) {
  return (
    <li className="grid gap-3 py-6 sm:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] sm:gap-8 sm:py-8">
      <h3 className="flex items-start gap-3 font-display text-bloque font-bold leading-snug text-ink">
        <Icono size={20} aria-hidden className="mt-0.5 shrink-0 text-granate" />
        {titulo}
      </h3>
      <p className="text-pretty text-dato leading-relaxed text-inkSoft">{children}</p>
    </li>
  );
}

/** Un paso de «Cómo funciona»: el número sobre una línea que baja al siguiente, el título, una frase y su maqueta al lado. */
function Paso({ n, titulo, children, maqueta, ultimo = false }: { n: number; titulo: string; children: ReactNode; maqueta: ReactNode; ultimo?: boolean }) {
  return (
    <li className="relative grid gap-6 pl-14 sm:pl-16 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:gap-14">
      <span
        aria-hidden
        className="absolute left-0 top-0 grid h-10 w-10 place-items-center rounded-full bg-granate font-display text-cuerpo font-bold tabular-nums text-paper sm:h-11 sm:w-11"
      >
        {n}
      </span>
      {!ultimo && <span aria-hidden className="absolute bottom-[-3.5rem] left-5 top-12 w-px bg-line sm:bottom-[-5rem] sm:left-[1.375rem] sm:top-14" />}
      <div className="min-w-0 pt-1.5 lg:pt-2">
        <h3 className="font-display text-seccion font-bold leading-tight text-ink sm:text-cifra">
          <span className="sr-only">Paso {n}: </span>
          {titulo}
        </h3>
        <p className="mt-3 max-w-[50ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">{children}</p>
      </div>
      <div className="min-w-0">{maqueta}</div>
    </li>
  );
}

/** Lo que trae la cuenta: una fila que enlaza, con su ícono, su título y una frase. */
function Incluye({ href, Icono, titulo, children }: { href: string; Icono: typeof Timer; titulo: string; children: ReactNode }) {
  return (
    <li>
      <Link href={href} className="group flex items-start gap-4 p-5 transition-colors duration-rapido hover:bg-paperSoft sm:p-6">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
          <Icono size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-3 font-display text-bloque font-bold text-ink">
            {titulo}
            <ArrowRight size={17} aria-hidden className="shrink-0 text-mute transition-transform duration-rapido group-hover:translate-x-0.5 group-hover:text-granate" />
          </span>
          <span className="mt-1 block text-dato leading-relaxed text-inkSoft">{children}</span>
        </span>
      </Link>
    </li>
  );
}
