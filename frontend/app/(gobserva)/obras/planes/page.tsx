import type { Metadata } from "next";
import { BadgeCheck, CalendarPlus, CalendarX2, Handshake, HardHat, Megaphone, Sparkles } from "lucide-react";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { AvisoPlanes, ComoFunciona } from "@/components/gobserva/ComoFunciona";
import { Planes } from "@/components/gobserva/Planes";
import { TiraCifras } from "@/components/gobserva-obras/Piezas";
import { planesObras } from "@/components/gobserva-obras/planes";
import { Faq } from "@/components/licitaciones/Faq";
import { fechaCorta, numero, solesCompacto } from "@/lib/formato";
import { urlCanonica } from "@/lib/gobserva";
import { getResumenObras } from "@/lib/gobserva-obras";
import { planesServidor } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "Planes",
  description:
    "Alertas de obras públicas por región, sector y monto: los proyectos nuevos y los que pasan a licitación. Seguimiento de proyectos, descarga en Excel y MCP, con precio de fundador para las primeras 50 empresas.",
  alternates: { canonical: urlCanonica("obras", "/planes") },
};

/**
 * Los planes de Gobserva Obras (precios del catálogo de la API): arriba, lo que hay hoy para vigilar (las cifras vivas de
 * Invierte.pe e INFOBRAS, GET /proyectos/resumen, la misma caché de la portada), los planes, las garantías, cómo se paga,
 * el MCP y las preguntas frecuentes.
 */
