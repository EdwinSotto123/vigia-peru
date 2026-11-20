import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Bot, Cable, Gift, MessageSquareText, Wrench } from "lucide-react";
import { Copiar } from "@/components/gobserva/Copiar";
import { URL_MCP_SALUD } from "@/lib/gobserva";
import { cn } from "@/lib/utils";

/**
 * El MCP de Gobserva Salud, abierto (2026-11-20): como BloqueMCP (components/gobserva/BloqueMCP.tsx), pero sin plan ni
 * cuenta: se pega la dirección en Claude, ChatGPT o Cursor y listo. Tiene un tope por conexión para que siga abierto para
 * todos. `completo`: con los pasos para cada asistente y las seis herramientas (la página /mcp); sin él, la versión de la
 * portada (la dirección, ejemplos y el enlace a los pasos). Banda oscura de marca. Server-safe (copiar es de cliente).
 */
export const HERRAMIENTAS_MCP_SALUD = [
  { nombre: "buscar_establecimiento_salud", descripcion: "Busca clínicas, hospitales, centros y consultorios en RENIPRESS por nombre, código IPRESS o RUC, con filtros de lugar, categoría, sector y sanciones." },
  { nombre: "ficha_establecimiento_salud", descripcion: "La ficha de un establecimiento: estado, categoría, servicios, sanciones firmes, denuncias y los chequeos ya redactados con su fuente y fecha." },
  { nombre: "verificar_medico", descripcion: "Lo que dicen las fuentes abiertas de un número de colegiatura y los pasos para confirmar su habilitación en el Colegio Médico." },
  { nombre: "sanciones_salud", descripcion: "El Registro de Sanciones de SUSALUD: sanciones firmes con su resolución, infracción, multa en UIT y si están en un proceso judicial." },
  { nombre: "normas_salud", descripcion: "Los artículos de las normas de salud del Perú que responden una pregunta, con el enlace oficial." },
  { nombre: "fuentes_salud", descripcion: "De dónde sale cada dato, qué clase de hecho es y hasta qué fecha está cargado." },
];

const EJEMPLOS = [
  "¿El Hospital Loayza figura activo en RENIPRESS y qué categoría tiene?",
  "¿Qué clínicas de Arequipa tienen sanciones firmes de SUSALUD este año?",
  "Me van a operar en un consultorio: ¿cómo verifico si tiene centro quirúrgico?",
  "¿Qué dice la norma sobre la categoría que necesita una clínica para internar pacientes?",
];

