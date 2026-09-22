import { Database, FileStack, Landmark, ScrollText, Scale } from "lucide-react";
import { TOTAL_AGENTES, TOTAL_PASOS } from "@/components/agentes/catalogo";

/**
 * Qué entra, quién reparte y qué sale — dibujado, con los datos corriendo.
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
 * fijo, así que cada conector es una baldosa de 88 px que no necesita saber
 * dónde cayó ninguna caja. Sin medir nada en JS, sin romperse al cambiar el
 * ancho de la ventana. El guion de la línea se desplaza dos períodos exactos,
 * que es lo que hace que el bucle no tenga costura y que se lea como caudal.
 *
 * En móvil los cables se esconden: a 390 px un diagrama horizontal de cuatro
 * columnas es ilegible, y la información completa vive igual en los carriles de
 * abajo. El SVG es `aria-hidden` por la misma razón — lo que tiene que leer un
 * lector de pantalla son los pasos, no el dibujo.
 */

const ENTRADA = [
  { Icono: Database, t: "Registro OCDS", d: "El contrato tal como lo publicó el Estado" },
  { Icono: FileStack, t: "El expediente", d: "Bases, actas, contrato y adendas, en PDF" },
  { Icono: Landmark, t: "14 registros del Estado", d: "Sanciones, visitas, aportes, autoridades" },
];

export function Orquestacion() {
  return (
    <div className="mt-10">
      {/* ── Diagrama, sólo desde lg ── */}
      <div className="hidden items-stretch lg:flex">
        <Columna titulo="Entra">
          <ul className="flex flex-col justify-center gap-2.5">
            {ENTRADA.map(({ Icono, t, d }) => (
              <li
                key={t}
                className="rounded-2xl border border-paper/12 bg-paper/[0.04] px-3.5 py-2.5"
              >
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

        {/* ── El orquestador ── */}
        <div className="flex w-[15rem] shrink-0 flex-col justify-center">
          <div className="relative">
            <span
              aria-hidden
              className="animate-latidoNodo absolute inset-0 rounded-3xl border border-heroGreen"
            />
            <div className="relative rounded-3xl border border-heroGreen/50 bg-heroGreen/[0.09] px-4 py-4 text-center">
              <span className="block font-serif text-lg font-bold text-paper">Orquestador</span>
              <span className="mt-0.5 block font-mono text-[11px] uppercase tracking-wide text-heroGreen">
                corre en código
              </span>
              <p className="mt-2.5 text-[11px] leading-relaxed text-paper/70">
                Asigna el contrato por antigüedad, lanza los {TOTAL_PASOS} pasos en el orden fijo y no da el
                análisis por terminado hasta que todos corrieron.
              </p>
            </div>
          </div>
        </div>

        <Cable modo="diverge" />

        <Columna titulo="Corre">
          <ul className="flex flex-col justify-center gap-2.5">
            {[
              { t: "Expediente", d: "4 agentes" },
              { t: "Proveedor", d: "3 agentes" },
              { t: "Síntesis", d: "3 agentes" },
            ].map(({ t, d }) => (
              <li key={t} className="rounded-2xl border border-paper/12 bg-paper/[0.04] px-3.5 py-2.5">
                <span className="block text-[13px] font-semibold text-paper">Carril {t}</span>
                <span className="mt-0.5 block text-[11px] text-paper/70">{d}</span>
              </li>
            ))}
          </ul>
        </Columna>

        <Cable modo="converge" />

        <div className="flex w-[13rem] shrink-0 flex-col justify-center">
          <div className="rounded-3xl border border-paper/15 bg-paper/[0.06] px-4 py-4 text-center">
            <Scale size={18} className="mx-auto text-paper/60" aria-hidden />
            <span className="mt-2 block font-serif text-lg font-bold text-paper">Dictamen público</span>
            <p className="mt-1.5 text-[11px] leading-relaxed text-paper/70">
              Cada señal con su norma citada y la página exacta del documento que la sostiene.
            </p>
          </div>
        </div>
      </div>

      {/* ── Móvil: el mismo circuito, en vertical ──
             El diagrama horizontal de cuatro columnas es ilegible a 390 px, pero
             esconderlo dejaba al orquestador existiendo sólo como párrafo. Acá
             son los mismos cuatro eslabones, apilados y con el mismo cable. ── */}
      <ol className="lg:hidden">
        <EslabonMovil titulo="Entra" cuerpo="El registro OCDS, el expediente en PDF y 14 registros del Estado" />
        <EslabonMovil
          titulo="Orquestador"
          cuerpo={`Asigna el contrato por antigüedad y lanza los ${TOTAL_PASOS} pasos en el orden fijo`}
          destacado
        />
        <EslabonMovil titulo="Corre" cuerpo="Tres carriles: Expediente, Proveedor y Síntesis" />
        <EslabonMovil titulo="Sale" cuerpo="Dictamen público, cada señal con su norma y su página" ultimo />
      </ol>

      {/* ── La historia del orquestador. Es contenido, no decoración: va siempre,
             también en móvil, porque es lo que explica por qué esto no improvisa. ── */}
      <p className="mt-5 flex max-w-[92ch] items-start gap-2.5 text-[13px] leading-relaxed text-paper/70">
        <ScrollText size={15} className="mt-0.5 shrink-0 text-heroGreen" aria-hidden />
        <span>
          <strong className="font-semibold text-paper">La primera versión del orquestador era un LLM</strong>{" "}
          que decidía a qué especialista llamar y en qué orden. Se rendía antes de terminar: daba el análisis
          por completo con agentes sin correr, y el dictamen salía sin la red de personas sin que nada
          avisara. Hoy la secuencia corre en código y garantiza que los {TOTAL_AGENTES} agentes corran
          siempre. Va a contramano de la moda, y es a propósito.
        </span>
      </p>
    </div>
  );
}

/** Un eslabón del circuito en móvil, con su tramo de cable hacia el siguiente. */
function EslabonMovil({
  titulo,
  cuerpo,
  destacado = false,
  ultimo = false,
}: {
  titulo: string;
  cuerpo: string;
  destacado?: boolean;
  ultimo?: boolean;
}) {
  return (
    <li>
      <div
        className={`rounded-2xl border px-4 py-3 ${
          destacado ? "border-heroGreen/50 bg-heroGreen/[0.09]" : "border-paper/12 bg-paper/[0.04]"
        }`}
      >
        <span className={`block text-[14px] font-semibold ${destacado ? "font-serif text-[16px]" : ""} text-paper`}>
          {titulo}
        </span>
        <span className="mt-0.5 block text-[12px] leading-relaxed text-paper/70">{cuerpo}</span>
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
    modo === "converge"
      ? `M0,${y} C24,${y} 24,50 48,50`
      : `M0,50 C24,50 24,${y} 48,${y}`;
  return (
    <svg
      aria-hidden
      viewBox="0 0 48 100"
      preserveAspectRatio="none"
      className="h-auto w-[5.5rem] shrink-0 self-stretch"
    >
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
