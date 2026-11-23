import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FranjaMCP } from "@/components/gobserva/BloqueMCP";
import { Odometro } from "@/components/gobserva/portada/Odometro";
import { PestanasVivas } from "@/components/gobserva/portada/PestanasVivas";
import { Pruebalo, type OpcionPrueba } from "@/components/gobserva/portada/Pruebalo";
import { Faq } from "@/components/licitaciones/Faq";
import { planesLicitaciones } from "@/components/licitaciones/planes";
import { BuscadorRubro } from "@/components/licitaciones/portada/BuscadorRubro";
import { datosPortada, type RubroVivo } from "@/components/licitaciones/portada/datosPortada";
import { MaquetaAviso, MaquetaContexto, MaquetaLinea, MaquetaParaTi } from "@/components/licitaciones/portada/Maquetas";
import { PlanesCortos } from "@/components/licitaciones/portada/PlanesCortos";
import { TodoEnUnaCuenta, type Puesto } from "@/components/licitaciones/portada/TodoEnUnaCuenta";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { fechaCorta, numero, solesCompacto } from "@/lib/formato";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { planesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";
import { tituloNatural } from "@/lib/landing";
import { limpiar } from "@/lib/licitaciones";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Licitaciones: las oportunidades para venderle al Estado, cada día" },
  description:
    "Dinos qué vende tu empresa y cada día te mostramos las licitaciones y los contratos menores del SEACE que calzan contigo, con lo que necesitas para ganarlos: quién compra, quién gana, a qué precio y cuántos compiten.",
  alternates: { canonical: urlCanonica("licitaciones", "/") },
};

/**
 * Portada de Gobserva Licitaciones. Rehecha el 2026-11-22 (el usuario: «portadas vivas, más cortas, tarjetas que
 * reaccionan; que llame a usarlo, entendible»; medía 13,360 px en el celular y 7,605 en la computadora, y no mostraba un
 * solo dato de hoy):
 * - el héroe: la frase, lo que se publicó esta semana y los contratos menores abiertos (cifras que ruedan), «¿Qué vendes?»
 *   con lo que hay HOY de cada rubro (Pruébalo: cuántas convocatorias, la más reciente y los menores por cotizar), el
 *   buscador de cualquier rubro y la cuenta; la escena de la emprendedora, desde lg;
 * - cómo funciona: el problema de hoy y lo que hace Gobserva, en cuatro pestañas que avanzan solas con su maqueta
 *   (antes tres problemas y cuatro pasos apilados: 3,500 px en el celular), con la competencia del último año;
 * - todo en una sola cuenta: cinco puestos con su cifra de hoy, una fila que se desliza en el celular (el asistente va
 *   aquí: su bloque grande medía 1,180 px);
 * - el MCP (el menú «API y MCP» lleva a #mcp), las preguntas y, al final, los planes cortos con la cuenta gratis.
 * Datos: los de Oportunidades y Contratos menores (datosPortada, con su caché); si faltan, cada parte dice lo mismo sin
 * números o no aparece.
 */
