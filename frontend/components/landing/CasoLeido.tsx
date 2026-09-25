"use client";

import { useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, ExternalLink, FileText, Scale, Search } from "lucide-react";
import { gsap, SIN_REDUCIR, useGSAP } from "@/lib/gsap";
import type { CasoPortada } from "@/lib/landing";
import { severidadDeBandera } from "@/lib/severidad";
import { plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Severidad } from "@/components/ui/Severidad";
import { Revelar } from "@/components/ui/Revelar";
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
 * "Cómo funciona", contado con un contrato de verdad: uno de los que Vigía ya leyó,
 * tal como quedó publicado. Nada inventado ni ilustrativo.
 *
 * Se lee de un vistazo: una ficha del contrato (entidad, qué se compró, monto, fecha,
 * quién ganó), UNA señal grande y corta (la regla, su severidad y el comienzo de la
 * evidencia) y la norma en una pastilla. La evidencia completa, con cada empresa y
 * cada monto, está a un clic en "Ver lo que encontró" (panel §14.4) o en el análisis.
 *
 * Los cuatro pasos son un recorrido de ícono y pocas palabras. Al entrar en pantalla la
 * línea avanza y cada capa de la ficha se enfoca con su paso (una vez, sin fijar la
 * página: menos scroll). Sin movimiento, todo está completo desde el principio: el
 * estado atenuado lo pone GSAP, nunca el CSS.
 */

const PASOS = [
  { Icono: FileText, t: "El Estado lo publica" },
  { Icono: Search, t: "Vigía lo lee" },
  { Icono: Scale, t: "Cita la ley" },
  { Icono: ExternalLink, t: "Tú lo compruebas" },
];

