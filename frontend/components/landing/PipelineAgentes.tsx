import Link from "next/link";
import { ArrowRight, ArrowRight as Flecha, Cpu, ShieldCheck } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import { PulseDot } from "@/components/ui/PulseDot";
import { PASOS, TOTAL_AGENTES, TOTAL_PASOS, porCarril, type PasoPipeline } from "@/components/agentes/catalogo";

/**
 * El pipeline real, corriendo.
 *
 * Lo más difícil de creer de este producto —que un equipo de agentes leyó el
 * expediente entero— estaba dicho en la landing en once palabras dentro de una
 * tarjeta: "Diez agentes los leen". Un número sin nada detrás se lee como
 * marketing, y en una herramienta que le exige evidencia al Estado eso es
 * exactamente lo que no puede pasar.
 *
 * La primera versión de esta sección lo arregló a medias: dibujaba el grafo,
 * pero en tres cajas grises sobre fondo claro. Era correcto y no era nada — un
 * diagrama de documentación en medio de una portada. Lo que le faltaba no era
 * información, era que se viera CORRER.
 *
 * Ahora el fondo es oscuro (el segundo y último corte en tinta de la página) y
 * una ola recorre el grafo encendiendo cada paso cuando le toca: el desfase de
 * cada chip sale de su posición real —su carril y su etapa—, así que lo que se
 * ve es el orden en que se ejecuta de verdad, no una animación decorativa. Los
 * carriles 2 y 3 arrancan después porque de verdad esperan a que el expediente
 * esté leído.
 *
 * El contenido sigue saliendo entero de `components/agentes/catalogo`, que
 * deriva de `lib/auditoria` y esa de `backend/agent/deterministic.py`. Si el
 * backend agrega un agente, aparece acá solo; si lo quita, desaparece. No hay
 * forma de que la landing prometa un agente que no existe.
 *
 * Quien pidió menos movimiento en su sistema no ve nada de esto: `globals.css`
 * neutraliza los loops y los chips quedan todos encendidos.
 */

/** Cuántos turnos espera cada carril antes de arrancar: su dependencia real. */
const ARRANQUE: Record<string, number> = { expediente: 0, proveedor: 1, sintesis: 3 };
/** Duración de un turno de la ola, en segundos. El ciclo entero dura 7 s. */
const TURNO = 0.72;

const TONO_TIPO = {
  agente: {
    caja: "border-heroGreen/25 bg-paper/[0.07]",
    punto: "bg-heroGreen",
    Icono: Cpu,
    etiqueta: "Agente de IA",
  },
  paso: {
    caja: "border-paper/12 bg-paper/[0.03]",
    punto: "bg-paper/45",
    Icono: ShieldCheck,
    etiqueta: "Verificación del pipeline",
  },
} as const;

