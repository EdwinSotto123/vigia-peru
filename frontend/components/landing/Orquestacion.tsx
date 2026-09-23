"use client";

import { useId, useState } from "react";
import { ChevronDown, Cpu, Database, FileStack, Landmark, ScrollText, Scale } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";
import type { PasoPipeline } from "@/components/agentes/catalogo";

/**
 * Qué entra, quién reparte y qué sale — dibujado, con los datos corriendo, y
 * con los carriles que se abren.
 *
 * Faltaba el actor principal. El grafo mostraba los diez agentes y no mostraba
 * al que los manda, que además tiene la mejor historia del producto: la primera
 * versión del orquestador era un LLM que decidía a qué especialista llamar y en
 * qué orden, y **se rendía antes de terminar** — daba el análisis por completo
 * con agentes sin correr, y el dictamen salía sin la red de personas sin que
 * nada avisara. Hoy la orquestación corre en código. Va a contramano de la
 * moda y es deliberado: en una herramienta cuya credibilidad depende de la
 * completitud, un paso que "a veces se saltea" no es un detalle, es un defecto
 * fatal.
 *
 * Los cables son SVG de verdad, no bordes de caja: van entre columnas de ancho
 * fijo, así que cada conector es una baldosa que no necesita saber dónde cayó
 * ninguna caja. Sin medir nada en JS, sin romperse al cambiar el ancho de la
 * ventana. El guion de la línea se desplaza dos períodos exactos, que es lo que
 * hace que el bucle no tenga costura y que se lea como caudal.
 *
 * Los tres carriles ERAN tres bloques siempre abiertos debajo del diagrama, con
 * sus doce chips a la vista. Repetían el encabezado que el diagrama ya daba
 * ("Carril Expediente · 4 agentes") y, con todo desplegado a la vez, la sección
 * medía 1 558 px de los cuales dos tercios nadie lee. Ahora el carril del
 * diagrama ES el control: se abre uno por vez, y lo que se despliega es
 * exactamente lo que el diagrama prometía.
 */

const ENTRADA = [
  { Icono: Database, t: "El contrato publicado", d: "Tal como lo dejó el Estado en el SEACE" },
  { Icono: FileStack, t: "Su expediente", d: "Bases, actas, contrato y adendas" },
  { Icono: Landmark, t: "14 registros del Estado", d: "Sanciones, visitas, aportes de campaña, autoridades" },
];

/** Duración de un turno de la ola que recorre el DAG, en segundos. */
const TURNO = 0.72;

export interface CarrilDatos {
  clave: string;
  label: string;
  nAgentes: number;
  /** Cuántos turnos espera este carril antes de arrancar: su dependencia real. */
  arranque: number;
  /** Los pasos agrupados por etapa; los que comparten grupo corren a la vez. */
  grupos: PasoPipeline[][];
}