export function CasoLeido({ caso, regla }: { caso: CasoPortada; regla: string | null }) {
  const raiz = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(SIN_REDUCIR, () => {
        const capas = gsap.utils.toArray<HTMLElement>(".capa");
        const pasos = gsap.utils.toArray<HTMLElement>(".paso");
        // Atenuadas, nunca ocultas: un hueco en blanco se lee como "no cargó".
        gsap.set(capas.slice(1), { opacity: 0.2, filter: "blur(4px)" });
        gsap.set(pasos.slice(1), { opacity: 0.45 });

        const tl = gsap.timeline({
          defaults: { ease: "power2.out" },
          scrollTrigger: { trigger: ".caso-ficha", start: "top 72%", once: true },
        });
        tl.fromTo(".pasos-linea-h", { scaleX: 0 }, { scaleX: 1, duration: 2.1, ease: "none" }, 0).fromTo(
          ".pasos-linea-v",
          { scaleY: 0 },
          { scaleY: 1, duration: 2.1, ease: "none" },
          0,
        );
        // La capa i se enfoca cuando la línea llega al paso i. Al terminar se limpia el
        // filtro: el panel de "Ver lo que encontró" vive dentro de una de estas capas.
        capas.slice(1).forEach((capa, i) => {
          const en = 0.7 * (i + 1);
          tl.to(pasos[i + 1], { opacity: 1, duration: 0.3 }, en).to(
            capa,
            { opacity: 1, filter: "blur(0px)", duration: 0.45, clearProps: "filter,opacity" },
            en,
          );
        });
      });
      return () => mm.revert();
    },
    { scope: raiz },
  );

  const sev = severidadDeBandera(caso.severidad);
  const titulo = regla ?? "Lo que encontró Vigía";
  const analisis = `/app/convocatoria/${encodeURIComponent(caso.convocatoria)}`;

  return (
    <section
      ref={raiz}
      id="como"
      data-tema="oscuro"
      aria-labelledby="caso-titulo"
      className="sobre-oscuro relative scroll-mt-16 overflow-hidden border-t border-paper/10 bg-ink text-paper"
    >
      <div className="container-page relative py-16 sm:py-20">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center lg:gap-16">
          <div>
            <h2 id="caso-titulo" className="text-balance font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
              Así lee Vigía un contrato real.
            </h2>
            <p className="mt-3 max-w-[48ch] text-pretty text-base leading-relaxed text-paper/75">
              Uno que ya leyó, tal como quedó publicado. Es una señal para revisar, nunca una acusación.
            </p>

            {/* ── Los pasos ── Una secuencia de verdad: en fila en el celular, en columna desde lg. */}
            <div className="relative mt-8 lg:mt-10">
              <span aria-hidden className="absolute left-[12.5%] right-[12.5%] top-5 h-0.5 rounded-full bg-paper/15 lg:hidden" />
              <span aria-hidden className="pasos-linea-h absolute left-[12.5%] right-[12.5%] top-5 h-0.5 origin-left rounded-full bg-maiz lg:hidden" />
              <span aria-hidden className="absolute bottom-5 left-5 top-5 hidden w-0.5 -translate-x-1/2 rounded-full bg-paper/15 lg:block" />
              <span aria-hidden className="pasos-linea-v absolute bottom-5 left-5 top-5 hidden w-0.5 -translate-x-1/2 origin-top rounded-full bg-maiz lg:block" />
              <ol className="relative grid grid-cols-4 gap-2 lg:grid-cols-1 lg:gap-5">
                {PASOS.map(({ Icono, t }, i) => (
                  <li key={t} className="paso flex flex-col items-center gap-2 text-center lg:flex-row lg:gap-4 lg:text-left">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-maiz/50 bg-ink text-maiz">
                      <Icono size={17} aria-hidden />
                    </span>
                    <span className="text-[12.5px] font-semibold leading-tight text-paper sm:text-[14px] lg:text-lg">
                      <span className="sr-only">Paso {i + 1}: </span>
                      {t}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* ── La ficha del contrato ── Papel sobre la sección oscura: el foco vuelve a granate. */}
          <article className="caso-ficha sobre-claro overflow-hidden rounded-2xl bg-paper text-ink shadow-dialog">
            {/* Capa 1: el contrato */}
            <div className="capa px-5 pb-5 pt-4 sm:px-7 sm:pt-5">
              <div className="flex items-center justify-between gap-3 text-[12px] text-mute">
                <span className="inline-flex items-center gap-1.5">
                  <FileText size={13} aria-hidden /> Contrato publicado en el SEACE
                </span>
                {caso.region && <span className="truncate">{caso.region}</span>}
              </div>
              <h3 className="mt-2 line-clamp-2 font-display text-lg font-bold leading-snug text-ink" title={caso.entidad}>
                {caso.entidad}
              </h3>
              <p className="mt-1 line-clamp-2 text-[14px] leading-relaxed text-inkSoft" title={caso.objeto}>
                {caso.objeto}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-[auto_auto_minmax(0,1fr)]">
                {caso.monto && <Dato t="Monto" v={caso.monto} mono />}
                {caso.fecha && <Dato t="Adjudicado" v={caso.fecha} />}
                {caso.proveedor && <Dato t="Ganó" v={caso.proveedor} className="col-span-2 sm:col-span-1" />}
              </dl>
            </div>

            {/* Capa 2: la señal, grande y corta */}
            <div className={cn("capa border-t border-line px-5 py-5 sm:px-7", sev.fondo)}>
              <div className="flex flex-wrap items-center gap-2">
                <Severidad bandera={caso.severidad} className="bg-paper" />
                {caso.otrasSenales > 0 && (
                  <span className="text-[12.5px] text-inkSoft">y {plural(caso.otrasSenales, "señal más", "señales más")}</span>
                )}
              </div>
              <h4 className="mt-2.5 text-balance font-display text-2xl font-extrabold leading-tight text-ink sm:text-[28px]">{titulo}</h4>
              {/* El comienzo de la evidencia, en una línea (dos en el celular); entera, a un clic. */}
              <p className="mt-1.5 line-clamp-2 text-[14px] leading-relaxed text-inkSoft sm:line-clamp-1">{caso.hallazgo}</p>
              <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2.5">
                {/* Capa 3: la norma que cita */}
                <span
                  className="capa inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-paper px-3 py-1 text-[12.5px] font-medium text-granate ring-1 ring-inset ring-granate/20"
                  title={caso.norma}
                >
                  <Scale size={13} className="shrink-0" aria-hidden />
                  <span className="sr-only">La norma que cita: </span>
                  <span className="truncate">{caso.norma}</span>
                </span>
                <Revelar
                  titulo={titulo}
                  descripcion={caso.entidad}
                  etiqueta="Ver lo que encontró Vigía en este contrato"
                  className="inline-flex w-auto min-h-[32px] items-center gap-1 text-[13.5px] font-semibold text-granate underline-offset-4 hover:underline"
                  detalle={<DetalleCaso caso={caso} />}
                  pie={<PieCaso caso={caso} analisis={analisis} />}
                >
                  Ver lo que encontró <ChevronRight size={15} aria-hidden />
                </Revelar>
              </div>
            </div>

            {/* Capa 4: comprobarlo */}
            <div className="capa flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line px-5 py-3.5 text-[13.5px] sm:px-7">
              <Link href={analisis} className="inline-flex min-h-[32px] items-center gap-1.5 font-semibold text-granate underline-offset-2 hover:underline">
                Leer el análisis completo <ArrowUpRight size={14} aria-hidden />
              </Link>
              {caso.fuenteUrl && <FichaOficial href={caso.fuenteUrl} />}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}

function Dato({ t, v, mono = false, className }: { t: string; v: string; mono?: boolean; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-[12px] text-mute">{t}</dt>
      <dd className={cn("mt-0.5 truncate text-[14px] font-semibold text-ink", mono && "font-mono tabular-nums")} title={v}>
        {v}
      </dd>
    </div>
  );
}

function FichaOficial({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-[32px] items-center gap-1.5 font-medium text-ink underline-offset-2 hover:underline"
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
