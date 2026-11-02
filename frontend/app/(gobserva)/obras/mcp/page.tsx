import type { Metadata } from "next";
import Link from "next/link";
import { BloqueMCP } from "@/components/gobserva/BloqueMCP";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "API y MCP: las obras públicas en tu IA",
  description:
    "Conecta Claude, ChatGPT o Cursor a Gobserva Obras por MCP y pregúntale por los proyectos que se vienen, el avance de una obra o el mercado de tu región. Gratis durante la beta.",
  alternates: { canonical: urlCanonica("obras", "/mcp") },
};

/** Gobserva Obras con tu asistente de IA: el servidor MCP explicado, con sus pasos, ejemplos y herramientas. */
export default function McpObras() {
  const base = baseProducto("obras");
  return (
    <div className="container-page space-y-10 py-10 sm:py-14">
      <header className="max-w-3xl">
        <h1 className="text-balance font-display text-titulo font-bold leading-tight text-ink sm:text-vitrina">Tu asistente de IA, ahora sabe de obras públicas.</h1>
        <p className="mt-4 text-bloque leading-relaxed text-inkSoft">
          Con el MCP de Gobserva, Claude, ChatGPT o Cursor consultan en vivo los proyectos de inversión del Estado, sus obras y quién las construye: le
          preguntas como a una persona y te responde con proyectos reales, su plata, su avance y el enlace a la fuente oficial.
        </p>
      </header>
      <BloqueMCP
        id="mcp"
        titulo="Conéctalo en un minuto"
        bajada="MCP (Model Context Protocol) es el estándar abierto con el que los asistentes de IA consultan fuentes de datos. Gobserva publica uno gratis durante la beta: sin cuenta y sin llaves."
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
        <div>
          <p className="font-display text-bloque font-bold text-ink">¿Lo quieres para tu equipo comercial, tu gremio o tu CRM?</p>
          <p className="mt-1 text-dato text-inkSoft">Más consultas, una API con todo el histórico y reportes por región y sector, en los planes Empresa e Institucional.</p>
        </div>
        <Link href={rutaEn(base, "/planes#plan-institucional")} className={claseAccion("primario", "shrink-0")}>
          Conversemos
        </Link>
      </div>
    </div>
  );
}