export default async function PlanesObras() {
  const base = baseProducto("obras");
  const [cat, r] = await Promise.all([planesServidor("obras"), getResumenObras()]);
  const cupo = cat.planes.find((p) => p.id === "pro")?.fundador?.cupo;

  return (
    <div className="container-page space-y-16 py-10 sm:py-14">
      <header className="grid gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-end">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Llega a las obras antes que tu competencia</h1>
          <p className="mt-3 text-pretty text-bloque leading-relaxed text-inkSoft">
            Buscar proyectos, leer sus fichas y medir tu mercado es gratis. Los planes de pago te traen cada mañana los proyectos nuevos y los que
            cambian de fase, siguen los que guardaste y bajan cualquier búsqueda en Excel.
          </p>
          <AvisoPlanes texto={cat.aviso} className="mt-5" />
        </div>
        {r && (
          <section aria-labelledby="hoy-t" className="min-w-0">
            <h2 id="hoy-t" className="font-display text-bloque font-bold leading-tight text-ink">
              Lo que vigilas con Gobserva Obras, hoy
            </h2>
            <TiraCifras
              className="mt-3"
              enDos
              etiqueta="Cifras de hoy"
              items={[
                { Icono: Sparkles, etiqueta: "Proyectos que se vienen", valor: numero(r.seVienen), detalle: `Por ${solesCompacto(r.seVienenMonto)}`, destacado: true },
                { Icono: Megaphone, etiqueta: "Se licitan ahora", valor: numero(r.licitando), detalle: `Por ${solesCompacto(r.licitandoMonto)}` },
                { Icono: CalendarPlus, etiqueta: "Viables en 30 días", valor: numero(r.nuevos30), detalle: "Proyectos recién declarados" },
                { Icono: HardHat, etiqueta: "Obras en marcha", valor: numero(r.enMarcha), detalle: `Por ${solesCompacto(r.enMarchaMonto)}` },
              ]}
            />
            {r.estado?.inversionesAl && (
              <p className="mt-2 text-rotulo text-mute">
                Invierte.pe al {fechaCorta(r.estado.inversionesAl)}
                {r.estado.infobrasAl ? `, INFOBRAS al ${fechaCorta(r.estado.infobrasAl)}` : ""}; las convocatorias del SEACE, a diario.
              </p>
            )}
          </section>
        )}
      </header>

      <Planes planes={planesObras(base, cat)} />

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Garantia Icono={CalendarX2} titulo="Sin permanencia" texto="Cancelas desde tu cuenta cuando quieras y sigues con tu plan hasta el final del mes pagado." />
        {cupo ? (
          <Garantia Icono={Sparkles} titulo="Tu precio se queda" texto={`Las primeras ${cupo} empresas conservan el precio de fundador mientras mantengan su plan.`} />
        ) : (
          <Garantia Icono={Handshake} titulo="Sin comisiones" texto="Pagas el plan y nada más: nunca cobramos un porcentaje de lo que ganes." />
        )}
        <Garantia Icono={BadgeCheck} titulo="Datos oficiales" texto="Todo sale de Invierte.pe (MEF), INFOBRAS (Contraloría) y el SEACE (OECE), con el enlace a la fuente en cada ficha." />
      </ul>

      <ComoFunciona
        cat={cat}
        pasos={[
          { titulo: "Crea tu cuenta", texto: "Con Google o con tu correo, gratis y en un minuto." },
          { titulo: "Busca las obras que te interesan", texto: "Filtra los proyectos por región, sector, fase y monto, y guarda la búsqueda como alerta." },
          { titulo: "Te llega lo que cambia", texto: "Los proyectos nuevos y los que aprueban su expediente, pasan a licitación o se paralizan, con el enlace a su ficha." },
        ]}
      />

      <BloqueMCP
        titulo="API y MCP para tu equipo"
        bajada="Conecta tu asistente de IA al servidor MCP de Gobserva y pregunta por los proyectos que se vienen, por una obra o por el mercado de tu región. Gratis durante la beta; el plan Empresa sumará una API para tu CRM y el Institucional, límites altos y soporte."
        ejemplos={[
          "Resume los proyectos de riego con expediente técnico en Cajamarca y su presupuesto de este año.",
          "¿Cuánto avanzó la obra del CUI 2233850 y quién la construye?",
          "Compárame el mercado de obras de saneamiento de Piura y de Lambayeque.",
        ]}
        herramientas={[
          { nombre: "buscar_proyectos_inversion", descripcion: "Los proyectos que se vienen, en marcha o paralizados, con filtros por texto, región, sector, fase y monto." },
          { nombre: "ficha_proyecto", descripcion: "Un proyecto por su CUI: montos, fase, obras con su avance, procesos del SEACE y quién los ganó." },
          { nombre: "mercado_obras", descripcion: "El mercado de obras de una región y un sector: pipeline, ejecución, paralizadas y quién gana." },
        ]}
      />

      <Faq
        preguntas={[
          {
            p: "¿Cómo llegan las alertas?",
            r: "Por correo y, si lo activas en tu cuenta, como notificación en tu celular o tu computadora: una vez por semana con la cuenta gratis y cada mañana con Pro o Empresa, con los proyectos nuevos de tu búsqueda y los que cambiaron de fase (aprobaron su expediente, pasaron a licitación, empezaron la obra o se paralizaron).",
          },
          {
            p: "¿Puedo seguir un solo proyecto?",
            r: "Sí. En su ficha, «Avísame cuando cambie de fase» crea una alerta con su CUI: te avisamos cuando apruebe su expediente técnico, se licite, empiece la obra o se paralice. También puedes guardarlo en tu cuenta con una nota y su estado.",
          },
          { p: "¿Qué es guardar un proyecto?", r: "Guardas los proyectos que te interesan desde su ficha y los tienes juntos en tu cuenta, con una nota y su estado: preparando, presentada, ganada o perdida." },
          { p: "¿Cómo pago?", r: "Con tarjeta de crédito o débito por Mercado Pago, que se cobra cada mes, o con Yape o Plin por 1, 3, 6 o 12 meses de una vez." },
          { p: "¿Reemplaza al SEACE?", r: "No. Las ofertas se presentan en el SEACE. Gobserva Obras te avisa antes y te da contexto; cada ficha enlaza al MEF, a INFOBRAS y a los procesos oficiales." },
          { p: "¿Es legal?", r: "Sí: son datos públicos que el Estado publica por ley (transparencia y datos abiertos). Gobserva no vende datos personales ni nombra a personas naturales." },
          { p: "¿Puedo cancelar?", r: "Sí, desde tu cuenta y sin penalidad. No se vuelve a cobrar y sigues con tu plan hasta el final de lo que pagaste." },
          {
            p: "¿Tienen relación con Vigía?",
            r: "Vigía es el proyecto cívico y gratuito de Gobserva que vigila las compras y las obras del Estado. Gobserva Obras usa los mismos datos públicos para ayudar a las empresas a competir; pagar un plan nunca cambia lo que Vigía muestra de nadie.",
          },
        ]}
      />
    </div>
  );
}

function Garantia({ Icono, titulo, texto }: { Icono: typeof Sparkles; titulo: string; texto: string }) {
  return (
    <li className="flex min-w-0 gap-3 rounded-2xl border border-line bg-paper p-4">
      <Icono size={20} aria-hidden className="mt-0.5 shrink-0 text-granate" />
      <div className="min-w-0">
        <p className="text-dato font-semibold text-ink">{titulo}</p>
        <p className="mt-0.5 text-meta leading-snug text-inkSoft">{texto}</p>
      </div>
    </li>
  );
}
