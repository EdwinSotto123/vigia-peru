import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Bot, Cable, MessageSquareText, Wrench } from "lucide-react";
import { URL_MCP_EMPLEO, URL_MCP_LICITACIONES } from "@/lib/gobserva";
import { COBROS_EN_PAUSA, LIMITES_ABIERTO } from "@/lib/gobserva-planes";
import { cn } from "@/lib/utils";
import { Copiar } from "./Copiar";

/**
 * «Pregúntale a tu IA»: el servidor MCP de Gobserva (backend/mcp-worker/src/v2) explicado para quien no sabe qué es un
 * MCP: qué hace, cómo se activa (vino con los planes de pago desde 2026-11-08; con los cobros en pausa, desde 2026-11-24,
 * es gratis con una cuenta con el correo confirmado), cómo se conecta y qué preguntarle, con las herramientas que
 * responden. Banda oscura de marca, la misma de día y de noche. Server-safe (el botón de copiar es de cliente).
 */
export function BloqueMCP({
  titulo = "Pregúntale a tu IA, con datos del Estado en vivo",
  bajada,
  ejemplos,
  herramientas,
  cuenta,
  planes,
  crear,
  id = "mcp",
  className,
}: {
  titulo?: string;
  bajada: string;
  /** Preguntas de ejemplo, como las escribiría alguien. */
  ejemplos: string[];
  /** Las herramientas del MCP que usa este producto: nombre y qué responde. */
  herramientas: { nombre: string; descripcion: string }[];
  /** La cuenta con la que se entra al MCP: «Gobserva Empleo» o «Gobserva Licitaciones» (y su dirección del MCP). */
  cuenta: "Gobserva Empleo" | "Gobserva Licitaciones";
  /** La página de planes del producto. */
  planes: string;
  /** Crear la cuenta: con los cobros en pausa, el primer paso lleva aquí (sin ella, a `planes`). */
  crear?: string;
  id?: string;
  className?: string;
}) {
  const empleo = cuenta === "Gobserva Empleo";
  const direccion = empleo ? URL_MCP_EMPLEO : URL_MCP_LICITACIONES;
  const creditos = (LIMITES_ABIERTO[empleo ? "empleo" : "licitaciones"].mcp ?? 0).toLocaleString("es-PE");
  const configuracion = JSON.stringify({ mcpServers: { [empleo ? "gobserva-empleo" : "gobserva-licitaciones"]: { type: "http", url: direccion } } }, null, 2);
  return (
    // El borde claro y tenue separa la banda del fondo de noche, que es casi del mismo carbón.
    <section id={id} aria-labelledby={`${id}-t`} className={cn("sobre-oscuro scroll-mt-20 overflow-hidden rounded-3xl border border-paper/10 bg-ink text-paper", className)}>
      <div className="grid gap-10 p-6 sm:p-10 lg:grid-cols-[1.05fr_1fr]">
        <div className="min-w-0">
          <h2 id={`${id}-t`} className="text-balance font-display text-titulo font-bold leading-tight sm:text-vitrina">
            {titulo}
          </h2>
          <p className="mt-4 max-w-[60ch] text-pretty text-cuerpo leading-relaxed text-paper/75">{bajada}</p>
          {/* Lo que cuesta, después del título y de lo que es (encima del título sería una etiqueta de adorno). */}
          <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-maiz/40 bg-maiz/10 px-3 py-1 text-meta font-semibold text-maiz">
            <Cable size={14} aria-hidden /> {COBROS_EN_PAUSA ? "Gratis con tu cuenta" : "Viene con los planes de pago"}
          </p>
          <ol className="mt-6 space-y-4">
            {COBROS_EN_PAUSA ? (
              <Paso n={1} titulo="Crea tu cuenta gratis y confirma tu correo">
                Con tu cuenta de {cuenta} y tu correo confirmado se activa tu MCP, con {creditos} créditos al mes. Sin pagar nada.{" "}
                <a href={crear ?? planes} className="font-semibold text-maiz underline underline-offset-2 hover:text-paper">
                  {crear ? "Crear mi cuenta gratis" : "Lo que incluye tu cuenta"}
                </a>
              </Paso>
            ) : (
              <Paso n={1} titulo="Adquiere un plan">
                Con cualquier plan de pago de {cuenta} se activa tu MCP, con créditos al mes según el plan.{" "}
                <a href={planes} className="font-semibold text-maiz underline underline-offset-2 hover:text-paper">
                  Ver los planes
                </a>
              </Paso>
            )}
            <Paso n={2} titulo="Copia la dirección del servidor">
              <Copiar texto={direccion} className="mt-2 border-paper/15 bg-paper/5 [&_code]:text-paper" />
            </Paso>
            <Paso n={3} titulo="Agrégala a tu asistente y entra con tu cuenta">
              <ol className="mt-2 space-y-3">
                <li className="flex gap-2.5">
                  <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-maiz/50 font-mono text-rotulo font-bold text-maiz">a</span>
                  <span className="min-w-0">
                    <b className="font-semibold text-paper">En Claude:</b> abre Configuración, entra a Conectores, elige «Agregar conector
                    personalizado», pega la dirección y pulsa «Conectar»: entras con tu cuenta de {cuenta}.
                  </span>
                </li>
                <li className="flex gap-2.5">
                  <span aria-hidden className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border border-maiz/50 font-mono text-rotulo font-bold text-maiz">b</span>
                  <span className="min-w-0 flex-1">
                    <b className="font-semibold text-paper">En ChatGPT, Cursor u otro cliente</b> que lea un archivo de configuración, pega
                    esto. Te pedirá entrar con tu cuenta la primera vez:
                    <Copiar texto={configuracion} bloque className="mt-2 border-paper/15 bg-paper/5 [&_pre]:text-paper" />
                  </span>
                </li>
              </ol>
            </Paso>
            <Paso n={4} titulo="Pregunta en tus palabras">
              Tu asistente consulta los datos de Gobserva y te responde con la fuente oficial de cada dato.
            </Paso>
          </ol>
        </div>
        <div className="min-w-0 space-y-6">
          <div>
            <h3 className="flex items-center gap-2 text-cuerpo font-semibold text-paper">
              <MessageSquareText size={16} aria-hidden className="text-maiz" /> Pregúntale, por ejemplo
            </h3>
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
            <h3 className="flex items-center gap-2 text-cuerpo font-semibold text-paper">
              <Wrench size={16} aria-hidden className="text-maiz" /> Lo que responde
            </h3>
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

/**
 * El MCP en una franja (2026-11-08): en las portadas va después del asistente y sin el JSON ni los pasos (eso queda en su
 * página): a quien busca trabajo o le vende al Estado le basta saber que su IA también se conecta con su cuenta.
 * `bajada`: otra frase, para un MCP que no pide plan (el de Salud, abierto y sin cuenta).
 */
export function FranjaMCP({ que, href, id = "mcp", bajada, className }: { que: string; href: string; id?: string; bajada?: ReactNode; className?: string }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className={cn("scroll-mt-20 rounded-3xl border border-line bg-paper p-6 sm:p-8", className)}>
      <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between md:gap-10">
        <div className="flex min-w-0 items-start gap-4">
          <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
            <Cable size={20} />
          </span>
          <div className="min-w-0">
            <h2 id={`${id}-t`} className="text-balance font-display text-seccion font-bold leading-tight text-ink">¿Usas Claude, ChatGPT o Cursor?</h2>
            <p className="mt-2 max-w-[60ch] text-pretty text-dato leading-relaxed text-inkSoft">
              {bajada ??
                (COBROS_EN_PAUSA ? (
                  <>Gratis con tu cuenta: conecta tu IA a Gobserva y pregúntale por {que} desde ahí, con los mismos créditos del asistente. Te toma un minuto.</>
                ) : (
                  <>Con tu plan, conecta tu IA a Gobserva y pregúntale por {que} desde ahí, con los mismos créditos del asistente. Te toma un minuto.</>
                ))}
            </p>
          </div>
        </div>
        <Link href={href} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 self-start rounded-full border border-line bg-caja px-4 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/50 md:self-center">
          Ver cómo conectarla <ArrowRight size={15} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