export function Orquestacion({
  carriles,
  totalPasos,
}: {
  carriles: CarrilDatos[];
  totalPasos: number;
  totalAgentes: number;
}) {
  // Arranca con el primero abierto: un acordeón que empieza todo cerrado no
  // enseña que se puede abrir, y acá lo que hay adentro es el argumento.
  const [abierto, setAbierto] = useState<string | null>(carriles[0]?.clave ?? null);
  const id = useId();
  const activo = carriles.find((c) => c.clave === abierto) ?? null;

  const botones = carriles.map((c) => (
    <BotonCarril
      key={c.clave}
      carril={c}
      abierto={abierto === c.clave}
      controla={`${id}-detalle`}
      onClick={() => setAbierto(abierto === c.clave ? null : c.clave)}
    />
  ));

  return (
    <div className="mt-10">
      {/* ── Diagrama, sólo desde xl: a 1024 px las cuatro columnas quedaban de 110 px y cada caja partía su título en tres renglones ── */}
      <div className="hidden items-stretch xl:flex">
        <Columna titulo="Entra">
          <ul className="flex flex-col justify-center gap-2.5">
            {ENTRADA.map(({ Icono, t, d }) => (
              <li key={t} className="rounded-2xl border border-paper/12 bg-paper/[0.04] px-3.5 py-2.5">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-paper">
                  <Icono size={13} className="shrink-0 text-paper/50" aria-hidden />
                  {t}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-paper/70">{d}</span>
              </li>
            ))}
          </ul>
        </Columna>

        <Cable modo="converge" />

        <div className="flex w-[15rem] shrink-0 flex-col justify-center">
          <div className="relative">
            <span aria-hidden className="animate-latidoNodo absolute inset-0 rounded-3xl border border-heroGreen" />
            <div className="relative rounded-3xl border border-heroGreen/50 bg-heroGreen/[0.09] px-4 py-4 text-center">
              <span className="block font-serif text-lg font-bold text-paper">El coordinador</span>
              <span className="mt-0.5 block font-mono text-[11px] uppercase tracking-wide text-heroGreen">
                siempre la misma lista
              </span>
              <p className="mt-2.5 text-[11px] leading-relaxed text-paper/70">
                Toma los contratos por orden de llegada, lanza las {totalPasos} revisiones en el mismo orden y no
                da el análisis por terminado hasta que todas corrieron.
              </p>
            </div>
          </div>
        </div>

        <Cable modo="diverge" />

        <Columna titulo="Revisa">
          <ul className="flex flex-col justify-center gap-2.5">
            {botones.map((b, i) => (
              <li key={carriles[i].clave}>{b}</li>
            ))}
          </ul>
        </Columna>

        <Cable modo="converge" />

        <div className="flex w-[13rem] shrink-0 flex-col justify-center">
          <div className="rounded-3xl border border-paper/15 bg-paper/[0.06] px-4 py-4 text-center">
            <Scale size={18} className="mx-auto text-paper/60" aria-hidden />
            <span className="mt-2 block font-serif text-lg font-bold text-paper">Informe público</span>
            <p className="mt-1.5 text-[11px] leading-relaxed text-paper/70">
              Cada señal con la ley que cita y la página exacta del documento que la sostiene.
            </p>
          </div>
        </div>
      </div>

      {/* ── Móvil: el mismo circuito, en vertical ──
             El diagrama horizontal de cuatro columnas es ilegible a 390 px, pero
             esconderlo dejaba al orquestador existiendo sólo como párrafo. ── */}
      <ol className="mx-auto max-w-2xl xl:hidden">
        <EslabonMovil titulo="Entra" cuerpo="El contrato publicado, su expediente y 14 registros del Estado" />
        <EslabonMovil
          titulo="El coordinador"
          cuerpo={`Lanza las ${totalPasos} revisiones siempre en el mismo orden, sin saltarse ninguna`}
          destacado
        />
        <EslabonMovil titulo="Revisa" cuerpo="En tres frentes. Toca uno para ver qué revisa cada parte.">
          <ul className="mt-2.5 space-y-2">
            {botones.map((b, i) => (
              <li key={carriles[i].clave}>{b}</li>
            ))}
          </ul>
        </EslabonMovil>
        <EslabonMovil titulo="Sale" cuerpo="Un informe público, cada señal con su ley y su página" ultimo />
      </ol>

      {/* ── Lo que se abre ── */}
      <div id={`${id}-detalle`} role="region" aria-live="polite" className="mt-4">
        {activo ? (
          <DetalleCarril key={activo.clave} carril={activo} />
        ) : (
          <p className="rounded-2xl border border-dashed border-paper/15 px-4 py-5 text-center text-[13px] text-paper/70">
            Elige un frente para ver qué revisa, en qué orden y contra qué fuente lo compara.
          </p>
        )}
      </div>

      {/* ── La historia del orquestador. Es contenido, no decoración: va siempre,
             también en móvil, porque es lo que explica por qué esto no improvisa. ── */}
      <p className="mt-5 flex max-w-[92ch] items-start gap-2.5 text-[13px] leading-relaxed text-paper/70">
        <ScrollText size={15} className="mt-0.5 shrink-0 text-heroGreen" aria-hidden />
        <span>
          <strong className="font-semibold text-paper">Al principio, una inteligencia artificial decidía qué revisar y en qué orden.</strong>{" "}
          A veces se rendía antes de terminar y daba el análisis por completo con revisiones sin hacer. Por eso
          hoy el orden es fijo y no lo decide ningún modelo: las {totalPasos} revisiones corren siempre, en
          todos los contratos.
        </span>
      </p>
    </div>
  );
}

