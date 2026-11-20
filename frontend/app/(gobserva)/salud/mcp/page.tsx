import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Gauge, Gift, KeyRound } from "lucide-react";
import { BloqueMCPSalud } from "@/components/salud/portada/BloqueMCPSalud";
import { Encabezado, Ruta } from "@/components/salud/portada/Piezas";
import { Beneficios } from "@/components/patrones/Franja";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "MCP abierto: los registros de salud en tu IA",
  description:
    "Conecta Claude, ChatGPT o Cursor a Gobserva Salud por MCP, gratis y sin cuenta: busca establecimientos en RENIPRESS, sus sanciones firmes de SUSALUD, cómo verificar a un médico y las normas de salud, con la fuente y la fecha de cada dato.",
  alternates: { canonical: urlCanonica("salud", "/mcp") },
};

/**
 * /mcp de Gobserva Salud (2026-11-20): cómo conectar el MCP abierto (https://mcp.gobserva.cloud/mcp/salud), sin cuenta ni
 * plan, con sus seis herramientas y el tope por conexión. El modelo es la página /mcp de Obras.
 */
export default function McpSalud() {
  const base = baseProducto("salud");
  return (
    <div className="container-page space-y-10 pb-10 pt-5 sm:pb-14 sm:pt-6">
      <div>
        <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "MCP" }]} />
        <Encabezado
          className="mt-2"
          titulo="Tu asistente de IA, con los registros oficiales de salud"
          bajada="Con el MCP de Gobserva Salud, Claude, ChatGPT o Cursor consultan en vivo RENIPRESS y el Registro de Sanciones de SUSALUD: le preguntas como a una persona y te responde con establecimientos reales, la fuente de cada dato y su fecha."
        />
        <Beneficios
          className="mt-6"
          items={[
            { icono: <Gift size={16} aria-hidden />, titulo: "Gratis y sin cuenta", texto: "No pide registro, plan ni tarjeta: pegas la dirección y listo." },
            { icono: <BadgeCheck size={16} aria-hidden />, titulo: "Con la fuente de cada dato", texto: "Responde con RENIPRESS, el Registro de Sanciones y los datos abiertos de SUSALUD, con su fecha." },
            { icono: <KeyRound size={16} aria-hidden />, titulo: "Sin datos de personas", texto: "No busca ni devuelve nombres: de un médico, sólo cómo verificarlo en su colegio." },
            { icono: <Gauge size={16} aria-hidden />, titulo: "Con un tope por conexión", texto: "Para que siga abierto para todos, cada conexión tiene un límite de consultas." },
          ]}
        />
      </div>
      <BloqueMCPSalud
        id="mcp"
        completo
        titulo="Conéctalo en un minuto"
        bajada="MCP (Model Context Protocol) es el estándar abierto con el que los asistentes de IA consultan fuentes de datos. El de Gobserva Salud es abierto: es información de interés público y cualquiera puede usarla."
      />
      <div className="flex flex-col items-start gap-4 rounded-3xl border border-line bg-paper p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="font-display text-bloque font-bold text-ink">¿Prefieres no instalar nada?</h2>
          <p className="mt-1 text-dato text-inkSoft">El asistente de la web responde lo mismo, con las mismas fuentes, también gratis y sin cuenta.</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link href={rutaEn(base, "/fuentes")} className={claseAccion("secundario", "min-h-11")}>
            Ver las fuentes
          </Link>
          <Link href={rutaEn(base, "/asistente")} className={claseAccion("primario", "min-h-11")}>
            Abrir el asistente
          </Link>
        </div>
      </div>
    </div>
  );
}
