"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, RotateCcw, ScanSearch } from "lucide-react";
import { Pixel } from "@/components/pixel/Pixel";
import { reglaLabel } from "@/lib/auditoria-reglas";
import { numero } from "@/lib/formato";
import type { CifrasDetector } from "@/lib/detector";
import { cn } from "@/lib/utils";

/**
 * «Así se ve un proceso arreglado»: lo que Vigía detecta, para jugarlo (2026-11-21, el usuario: «mejora la UX/UI de
 * Vigía mostrando cosas interactivas, que le muestre las capacidades, las señales, tipo detección de colusión»).
 *
 * Tres casos de EJEMPLO (colusión, compra partida, sobreprecio), con empresas inventadas que se llaman A, B, C y D: un
 * ejemplo con nombres de empresas reales sería una acusación. Cada cruce que se enciende es una regla o un patrón que
 * Vigía corre de verdad (backend/api/src/data/reglas.json, /app/patrones), con su nombre de siempre (`reglaLabel`), la
 * fuente de donde sale y, al encenderlo, cuántas veces lo encontró en contratos reales y el enlace para verlos
 * (lib/detector.ts). Si la API no responde, el ejemplo se juega igual, sin las cifras.
 *
 * Movimiento: al encender un cruce, una línea neón barre la escena una vez y lo nuevo se dibuja; «Cruzar todo» los
 * enciende uno por uno. Con movimiento reducido, todo aparece en su lugar, sin barrido ni caminata.
 */

type Clave = "colusion" | "partida" | "precio";

interface Cruce {
  id: string;
  /** La regla de Vigía: da el nombre y la cifra real (/senales) y lleva a /app/hallazgos?regla=. */
  regla?: string;
  /** O el patrón: la cifra y el enlace salen de /app/patrones. */
  patron?: "relleno" | "repetidas";
  nombre: string;
  fuente: string;
  hallazgo: string;
}

interface Escenario {
  clave: Clave;
  pestana: string;
  planteo: string;
  /** Lo que dice el veredicto antes de cruzar nada. */
  limpio: string;
  /** Y con todos los cruces encendidos. */
  final: string;
  cruces: Cruce[];
}

const ESCENARIOS: Escenario[] = [
  {
    clave: "colusion",
    pestana: "Colusión",
    planteo: "Una municipalidad licita el asfaltado de una avenida por S/ 2.4 millones. Se presentan cuatro empresas y gana A.",
    limpio: "A simple vista, todo en regla: cuatro postores y una oferta ganadora dentro del valor referencial.",
    final: "Cinco señales en un mismo proceso. Vigía lo pone primero en la fila para que una persona lo lea, con la fuente de cada dato.",
    cruces: [
      {
        id: "vinculados",
        regla: "postores_vinculados_rnp",
        nombre: reglaLabel("postores_vinculados_rnp"),
        fuente: "Socios y representantes en el RNP y la SUNAT",
        hallazgo: "C y D compiten entre sí, pero tienen el mismo gerente.",
      },
      {
        id: "relleno",
        patron: "relleno",
        nombre: "Postor de relleno",
        fuente: "Todos los procesos del SEACE desde 2018",
        hallazgo: "B se presentó junto a A en 9 procesos y nunca ganó: acompaña para que parezca que hubo competencia.",
      },
      {
        id: "ofertas",
        regla: "ofertas_agrupadas",
        nombre: reglaLabel("ofertas_agrupadas"),
        fuente: "Las ofertas del acta, en el SEACE",
        hallazgo: "Las cuatro ofertas caben en 0.8 %. Cuatro empresas que calculan cada una por su lado casi nunca llegan tan juntas.",
      },
      {
        id: "nuevo",
        regla: "ruc_ganador_muy_nuevo",
        nombre: reglaLabel("ruc_ganador_muy_nuevo"),
        fuente: "Fecha de inscripción en la SUNAT",
        hallazgo: "A se inscribió en la SUNAT cuatro meses antes de la convocatoria.",
      },
      {
        id: "visita",
        regla: "lobby_visits_pre_convocatoria",
        nombre: reglaLabel("lobby_visits_pre_convocatoria"),
        fuente: "Registro de visitas de la entidad",
        hallazgo: "El gerente de A visitó la municipalidad seis días antes de la convocatoria.",
      },
    ],
  },
  {
    clave: "partida",
    pestana: "Compra partida",
    planteo: "Un hospital necesita un medicamento por S/ 243 mil. Comprarlo de una vez obliga a un proceso con competencia, pero llegan seis órdenes directas, una por semana.",
    limpio: "A simple vista, seis compras pequeñas, cada una permitida por la ley.",
    final: "Tres señales que se explican juntas: una compra grande, partida en pedazos para no concursar.",
    cruces: [
      {
        id: "repetidas",
        patron: "repetidas",
        nombre: "La misma compra, repetida",
        fuente: "Órdenes de compra del SEACE",
        hallazgo: "Las seis órdenes van al mismo proveedor, por el mismo medicamento y el mismo monto.",
      },
      {
        id: "tope",
        regla: "cuantia_al_limite_del_tope",
        nombre: reglaLabel("cuantia_al_limite_del_tope"),
        fuente: "El tope de una compra directa (8 UIT)",
        hallazgo: "Cada orden queda justo debajo del tope que obliga a convocar.",
      },
      {
        id: "fraccion",
        regla: "fraccionamiento",
        nombre: reglaLabel("fraccionamiento"),
        fuente: "La suma de las órdenes",
        hallazgo: "Juntas suman S/ 243 mil, más de cinco veces el tope: debió ser un solo proceso, con competencia.",
      },
    ],
  },
  {
    clave: "precio",
    pestana: "Sobreprecio",
    planteo: "Una entidad compra 40 computadoras portátiles a S/ 6,900 cada una.",
    limpio: "A simple vista, una compra más, con su orden y su factura.",
    final: "El precio no se explica por el mercado. Vigía lo marca y muestra con qué compras lo comparó.",
    cruces: [
      {
        id: "mercado",
        regla: "sobreprecio_elevado",
        nombre: reglaLabel("sobreprecio_elevado"),
        fuente: "Lo que pagaron otras entidades (Perú Compras y SEACE)",
        hallazgo: "Otras 14 entidades compraron la misma computadora entre S/ 3,400 y S/ 4,300.",
      },
      {
        id: "mediana",
        regla: "sobreprecio_muy_elevado",
        nombre: reglaLabel("sobreprecio_muy_elevado"),
        fuente: "La mediana del mercado",
        hallazgo: "S/ 6,900 es 82 % más que la mediana, S/ 3,800.",
      },
      {
        id: "lote",
        regla: "sobreprecio_lote_muy_elevado",
        nombre: reglaLabel("sobreprecio_lote_muy_elevado"),
        fuente: "El total de la compra",
        hallazgo: "Por las 40 se pagó S/ 276 mil. A precio de mercado habrían costado S/ 152 mil: S/ 124 mil de más.",
      },
    ],
  },
];