export default async function InicioLicitaciones() {
  const base = baseProducto("licitaciones");
  const [cat, d] = await Promise.all([planesServidor("licitaciones"), datosPortada()]);
  const ruta = (p: string) => rutaEn(base, p);
  const crear = ruta(`/entrar?crear=1&next=${encodeURIComponent("/cuenta?tab=para-ti")}`);
  const r = d.resumen;
  const m = d.menores;
  const comp = r?.competencia;
  const unSolo = comp?.procesos && comp.unSoloPostor != null ? Math.round((comp.unSoloPostor / comp.procesos) * 100) : null;
  const opciones = d.rubros.map((x) => opcionRubro(x, ruta));

  const puestos: Puesto[] = [
    {
      sprite: "iconoCalendario",
      titulo: "Contratos menores para cotizar hoy",
      texto: "Compras de hasta 8 UIT que todavía reciben cotizaciones, con sus términos de referencia. Se actualizan cada hora.",
      cifra: m ? { texto: numero(m.abiertas), que: m.cierranHoy > 0 ? <>abiertos; {numero(m.cierranHoy)} cierran hoy</> : "abiertos ahora" } : null,
      accion: "Ver los contratos menores",
      href: ruta("/menores"),
      oscura: true,
    },
    {
      sprite: "iconoLupa",
      titulo: "Licitaciones del SEACE",
      texto: "Cada convocatoria con sus ítems, sus bases y la entidad que compra.",
      cifra: r ? { texto: numero(r.semana), que: "en los últimos 7 días" } : null,
      accion: "Ver las licitaciones",
      href: ruta("/oportunidades"),
    },
    {
      sprite: "obra",
      titulo: "Obras, incluidas en tu plan",
      texto: "Las inversiones que se vienen, para llegar antes de que se liciten.",
      accion: "Ver las obras",
      href: urlCanonica("obras", "/"),
    },
    {
      sprite: "iconoCaja",
      titulo: "El mercado de tu rubro",
      texto: "Quién compra, quién gana y a qué precio en los últimos 12 meses.",
      cifra: comp?.adjudicado ? { texto: solesCompacto(comp.adjudicado), que: "adjudicados en 12 meses" } : null,
      accion: "Ver el mercado",
      href: ruta("/mercado"),
    },
    {
      sprite: "documento",
      titulo: "Tu asistente con IA",
      texto: "Le preguntas como a un colega: «¿Qué licitaciones de uniformes hay esta semana en Cusco?». Viene con los planes.",
      accion: "Ver lo que incluye cada plan",
      href: ruta("/planes#comparar"),
    },
  ];

  return (
    <>
      {/* ── La oferta, viva ─────────────────────────────────────────────────── */}
      <section className="sobre-oscuro relative overflow-hidden bg-ink text-paper">
        <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-40" />
        <div className="container-page relative grid gap-x-12 gap-y-7 py-9 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:py-16">
          <div className="min-w-0">
            <h1 className="max-w-[16ch] text-balance font-display text-portada font-bold leading-[1.04] tracking-[-0.025em] sm:text-cartel">
              Véndele al Estado sin revisar el SEACE cada mañana.
            </h1>
            <p className="mt-5 max-w-[54ch] text-pretty text-cuerpo leading-relaxed text-paper/80 sm:text-bloque">
              {r && m ? (
                <>
                  En los últimos 7 días el Estado publicó <Odometro texto={numero(r.semana)} className="font-semibold text-paper" /> licitaciones, y hoy hay{" "}
                  <Odometro texto={numero(m.abiertas)} retardo={250} className="font-semibold text-paper" /> contratos menores que todavía puedes cotizar. Te
                  mostramos los que calzan con lo que vendes.
                </>
              ) : (
                <>Dinos qué vende tu empresa. Cada día te mostramos las licitaciones y los contratos menores que calzan contigo, con lo que necesitas saber para ganarlos.</>
              )}
            </p>
          </div>
          {/* Lo vivo: en el celular, después de la frase; desde lg, la columna de la derecha (en lugar de la escena). */}
          {opciones.length >= 2 && (
            <Pruebalo oscuro className="lg:col-start-2 lg:row-span-2 lg:row-start-1" pregunta="¿Qué vendes? Mira lo que hay hoy" opciones={opciones} />
          )}
          <div className="min-w-0">
            <BuscadorRubro accion={ruta("/oportunidades")} className="max-w-xl" />
            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href={crear} className={claseAccion("oscuro", "", "lg")}>
                Crear mi cuenta gratis <ArrowRight size={18} aria-hidden />
              </Link>
              <Link href={ruta("/planes")} className="inline-flex min-h-11 items-center text-dato font-semibold text-paper/85 underline-offset-4 hover:text-paper hover:underline">
                Ver planes
              </Link>
            </div>
            <p className="mt-3 text-meta text-paper/65">Gratis y sin tarjeta. Datos oficiales del SEACE y el OECE. Obras incluidas en tu plan.</p>
          </div>
        </div>
      </section>

      <div className="container-page space-y-14 pb-14 pt-12 sm:space-y-16 sm:pb-16 sm:pt-14">
        {/* ── Cómo funciona: el problema de hoy y lo que hace Gobserva ─────────── */}
        <section aria-labelledby="como-t">
          <Cabecera id="como-t" titulo="Llega a tiempo y oferta sabiendo" bajada="Hoy venderle al Estado es llegar tarde o a ciegas. El primer paso lo haces tú, una vez; lo demás corre solo cada día." />
          <PestanasVivas
            etiqueta="Cómo funciona Gobserva Licitaciones"
            className="mt-6"
            auto={6500}
            pestanas={[
              { titulo: "Dinos qué vendes", icono: <Icono sprite="emprendedora" /> },
              { titulo: "Lo que calza", icono: <Icono sprite="iconoLupa" /> },
              { titulo: "Avisos a tiempo", icono: <Icono sprite="iconoCampana" /> },
              { titulo: "Contra quién compites", icono: <Icono sprite="pregunta" /> },
            ]}
          >
            <Panel titulo="Una sola vez, en tus palabras" maqueta={<MaquetaLinea />}>
              Escribe lo que vende tu empresa, las regiones donde atiendes y lo que compras. Es tu línea de negocio: con ella ordenamos todo lo demás.
            </Panel>
            <Panel
              titulo="Lo tuyo, primero"
              maqueta={<MaquetaParaTi />}
              hoy="Cada día se publican compras de todas las entidades y todos los rubros, y la que era para ti pasa de largo."
              accion={{ href: ruta("/para-ti"), etiqueta: "Así se ve «Para ti»" }}
            >
              En «Para ti» están las licitaciones y los contratos menores abiertos, de lo que más se parece a lo que vendes a lo que menos, con un puntaje de
              afinidad de 0 a 100.
            </Panel>
            <Panel
              titulo="Te avisamos antes de que cierre"
              maqueta={<MaquetaAviso correo={cat.correoActivo} />}
              hoy="Los contratos menores reciben cotizaciones por pocos días, a veces por horas: si no lo ves a tiempo, ya cerró."
            >
              Lo nuevo llega {cat.correoActivo ? "a tu correo" : "a tu cuenta"} y como notificación a tu celular: con la cuenta gratis, cada semana; con un plan,
              cada mañana. Y te recordamos lo que guardaste 2 días antes de que cierre.
            </Panel>
            <Panel
              titulo="Pones tu precio sabiendo"
              maqueta={<MaquetaContexto />}
              hoy={
                unSolo != null && comp?.postoresPromedio ? (
                  <>
                    En el último año, en <b className="font-semibold text-ink">{unSolo} de cada 100</b> procesos se presentó un solo postor, y en promedio
                    compitieron {comp.postoresPromedio.toLocaleString("es-PE", { maximumFractionDigits: 1 })}. Sin saber quién le vende a esa entidad ni a qué
                    precio, se oferta a ciegas.
                  </>
                ) : (
                  "Sin saber quién le vende a esa entidad, a qué precio se adjudicó lo mismo ni cuántos compiten, el precio se pone adivinando."
                )
              }
            >
              Antes de cotizar ves quién le vende a esa entidad, a qué precio se adjudicó lo mismo en otras y cuántos suelen competir. Todo con el enlace a la
              fuente oficial.
            </Panel>
          </PestanasVivas>
        </section>

        {/* ── Todo en una sola cuenta ────────────────────────────────────────── */}
        <section aria-labelledby="todo-t">
          <Cabecera id="todo-t" titulo="Todo en una sola cuenta" bajada="Bienes, servicios, consultorías y obras: lo que compra el Estado, en una suscripción." />
          <TodoEnUnaCuenta className="mt-6" puestos={puestos} />
        </section>

        {/* ── Tu IA (MCP): el menú «API y MCP» trae aquí ──────────────────────── */}
        <FranjaMCP que="licitaciones, obras y tu mercado" href={ruta("/planes#mcp")} />

        {/* ── Preguntas ──────────────────────────────────────────────────────── */}
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

        {/* ── Empieza gratis: los planes, cortos, y la cuenta ───────────────── */}
        <section aria-labelledby="planes-t" className="sobre-oscuro relative overflow-hidden rounded-3xl border border-paper/10 bg-ink px-5 py-7 text-paper sm:px-10 sm:py-10">
          <div aria-hidden className="fondo-puntos pointer-events-none absolute inset-0 opacity-40" />
          <div className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
            <div className="min-w-0 max-w-3xl">
              <h2 id="planes-t" className="text-balance font-display text-cifra font-bold leading-[1.1] tracking-[-0.02em] sm:text-titulo">
                Que la próxima compra de tu rubro te encuentre a ti
              </h2>
              <p className="mt-3 max-w-[60ch] text-pretty text-cuerpo leading-relaxed text-paper/80">
                Buscar, leer las fichas y ver «Para ti» es gratis, y con tu cuenta te avisamos cada semana. Los planes te avisan cada mañana, guardan más y
                bajan tus búsquedas en Excel.{" "}
                <Link href={ruta("/planes#comparar")} className="whitespace-nowrap font-semibold text-maiz underline-offset-4 hover:underline">
                  Comparar lo que incluye cada plan
                </Link>
              </p>
            </div>
            <div aria-hidden className="flex items-end gap-3 max-sm:hidden">
              <Pixel nombre="emprendedora" escala={4} retardo={1600} />
              <Pixel nombre="camion" escala={4} />
            </div>
          </div>
          <PlanesCortos className="relative mt-6" planes={planesLicitaciones(base, cat)} />
        </section>
      </div>
    </>
  );
}

