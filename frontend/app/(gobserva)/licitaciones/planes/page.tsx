import type { Metadata } from "next";
import { BadgeCheck, Bot, CalendarX2, CircleHelp, CreditCard, Footprints, Handshake, MailCheck, Sparkles, Table2 } from "lucide-react";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { AvisoPlanes, ComoFunciona } from "@/components/gobserva/ComoFunciona";
import { Planes } from "@/components/gobserva/Planes";
import { PestanasVivas } from "@/components/gobserva/portada/PestanasVivas";
import { AnclaEnPestana } from "@/components/licitaciones/AnclaEnPestana";
import { ComparaPlanes } from "@/components/licitaciones/ComparaPlanes";
import { Faq } from "@/components/licitaciones/Faq";
import { planesLicitaciones } from "@/components/licitaciones/planes";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { COBROS_EN_PAUSA, entero, planesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "Planes",
  description: COBROS_EN_PAUSA
    ? "Alertas diarias de licitaciones por rubro y región, procesos guardados con su estado, descarga en Excel y MCP: gratis con tu cuenta y tu correo confirmado. Los planes de pago llegan pronto."
    : "Alertas diarias de licitaciones por rubro y región, procesos guardados con su estado, descarga en Excel y MCP. Con precio de fundador para las primeras 50 empresas.",
  alternates: { canonical: urlCanonica("licitaciones", "/planes") },
};

/**
 * Los planes de Gobserva Licitaciones (modo persuadir): las tarjetas con los precios del catálogo de la API, la tabla que
 * los compara con sus límites reales, lo que se garantiza, cómo se empieza y se paga, el MCP y las preguntas frecuentes.
 * 2026-11-22 (el usuario: «páginas más cortas»; medía 9,110 px en el celular): los planes y las garantías se deslizan en
 * fila en el celular, y la tabla (#comparar), «cómo empiezas y pagas», el MCP (#mcp) y las preguntas van en pestañas.
 * La portada enlaza a esas anclas: AnclaEnPestana abre la pestaña que las tiene.
 */
