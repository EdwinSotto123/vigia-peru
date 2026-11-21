"use client";

import { rutaContrato } from "@/lib/rutas";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { ArrowUpRight, Building2, ChevronRight, ExternalLink, FileText, Info, Scale, Search, type LucideIcon } from "lucide-react";
import { SIN_REDUCIR, useEscenaGsap } from "@/lib/gsap";
import { tituloNatural, type CasoPortada, type OtraSenal } from "@/lib/landing";
import { severidadDeBandera } from "@/lib/severidad";
import { numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Severidad } from "@/components/ui/Severidad";
import { Revelar } from "@/components/ui/Revelar";
import { TOTAL_AGENTES, TOTAL_PASOS } from "@/components/agentes/catalogo";
import { EnlaceAccion } from "./EnlaceAccion";
import { Ayuda } from "@/components/patrones/Ayuda";
import {
  BloqueDetalle,
  ChipsDetalle,
  CitaDetalle,
  CuerpoDetalle,
  DatosClave,
  PieDetalle,
  type DatoClave,
} from "@/components/patrones/Detalle";

/**
 * «Lo que ya encontró»: contratos reales que Vigía leyó, y cómo los leyó, en UNA sección (2026-11-13).
 *
 * Antes eran dos seguidas que contaban lo mismo: «Así lee Vigía un contrato» (un caso en cuatro pasos) y «Lo que ya
 * encontró» (tres casos más, uno debajo del otro, con el mismo hallazgo y la misma ley otra vez). Medían 2,4 pantallas
 * en escritorio y 4,5 en el celular. Ahora los casos son pestañas (la severidad, la regla, la entidad y el monto, todos a
 * la vista) y el elegido se lee en cuatro pasos con sus propios datos:
 *
 *   1. Alguien compra         la entidad, qué compró, el monto, la fecha, la provincia
 *   2. Vigía lo lee           cuántos revisores y comprobaciones, a quién investigó, cuántas señales
 *   3. Encuentra una señal    la regla, su evidencia y la norma (papel: el clímax)
 *   4. Tú lo compruebas       las otras señales de proceso por su nombre y los enlaces
 *
 * Nada inventado ni ilustrativo: todo sale del análisis publicado. Las otras señales van sólo por su nombre, y sólo las
 * de proceso: las que hablan de personas no se nombran en la portada (quedan contadas). La evidencia completa está a un
 * clic ("Ver lo que encontró", panel §14.4) o en el análisis.
 *
 * En el celular los cuatro pasos apilados medían 1 450 px: ahí se ve UNO a la vez, con una barra numerada arriba
 * (como los capítulos de las fichas), y abre en el 3, el hallazgo. Desde lg van los cuatro en fila, unidos por la línea.
 *
 * Al entrar en pantalla la línea avanza y cada paso se enfoca cuando llega (una vez, sin fijar la página). Sin
 * movimiento, todo está completo desde el principio: el estado atenuado lo pone GSAP, nunca el CSS.
 */

/** Un caso de la portada con el nombre de su regla («Única oferta válida») y sus otras señales de proceso. */
export interface CasoConDetalle extends CasoPortada {
  regla: string | null;
  otras: OtraSenal[];
}

const PASOS: { Icono: LucideIcon; t: string; corto: string }[] = [
  { Icono: FileText, t: "Alguien compra", corto: "Compra" },
  { Icono: Search, t: "Vigía lo lee", corto: "Lectura" },
  { Icono: Scale, t: "Encuentra una señal", corto: "Señal" },
  { Icono: ExternalLink, t: "Tú lo compruebas", corto: "Compruébalo" },
];

/** El paso que abre en el celular: el hallazgo. */
const PASO_INICIAL = 2;

/** La tarjeta oscura de un paso (el paso 3 va en papel: es el hallazgo). */
const TARJETA = "rounded-2xl border border-paper/15 p-4";

/** El título de un caso: su regla; sin ella, dónde (sin región no se pone "Perú": rellenar un hueco es inventar). */
const tituloCaso = (c: CasoConDetalle) => c.regla ?? (c.region ? `Una señal en ${c.region}` : "Lo que encontró Vigía");

