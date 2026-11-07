import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Bot, Check, EyeOff, HardHat, Landmark, LineChart, Megaphone, Timer } from "lucide-react";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { Planes } from "@/components/gobserva/Planes";
import { Faq } from "@/components/licitaciones/Faq";
import { planesLicitaciones } from "@/components/licitaciones/planes";
import { MaquetaAviso, MaquetaContexto, MaquetaLinea, MaquetaMenores, MaquetaParaTi } from "@/components/licitaciones/portada/Maquetas";
import { RadarOportunidades } from "@/components/licitaciones/portada/RadarOportunidades";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { planesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Licitaciones: las oportunidades para venderle al Estado, cada día" },
  description:
    "Dinos qué vende tu empresa y cada día te mostramos las licitaciones y los contratos menores del SEACE que calzan contigo, con lo que necesitas para ganarlos: quién compra, quién gana, a qué precio y cuántos compiten.",
  alternates: { canonical: urlCanonica("licitaciones", "/") },
};

/**
 * Portada de Gobserva Licitaciones (modo persuadir; rehecha el 2026-11-07 como un relato, sin buscador ni cifras vivas):
 * la oferta con el radar que encuentra lo que calza, el problema de venderle al Estado hoy, cómo funciona en cuatro pasos
 * con su maqueta, todo lo que trae la cuenta, los planes, el MCP, las preguntas y el cierre. Las búsquedas y los datos
 * viven en Oportunidades, Contratos menores y Mercado. Lo único que pide a la API son los planes.
 */
