import Link from "next/link";
import { ArrowRight, ArrowRight as Flecha, Cpu, ShieldCheck } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import { PASOS, TOTAL_AGENTES, TOTAL_PASOS, porCarril, type PasoPipeline } from "@/components/agentes/catalogo";

/**
 * El pipeline real, dibujado.
 *
 * Lo más difícil de creer de este producto —que un equipo de agentes leyó el
 * expediente entero— estaba dicho en la landing en once palabras dentro de una
 * tarjeta: "Diez agentes los leen". Un número sin nada detrás se lee como
 * marketing, y en una herramienta que le exige evidencia al Estado eso es
 * exactamente lo que no puede pasar.
 *
 * Así que acá se muestra el grafo tal cual corre: tres carriles, los pasos en
 * el orden real, los que corren a la vez puestos a la vez, y cada agente con lo
 * que analiza y contra qué fuente lo coteja. Nada de esto está escrito a mano:
 * sale de `components/agentes/catalogo`, que deriva de `lib/auditoria` y esa de
 * `backend/agent/deterministic.py`. Si el backend agrega un agente, aparece acá
 * solo — y si lo quita, desaparece. No hay forma de que la landing prometa un
 * agente que no existe.
 *
 * El pulso que recorre cada riel no es decoración: es la única parte de la
 * página que dice, sin texto, que esto es una secuencia que se ejecuta. Los
 * tres carriles arrancan desfasados porque así arrancan de verdad — Proveedor y
 * Síntesis dependen de que el expediente ya esté leído. Quien pidió menos
 * movimiento en su sistema no lo ve: `globals.css` neutraliza los loops.
 */

const TONO_TIPO = {
  agente: {
    caja: "border-heroViolet/30 bg-heroViolet-soft/70 hover:border-heroViolet/60",
    punto: "bg-heroViolet",
    Icono: Cpu,
    etiqueta: "Agente de IA",
  },
  paso: {
    caja: "border-line bg-paper hover:border-paperEdge",
    punto: "bg-mute/60",
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
      className="scroll-mt-20 border-b border-line bg-paper py-14 sm:py-16"
    >
      <div className="container-page max-w-[1600px]">
        {/* El titular ocupa el ancho completo y la bajada comparte renglón con el
            enlace: con el titular topado en `max-w-2xl` y el botón empujado al
            borde derecho quedaban 700 px de blanco en el medio de la sección más
            importante de la página. */}
        <h2 id="agentes-titulo" className="max-w-[34ch] font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl lg:text-5xl">
          No es un modelo contestando una pregunta.{" "}
          <em className="text-heroViolet not-italic">Son {TOTAL_AGENTES} agentes leyendo un expediente.</em>
        </h2>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <p className="max-w-[64ch] text-[15px] leading-relaxed text-inkSoft">
            Cada contrato financiado pasa por {TOTAL_PASOS} pasos repartidos en tres carriles. El orden no lo
            decide un modelo: corre en código, siempre igual, y cada paso deja su rastro en una bitácora
            pública. Pasa el puntero por cualquiera para ver qué analiza y contra qué fuente lo coteja.
          </p>
          <Link
            href="/app/auditoria"
            className="group inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-paperSoft px-5 py-3 text-sm font-semibold text-ink transition-colors duration-rapido hover:bg-paperDeep"
          >
            Verlos corriendo ahora mismo
            <ArrowRight size={15} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>

        <ol className="mt-8 space-y-4">
          {carriles.map((c, i) => (
            <Carril key={c.key} indice={i} label={c.label} pasos={c.pasos} />
          ))}
        </ol>

        <p className="mt-6 max-w-[80ch] text-[13px] leading-relaxed text-mute">
          Los {TOTAL_AGENTES} agentes corren un modelo y emiten señales. Los otros{" "}
          {TOTAL_PASOS - TOTAL_AGENTES} pasos no opinan: consultan datos o verifican lo que hicieron los
          demás. La autoevaluación es la última y puede frenar la publicación entera.
        </p>
      </div>
    </section>
  );
}