export function CasoLeido({ casos, leidos }: { casos: CasoConDetalle[]; /** Los contratos que Vigía ya leyó. */ leidos: number }) {
  const raiz = useRef<HTMLElement>(null);
  const base = useId();
  const [elegido, setElegido] = useState(0);
  // Sólo en el celular: qué paso se ve (desde lg se ven los cuatro).
  const [paso, setPaso] = useState(PASO_INICIAL);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);

  // Revelado liviano: GSAP llega después de `load`, en un momento ocioso, y nunca con
  // movimiento reducido. Hasta entonces los pasos se ven completos.
  useEscenaGsap(
    raiz,
    SIN_REDUCIR,
    ({ gsap }) => {
      const capas = gsap.utils.toArray<HTMLElement>(".capa");
      const pasos = gsap.utils.toArray<HTMLElement>(".paso-marca");
      // Atenuadas, nunca ocultas: un hueco en blanco se lee como "no cargó".
      gsap.set(capas.slice(1), { opacity: 0.25, filter: "blur(3px)" });
      gsap.set(pasos.slice(1), { opacity: 0.45 });

      const tl = gsap.timeline({
        defaults: { ease: "power2.out" },
        scrollTrigger: { trigger: ".pasos-caso", start: "top 78%", once: true },
      });
      tl.fromTo(".pasos-linea-h", { scaleX: 0 }, { scaleX: 1, duration: 1.6, ease: "none" }, 0);
      // El paso i se enfoca cuando la línea llega a él. Al terminar se limpia el filtro:
      // el panel de "Ver lo que encontró" vive dentro de una de estas capas.
      capas.slice(1).forEach((capa, i) => {
        const en = 0.5 * (i + 1);
        tl.to(pasos[i + 1], { opacity: 1, duration: 0.3 }, en).to(
          capa,
          { opacity: 1, filter: "blur(0px)", duration: 0.4, clearProps: "filter,opacity" },
          en,
        );
      });
    },
    { diferido: true },
  );

  if (casos.length === 0) return null;
  const caso = casos[Math.min(elegido, casos.length - 1)];

  const teclas = (e: KeyboardEvent, i: number) => {
    const paso = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!paso && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const n = e.key === "Home" ? 0 : e.key === "End" ? casos.length - 1 : (i + paso + casos.length) % casos.length;
    setElegido(n);
    botones.current[n]?.focus();
  };

  return (
    <section
      ref={raiz}
      id="casos"
      data-tema="oscuro"
      aria-labelledby="casos-titulo"
      className="sobre-oscuro relative scroll-mt-16 overflow-hidden border-t border-paper/10 bg-ink text-paper"
    >
      <div className="container-page relative py-10 sm:py-12">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="min-w-0 max-w-[60ch]">
            <h2 id="casos-titulo" className="text-balance font-display text-cifra font-bold leading-[1.08] tracking-tight sm:text-titulo">
              Lo que ya <span className="text-maiz">encontró.</span>
            </h2>
            <p className="mt-2 text-pretty text-cuerpo leading-relaxed text-paper/75">
              Contratos reales, de los {numero(leidos)} que Vigía ya leyó. Elige uno y míralo de principio a fin.{" "}
              <Ayuda titulo="¿Qué quiere decir señal alta o media?" className="text-paper/60 hover:bg-paper/10 hover:text-maiz">
                Señal alta: hay indicios fuertes de que algo no se hizo como manda la ley. Señal media: hay algo inusual que
                conviene mirar. Ninguna es una acusación.
              </Ayuda>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="inline-flex items-center gap-2 rounded-full border border-paper/15 px-3.5 py-1.5 text-meta text-paper/80">
              <Info size={14} className="shrink-0 text-maiz" aria-hidden />
              Una señal es para revisar, nunca una acusación.
            </p>
            <EnlaceAccion href="/app/hallazgos" variante="contornoOscuro">
              Ver todos los hallazgos
            </EnlaceAccion>
          </div>
        </div>

        {/* ── Los casos, como pestañas: todos a la vista, sin carrusel ── */}
        <div role="tablist" aria-label="Contratos leídos por Vigía" className="mt-6 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {casos.map((c, i) => {
            const activo = i === elegido;
            return (
              <button
                key={c.codigo}
                ref={(el) => {
                  botones.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${base}-tab-${i}`}
                aria-selected={activo}
                aria-controls={`${base}-panel`}
                tabIndex={activo ? 0 : -1}
                onClick={() => setElegido(i)}
                onKeyDown={(e) => teclas(e, i)}
                className={cn(
                  "flex min-w-0 flex-col items-start gap-1.5 rounded-2xl border p-3 text-left transition-colors duration-rapido focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-maiz sm:p-3.5",
                  activo ? "border-maiz ring-1 ring-maiz" : "border-paper/15 hover:border-paper/40",
                )}
              >
                <Severidad bandera={c.severidad} />
                <span className="line-clamp-2 text-dato font-semibold leading-snug text-paper">{tituloCaso(c)}</span>
                <span className="block w-full truncate text-meta text-paper/70" title={c.entidad}>
                  {tituloNatural(c.entidad)}
                </span>
                {/* El monto, desde sm: en el celular lo dice el paso 1 y la pestaña queda en tres renglones. */}
                {c.monto && <span className="hidden font-mono text-meta tabular-nums text-paper/90 sm:block">{c.monto}</span>}
              </button>
            );
          })}
        </div>

        {/* ── El elegido, en cuatro pasos ── En el celular, uno a la vez con su barra numerada; en fila desde lg. La línea
            de lg va del centro del primer círculo al del último. */}
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${elegido}`} className="pasos-caso relative mt-5 lg:mt-6">
          <div role="group" aria-label="Qué paso ver" className="mb-3 grid grid-cols-4 gap-1.5 lg:hidden">
            {PASOS.map(({ Icono, corto }, i) => (
              <button
                key={corto}
                type="button"
                aria-pressed={paso === i}
                onClick={() => setPaso(i)}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl border px-1 py-1.5 text-rotulo font-semibold transition-colors duration-rapido",
                  paso === i ? "border-maiz text-maiz" : "border-paper/15 text-paper/75 hover:border-paper/40",
                )}
              >
                <span className="flex items-center gap-1">
                  <span className="font-mono">{i + 1}</span>
                  <Icono size={13} aria-hidden />
                </span>
                {corto}
              </button>
            ))}
          </div>
          <span aria-hidden className="absolute left-5 right-[calc((100%_-_3.75rem)/4_-_1.25rem)] top-5 hidden h-0.5 rounded-full bg-paper/15 lg:block" />
          <span aria-hidden className="pasos-linea-h absolute left-5 right-[calc((100%_-_3.75rem)/4_-_1.25rem)] top-5 hidden h-0.5 origin-left rounded-full bg-maiz lg:block" />

          <PasosCaso caso={caso} paso={paso} />
        </div>
      </div>
    </section>
  );
}