export default async function InicioLicitaciones() {
  const base = baseProducto("licitaciones");
  const cat = await planesServidor("licitaciones");
  const ruta = (p: string) => rutaEn(base, p);
  const crear = ruta(`/entrar?crear=1&next=${encodeURIComponent("/cuenta?tab=para-ti")}`);

  return (
    <>
      {/* ── 1. La oferta ─────────────────────────────────────────────────────── */}
      <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper">
        <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-40" />
        <div className="container-page relative grid gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-10 lg:py-24">
          <div className="min-w-0">
            <h1 className="max-w-[16ch] text-balance font-display text-portada font-bold leading-[1.04] tracking-[-0.025em] sm:text-cartel">
              Véndele al Estado sin revisar el SEACE cada mañana.
            </h1>
            <p className="mt-6 max-w-[54ch] text-pretty text-bloque leading-relaxed text-paper/80">
              Dinos qué vende tu empresa. Cada día te mostramos las licitaciones y los contratos menores que calzan contigo, ordenados por afinidad y
              con lo que necesitas saber para ganarlos.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={crear} className={claseAccion("oscuro", "", "lg")}>
                Crear mi cuenta gratis <ArrowRight size={18} aria-hidden />
              </Link>
              <Link href={ruta("/planes")} className={claseAccion("contornoOscuro", "", "lg")}>
                Ver planes
              </Link>
            </div>
            <ul className="mt-8 grid gap-2.5 text-dato text-paper/80 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
              {["Gratis y sin tarjeta", "Datos oficiales del SEACE y el OECE", "Avisos por correo y en tu celular", "Obras incluidas en tu plan"].map((x) => (
                <li key={x} className="flex items-center gap-2">
                  <Check size={16} aria-hidden className="shrink-0 text-maiz" /> {x}
                </li>
              ))}
            </ul>
          </div>
          <RadarOportunidades />
        </div>
      </section>

      <div className="container-page space-y-24 pb-14 pt-16 sm:space-y-32 sm:pb-16 sm:pt-24">
        {/* ── 2. El problema ─────────────────────────────────────────────────── */}
        <section aria-labelledby="problema-t" className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <div className="min-w-0">
            <h2 id="problema-t" className="text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em] text-ink sm:text-vitrina">
              Hoy, venderle al Estado es llegar tarde o a ciegas
            </h2>
            <p className="mt-5 max-w-[48ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">
              Las compras públicas son abiertas. Encontrar a tiempo la que es para ti, y ofertar sabiendo contra quién compites, sigue siendo
              trabajo de horas.
            </p>
          </div>
          <ul className="min-w-0 divide-y divide-line border-y border-line">
            <Problema Icono={Megaphone} titulo="Lo tuyo se pierde entre todo lo demás">
              Cada día se publican compras nuevas de todas las entidades y todos los rubros. Revisarlas a mano se come la mañana, y la que era
              para ti pasa de largo.
            </Problema>
            <Problema Icono={Timer} titulo="Los contratos menores no esperan">
              Las compras de hasta 8 UIT reciben cotizaciones por pocos días, a veces por horas. Si no la ves a tiempo, ya cerró.
            </Problema>
            <Problema Icono={EyeOff} titulo="Se oferta a ciegas">
              No sabes quién le vende a esa entidad, a qué precio se adjudicó lo mismo en otra ni cuántos compiten. El precio se pone adivinando.
            </Problema>
          </ul>
        </section>

        {/* ── 3. Cómo funciona ───────────────────────────────────────────────── */}
        <section aria-labelledby="como-t">
          <Cabecera
            id="como-t"
            titulo="Cómo funciona"
            bajada="El primer paso lo haces tú, una sola vez. Los demás corren solos todos los días."
          />
          <ol className="relative mt-12 space-y-14 sm:space-y-20">
            <Paso n={1} titulo="Dinos qué vendes" maqueta={<MaquetaLinea />}>
              En tus palabras, con las regiones donde atiendes y lo que compras. Es tu línea de negocio: con ella ordenamos todo lo demás.
            </Paso>
            <Paso n={2} titulo="Te mostramos lo que calza" maqueta={<MaquetaParaTi />} accion={{ href: ruta("/para-ti"), etiqueta: "Así se ve «Para ti»" }}>
              En «Para ti» están las licitaciones y los contratos menores abiertos, de lo que más se parece a lo que vendes a lo que menos, con un
              puntaje de afinidad de 0 a 100.
            </Paso>
            <Paso n={3} titulo="Te avisamos a tiempo" maqueta={<MaquetaAviso correo={cat.correoActivo} />}>
              Lo nuevo llega {cat.correoActivo ? "a tu correo" : "a tu cuenta"} y como notificación a tu celular: con la cuenta gratis, cada semana;
              con un plan, cada mañana. Y te recordamos lo que guardaste 2 días antes de que cierre.
            </Paso>
            <Paso n={4} titulo="Ofertas sabiendo contra quién compites" maqueta={<MaquetaContexto />} ultimo>
              Antes de cotizar ves quién le vende a esa entidad, a qué precio se adjudicó lo mismo en otras y cuántos suelen competir. Todo con el
              enlace a la fuente oficial.
            </Paso>
          </ol>
        </section>

        {/* ── 4. Todo en una cuenta ──────────────────────────────────────────── */}
        <section aria-labelledby="todo-t">
          <Cabecera
            id="todo-t"
            titulo="Todo en una sola cuenta"
            bajada="Una suscripción para lo que compra el Estado: bienes, servicios, consultorías y obras."
          />
          <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <Link
              href={ruta("/menores")}
              className="sobre-oscuro group relative flex min-w-0 flex-col overflow-hidden rounded-3xl border border-paper/10 bg-ink p-6 text-paper sm:p-8"
            >
              <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-30" />
              <h3 className="relative text-balance font-display text-seccion font-bold leading-tight sm:text-titulo">Contratos menores para cotizar hoy</h3>
              <p className="relative mt-3 max-w-[46ch] text-dato leading-relaxed text-paper/80">
                Las compras de hasta 8 UIT que todavía reciben cotizaciones en el SEACE, con sus términos de referencia para descargar y lo que se
                pagó antes por lo mismo. Se actualizan cada hora.
              </p>
              <div className="relative mt-6">
                <MaquetaMenores />
              </div>
              <span className="relative mt-6 inline-flex items-center gap-1.5 text-dato font-semibold text-maiz underline-offset-4 group-hover:underline">
                Ver los contratos menores <ArrowRight size={16} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-0.5" />
              </span>
            </Link>
            <ul className="min-w-0 divide-y divide-line overflow-hidden rounded-3xl border border-line bg-paper">
              <Incluye href={ruta("/oportunidades")} Icono={Landmark} titulo="Licitaciones del SEACE">
                Cada convocatoria con sus ítems, sus bases y lo que se sabe de la entidad que compra.
              </Incluye>
              <Incluye href={urlCanonica("obras", "/")} Icono={HardHat} titulo="Obras, incluidas en tu plan">
                Las inversiones públicas que se vienen y las que están en marcha, para llegar antes de que se liciten.
              </Incluye>
              <Incluye href={ruta("/mercado")} Icono={LineChart} titulo="El mercado de tu rubro">
                Quién compra, quién gana y a qué precio en los últimos 12 meses.
              </Incluye>
              <Incluye href={ruta("/#mcp")} Icono={Bot} titulo="Tu IA, conectada">
                Pregúntale a Claude o a ChatGPT por las licitaciones del día, con el servidor MCP de Gobserva.
              </Incluye>
            </ul>
          </div>
        </section>

        {/* ── 5. Planes ──────────────────────────────────────────────────────── */}
        <section aria-labelledby="planes-t">
          <Cabecera
            id="planes-t"
            titulo="Empieza gratis"
            bajada="Buscar, leer las fichas y ver «Para ti» es gratis, y con tu cuenta te avisamos cada semana. Los planes te avisan cada mañana, guardan más y bajan tus búsquedas en Excel. Obras viene incluido."
            accion={{ href: ruta("/planes#comparar"), etiqueta: "Comparar planes" }}
          />
          <Planes className="mt-8" planes={planesLicitaciones(base, cat)} />
        </section>

        {/* ── 6. MCP ─────────────────────────────────────────────────────────── */}
        <BloqueMCP
          id="mcp"
          titulo="Pregúntale a tu IA por las licitaciones del día"
          bajada="Conecta Claude, ChatGPT o Cursor al servidor MCP de Gobserva y pregunta en tus palabras: tu asistente consulta las convocatorias y el mercado en vivo, con la fuente oficial de cada dato. Gratis durante la beta; el plan Empresa suma una API para tu CRM."
          ejemplos={[
            "¿Qué licitaciones de combustible se convocaron esta semana en Puno y Cusco?",
            "Dame las obras de saneamiento de más de S/ 5 millones convocadas en los últimos 15 días.",
            "¿Quién le gana más contratos de uniformes al Estado y a qué precio?",
          ]}
          herramientas={[
            { nombre: "buscar_licitaciones", descripcion: "Las convocatorias recientes del SEACE, con filtros por palabras, región, tipo y valor referencial." },
            { nombre: "mercado_rubro", descripcion: "El mercado de un rubro en 12 meses: procesos, monto adjudicado, quién compra, quién gana y cuántos compiten." },
          ]}
        />

        {/* ── 7. Preguntas ───────────────────────────────────────────────────── */}
        <Faq
          preguntas={[
            {
              p: "¿De dónde salen los datos?",
              r: (
                <>
                  De fuentes públicas del Estado: las convocatorias del SEACE (datos abiertos OCDS del OECE), los contratos menores del buscador
                  público del SEACE y las adjudicaciones y postores de CONOSCE. Cada ficha enlaza al proceso en el portal oficial.
                </>
              ),
            },
            { p: "¿Qué es el puntaje de afinidad?", r: "Un número de 0 a 100 que dice cuánto se parece lo que se compra a lo que vende tu empresa, según tu línea de negocio. No es la probabilidad de ganar: te ayuda a ver primero lo que más te conviene revisar." },
            { p: "¿Reemplaza al SEACE?", r: "No. Las ofertas y cotizaciones se presentan en el SEACE, como siempre. Gobserva te avisa a tiempo y te da contexto para decidir; el cronograma oficial y las bases están en el SEACE y enlazamos cada proceso." },
            { p: "¿Es legal usar esta información?", r: "Sí. Son datos públicos que el Estado publica por ley (transparencia y datos abiertos). Gobserva los ordena y los cruza; no vende datos personales ni nombra a personas naturales." },
            { p: "¿Cómo pago un plan?", r: "Con tarjeta de crédito o débito por Mercado Pago, que se cobra cada mes, o con Yape o Plin por 1, 3, 6 o 12 meses. Cada pago queda en tu cuenta con su comprobante; si necesitas factura para tu empresa, escríbenos." },
            { p: "¿Qué hacen con mis datos?", r: "Los usamos sólo para tu cuenta y tus alertas. Nunca los vendemos, y puedes borrar tu cuenta tú mismo desde tu perfil." },
          ]}
        />

        {/* ── 8. El cierre ───────────────────────────────────────────────────── */}
        <section aria-labelledby="cierre-t" className="sobre-oscuro relative overflow-hidden rounded-3xl border border-paper/10 bg-ink px-6 py-12 text-paper sm:px-12 sm:py-16">
          <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_auto] lg:items-end">
            <div className="min-w-0">
              <h2 id="cierre-t" className="max-w-[20ch] text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em] sm:text-vitrina">
                Que la próxima compra de tu rubro te encuentre a ti
              </h2>
              <p className="mt-4 max-w-[52ch] text-pretty text-cuerpo leading-relaxed text-paper/80">
                Crea tu cuenta, dinos qué vendes y mira hoy mismo lo que calza contigo. Gratis y sin tarjeta.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Link href={crear} className={claseAccion("oscuro", "", "lg")}>
                Crear mi cuenta gratis <ArrowRight size={18} aria-hidden />
              </Link>
              <Link href={ruta("/planes")} className={claseAccion("contornoOscuro", "", "lg")}>
                Ver planes
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

/**
 * Un paso de «Cómo funciona»: el número sobre una línea que baja al siguiente, el título, una frase y su maqueta al lado
 * (desde lg; en el celular, debajo).
 */
function Paso({
  n,
  titulo,
  children,
  maqueta,
  accion,
  ultimo = false,
}: {
  n: number;
  titulo: string;
  children: ReactNode;
  maqueta: ReactNode;
  accion?: { href: string; etiqueta: string };
  ultimo?: boolean;
}) {
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
        {accion && (
          <Link href={accion.href} className="mt-4 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
            {accion.etiqueta} <ArrowRight size={15} aria-hidden />
          </Link>
        )}
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