function BotonCarril({
  carril,
  abierto,
  controla,
  onClick,
}: {
  carril: CarrilDatos;
  abierto: boolean;
  controla: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={abierto}
      aria-controls={controla}
      className={`flex w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors duration-rapido ${
        abierto
          ? "border-heroGreen/60 bg-heroGreen/[0.12]"
          : "border-paper/12 bg-paper/[0.04] hover:border-paper/25 hover:bg-paper/[0.07]"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-paper">Carril {carril.label}</span>
        <span className="mt-0.5 block text-[11px] text-paper/70">
          {carril.nAgentes} agentes en {carril.grupos.length} etapas
        </span>
      </span>
      <ChevronDown
        size={15}
        className={`shrink-0 text-paper/60 transition-transform duration-rapido ${abierto ? "rotate-180" : ""}`}
        aria-hidden
      />
    </button>
  );
}

/** El carril abierto: sus etapas en orden, con la ola encendiendo el que corre. */
function DetalleCarril({ carril }: { carril: CarrilDatos }) {
  return (
    <div className="animate-slideUp rounded-3xl border border-paper/10 bg-paper/[0.04] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
        <h3 className="text-[15px] font-semibold text-paper">Carril {carril.label}</h3>
        <span className="text-[12px] text-paper/65">
          Cada etapa espera a que termine la anterior; dentro de una etapa, todos corren a la vez.
        </span>
      </div>

      {/* El riel. Arranca desfasado porque así arranca de verdad: Proveedor y
          Síntesis esperan a que el expediente esté leído. */}
      <div className="relative mt-3 h-1 overflow-hidden rounded-full bg-paper/10" aria-hidden>
        <span
          className="animate-rielPulso absolute top-0 h-full w-1/5 rounded-full bg-gradient-to-r from-transparent via-heroGreen to-transparent"
          style={{ animationDelay: `${carril.arranque * TURNO}s` }}
        />
      </div>

      {/* En móvil la flecha va ARRIBA de la etapa, no a su izquierda: al costado,
          cada etapa quedaba sangrada un ancho de flecha más que la anterior y la
          columna salía en escalera. */}
      <ol className="mt-3 flex flex-col gap-1.5 lg:flex-row lg:items-stretch lg:gap-2.5">
        {carril.grupos.map((grupo, gi) => (
          <li key={gi} className="flex min-w-0 flex-1 flex-col gap-1.5 lg:flex-row lg:gap-2.5">
            {gi > 0 && (
              <span className="flex shrink-0 items-center justify-center text-paper/25" aria-hidden>
                <ChevronDown size={15} className="lg:-rotate-90" />
              </span>
            )}
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <span className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-wide text-paper/60">
                Etapa {gi + 1}
                {grupo.length > 1 && (
                  <span className="font-sans normal-case tracking-normal">({grupo.length} a la vez)</span>
                )}
              </span>
              <div className="flex flex-1 flex-col justify-center gap-2">
                {grupo.map((p) => (
                  <ChipPaso key={p.clave} p={p} turno={carril.arranque + gi} />
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const TONO_TIPO = {
  agente: { caja: "border-heroGreen/25 bg-paper/[0.07]", punto: "bg-heroGreen", etiqueta: "Agente de IA" },
  paso: { caja: "border-paper/12 bg-paper/[0.03]", punto: "bg-paper/45", etiqueta: "Verificación automática" },
} as const;

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
          <Cpu size={12} aria-hidden /> {t.etiqueta}
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

/** Un eslabón del circuito en móvil, con su tramo de cable hacia el siguiente. */
function EslabonMovil({
  titulo,
  cuerpo,
  destacado = false,
  ultimo = false,
  children,
}: {
  titulo: string;
  cuerpo: string;
  destacado?: boolean;
  ultimo?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <li>
      <div
        className={`rounded-2xl border px-4 py-3 ${
          destacado ? "border-heroGreen/50 bg-heroGreen/[0.09]" : "border-paper/12 bg-paper/[0.04]"
        }`}
      >
        <span className={`block text-[14px] font-semibold text-paper ${destacado ? "font-serif text-[16px]" : ""}`}>
          {titulo}
        </span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-paper/70">{cuerpo}</span>
        {children}
      </div>
      {!ultimo && (
        <svg aria-hidden viewBox="0 0 2 28" preserveAspectRatio="none" className="mx-auto h-7 w-0.5">
          <path
            d="M1,0 L1,28"
            fill="none"
            stroke="#2FA84C"
            strokeWidth={1.25}
            strokeLinecap="round"
            strokeDasharray="5 11"
            vectorEffect="non-scaling-stroke"
            className="animate-fluirDatos"
            style={{ opacity: 0.75 }}
          />
        </svg>
      )}
    </li>
  );
}

function Columna({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-paper/60">{titulo}</span>
      <div className="flex flex-1 flex-col justify-center">{children}</div>
    </div>
  );
}

/**
 * Un tramo de cable entre dos columnas. Baldosa de ancho fijo: las curvas
 * arrancan y terminan en coordenadas del propio viewBox, así que no depende de
 * dónde quedó ninguna caja. `preserveAspectRatio="none"` deja que se estire a
 * lo alto de la fila sin deformar el grosor de la línea (`vector-effect`).
 */
function Cable({ modo }: { modo: "converge" | "diverge" }) {
  const ramas = [16, 50, 84];
  const d = (y: number) =>
    modo === "converge" ? `M0,${y} C24,${y} 24,50 48,50` : `M0,50 C24,50 24,${y} 48,${y}`;
  return (
    <svg aria-hidden viewBox="0 0 48 100" preserveAspectRatio="none" className="h-auto w-[5.5rem] shrink-0 self-stretch">
      {ramas.map((y, i) => (
        <path
          key={y}
          d={d(y)}
          fill="none"
          stroke="#2FA84C"
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeDasharray="5 11"
          vectorEffect="non-scaling-stroke"
          className="animate-fluirDatos"
          style={{ animationDelay: `${i * 0.18}s`, opacity: 0.75 }}
        />
      ))}
    </svg>
  );
}