export default async function PlanesLicitaciones() {
  const base = baseProducto("licitaciones");
  const cat = await planesServidor("licitaciones");
  const cupo = cat.planes.find((p) => p.id === "crece")?.fundador?.cupo;
  // Con los cobros en pausa (2026-11-24): todo gratis con la cuenta verificada y los planes de pago «próximamente».
  const pausa = cat.enPausa && cat.abierto;

  return (
    <div className="container-page space-y-16 py-10 sm:py-14">
      <header className="max-w-3xl">
        {pausa ? (
          <>
            <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Hoy, todo gratis con tu cuenta</h1>
            <p className="mt-3 text-pretty text-bloque leading-relaxed text-inkSoft">
              Licitaciones, contratos menores abiertos y obras que se vienen, en una sola cuenta. Créala con tu correo, confírmalo y tienes lo nuevo cada
              mañana, tus procesos guardados con su estado, descargas en Excel y tu MCP para preguntarle a tu IA, sin pagar nada. Los planes de pago llegan pronto.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Elige tu plan para venderle al Estado</h1>
            <p className="mt-3 text-pretty text-bloque leading-relaxed text-inkSoft">
              Licitaciones, contratos menores abiertos y obras que se vienen, en una sola cuenta. Buscar, leer las fichas y medir tu mercado es gratis; los
              planes de pago te traen lo nuevo cada mañana, guardan tus procesos con su estado y bajan cualquier búsqueda en Excel.
            </p>
            <AvisoPlanes texto={cat.aviso} className="mt-5" />
          </>
        )}
      </header>

      <div className="space-y-6">
        {/* En el celular, una fila que se desliza (las cinco tarjetas apiladas eran cuatro pantallas); desde md, la rejilla. */}
        <Planes
          planes={planesLicitaciones(base, cat)}
          className="max-md:-mx-4 max-md:flex max-md:snap-x max-md:snap-mandatory max-md:overflow-x-auto max-md:px-4 max-md:pb-3 max-md:[scrollbar-width:none] max-md:[&::-webkit-scrollbar]:hidden max-md:[&>li]:w-[84%] max-md:[&>li]:shrink-0 max-md:[&>li]:snap-start max-md:[&>li]:scroll-ml-4"
        />
        <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
          {pausa ? (
            <>
              <Garantia Icono={CreditCard} titulo="Sin tarjeta" texto="No te pedimos tarjeta ni datos de pago: tu cuenta es gratis." />
              <Garantia Icono={MailCheck} titulo="Solo tu correo" texto="Confírmalo con el enlace que te enviamos, o entra con Google, y se abre todo." />
            </>
          ) : (
            <Garantia Icono={CalendarX2} titulo="Sin permanencia" texto="Cancelas desde tu cuenta cuando quieras y sigues con tu plan hasta el final del mes pagado." />
          )}
          {pausa ? null : cupo ? (
            <Garantia Icono={Sparkles} titulo="Tu precio se queda" texto={`Las primeras ${cupo} empresas conservan el precio de fundador mientras mantengan su plan.`} />
          ) : (
            <Garantia Icono={Handshake} titulo="Sin comisiones" texto="Pagas el plan y nada más: nunca cobramos un porcentaje de lo que ganes." />
          )}
          <Garantia Icono={BadgeCheck} titulo="Datos oficiales" texto="Todo sale del SEACE y de CONOSCE (OECE), con el enlace a la fuente en cada ficha." />
        </ul>
      </div>

      <section aria-labelledby="dudas-t">
        <h2 id="dudas-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
          Compara y decide
        </h2>
        {/* La portada enlaza a /planes#comparar y /planes#mcp: si el ancla cae en una pestaña cerrada, la abre. */}
        <AnclaEnPestana />
        <PestanasVivas
          etiqueta={pausa ? "Cómo empiezas, el MCP y las preguntas frecuentes" : "La tabla de los planes, cómo empiezas y pagas, el MCP y las preguntas frecuentes"}
          className="mt-3"
          pestanas={[
            ...(pausa ? [] : [{ titulo: "Compara los planes", icono: <Table2 size={16} aria-hidden /> }]),
            { titulo: pausa ? "Cómo empiezas" : "Cómo empiezas y pagas", icono: <Footprints size={16} aria-hidden /> },
            { titulo: "API y MCP", icono: <Bot size={16} aria-hidden /> },
            { titulo: "Preguntas", icono: <CircleHelp size={16} aria-hidden /> },
          ]}
        >
          {pausa ? null : <ComparaPlanes cat={cat} />}
          <ComoFunciona
            cat={cat}
            sinPagos={!!pausa}
            pasos={[
              { titulo: "Crea tu cuenta", texto: "Con Google o con tu correo, gratis y en un minuto." },
              { titulo: "Busca lo que vendes", texto: "Filtra las convocatorias por palabras, región, tipo y monto, y guarda la búsqueda como alerta." },
              {
                titulo: "Te llega lo nuevo",
                texto: pausa
                  ? "Con tu correo confirmado, las convocatorias nuevas de tu búsqueda cada mañana, con el plazo de consultas de cada una y el enlace a sus bases."
                  : "Las convocatorias nuevas de tu búsqueda (cada semana gratis; cada mañana con un plan de pago), con el plazo de consultas de cada una y el enlace a sus bases.",
              },
            ]}
          />
          <BloqueMCP
            titulo="API y MCP para tu equipo"
            bajada={
              pausa
                ? `Tu cuenta gratis trae tu MCP, con ${entero(cat.abierto?.mcp ?? 1500)} créditos al mes: conecta tu asistente de IA y pregunta por las licitaciones del día, las obras, tu mercado o una entidad. La API para tu CRM llega con los planes de pago.`
                : "Cualquier plan de pago trae tu MCP: conecta tu asistente de IA y pregunta por las licitaciones del día, las obras, tu mercado o una entidad. El plan Pro sumará una API para tu CRM y el Institucional, límites altos y soporte."
            }
            cuenta="Gobserva Licitaciones"
            planes={pausa ? rutaEn(base, "/entrar?crear=1") : "#comparar"}
            ejemplos={[
              "Resume las convocatorias de señalización vial de esta semana con su valor referencial.",
              "¿Qué entidades de Arequipa compran más medicamentos y a quién le compran?",
              "Compárame cuántos postores hubo en las obras de agua potable de Cajamarca y de Puno.",
            ]}
            herramientas={[
              { nombre: "buscar_licitaciones", descripcion: "Las convocatorias recientes del SEACE, con filtros por palabras, región, tipo y valor referencial." },
              { nombre: "mercado_rubro", descripcion: "El mercado de un rubro en 12 meses: procesos, monto adjudicado, quién compra, quién gana y cuántos compiten." },
            ]}
          />
          <Faq
            preguntas={pausa ? [
              {
                p: "¿De verdad es gratis?",
                r: "Sí. Los planes de pago llegan pronto; mientras tanto, con tu cuenta y tu correo confirmado usas todo lo que ya funciona sin pagar nada y sin dejar una tarjeta.",
              },
              {
                p: "¿Por qué piden confirmar el correo?",
                r: "Para que las alertas te lleguen a ti y para cuidar el servicio de robots. Sin confirmarlo tienes 1 alerta semanal y 30 guardados; al confirmarlo se abre todo.",
              },
              {
                p: "¿Cómo llegan las alertas?",
                r: cat.correoActivo
                  ? "Por correo y, si lo activas en tu cuenta, como notificación en tu celular o tu computadora: cada mañana, con las convocatorias nuevas de tu búsqueda y el plazo de consultas de cada una."
                  : "Por ahora en tu cuenta («Lo último que te avisamos») y, si lo activas, como notificación en tu celular o tu computadora; los correos salen en los próximos días.",
              },
              { p: "¿Reemplaza al SEACE?", r: "No. Las ofertas se presentan en el SEACE. Gobserva te avisa a tiempo y te da contexto; cada ficha enlaza al proceso oficial y a sus bases." },
              { p: "¿Es legal?", r: "Sí: son datos públicos que el Estado publica por ley (transparencia y datos abiertos). Gobserva no vende datos personales ni nombra a personas naturales." },
              { p: "¿Tienen relación con Vigía?", r: "Vigía es el proyecto cívico y gratuito de Gobserva que vigila las compras del Estado. Gobserva Licitaciones usa los mismos datos públicos para ayudar a las empresas a competir." },
            ] : [
              {
                p: "¿Cómo llegan las alertas?",
                r: cat.correoActivo
                  ? "Por correo y, si lo activas en tu cuenta, como notificación en tu celular o tu computadora: una vez por semana con la cuenta gratis y cada mañana con Inicia, Crece o Pro, con las convocatorias nuevas de tu búsqueda y el plazo de consultas de cada una."
                  : "Por ahora en tu cuenta («Lo último que te avisamos») y, si lo activas, como notificación en tu celular o tu computadora; los correos salen en los próximos días. Una vez por semana con la cuenta gratis y cada mañana con Inicia, Crece o Pro, con el plazo de consultas de cada convocatoria.",
              },
              { p: "¿Cómo pago?", r: "Con tarjeta de crédito o débito por Mercado Pago, que se cobra cada mes, o con Yape o Plin por 1, 3, 6 o 12 meses de una vez." },
              { p: "¿Qué es el precio de fundador?", r: "Un precio rebajado para las primeras 50 empresas de cada plan. Lo conservas mientras mantengas tu plan, aunque después el precio suba." },
              { p: "¿Reemplaza al SEACE?", r: "No. Las ofertas se presentan en el SEACE. Gobserva te avisa a tiempo y te da contexto; cada ficha enlaza al proceso oficial y a sus bases." },
              { p: "¿Es legal?", r: "Sí: son datos públicos que el Estado publica por ley (transparencia y datos abiertos). Gobserva no vende datos personales ni nombra a personas naturales." },
              { p: "¿Puedo cancelar?", r: "Sí, desde tu cuenta y sin penalidad. No se vuelve a cobrar y sigues con tu plan hasta el final de lo que pagaste." },
              { p: "¿Tienen relación con Vigía?", r: "Vigía es el proyecto cívico y gratuito de Gobserva que vigila las compras del Estado. Gobserva Licitaciones usa los mismos datos públicos para ayudar a las empresas a competir; pagar un plan nunca cambia lo que Vigía muestra de nadie." },
            ]}
          />
        </PestanasVivas>
      </section>


    </div>
  );
}

function Garantia({ Icono, titulo, texto }: { Icono: typeof Sparkles; titulo: string; texto: string }) {
  return (
    <li className="flex w-[78%] min-w-0 shrink-0 snap-start scroll-ml-4 gap-3 rounded-2xl border border-line bg-paper p-4 md:w-auto">
      <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-granate-50 text-granate">
        <Icono size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-dato font-semibold text-ink">{titulo}</p>
        <p className="mt-0.5 text-meta leading-snug text-inkSoft">{texto}</p>
      </div>
    </li>
  );
}