const PATRON = {
  relleno: { seccion: "relleno", unidad: ["pareja así", "parejas así"], tipoCaso: "relleno" },
  repetidas: { seccion: "repetidas", unidad: ["caso así", "casos así"], tipoCaso: "repetidas" },
} as const;

/** Los colores de las escenas: tokens de la banda oscura (en los dos modos la placa es oscura y el acento, neón). */
const COLOR = {
  linea: "rgb(var(--paper) / 0.32)",
  tenue: "rgb(var(--paper) / 0.14)",
  texto: "rgb(var(--paper) / 0.88)",
  suave: "rgb(var(--paper) / 0.64)",
  neon: "rgb(var(--maiz))",
  neonTenue: "rgb(var(--maiz) / 0.16)",
  alerta: "rgb(var(--alerta-banda))",
  sobreNeon: "rgb(var(--sobre-maiz))",
} as const;

const PAUSA_PASO = 1100;

/** «S/ 6,900» y «82 %» no se parten al final de un renglón. */
const conEspacios = (t: string) => t.replace(/S\/ /g, "S/\u00a0").replace(/ %/g, "\u202f%");

function sinMovimiento(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function Detector({ cifras }: { cifras: CifrasDetector | null }) {
  const [clave, setClave] = useState<Clave>("colusion");
  const [activos, setActivos] = useState<ReadonlySet<string>>(() => new Set());
  const [pulso, setPulso] = useState(0);
  const [corriendo, setCorriendo] = useState(false);
  const reloj = useRef<number | null>(null);
  const pestanas = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  const esc = ESCENARIOS.find((e) => e.clave === clave) ?? ESCENARIOS[0];
  const total = esc.cruces.length;
  const n = esc.cruces.filter((c) => activos.has(c.id)).length;

  useEffect(
    () => () => {
      if (reloj.current) window.clearTimeout(reloj.current);
    },
    [],
  );

  function parar() {
    if (reloj.current) window.clearTimeout(reloj.current);
    reloj.current = null;
    setCorriendo(false);
  }

  function elegir(c: Clave) {
    if (c === clave) return;
    parar();
    setClave(c);
    setActivos(new Set());
  }

  function alternar(id: string) {
    parar();
    const enciende = !activos.has(id);
    setActivos((prev) => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
    if (enciende) setPulso((p) => p + 1);
  }

  function cruzarTodo() {
    parar();
    const faltan = esc.cruces.map((c) => c.id).filter((id) => !activos.has(id));
    if (!faltan.length) return;
    if (sinMovimiento()) {
      setActivos(new Set(esc.cruces.map((c) => c.id)));
      return;
    }
    setCorriendo(true);
    const paso = (i: number) => {
      setActivos((prev) => new Set([...prev, faltan[i]]));
      setPulso((p) => p + 1);
      if (i + 1 < faltan.length) reloj.current = window.setTimeout(() => paso(i + 1), PAUSA_PASO);
      else {
        reloj.current = null;
        setCorriendo(false);
      }
    };
    paso(0);
  }

  function reiniciar() {
    parar();
    setActivos(new Set());
  }

  // Las pestañas con las flechas, como un tablist.
  function teclaPestana(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const k = e.key;
    if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "Home" && k !== "End") return;
    e.preventDefault();
    const j = k === "Home" ? 0 : k === "End" ? ESCENARIOS.length - 1 : (i + (k === "ArrowRight" ? 1 : -1) + ESCENARIOS.length) % ESCENARIOS.length;
    elegir(ESCENARIOS[j].clave);
    pestanas.current[j]?.focus();
  }

  const on = (id: string) => activos.has(id);
  const veredicto =
    n === 0
      ? esc.limpio
      : n === total
        ? esc.final
        : n <= 2
          ? "Algo no cuadra. Una señal sola puede ser casualidad: Vigía sigue cruzando."
          : "Ya son varias señales juntas. Vigía lo pone primero en la fila para que una persona lo lea.";

  return (
    <section id="detector" aria-labelledby="detector-titulo" className="scroll-mt-16 border-t border-line bg-paper py-10 sm:py-12">
      <div className="container-page">
        <div className="max-w-[64ch]">
          <h2 id="detector-titulo" className="text-balance font-display text-cifra font-bold leading-[1.08] text-ink sm:text-titulo">
            Un proceso puede verse limpio y estar arreglado. <span className="text-granate">Vigía cruza lo que no se ve.</span>
          </h2>
          <p className="mt-2 text-pretty text-cuerpo leading-relaxed text-inkSoft">
            Tres casos de ejemplo, con empresas inventadas. Enciende cada cruce y mira lo que aparece: son las mismas revisiones
            que Vigía hace con cada contrato real, y cada una sale de un registro público.
          </p>
        </div>

        <div data-tema="oscuro" className="sobre-oscuro mt-6 rounded-2xl bg-ink p-3 text-paper sm:p-5">
          <div role="tablist" aria-label="Casos de ejemplo" className="grid grid-cols-3 gap-1 rounded-xl border border-paper/15 p-1">
            {ESCENARIOS.map((e, i) => {
              const activa = e.clave === clave;
              return (
                <button
                  key={e.clave}
                  ref={(el) => {
                    pestanas.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${base}-tab-${e.clave}`}
                  aria-selected={activa}
                  aria-controls={`${base}-panel`}
                  tabIndex={activa ? 0 : -1}
                  onClick={() => elegir(e.clave)}
                  onKeyDown={(ev) => teclaPestana(ev, i)}
                  className={cn(
                    "min-h-11 rounded-lg px-2 text-dato font-semibold leading-tight transition-colors",
                    activa ? "bg-maiz text-sobreMaiz" : "text-paper/80 hover:bg-paper/10 hover:text-paper",
                  )}
                >
                  {e.pestana}
                </button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`${base}-panel`}
            aria-labelledby={`${base}-tab-${clave}`}
            className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,1fr)] lg:gap-6"
          >
            <figure className="relative min-w-0 overflow-hidden rounded-xl border border-paper/15 lg:sticky lg:top-24 lg:self-start">
              <figcaption className="px-4 pt-3.5 text-dato leading-snug text-paper/85">{conEspacios(esc.planteo)}</figcaption>
              <div className="relative">
                <Escena clave={clave} on={on} />
                {pulso > 0 && <span key={pulso} aria-hidden className="detector-barrido" />}
              </div>
            </figure>

            <div className="min-w-0">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h3 className="font-display text-bloque font-bold leading-tight text-paper">Lo que cruza Vigía</h3>
                  <p className="mt-0.5 text-meta text-paper/65">Toca cada cruce para encenderlo.</p>
                </div>
                <Pixel nombre="vigia" escala={2} retardo={300} />
              </div>

              <ul className="mt-3 space-y-2">
                {esc.cruces.map((c) => (
                  <li key={c.id}>
                    <FilaCruce cruce={c} encendido={on(c.id)} onAlternar={() => alternar(c.id)} cifras={cifras} />
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={cruzarTodo}
                  disabled={corriendo || n === total}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full bg-maiz px-4 text-dato font-semibold text-sobreMaiz transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-45"
                >
                  <ScanSearch size={16} aria-hidden />
                  {corriendo ? "Cruzando…" : "Cruzar todo"}
                </button>
                <button
                  type="button"
                  onClick={reiniciar}
                  disabled={n === 0 && !corriendo}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border border-paper/25 px-4 text-dato font-semibold text-paper transition-colors hover:border-paper/50 hover:bg-paper/5 disabled:cursor-default disabled:opacity-40"
                >
                  <RotateCcw size={15} aria-hidden />
                  Empezar de nuevo
                </button>
              </div>

              <div className="mt-4 rounded-xl border border-paper/15 p-3.5" aria-live="polite" aria-atomic="true">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-dato font-semibold text-paper">
                    <span className={cn("font-display text-bloque tabular-nums", n ? "text-alertaBanda" : "text-paper")}>{n}</span> de {total}{" "}
                    señales
                  </p>
                  <span aria-hidden className="flex gap-1">
                    {esc.cruces.map((c, i) => (
                      <span key={c.id} className={cn("h-3 w-3 rounded-sm transition-colors duration-300", i < n ? "bg-alertaBanda" : "bg-paper/15")} />
                    ))}
                  </span>
                </div>
                <p className="mt-1.5 text-pretty text-dato leading-snug text-paper/85">{conEspacios(veredicto)}</p>
                <p className="mt-2 text-meta leading-snug text-paper/60">
                  Una señal es un indicio, no una acusación: la denuncia le corresponde a la Contraloría o a la Fiscalía.
                </p>
              </div>
            </div>
          </div>

          <CasoReal clave={clave} cifras={cifras} />
        </div>
      </div>
    </section>
  );
}

function FilaCruce({
  cruce,
  encendido,
  onAlternar,
  cifras,
}: {
  cruce: Cruce;
  encendido: boolean;
  onAlternar: () => void;
  cifras: CifrasDetector | null;
}) {
  const real = cifraReal(cruce, cifras);
  return (
    <div className={cn("rounded-xl border transition-colors", encendido ? "border-maiz/55 bg-maiz/10" : "border-paper/15 hover:border-paper/35")}>
      <button type="button" aria-pressed={encendido} onClick={onAlternar} className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border-2 transition-colors",
            encendido ? "border-maiz bg-maiz" : "border-paper/45",
          )}
        >
          {encendido && <Check size={13} strokeWidth={3} className="text-sobreMaiz" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-dato font-semibold leading-snug text-paper">{cruce.nombre}</span>
          <span className="block text-meta leading-snug text-paper/65">{cruce.fuente}</span>
          <span className={cn("grid transition-[grid-template-rows] duration-500 ease-out motion-reduce:transition-none", encendido ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
            <span className="overflow-hidden">
              <span className="block pt-1.5 text-dato leading-snug text-maiz">{conEspacios(cruce.hallazgo)}</span>
            </span>
          </span>
        </span>
      </button>
      {encendido && real && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-paper/10 px-3 py-2 pl-11 text-meta leading-snug text-paper/75">
          <span>{real.texto}</span>
          <Link href={real.href} className="inline-flex items-center gap-1 font-semibold text-maiz underline-offset-4 hover:underline">
            {real.accion}
            <ArrowRight size={13} aria-hidden />
          </Link>
        </p>
      )}
    </div>
  );
}

/** La cifra real de un cruce: cuántas veces lo encontró Vigía, y adónde ir a verlas. */
function cifraReal(c: Cruce, cifras: CifrasDetector | null): { texto: ReactNode; href: string; accion: string } | null {
  if (!cifras) return null;
  if (c.regla) {
    const total = cifras.reglas?.[c.regla];
    if (!total) return null;
    return {
      texto: (
        <>
          En contratos reales, Vigía la encontró <b className="font-semibold text-paper tabular-nums">{numero(total)}</b> {total === 1 ? "vez" : "veces"}.
        </>
      ),
      href: `/app/hallazgos?regla=${c.regla}`,
      accion: "Verlas",
    };
  }
  if (c.patron) {
    const p = cifras[c.patron];
    if (!p) return null;
    const [uno, varios] = PATRON[c.patron].unidad;
    return {
      texto: (
        <>
          En los datos reales hay <b className="font-semibold text-paper tabular-nums">{numero(p.total)}</b> {p.total === 1 ? uno : varios}.
        </>
      ),
      href: `/app/patrones?seccion=${PATRON[c.patron].seccion}`,
      accion: "Verlos",
    };
  }
  return null;
}

/** Al pie de la placa: el caso real que se parece al ejemplo, si la API lo dio. */
function CasoReal({ clave, cifras }: { clave: Clave; cifras: CifrasDetector | null }) {
  const caso =
    clave === "colusion" && cifras?.relleno?.caso
      ? { href: `/app/patrones/caso/relleno/${cifras.relleno.caso}`, texto: "Abre un caso real de postor de relleno" }
      : clave === "partida" && cifras?.repetidas?.caso
        ? { href: `/app/patrones/caso/repetidas/${cifras.repetidas.caso}`, texto: "Abre un caso real de compra repetida" }
        : clave === "precio" && cifras?.reglas?.sobreprecio_muy_elevado
          ? { href: "/app/hallazgos?regla=sobreprecio_muy_elevado", texto: "Mira los contratos reales con sobreprecio muy alto" }
          : null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-paper/10 pt-3.5">
      <p className="max-w-[60ch] text-meta leading-snug text-paper/70">
        Los ejemplos son inventados. Las reglas, las fuentes y las cifras de cada cruce son las de Vigía hoy.
      </p>
      {caso && (
        <Link href={caso.href} className="inline-flex min-h-10 items-center gap-1.5 text-dato font-semibold text-maiz underline-offset-4 hover:underline">
          {caso.texto}
          <ArrowRight size={15} aria-hidden />
        </Link>
      )}
    </div>
  );
}

/* ── Las escenas ────────────────────────────────────────────────────────────────────────────────── */

/** Una figura de píxeles dentro del SVG de la escena (Pixel es un <svg> propio: se anida). */
function Figura({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return <g transform={`translate(${x} ${y})`}>{children}</g>;
}

/** Lo que aparece con un cruce: se desvanece al entrar y al salir. */
function Capa({ visible, children, retardo = 0 }: { visible: boolean; children: ReactNode; retardo?: number }) {
  return (
    <g
      aria-hidden={!visible}
      className="transition-opacity duration-500 ease-out motion-reduce:transition-none"
      style={{ opacity: visible ? 1 : 0, transitionDelay: visible ? `${retardo}ms` : "0ms" }}
    >
      {children}
    </g>
  );
}

/** Un trazo que se dibuja de punta a punta al encenderse. */
function Trazo({ d, visible, color = COLOR.neon, ancho = 2.5, retardo = 0 }: { d: string; visible: boolean; color?: string; ancho?: number; retardo?: number }) {
  return (
    <path
      d={d}
      pathLength={1}
      fill="none"
      stroke={color}
      strokeWidth={ancho}
      strokeLinecap="round"
      strokeDasharray="1 1"
      className={cn("transition-[stroke-dashoffset,opacity] duration-700 ease-out motion-reduce:transition-none", color === COLOR.neon && "detector-neon")}
      style={{ strokeDashoffset: visible ? 0 : 1, opacity: visible ? 1 : 0, transitionDelay: visible ? `${retardo}ms` : "0ms" }}
    />
  );
}

/** Una etiqueta en la escena: texto neón sobre una píldora del fondo de la placa. `x` es su centro o, con `desde`, su
 * borde izquierdo. */
function Etiqueta({ x, y, texto, color = COLOR.neon, desde = false }: { x: number; y: number; texto: string; color?: string; desde?: boolean }) {
  const ancho = anchoEtiqueta(texto);
  const centro = desde ? x + ancho / 2 : x;
  return (
    <g>
      <rect x={centro - ancho / 2} y={y - 15} width={ancho} height={22} rx={11} fill="rgb(var(--ink))" stroke={color} strokeWidth={1.25} />
      <text x={centro} y={y} textAnchor="middle" fontSize={14} fontWeight={600} fill={color}>
        {conEspacios(texto)}
      </text>
    </g>
  );
}

/** El ancho de una píldora, de su texto: 14 px semibold ocupa unos 8 por carácter, más el aire de los lados. */
const anchoEtiqueta = (texto: string) => Math.round(texto.length * 8.1 + 22);

/**
 * Cada escena se dibuja dos veces: a lo ancho (480 de ancho, desde sm) y angosta para el celular (360: las x por 0,75 y
 * los textos del mismo tamaño, así a 390 px se leen a 12 px y no a 9). CSS elige cuál se ve: no salta al hidratar.
 */
interface PropsEscena {
  on: (id: string) => boolean;
  /** La escala de las x: 1 a lo ancho, 0.75 en el celular. */
  k: number;
  className: string;
}

function Escena({ clave, on }: { clave: Clave; on: (id: string) => boolean }) {
  const Dibujo = clave === "colusion" ? EscenaColusion : clave === "partida" ? EscenaPartida : EscenaPrecio;
  return (
    <>
      <Dibujo on={on} k={0.75} className="block sm:hidden" />
      <Dibujo on={on} k={1} className="hidden sm:block" />
    </>
  );
}

const POSTORES = [
  { letra: "A", x: 60, oferta: 2381 },
  { letra: "B", x: 180, oferta: 2392 },
  { letra: "C", x: 300, oferta: 2396 },
  { letra: "D", x: 420, oferta: 2399 },
];

function EscenaColusion({ on, k, className }: PropsEscena) {
  const X = (x: number) => Math.round(x * k);
  const W = X(480);
  const centro = W / 2;
  // La municipalidad (34 x 28 a escala 3) va al centro; el camino de la visita llega a su costado izquierdo.
  const izquierdaEntidad = centro - 51;
  const finCamino = izquierdaEntidad - 3;
  const vinculados = on("vinculados");
  const relleno = on("relleno");
  const ofertas = on("ofertas");
  const nuevo = on("nuevo");
  const visita = on("visita");
  const marcada = (letra: string) => (vinculados && (letra === "C" || letra === "D")) || (relleno && (letra === "A" || letra === "B"));
  return (
    <svg
      viewBox={`0 0 ${W} 330`}
      className={cn("h-auto w-full", className)}
      role="img"
      aria-label="Una municipalidad arriba y las cuatro empresas que se presentaron abajo, A, B, C y D, con lo que encontró cada cruce encendido."
    >
      {/* Las ofertas: de la municipalidad a cada postor. */}
      {POSTORES.map((p) => (
        <line key={p.letra} x1={centro} y1={92} x2={X(p.x)} y2={138} stroke={COLOR.linea} strokeWidth={1.5} strokeDasharray="3 5" />
      ))}
      <Figura x={izquierdaEntidad} y={4}>
        <Pixel nombre="entidad" escala={3} />
      </Figura>

      {/* La visita: el gerente de A camina hasta la municipalidad. */}
      <Trazo d={`M24 168 V50 H${finCamino}`} visible={visita} ancho={2} />
      <Capa visible={visita} retardo={250}>
        <Etiqueta x={32} y={74} texto="6 días antes" desde />
      </Capa>
      {visita && (
        <g transform="translate(16 128)">
          <g className="detector-camina" style={{ "--camina-x": `${finCamino - 16 - 26}px` } as CSSProperties}>
            <Pixel nombre="vecinaCamina" escala={1.5} />
          </g>
        </g>
      )}

      {POSTORES.map((p, i) => {
        const x = X(p.x);
        const gano = i === 0;
        return (
          <g key={p.letra}>
            {/* El recuadro de un postor marcado por un cruce. */}
            <rect
              x={x - 32}
              y={140}
              width={64}
              height={76}
              rx={8}
              fill={COLOR.neonTenue}
              stroke={COLOR.neon}
              strokeWidth={1.5}
              className="transition-opacity duration-500 motion-reduce:transition-none"
              style={{ opacity: marcada(p.letra) ? 1 : 0 }}
            />
            <rect x={x - 15} y={146} width={30} height={24} rx={12} fill={gano ? COLOR.texto : "none"} stroke={gano ? "none" : COLOR.linea} strokeWidth={1.5} />
            <text x={x} y={164} textAnchor="middle" fontSize={17} fontWeight={700} fill={gano ? COLOR.sobreNeon : COLOR.texto}>
              {p.letra}
            </text>
            <Figura x={x - 24} y={176}>
              <Pixel nombre="empresa" escala={3} animado={false} />
            </Figura>
            <text
              x={x}
              y={234}
              textAnchor="middle"
              fontSize={k < 1 ? 13 : 14}
              fontWeight={ofertas ? 700 : 500}
              className="tabular-nums transition-colors duration-500"
              fill={ofertas ? COLOR.neon : COLOR.suave}
            >
              {conEspacios(`S/ ${numero(p.oferta)} mil`)}
            </text>
          </g>
        );
      })}

      {/* RUC muy reciente: sobre A. */}
      <Capa visible={nuevo}>
        <Etiqueta x={30} y={128} texto="RUC de 4 meses" desde />
      </Capa>

      {/* Ofertas agrupadas: las cuatro, subrayadas, y cuánto las separa. */}
      <Capa visible={ofertas}>
        {POSTORES.map((p) => (
          <line key={p.letra} x1={X(p.x) - X(34)} y1={241} x2={X(p.x) + X(34)} y2={241} stroke={COLOR.neon} strokeWidth={2} strokeLinecap="round" />
        ))}
        <Etiqueta x={centro} y={276} texto="en 0.8 %" />
      </Capa>

      {/* Postor de relleno (A y B) y postores vinculados (C y D): los arcos de abajo. */}
      <Trazo d={`M${X(60)} 248 Q${X(120)} 312 ${X(180)} 248`} visible={relleno} />
      <Capa visible={relleno} retardo={300}>
        <Etiqueta x={X(120)} y={312} texto="9 veces juntas" />
      </Capa>
      <Trazo d={`M${X(300)} 248 Q${X(360)} 312 ${X(420)} 248`} visible={vinculados} />
      <Capa visible={vinculados} retardo={300}>
        <Etiqueta x={X(360)} y={312} texto="mismo gerente" />
      </Capa>
    </svg>
  );
}

/** Seis órdenes, una por semana: su fecha y dónde está cada una (a lo ancho; `k` las acerca en el celular). */
const ORDENES = ["3 jun", "10 jun", "17 jun", "24 jun", "1 jul", "8 jul"].map((fecha, i) => ({ fecha, x: 40 + i * 68 }));
const PISO = 296;
const TOPE = 46; // alto del tope, en unidades del SVG
const ORDEN = 41; // alto de cada orden: justo debajo del tope
const ANCHO_ORDEN = 40;

function EscenaPartida({ on, k, className }: PropsEscena) {
  const X = (x: number) => Math.round(x * k);
  const W = X(480);
  const ordenes = ORDENES.map((o) => ({ ...o, x: X(o.x) }));
  const ancho = X(ANCHO_ORDEN);
  const xPila = ordenes[ordenes.length - 1].x;
  const repetidas = on("repetidas");
  const tope = on("tope");
  const apiladas = on("fraccion");
  return (
    <svg
      viewBox={`0 0 ${W} 330`}
      className={cn("h-auto w-full", className)}
      role="img"
      aria-label="Seis órdenes de compra, una por semana, cada una justo debajo del tope para comprar sin concurso; apiladas, superan cinco veces ese tope."
    >
      <line x1={X(20)} y1={PISO} x2={X(460)} y2={PISO} stroke={COLOR.linea} strokeWidth={1.5} />
      {/* El tope para comprar sin concurso. */}
      <line
        x1={X(20)}
        y1={PISO - TOPE}
        x2={X(460)}
        y2={PISO - TOPE}
        stroke={tope ? COLOR.alerta : COLOR.suave}
        strokeWidth={tope ? 2 : 1.5}
        strokeDasharray="6 5"
        className="transition-colors duration-500"
      />
      <text x={X(20)} y={PISO - TOPE - 8} fontSize={13} fontWeight={600} fill={tope ? COLOR.alerta : COLOR.suave} className="transition-colors duration-500">
        Tope para comprar sin concurso
      </text>

      {/* Mismo proveedor y mismo monto: la llave sobre las seis (no cuando ya están apiladas). */}
      <Capa visible={repetidas && !apiladas}>
        <path d={`M${ordenes[0].x} 214 V206 H${xPila + ancho} V214`} fill="none" stroke={COLOR.neon} strokeWidth={2} />
        <Etiqueta x={W / 2} y={198} texto="mismo proveedor, mismo monto" />
      </Capa>

      {ordenes.map((o, i) => (
        <g key={o.fecha}>
          {/* Dónde estaba la orden, cuando se va a la pila. */}
          <rect
            x={o.x}
            y={PISO - ORDEN}
            width={ancho}
            height={ORDEN}
            fill="none"
            stroke={COLOR.tenue}
            strokeDasharray="3 3"
            className="transition-opacity duration-500"
            style={{ opacity: apiladas && i < ordenes.length - 1 ? 1 : 0 }}
          />
          <rect
            x={o.x}
            y={PISO - ORDEN}
            width={ancho}
            height={ORDEN}
            rx={2}
            fill={repetidas ? COLOR.neon : COLOR.texto}
            fillOpacity={repetidas ? 0.85 : 0.55}
            stroke="rgb(var(--ink))"
            strokeWidth={1.5}
            className="transition-[transform,fill,fill-opacity] duration-700 ease-out motion-reduce:transition-none"
            style={{
              transform: apiladas ? `translate(${xPila - o.x}px, ${-i * ORDEN}px)` : "translate(0px, 0px)",
              transitionDelay: apiladas ? `${i * 90}ms` : "0ms",
            }}
          />
          {/* Justo debajo del tope: la tapa de cada orden. */}
          <rect
            x={o.x}
            y={PISO - ORDEN - 1}
            width={ancho}
            height={3}
            fill={COLOR.alerta}
            className="transition-opacity duration-500"
            style={{ opacity: tope && !apiladas ? 1 : 0 }}
          />
          <text x={o.x + ancho / 2} y={PISO + 20} textAnchor="middle" fontSize={13} fill={COLOR.suave}>
            {o.fecha}
          </text>
        </g>
      ))}

      <Capa visible={tope && !apiladas} retardo={200}>
        <Etiqueta x={W / 2} y={166} texto="cada una, justo debajo" color={COLOR.alerta} />
      </Capa>

      {/* Fraccionamiento: la pila y cuánto suma. */}
      <Capa visible={apiladas} retardo={600}>
        <text x={xPila - 14} y={70} textAnchor="end" fontSize={22} fontWeight={700} fill={COLOR.neon}>
          {conEspacios("S/ 243 mil juntas")}
        </text>
        <text x={xPila - 14} y={92} textAnchor="end" fontSize={14} fill={COLOR.texto}>
          más de cinco veces el tope
        </text>
        <text x={xPila - 14} y={110} textAnchor="end" fontSize={14} fill={COLOR.texto}>
          debió ser un proceso con competencia
        </text>
      </Capa>
    </svg>
  );
}

/** Los precios de las otras 14 entidades (ejemplo). */
const OTRAS = [3050, 3220, 3380, 3420, 3510, 3600, 3700, 3790, 3810, 3900, 4050, 4200, 4290, 4680];
const EJE = 150;

function EscenaPrecio({ on, k, className }: PropsEscena) {
  const X = (x: number) => Math.round(x * k);
  const W = X(480);
  // El eje de precios: S/ 2,000 a S/ 8,000.
  const px = (soles: number) => X(30 + ((soles - 2000) * 420) / 6000);
  const mercado = on("mercado");
  const mediana = on("mediana");
  const lote = on("lote");
  const senal = mercado || mediana || lote;
  // El lote: lo pagado (276 mil) y lo que habría costado (152 mil), en la misma escala.
  const pagado = X(300);
  const deMercado = X(165);
  return (
    <svg
      viewBox={`0 0 ${W} 330`}
      className={cn("h-auto w-full", className)}
      role="img"
      aria-label="Lo que pagó esta entidad por cada computadora, S/ 6,900, frente a lo que pagaron otras 14 entidades, entre S/ 3,400 y S/ 4,300."
    >
      <text x={X(30)} y={34} fontSize={13} fontWeight={600} fill={COLOR.suave}>
        Precio por computadora
      </text>
      <line x1={X(30)} y1={EJE} x2={X(450)} y2={EJE} stroke={COLOR.linea} strokeWidth={1.5} />
      {[2000, 4000, 6000, 8000].map((s) => (
        <g key={s}>
          <line x1={px(s)} y1={EJE - 5} x2={px(s)} y2={EJE + 5} stroke={COLOR.linea} strokeWidth={1.5} />
          {/* Las puntas del eje, hacia adentro: en el celular, centradas, se salían del dibujo. */}
          <text x={s === 2000 ? px(s) - 4 : s === 8000 ? px(s) + 4 : px(s)} y={EJE + 34} textAnchor={s === 2000 ? "start" : s === 8000 ? "end" : "middle"} fontSize={13} fill={COLOR.suave}>
            {conEspacios(`S/ ${numero(s)}`)}
          </text>
        </g>
      ))}

      {/* Lo que pagaron otras entidades: los puntos, la franja del medio (cuartil 1 a 3) y la mediana. */}
      <Capa visible={mercado}>
        <rect x={px(3400)} y={EJE - 13} width={px(4300) - px(3400)} height={26} rx={6} fill={COLOR.neonTenue} stroke={COLOR.neon} strokeWidth={1.25} />
        <line x1={px(3800)} y1={EJE - 18} x2={px(3800)} y2={EJE + 18} stroke={COLOR.neon} strokeWidth={2.5} />
        <text x={px(3800)} y={EJE - 52} textAnchor="middle" fontSize={14} fontWeight={600} fill={COLOR.neon}>
          Otras 14 entidades
        </text>
        <text x={px(3800)} y={EJE - 33} textAnchor="middle" fontSize={13} fill={COLOR.texto}>
          {conEspacios("mediana S/ 3,800")}
        </text>
      </Capa>
      {OTRAS.map((s, i) => (
        <circle
          key={s}
          cx={px(s)}
          cy={EJE + (i % 2 ? 6 : -6)}
          r={4.5}
          fill={COLOR.neon}
          className="transition-opacity duration-300 motion-reduce:transition-none"
          style={{ opacity: mercado ? 0.9 : 0, transitionDelay: mercado ? `${150 + i * 45}ms` : "0ms" }}
        />
      ))}

      {/* Esta entidad. */}
      <circle cx={px(6900)} cy={EJE} r={10} fill={senal ? COLOR.alerta : COLOR.texto} stroke="rgb(var(--ink))" strokeWidth={2} className="transition-colors duration-500" />
      <text x={px(6900)} y={EJE - 52} textAnchor="middle" fontSize={14} fontWeight={600} fill={senal ? COLOR.alerta : COLOR.texto} className="transition-colors duration-500">
        Esta entidad
      </text>
      <text x={px(6900)} y={EJE - 33} textAnchor="middle" fontSize={13} fill={COLOR.texto}>
        {conEspacios("S/ 6,900")}
      </text>

      {/* Cuánto más que la mediana. */}
      <Trazo d={`M${px(3800)} 206 H${px(6900) - 6}`} visible={mediana} color={COLOR.alerta} ancho={2.5} />
      <Capa visible={mediana} retardo={450}>
        <path d={`M${px(6900) - 12} 199 L${px(6900)} 206 L${px(6900) - 12} 213`} fill="none" stroke={COLOR.alerta} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        <Etiqueta x={(px(3800) + px(6900)) / 2} y={234} texto="82 % más que la mediana" color={COLOR.alerta} />
      </Capa>

      {/* El lote: lo pagado, lo que habría costado y, junto a lo de mercado y bajo el tramo rojo, cuánto se pagó de más. */}
      <Capa visible={lote}>
        <text x={X(30)} y={266} fontSize={13} fill={COLOR.texto}>
          {conEspacios("Se pagó por las 40: S/ 276 mil")}
        </text>
        <rect x={X(30)} y={272} width={pagado} height={13} rx={3} fill={COLOR.tenue} />
        <rect x={X(30) + deMercado} y={272} width={pagado - deMercado} height={13} rx={3} fill={COLOR.alerta} />
        <text x={X(30)} y={306} fontSize={13} fill={COLOR.texto}>
          {conEspacios("A precio de mercado: S/ 152 mil")}
        </text>
        <rect x={X(30)} y={312} width={deMercado} height={13} rx={3} fill={COLOR.neon} />
        <text x={X(30) + deMercado + 8} y={324} fontSize={14} fontWeight={700} fill={COLOR.alerta}>
          {conEspacios("S/ 124 mil de más")}
        </text>
      </Capa>
    </svg>
  );
}