/** Los cuatro pasos de un caso. */
function PasosCaso({ caso, paso }: { caso: CasoConDetalle; /** El que se ve en el celular. */ paso: number }) {
  const sev = severidadDeBandera(caso.severidad);
  const titulo = tituloCaso(caso);
  const analisis = rutaContrato(caso.convocatoria, "dictamen");
  const totalSenales = caso.otrasSenales + 1;
  // Las que no se nombran (de personas o del documento) se cuentan, no se esconden.
  const nombradas = caso.otras.slice(0, 4);
  const sinNombrar = Math.max(0, caso.otrasSenales - nombradas.length);

  return (
    <ol className="relative grid gap-4 lg:grid-cols-4 lg:gap-5">
      <Paso n={1} visible={paso === 0}>
        <div className={cn("capa", TARJETA)}>
          <p className="flex items-center gap-1.5 text-rotulo text-paper/70">
            <FileText size={13} aria-hidden /> Publicado en el SEACE
          </p>
          <p className="mt-1.5 line-clamp-2 font-display text-destacado font-bold leading-snug" title={caso.entidad}>
            {tituloNatural(caso.entidad)}
          </p>
          <p className="mt-1 line-clamp-3 text-dato leading-snug text-paper/85" title={caso.objeto}>
            <span className="text-paper/60">Compró: </span>
            {tituloNatural(caso.objeto)}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-paper/10 pt-3">
            {caso.monto && <Dato t="Monto" v={caso.monto} mono />}
            {caso.fecha && <Dato t="Adjudicado" v={caso.fecha} />}
            {caso.region && <Dato t="Provincia" v={caso.region} />}
          </dl>
        </div>
      </Paso>

      <Paso n={2} visible={paso === 1}>
        <div className={cn("capa", TARJETA)}>
          <p className="text-dato font-medium leading-snug text-paper/90">Revisores automáticos leen todo el expediente:</p>
          <div className="mt-2.5 grid grid-cols-2 gap-3">
            <Cifra n={TOTAL_AGENTES} t="revisores" />
            <Cifra n={TOTAL_PASOS} t="comprobaciones" />
          </div>
          <ul className="mt-3 space-y-2 border-t border-paper/10 pt-3 text-dato leading-snug">
            <Hizo Icono={FileText}>Leyeron las bases, las actas y el contrato</Hizo>
            {caso.proveedor && (
              <Hizo Icono={Building2}>
                Investigaron a la empresa ganadora,{" "}
                <span className="font-semibold text-paper" title={caso.proveedor}>
                  {caso.proveedor}
                </span>
              </Hizo>
            )}
            <Hizo Icono={Search}>
              Encontraron <span className="font-semibold text-maiz">{plural(totalSenales, "señal", "señales")}</span>
            </Hizo>
          </ul>
        </div>
      </Paso>

      <Paso n={3} visible={paso === 2}>
        {/* El hallazgo, en papel: el foco vuelve a granate. */}
        <article className="capa sobre-claro overflow-hidden rounded-2xl bg-paper text-ink shadow-dialog">
          <div className={cn("p-4", sev.fondo)}>
            <Severidad bandera={caso.severidad} className="bg-paper" />
            <h4 className="mt-2 text-balance font-display text-bloque font-bold leading-tight">{titulo}</h4>
            <p className="mt-2 text-rotulo font-semibold text-mute">Qué encontró</p>
            <p className="mt-0.5 line-clamp-4 text-dato leading-relaxed text-ink">{caso.hallazgo}</p>
          </div>
          <div className="space-y-2 border-t border-line p-4">
            <p className="text-rotulo font-semibold text-mute">Qué dice la ley</p>
            <p className="flex items-start gap-1.5 text-dato font-medium text-granate" title={caso.norma}>
              <Scale size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span className="line-clamp-3">{caso.norma}</span>
            </p>
            <Revelar
              titulo={titulo}
              descripcion={caso.entidad}
              etiqueta="Ver lo que encontró Vigía en este contrato"
              className="inline-flex w-auto min-h-11 sm:min-h-8 items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline"
              detalle={<DetalleCaso caso={caso} />}
              pie={<PieCaso caso={caso} analisis={analisis} />}
            >
              Ver lo que encontró <ChevronRight size={15} aria-hidden />
            </Revelar>
          </div>
        </article>
      </Paso>

      <Paso n={4} visible={paso === 3}>
        <div className={cn("capa", TARJETA)}>
          <p className="text-dato font-medium leading-snug text-paper/90">Cada señal cita su norma y su fuente. Puedes comprobarla tú.</p>
          {nombradas.length > 0 && (
            <>
              <p className="mt-3 text-rotulo text-paper/70">Otras señales de este contrato</p>
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {nombradas.map((o) => (
                  <li
                    key={o.etiqueta}
                    className="inline-flex items-center gap-1.5 rounded-full border border-paper/15 px-2.5 py-1 text-meta text-paper/85"
                  >
                    <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", PUNTO[o.severidad])} />
                    {o.etiqueta}
                    <span className="sr-only">, severidad {o.severidad}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {sinNombrar > 0 && (
            <p className="mt-2 text-meta text-paper/70">
              {plural(sinNombrar, "señal más", "señales más")} en el análisis
            </p>
          )}
          <div className={cn("flex flex-col gap-1.5", caso.otrasSenales > 0 ? "mt-3 border-t border-paper/10 pt-3" : "mt-3")}>
            <Link
              href={analisis}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full bg-maiz px-4 text-dato font-semibold text-sobreMaiz transition-colors duration-rapido hover:bg-maiz-soft"
            >
              Leer el análisis completo <ArrowUpRight size={15} aria-hidden />
            </Link>
            {caso.fuenteUrl && <FichaOficial href={caso.fuenteUrl} oscuro />}
          </div>
        </div>
      </Paso>
    </ol>
  );
}

/** El punto de severidad de las otras señales, sobre oscuro (los mismos tonos que la pastilla). */
const PUNTO: Record<OtraSenal["severidad"], string> = { alta: "bg-rust", media: "bg-amber", baja: "bg-mute" };

/**
 * Un paso: su marca en la línea (número e ícono), su título y su tarjeta. En el celular sólo la tarjeta del paso elegido
 * (la barra numerada de arriba hace de marca y de título; el título queda para el lector de pantalla).
 */
function Paso({ n, visible, children }: { n: 1 | 2 | 3 | 4; visible: boolean; children: React.ReactNode }) {
  const { Icono, t } = PASOS[n - 1];
  return (
    <li className={cn(visible ? "block" : "hidden", "lg:flex lg:flex-col")}>
      <span className="paso-marca relative z-[1] hidden h-10 w-10 items-center justify-center rounded-full border border-maiz/60 bg-ink text-maiz lg:flex">
        <Icono size={17} aria-hidden />
      </span>
      <div className="min-w-0 lg:flex lg:flex-1 lg:flex-col">
        <h3 className="sr-only lg:not-sr-only lg:mt-2.5 lg:flex lg:items-center lg:gap-2 lg:text-cuerpo lg:font-semibold">
          <span className="font-mono text-rotulo font-medium text-maiz">
            <span className="sr-only">Paso </span>
            {n}
          </span>
          {t}
        </h3>
        {/* Desde lg las cuatro tarjetas miden lo mismo: la fila se lee pareja. */}
        <div className="lg:mt-2.5 lg:flex-1 lg:[&>*]:h-full">{children}</div>
      </div>
    </li>
  );
}

function Cifra({ n, t }: { n: number; t: string }) {
  return (
    <p>
      <span className="block font-display text-titulo font-bold leading-none tabular-nums text-maiz">{numero(n)}</span>
      <span className="mt-1 block text-meta text-paper/75">{t}</span>
    </p>
  );
}

function Hizo({ Icono, children }: { Icono: LucideIcon; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-paper/80">
      <Icono size={15} className="mt-0.5 shrink-0 text-maiz/80" aria-hidden />
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Dato({ t, v, mono = false, className }: { t: string; v: string; mono?: boolean; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-rotulo text-paper/60">{t}</dt>
      <dd className={cn("mt-0.5 text-dato font-semibold leading-snug text-paper", mono && "font-mono tabular-nums")}>
        {v}
      </dd>
    </div>
  );
}

function FichaOficial({ href, oscuro = false }: { href: string; oscuro?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn(
        "inline-flex min-h-11 sm:min-h-8 items-center gap-1.5 font-medium underline-offset-2 hover:underline",
        oscuro ? "justify-center text-dato text-paper/85" : "text-ink",
      )}
    >
      Ver la ficha oficial <ExternalLink size={13} aria-hidden />
      <span className="sr-only">(se abre en una pestaña nueva)</span>
    </a>
  );
}

/** El panel de "Ver lo que encontró" (§14.4): la evidencia entera, la norma y el contrato. */
function DetalleCaso({ caso }: { caso: CasoPortada }) {
  const datos: DatoClave[] = [
    { etiqueta: "Entidad", valor: caso.entidad },
    { etiqueta: "Qué se compró", valor: caso.objeto },
    ...(caso.monto ? [{ etiqueta: "Monto", valor: caso.monto, mono: true }] : []),
    ...(caso.fecha ? [{ etiqueta: "Adjudicado", valor: caso.fecha }] : []),
    ...(caso.proveedor ? [{ etiqueta: "Empresa ganadora", valor: caso.proveedor }] : []),
    ...(caso.region ? [{ etiqueta: "Provincia", valor: caso.region }] : []),
    { etiqueta: "Convocatoria", valor: caso.convocatoria, mono: true },
  ];
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <Severidad bandera={caso.severidad} />
        {caso.otrasSenales > 0 && (
          <span className="pill bg-paperDeep text-inkSoft">{plural(caso.otrasSenales, "señal más", "señales más")}</span>
        )}
      </ChipsDetalle>
      <BloqueDetalle titulo="Lo que encontró">
        <CitaDetalle fuente="Del análisis publicado por Vigía">{caso.hallazgo}</CitaDetalle>
      </BloqueDetalle>
      <BloqueDetalle titulo="La norma que cita">
        <span className="flex items-start gap-2">
          <Scale size={15} className="mt-0.5 shrink-0 text-granate" aria-hidden />
          <span>{caso.norma}</span>
        </span>
      </BloqueDetalle>
      <BloqueDetalle titulo="El contrato">
        <DatosClave items={datos} />
      </BloqueDetalle>
    </CuerpoDetalle>
  );
}

function PieCaso({ caso, analisis }: { caso: CasoPortada; analisis: string }) {
  return (
    <PieDetalle
      principal={
        <Link href={analisis} className="inline-flex items-center gap-1.5 font-semibold text-granate underline-offset-2 hover:underline">
          Leer el análisis completo <ArrowUpRight size={14} aria-hidden />
        </Link>
      }
      secundarias={caso.fuenteUrl ? <FichaOficial href={caso.fuenteUrl} /> : undefined}
    />
  );
}