/** Lo que muestra «¿Qué vendes?» para un rubro: cuántas convocatorias en 15 días, la más reciente y los menores abiertos. */
function opcionRubro(x: RubroVivo, ruta: (p: string) => string): OpcionPrueba {
  const rubro = x.etiqueta.toLocaleLowerCase("es-PE");
  const p = x.primera;
  const objeto = p ? recortar(limpiar(p.objeto).replace(/["“”]/g, ""), 90) : "";
  return {
    etiqueta: x.etiqueta,
    cifra: numero(x.total),
    unidad: <>{x.total === 1 ? "licitación" : "licitaciones"} de {rubro} en los últimos 15 días</>,
    detalle: (
      <>
        {p && objeto ? <>{masReciente(objeto, p.entidad, p.consultasHasta)} </> : null}
        {x.menores ? (
          <b className="font-semibold text-paper">
            Y {numero(x.menores)} {x.menores === 1 ? "contrato menor" : "contratos menores"} para cotizar ya.
          </b>
        ) : null}
      </>
    ),
    href: ruta(`/oportunidades?q=${encodeURIComponent(x.q)}`),
    accion: `Ver ${x.total === 1 ? "la" : `las ${numero(x.total)}`} de ${rubro}`,
  };
}

/**
 * «La más reciente: «…» (Municipalidad Distrital de…), con consultas hasta el 24 nov.». La entidad entre paréntesis: su
 * nombre oficial no siempre admite «de la». Sin doble punto cuando la fecha ya termina en punto.
 */
function masReciente(objeto: string, entidad: string | null, consultasHasta: string | null): string {
  const frase = `La más reciente: «${objeto}»${entidad ? ` (${tituloNatural(entidad)})` : ""}${consultasHasta ? `, con consultas hasta el ${fechaCorta(consultasHasta)}` : ""}`;
  return frase.endsWith(".") ? frase : `${frase}.`;
}

function recortar(t: string, max: number): string {
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  return `${corte.slice(0, Math.max(corte.lastIndexOf(" "), max - 15)).replace(/[,;:.\s]+$/, "")}…`;
}

function Icono({ sprite }: { sprite: NombreSprite }) {
  return (
    <span aria-hidden className="flex h-6 w-6 items-end justify-center">
      <Pixel nombre={sprite} escala={sprite === "emprendedora" ? 1 : 1.25} acento="accion" animado={false} />
    </span>
  );
}

function Cabecera({ id, titulo, bajada }: { id: string; titulo: string; bajada?: string }) {
  return (
    <div className="min-w-0 max-w-3xl">
      <h2 id={id} className="text-balance font-display text-titulo font-bold leading-[1.08] tracking-[-0.02em] text-ink sm:text-vitrina">
        {titulo}
      </h2>
      {bajada && <p className="mt-3 max-w-[62ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">{bajada}</p>}
    </div>
  );
}

/**
 * Un panel de «Cómo funciona»: lo que pasa hoy sin Gobserva (si aplica), lo que hace Gobserva, y su maqueta al lado
 * desde lg (en el celular, debajo).
 */
function Panel({
  titulo,
  hoy,
  children,
  maqueta,
  accion,
}: {
  titulo: string;
  hoy?: ReactNode;
  children: ReactNode;
  maqueta: ReactNode;
  accion?: { href: string; etiqueta: string };
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start lg:gap-12">
      <div className="min-w-0 lg:pt-2">
        {hoy && <p className="max-w-[50ch] text-pretty text-dato leading-relaxed text-mute">{hoy}</p>}
        <h3 className={`${hoy ? "mt-4" : ""} font-display text-seccion font-bold leading-tight text-ink sm:text-cifra`}>{titulo}</h3>
        <p className="mt-2.5 max-w-[50ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">{children}</p>
        {accion && (
          <Link href={accion.href} className="mt-3 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
            {accion.etiqueta} <ArrowRight size={15} aria-hidden />
          </Link>
        )}
      </div>
      <div className="min-w-0">{maqueta}</div>
    </div>
  );
}
