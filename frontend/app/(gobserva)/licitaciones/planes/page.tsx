import type { Metadata } from "next";
import { BadgeCheck, Lock, Receipt } from "lucide-react";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { Planes } from "@/components/gobserva/Planes";
import { Suscribirse } from "@/components/gobserva/Suscribirse";
import { Faq } from "@/components/licitaciones/Faq";
import { OPCIONES_PLAN_LICITACIONES, planesLicitaciones } from "@/components/licitaciones/planes";
import { urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { REGIONES_UBIGEO, TIPOS } from "@/lib/licitaciones";

export const metadata: Metadata = {
  title: "Planes",
  description: "Alertas diarias de licitaciones por rubro y región, inteligencia de mercado, API y MCP. Reserva tu precio de fundador: sin pagar nada hoy.",
  alternates: { canonical: urlCanonica("licitaciones", "/planes") },
};

const PLANES_VALIDOS = ["gratis", "pro", "empresa", "institucional"] as const;

/** Los planes de Gobserva Licitaciones, la lista de espera con precio de fundador, el MCP y las preguntas frecuentes. */
export default function PlanesLicitaciones({ searchParams }: { searchParams?: { plan?: string; rubro?: string } }) {
  const base = baseProducto("licitaciones");
  const plan = PLANES_VALIDOS.find((p) => p === searchParams?.plan) ?? "pro";
  const rubro = (searchParams?.rubro ?? "").trim().slice(0, 80);

  return (
    <div className="container-page space-y-16 py-10 sm:py-14">
      <header className="max-w-3xl">
        <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Elige cómo quieres ganarle al SEACE</h1>
        <p className="mt-3 text-pretty text-bloque leading-relaxed text-inkSoft">
          Durante la beta todo lo que ves en la web es gratis. Los planes de pago suman las alertas de cada mañana, la descarga en Excel, el
          histórico y la API. Reserva hoy tu precio de fundador: no cobramos nada hasta que abramos tu plan y lo confirmes.
        </p>
      </header>

      <Planes planes={planesLicitaciones(base)} />

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Garantia Icono={Lock} titulo="Sin tarjeta hoy" texto="Reservar es gratis. Te escribimos antes de abrir tu plan y decides entonces." />
        <Garantia Icono={Receipt} titulo="Con factura" texto="Al abrir los planes de pago emitimos factura electrónica a tu empresa." />
        <Garantia Icono={BadgeCheck} titulo="Datos oficiales" texto="Todo sale del SEACE y de CONOSCE (OECE), con el enlace a la fuente en cada ficha." />
      </ul>

      <section id="unete" aria-labelledby="unete-t" className="scroll-mt-24 grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="min-w-0">
          <h2 id="unete-t" className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">
            Reserva tu lugar
          </h2>
          <p className="mt-3 text-cuerpo leading-relaxed text-inkSoft">
            Cuéntanos qué vendes y dónde puedes atender. Abrimos por orden de llegada y las primeras 50 empresas se quedan con el precio de
            fundador mientras mantengan su plan.
          </p>
          <ol className="mt-6 space-y-3 text-dato text-inkSoft">
            <li className="flex gap-3">
              <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-granate font-mono text-meta font-bold text-paper">1</span>
              Te anotas hoy, gratis.
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-granate font-mono text-meta font-bold text-paper">2</span>
              Te escribimos para afinar tus rubros y regiones.
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-granate font-mono text-meta font-bold text-paper">3</span>
              Empiezas a recibir tus oportunidades cada mañana, y recién ahí confirmas el pago.
            </li>
          </ol>
        </div>
        <Suscribirse
          producto="licitaciones"
          planes={OPCIONES_PLAN_LICITACIONES}
          planInicial={plan}
          conEmpresa
          valoresIniciales={rubro ? { rubros: rubro } : undefined}
          origen={`licitaciones:planes${rubro ? `:${rubro}` : ""}`}
          intereses={[
            { clave: "rubros", etiqueta: "Qué vendes", tipo: "texto", placeholder: rubro || "Ej.: combustible, uniformes, obras de saneamiento", ayuda: "Tus rubros en tus palabras, separados por comas." },
            { clave: "tipos", etiqueta: "Tipo de contratación", tipo: "lista", opciones: TIPOS.map((t) => ({ valor: t.clave, etiqueta: t.nombre })) },
            { clave: "regiones", etiqueta: "Dónde puedes atender", tipo: "lista", opciones: REGIONES_UBIGEO.map((r) => ({ valor: r.ubigeo, etiqueta: r.nombre })) },
            { clave: "valorMinimo", etiqueta: "Valor referencial mínimo que te interesa (S/)", tipo: "numero", placeholder: "Ej.: 50000" },
          ]}
        />
      </section>

      <BloqueMCP
        titulo="API y MCP para tu equipo"
        bajada="Conecta tu asistente de IA al servidor MCP de Gobserva y pregunta por las licitaciones del día, por tu mercado o por una entidad. Gratis durante la beta; el plan Empresa suma una API para tu CRM y el Institucional, límites altos y soporte."
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
        preguntas={[
          { p: "¿Qué pasa cuando me anoto?", r: "Quedas en la lista con el plan que elegiste y tu precio de fundador guardado. Te escribimos antes de abrirlo; recién entonces decides si pagas." },
          { p: "¿Cómo llegan las alertas?", r: "Por correo y, si nos dejas tu número, por WhatsApp: una vez al día, con las convocatorias nuevas de tus rubros y regiones y el plazo de consultas de cada una." },
          { p: "¿Reemplaza al SEACE?", r: "No. Las ofertas se presentan en el SEACE. Gobserva te avisa a tiempo y te da contexto; cada ficha enlaza al proceso oficial y a sus bases." },
          { p: "¿Es legal?", r: "Sí: son datos públicos que el Estado publica por ley (transparencia y datos abiertos). Gobserva no vende datos personales ni nombra a personas naturales." },
          { p: "¿Puedo cancelar?", r: "Sí, cuando quieras y sin penalidad: los planes son mensuales." },
          { p: "¿Tienen relación con Vigía?", r: "Vigía es el proyecto cívico y gratuito de Gobserva que vigila las compras del Estado. Gobserva Licitaciones usa los mismos datos públicos para ayudar a las empresas a competir; pagar un plan nunca cambia lo que Vigía muestra de nadie." },
        ]}
      />
    </div>
  );
}

function Garantia({ Icono, titulo, texto }: { Icono: typeof Lock; titulo: string; texto: string }) {
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
