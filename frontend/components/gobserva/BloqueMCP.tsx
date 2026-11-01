import { Bot, Cable, MessageSquareText, Wrench } from "lucide-react";
import { URL_MCP } from "@/lib/gobserva";
import { cn } from "@/lib/utils";
import { Copiar } from "./Copiar";

/**
 * «Pregúntale a tu IA»: el servidor MCP de Gobserva (backend/mcp-worker, público y gratis durante la beta) explicado para
 * quien no sabe qué es un MCP: qué hace, cómo se conecta en tres pasos (Claude, ChatGPT, Cursor) y qué preguntarle, con
 * las herramientas que responden. Banda oscura de marca, la misma de día y de noche. Server-safe (el botón de copiar es
 * de cliente).
 */
export function BloqueMCP({
  titulo = "Pregúntale a tu IA, con datos del Estado en vivo",
  bajada,
  ejemplos,
  herramientas,
  id = "mcp",
  className,
}: {
  titulo?: string;
  bajada: string;
  /** Preguntas de ejemplo, como las escribiría alguien. */
  ejemplos: string[];
  /** Las herramientas del MCP que usa este producto: nombre y qué responde. */
  herramientas: { nombre: string; descripcion: string }[];
  id?: string;
  className?: string;
}) {
  const configuracion = JSON.stringify({ mcpServers: { gobserva: { type: "http", url: URL_MCP } } }, null, 2);
  return (
    <section id={id} aria-labelledby={`${id}-t`} className={cn("sobre-oscuro scroll-mt-20 overflow-hidden rounded-3xl bg-ink text-paper", className)}>
      <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[1.05fr_1fr]">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-maiz/40 bg-maiz/10 px-3 py-1 text-meta font-semibold text-maiz">
            <Cable size={14} aria-hidden /> MCP, gratis durante la beta
          </span>
          <h2 id={`${id}-t`} className="mt-4 text-balance font-display text-titulo font-bold leading-tight sm:text-vitrina">
            {titulo}
          </h2>
          <p className="mt-4 max-w-[60ch] text-pretty text-cuerpo leading-relaxed text-paper/75">{bajada}</p>
          <ol className="mt-6 space-y-4">
            <Paso n={1} titulo="Copia la dirección del servidor">
              <Copiar texto={URL_MCP} className="mt-2 border-paper/15 bg-paper/5 [&_code]:text-paper" />
            </Paso>
            <Paso n={2} titulo="Agrégala a tu asistente">
              En Claude: Configuración, Conectores, «Agregar conector personalizado» y pega la dirección. En ChatGPT, Cursor o
              cualquier cliente que lea un archivo de configuración:
              <Copiar texto={configuracion} bloque className="mt-2 border-paper/15 bg-paper/5 [&_pre]:text-paper" />
            </Paso>
            <Paso n={3} titulo="Pregunta en tus palabras">
              Tu asistente consulta los datos de Gobserva y te responde con la fuente oficial de cada dato.
            </Paso>
          </ol>
        </div>
        <div className="min-w-0 space-y-6">
          <div>
            <p className="inline-flex items-center gap-2 text-meta font-semibold uppercase tracking-[0.12em] text-paper/60">
              <MessageSquareText size={14} aria-hidden /> Pregúntale, por ejemplo
            </p>
            <ul className="mt-3 space-y-2.5">
              {ejemplos.map((e) => (
                <li key={e} className="flex gap-2.5">
                  <Bot size={18} aria-hidden className="mt-1 shrink-0 text-maiz" />
                  <span className="rounded-2xl rounded-tl-sm border border-paper/10 bg-paper/[0.06] px-4 py-2.5 text-dato leading-relaxed text-paper/90">«{e}»</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="inline-flex items-center gap-2 text-meta font-semibold uppercase tracking-[0.12em] text-paper/60">
              <Wrench size={14} aria-hidden /> Lo que responde
            </p>
            <ul className="mt-3 divide-y divide-paper/10 rounded-2xl border border-paper/10">
              {herramientas.map((h) => (
                <li key={h.nombre} className="px-4 py-3">
                  <code className="font-mono text-meta font-semibold text-maiz">{h.nombre}</code>
                  <p className="mt-0.5 text-meta leading-snug text-paper/70">{h.descripcion}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-maiz font-mono text-meta font-bold text-[rgb(var(--sobre-maiz))]">
        {n}
      </span>
      <div className="min-w-0 flex-1 text-dato leading-relaxed text-paper/80">
        <p className="font-semibold text-paper">{titulo}</p>
        {children}
      </div>
    </li>
  );
}
