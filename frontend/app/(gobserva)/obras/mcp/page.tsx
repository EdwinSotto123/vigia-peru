import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, KeyRound, Sparkles } from "lucide-react";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { Beneficios } from "@/components/patrones/Franja";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { CORREO_GOBSERVA, rutaEn, urlCanonica } from "@/lib/gobserva";
import { COBROS_EN_PAUSA } from "@/lib/gobserva-planes";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "API y MCP: las obras públicas en tu IA",
  description: COBROS_EN_PAUSA
    ? "Conecta ChatGPT, Cursor u otra IA a Gobserva Obras por MCP y pregúntale por los proyectos que se vienen, el avance de una obra o el mercado de tu región. Gratis con tu cuenta de Licitaciones."
    : "Conecta Claude, ChatGPT o Cursor a Gobserva Obras por MCP y pregúntale por los proyectos que se vienen, el avance de una obra o el mercado de tu región. Viene con los planes de Licitaciones.",
  alternates: { canonical: urlCanonica("obras", "/mcp") },
};

/** Gobserva Obras con tu asistente de IA: el servidor MCP explicado, con lo que trae, sus pasos, ejemplos y herramientas. */
export default function McpObras() {
  const base = baseProducto("obras");
  return (
    <div className="container-page space-y-10 py-10 sm:py-14">
      <header className="max-w-4xl">
        <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Tu asistente de IA, ahora sabe de obras públicas.</h1>
        <p className="mt-4 max-w-3xl text-bloque leading-relaxed text-inkSoft">
          Con el MCP de Gobserva, Claude, ChatGPT o Cursor consultan en vivo los proyectos de inversión del Estado, sus obras y quién las construye: le
          preguntas como a una persona y te responde con proyectos reales, su plata, su avance y el enlace a la fuente oficial.
        </p>
        <Beneficios
          className="mt-6"
          items={[
            { icono: <KeyRound size={16} aria-hidden />, titulo: "Con tu cuenta", texto: "Pegas la dirección del servidor en tu asistente y entras con tu cuenta de Gobserva Licitaciones." },
            { icono: <BadgeCheck size={16} aria-hidden />, titulo: "Con la fuente de cada dato", texto: "Las respuestas salen de Invierte.pe, INFOBRAS y el SEACE, con su enlace." },
            COBROS_EN_PAUSA
              ? { icono: <Sparkles size={16} aria-hidden />, titulo: "Gratis con tu cuenta", texto: "Con tu cuenta de Licitaciones, que trae Obras, y tu correo confirmado, tu MCP se activa sin pagar nada." }
              : { icono: <Sparkles size={16} aria-hidden />, titulo: "Viene con tu plan", texto: "Cualquier plan de pago de Licitaciones, que trae Obras, activa tu MCP. El Institucional sumará más." },
          ]}
        />
      </header>
      <BloqueMCP
        id="mcp"
        titulo="Conéctalo en un minuto"
        bajada={
          COBROS_EN_PAUSA
            ? "MCP (Model Context Protocol) es el estándar abierto con el que los asistentes de IA consultan fuentes de datos. El de Gobserva es gratis con tu cuenta: la creas, confirmas tu correo y conectas tu asistente."
            : "MCP (Model Context Protocol) es el estándar abierto con el que los asistentes de IA consultan fuentes de datos. El de Gobserva viene con los planes de pago: adquieres uno y conectas tu asistente con tu cuenta."
        }
        cuenta="Gobserva Licitaciones"
        planes={rutaEn(base, "/planes")}
        crear={rutaEn(base, "/entrar?crear=1")}
        ejemplos={[
          "¿Qué proyectos de agua potable de más de S/ 5 millones tienen expediente técnico en Puno?",
          "Arma una tabla con las 10 obras paralizadas más grandes de Cusco, desde cuándo y por qué.",
          "¿Qué empresas ganan más obras de transporte en Áncash y por cuánto?",
          "Dame la ficha del CUI 2233850: cuánto se gastó, cuánto avanzó y quién lo construye.",
        ]}
        herramientas={[
          { nombre: "buscar_proyectos_inversion", descripcion: "Los proyectos que se vienen, en marcha o paralizados, con filtros por texto, región, sector, fase y monto." },
          { nombre: "ficha_proyecto", descripcion: "Un proyecto por su CUI: montos, fase, sus obras con su avance, sus procesos del SEACE y quién los ganó." },
          { nombre: "mercado_obras", descripcion: "El mercado de obras de una región y un sector: pipeline, ejecución, paralizadas, tamaño típico y quién gana." },
        ]}
      />
      <div className="flex flex-col items-start gap-4 rounded-3xl border border-line bg-paper p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-bloque font-bold text-ink">¿Lo quieres para tu equipo comercial, tu gremio o tu CRM?</h2>
          <p className="mt-1 text-dato text-inkSoft">
            {COBROS_EN_PAUSA
              ? "Más consultas, una API con todo el histórico y reportes por región y sector: los planes para empresas e instituciones llegan pronto."
              : "Más consultas, una API con todo el histórico y reportes por región y sector, en los planes Empresa e Institucional."}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={rutaEn(base, "/proyectos")} className={claseAccion("secundario", "min-h-11")}>
            Ver los proyectos en la web
          </Link>
          {COBROS_EN_PAUSA ? (
            <a href={`mailto:${CORREO_GOBSERVA}`} className={claseAccion("primario", "min-h-11")}>
              Conversemos
            </a>
          ) : (
            <Link href={rutaEn(base, "/planes#plan-institucional")} className={claseAccion("primario", "min-h-11")}>
              Conversemos
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