function Carril({ indice, label, pasos }: { indice: number; label: string; pasos: PasoPipeline[] }) {
  const gs = grupos(pasos);
  const nAgentes = pasos.filter((p) => p.tipo === "agente").length;
  return (
    <li className="rounded-3xl border border-line bg-paperSoft p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
        <h3 className="flex items-baseline gap-2.5 text-[15px] font-semibold text-ink">
          <span className="font-mono text-[12px] text-mute">Carril {indice + 1}</span>
          {label}
        </h3>
        <span className="flex flex-wrap items-baseline gap-x-4 text-[12px] text-mute">
          <span>
            <span className="font-mono font-semibold text-inkSoft">{nAgentes}</span> agentes
          </span>
          <span>
            <span className="font-mono font-semibold text-inkSoft">{gs.length}</span> etapas en secuencia
          </span>
        </span>
      </div>

      {/* El riel. Los tres arrancan desfasados porque así arrancan de verdad:
          Proveedor y Síntesis esperan a que el expediente esté leído. */}
      <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
        <span
          className="animate-rielPulso absolute top-0 h-full w-1/5 rounded-full bg-gradient-to-r from-transparent via-heroGreen to-transparent"
          style={{ animationDelay: `${indice * 0.55}s` }}
        />
      </div>

      {/* `items-stretch` + chips centrados: una etapa con un solo agente al lado
          de otra con tres dejaba 200 px de vacío debajo del chip solo. Centrado,
          el mismo espacio se lee como lo que es — una etapa que se abre en tres
          ramas. */}
      {/* En móvil la flecha va ARRIBA de la etapa, no a su izquierda: al costado,
          cada etapa quedaba sangrada un ancho de flecha más que la anterior y la
          columna salía en escalera. */}
      <ol className="mt-3 flex flex-col gap-2.5 lg:flex-row lg:items-stretch">
        {gs.map((grupo, gi) => (
          <li key={gi} className="flex min-w-0 flex-1 flex-col gap-1.5 lg:flex-row lg:gap-2.5">
            {gi > 0 && (
              <span className="flex shrink-0 items-center justify-center text-mute/70 lg:pt-0" aria-hidden>
                <Flecha size={15} className="rotate-90 lg:rotate-0" />
              </span>
            )}
            {/* La etapa se rotula UNA vez por columna, no en cada chip: las
                columnas ya son las etapas —van en orden, con su flecha— así que
                repetir "Etapa 3" en los dos chips que corren a la vez gastaba un
                renglón por chip para decir lo que la posición ya dice. */}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-wide text-mute">
                Etapa {gi + 1}
                {grupo.length > 1 && (
                  <span className="font-sans normal-case tracking-normal">
                    — {grupo.length} en paralelo
                  </span>
                )}
              </span>
              <div className="flex flex-1 flex-col justify-center gap-2">
                {grupo.map((p) => (
                  <ChipPaso key={p.clave} p={p} />
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </li>
  );
}

function ChipPaso({ p }: { p: PasoPipeline }) {
  const t = TONO_TIPO[p.tipo];
  return (
    <Popover
      titulo={p.titulo}
      anchoClase="w-80"
      className={`block w-full rounded-2xl border px-3.5 py-2.5 text-left transition-colors duration-rapido ${t.caja}`}
      trigger={
        <span className="block">
          {/* `titulo`, no `nombre`: el nombre corto ("Legal", "Mercado", "Empresa")
              existe para chips de 80 px dentro del producto, donde el usuario ya
              sabe de qué se habla. Acá es la primera vez que alguien se entera de
              que estos agentes existen. */}
          <span className="flex items-baseline gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 translate-y-[-2px] rounded-full ${t.punto}`} aria-hidden />
            <span className="text-[13px] font-semibold leading-snug text-ink">{p.titulo}</span>
          </span>
          {/* text-ink/70, no text-mute: sobre el violeta suave del chip,
              text-mute da 4.31:1 — justo bajo el mínimo AA de 4.5:1. */}
          {p.fuentes.length > 0 && (
            <span className="mt-0.5 block truncate pl-3.5 text-[11px] text-ink/70">{p.fuentes.join(", ")}</span>
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
        {p.id && (
          <span className="mt-1.5 block font-mono text-[11px] text-mute">
            {p.id}
          </span>
        )}
      </span>
    </Popover>
  );
}