/** Los pasos de un carril, agrupados por su índice: los que comparten índice corren a la vez. */
function grupos(pasos: PasoPipeline[]): PasoPipeline[][] {
  const porIndice = new Map<number, PasoPipeline[]>();
  for (const p of pasos) porIndice.set(p.paso, [...(porIndice.get(p.paso) ?? []), p]);
  return [...porIndice.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

export function PipelineAgentes() {
  const carriles = porCarril(PASOS);
  return (
    <section
      id="agentes"
      aria-labelledby="agentes-titulo"
      className="relative scroll-mt-20 overflow-hidden bg-ink py-16 text-paper sm:py-20"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute left-1/4 top-0 h-[30rem] w-[30rem] -translate-x-1/2 rounded-full bg-heroViolet/30 blur-[130px]" />
        <div className="absolute bottom-0 right-0 h-[22rem] w-[22rem] rounded-full bg-heroGreen/12 blur-[110px]" />
      </div>

      <div className="container-page relative max-w-[1600px]">
        <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
          <div className="min-w-0">
            <h2 id="agentes-titulo" className="max-w-[18ch] font-serif text-4xl font-bold leading-[1.05] sm:text-5xl lg:text-6xl">
              Leer un contrato son{" "}
              <span className="text-heroGreen">{TOTAL_PASOS} pasos</span> y{" "}
              <span className="text-heroGreen">{TOTAL_AGENTES} agentes</span>.
            </h2>
            <p className="mt-4 max-w-[62ch] text-[15px] leading-relaxed text-paper/70">
              Esto es el grafo real, en el orden real. El que se enciende es el que estaría corriendo. Ningún
              modelo decide ese orden: corre en código, siempre igual, y cada paso deja su rastro en una
              bitácora pública.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <span className="inline-flex items-center gap-2 text-[12px] text-paper/70">
              <PulseDot color="moss" size={6} />
              simulación del recorrido
            </span>
            <Link
              href="/app/auditoria"
              className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-paper/25 px-5 py-3 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-paper/10"
            >
              Verlo con un contrato de verdad
              <ArrowRight size={15} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
            </Link>
          </div>
        </div>

        <ol className="mt-10 space-y-3">
          {carriles.map((c) => (
            <Carril key={c.key} clave={c.key} label={c.label} pasos={c.pasos} />
          ))}
        </ol>

        <p className="mt-6 max-w-[84ch] text-[13px] leading-relaxed text-paper/70">
          {TOTAL_AGENTES} de esos {TOTAL_PASOS} pasos corren un modelo y emiten señales. Los otros{" "}
          {TOTAL_PASOS - TOTAL_AGENTES} no opinan: consultan datos o verifican lo que hicieron los demás. La
          autoevaluación es la última y puede frenar la publicación entera.
        </p>
      </div>
    </section>
  );
}

function Carril({ clave, label, pasos }: { clave: string; label: string; pasos: PasoPipeline[] }) {
  const gs = grupos(pasos);
  const nAgentes = pasos.filter((p) => p.tipo === "agente").length;
  const arranque = ARRANQUE[clave] ?? 0;
  return (
    <li className="rounded-3xl border border-paper/10 bg-paper/[0.04] p-4 backdrop-blur-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
        <h3 className="flex items-baseline gap-2.5 text-[15px] font-semibold text-paper">
          <span className="font-mono text-[12px] text-paper/60">Carril</span>
          {label}
        </h3>
        <span className="flex flex-wrap items-baseline gap-x-4 text-[12px] text-paper/65">
          <span>
            <span className="font-mono font-semibold text-paper/85">{nAgentes}</span> agentes
          </span>
          <span>
            <span className="font-mono font-semibold text-paper/85">{gs.length}</span> etapas en secuencia
          </span>
        </span>
      </div>

      {/* El riel. Los tres arrancan desfasados porque así arrancan de verdad:
          Proveedor y Síntesis esperan a que el expediente esté leído. */}
      <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-paper/10" aria-hidden>
        <span
          className="animate-rielPulso absolute top-0 h-full w-1/5 rounded-full bg-gradient-to-r from-transparent via-heroGreen to-transparent"
          style={{ animationDelay: `${arranque * TURNO}s` }}
        />
      </div>

      {/* En móvil la flecha va ARRIBA de la etapa, no a su izquierda: al costado,
          cada etapa quedaba sangrada un ancho de flecha más que la anterior y la
          columna salía en escalera. */}
      <ol className="mt-3 flex flex-col gap-1.5 lg:flex-row lg:items-stretch lg:gap-2.5">
        {gs.map((grupo, gi) => (
          <li key={gi} className="flex min-w-0 flex-1 flex-col gap-1.5 lg:flex-row lg:gap-2.5">
            {gi > 0 && (
              <span className="flex shrink-0 items-center justify-center text-paper/25" aria-hidden>
                <Flecha size={15} className="rotate-90 lg:rotate-0" />
              </span>
            )}
            {/* La etapa se rotula UNA vez por columna, no en cada chip: las
                columnas ya son las etapas —van en orden, con su flecha— así que
                repetir "Etapa 3" en los dos chips que corren a la vez gastaba un
                renglón por chip para decir lo que la posición ya dice. */}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-wide text-paper/60">
                Etapa {gi + 1}
                {grupo.length > 1 && (
                  <span className="font-sans normal-case tracking-normal">— {grupo.length} en paralelo</span>
                )}
              </span>
              <div className="flex flex-1 flex-col justify-center gap-2">
                {grupo.map((p) => (
                  <ChipPaso key={p.clave} p={p} turno={arranque + gi} />
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </li>
  );
}

function ChipPaso({ p, turno }: { p: PasoPipeline; turno: number }) {
  const t = TONO_TIPO[p.tipo];
  return (
    <Popover
      titulo={p.titulo}
      anchoClase="w-80"
      className={`animate-pasoCorriendo block w-full rounded-2xl border px-3.5 py-2.5 text-left ${t.caja}`}
      estilo={{ animationDelay: `${turno * TURNO}s` }}
      trigger={
        <span className="block">
          {/* `titulo`, no `nombre`: el nombre corto ("Legal", "Mercado", "Empresa")
              existe para chips de 80 px dentro del producto, donde el usuario ya
              sabe de qué se habla. Acá es la primera vez que alguien se entera de
              que estos agentes existen. */}
          <span className="flex items-baseline gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-full ${t.punto}`} aria-hidden />
            <span className="text-[13px] font-semibold leading-snug text-paper">{p.titulo}</span>
          </span>
          {p.fuentes.length > 0 && (
            <span className="mt-0.5 block truncate pl-3.5 text-[11px] text-paper/75">{p.fuentes.join(", ")}</span>
          )}
        </span>
      }
    >
      <span className="block">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-heroViolet">
          <t.Icono size={12} aria-hidden /> {t.etiqueta}
        </span>
        <span className="mt-2 block text-[13px] leading-relaxed text-inkSoft">{p.que}</span>
        {p.fuentes.length > 0 && (
          <span className="mt-2 block border-t border-line pt-2 text-[12px] text-mute">
            Lo coteja contra:
            <span className="mt-1 flex flex-wrap gap-1">
              {p.fuentes.map((f) => (
                <span key={f} className="rounded-full bg-paperDeep px-2 py-0.5 text-[11px] text-inkSoft">
                  {f}
                </span>
              ))}
            </span>
          </span>
        )}
        {p.id && <span className="mt-1.5 block font-mono text-[11px] text-mute">{p.id}</span>}
      </span>
    </Popover>
  );
}