export function BloqueMCPSalud({
  titulo = "Pregúntale a tu IA, con los registros oficiales de salud",
  bajada,
  completo = false,
  pasos,
  id = "mcp",
  className,
}: {
  titulo?: string;
  bajada: string;
  completo?: boolean;
  /** Portada: la página con los pasos (/mcp). */
  pasos?: string;
  id?: string;
  className?: string;
}) {
  const configuracion = JSON.stringify({ mcpServers: { "gobserva-salud": { type: "http", url: URL_MCP_SALUD } } }, null, 2);
  return (
    <section id={id} aria-labelledby={`${id}-t`} className={cn("sobre-oscuro scroll-mt-20 overflow-hidden rounded-3xl border border-paper/10 bg-ink text-paper", className)}>
      <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[1.05fr_1fr]">
        <div className="min-w-0">
          <h2 id={`${id}-t`} className="text-balance font-display text-titulo font-bold leading-tight tracking-[-0.02em] sm:text-vitrina">
            {titulo}
          </h2>
          <p className="mt-4 max-w-[60ch] text-pretty text-cuerpo leading-relaxed text-paper/75">{bajada}</p>
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-maiz/40 bg-maiz/10 px-3 py-1 text-meta font-semibold text-maiz">
            <Gift size={14} aria-hidden /> Gratis y sin cuenta
          </p>
          <ol className="mt-6 space-y-4">
            <Paso n={1} titulo="Copia la dirección del servidor">
              <Copiar texto={URL_MCP_SALUD} className="mt-2 border-paper/15 bg-paper/5 [&_code]:text-paper" />
            </Paso>
            {completo ? (
              <Paso n={2} titulo="Agrégala a tu asistente">
                <ol className="mt-2 space-y-3">
                  <Sub letra="a">
                    <b className="font-semibold text-paper">En Claude:</b> abre Configuración, entra a Conectores, elige «Agregar conector
                    personalizado», pega la dirección y pulsa «Agregar». No te pide entrar con ninguna cuenta.
                  </Sub>
                  <Sub letra="b">
                    <b className="font-semibold text-paper">En ChatGPT, Cursor u otro cliente</b> que lea un archivo de configuración, pega esto:
                    <Copiar texto={configuracion} bloque className="mt-2 border-paper/15 bg-paper/5 [&_pre]:text-paper" />
                  </Sub>
                </ol>
              </Paso>
            ) : (
              <Paso n={2} titulo="Agrégala como conector en Claude, ChatGPT o Cursor">
                No pide cuenta, plan ni tarjeta.{" "}
                {pasos && (
                  <Link href={pasos} className="font-semibold text-maiz underline underline-offset-2 hover:text-paper">
                    Ver los pasos para cada asistente
                  </Link>
                )}
              </Paso>
            )}
            <Paso n={3} titulo="Pregunta en tus palabras">
              Tu asistente consulta RENIPRESS y el Registro de Sanciones de SUSALUD en vivo y te responde con la fuente y la fecha de cada dato.
            </Paso>
          </ol>
          <p className="mt-6 max-w-[60ch] border-t border-paper/10 pt-4 text-meta leading-relaxed text-paper/65">
            Para que siga abierto para todos, cada conexión tiene un tope de consultas. Si tu asistente lo alcanza, espera un momento y vuelve a
            preguntar.
          </p>
        </div>
        <div className="min-w-0 space-y-6">
          <div>
            <h3 className="flex items-center gap-2 text-cuerpo font-semibold text-paper">
              <MessageSquareText size={16} aria-hidden className="text-maiz" /> Pregúntale, por ejemplo
            </h3>
            <ul className="mt-3 space-y-2.5">
              {EJEMPLOS.map((e) => (
                <li key={e} className="flex gap-2.5">
                  <Bot size={18} aria-hidden className="mt-1 shrink-0 text-maiz" />
                  <span className="rounded-2xl rounded-tl-sm border border-paper/10 bg-paper/[0.06] px-4 py-2.5 text-dato leading-relaxed text-paper/90">«{e}»</span>
                </li>
              ))}
            </ul>
          </div>
          {completo ? (
            <div>
              <h3 className="flex items-center gap-2 text-cuerpo font-semibold text-paper">
                <Wrench size={16} aria-hidden className="text-maiz" /> Lo que responde: sus 6 herramientas
              </h3>
              <ul className="mt-3 divide-y divide-paper/10 rounded-2xl border border-paper/10">
                {HERRAMIENTAS_MCP_SALUD.map((h) => (
                  <li key={h.nombre} className="px-4 py-3">
                    <code className="break-all font-mono text-meta font-semibold text-maiz">{h.nombre}</code>
                    <p className="mt-0.5 text-meta leading-snug text-paper/70">{h.descripcion}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            pasos && (
              <Link
                href={pasos}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-paper/30 px-4 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-paper/10"
              >
                <Cable size={15} aria-hidden /> Cómo conectarlo y qué herramientas trae <ArrowRight size={15} aria-hidden />
              </Link>
            )
          )}
        </div>
      </div>
    </section>
  );
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-maiz font-mono text-meta font-bold text-sobreMaiz">
        {n}
      </span>
      <div className="min-w-0 flex-1 text-dato leading-relaxed text-paper/80">
        <p className="font-semibold text-paper">{titulo}</p>
        {children}
      </div>
    </li>
  );
}

function Sub({ letra, children }: { letra: string; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-maiz/50 font-mono text-rotulo font-bold text-maiz">
        {letra}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}
