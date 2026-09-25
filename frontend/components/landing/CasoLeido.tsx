"use client";

import { useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, Building2, ChevronRight, ExternalLink, FileText, Info, Scale, Search, type LucideIcon } from "lucide-react";
import { gsap, SIN_REDUCIR, useGSAP } from "@/lib/gsap";
import type { CasoPortada, OtraSenal } from "@/lib/landing";
import { severidadDeBandera } from "@/lib/severidad";
import { numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Severidad } from "@/components/ui/Severidad";
import { Revelar } from "@/components/ui/Revelar";
import { TOTAL_AGENTES, TOTAL_PASOS } from "@/components/agentes/catalogo";
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
 * "¿Pero cómo lo hizo?": la sección de arriba termina en cuántos contratos leyó Vigía y
 * cuántos tienen riesgo alto; ésta lo cuenta con UNO de esos contratos, de verdad y de
 * principio a fin, en cuatro pasos con sus propios datos:
 *
 *   1. El Estado lo publica   la entidad, qué compró, el monto, la fecha, la provincia
 *   2. Vigía lo lee           cuántos agentes y revisiones, a quién investigó, cuántas señales
 *   3. Cita la ley            la señal más fuerte, su evidencia y la norma (papel: el clímax)
 *   4. Tú lo compruebas       las otras señales de proceso por su nombre y los enlaces
 *
 * Nada inventado ni ilustrativo: todo sale del análisis publicado. Las otras señales van
 * sólo por su nombre, y sólo las de proceso: las que hablan de personas no se nombran en
 * la portada (quedan contadas). La evidencia completa está a un clic ("Ver lo que
 * encontró", panel §14.4) o en el análisis.
 *
 * Al entrar en pantalla la línea avanza y cada paso se enfoca cuando llega (una vez, sin
 * fijar la página). Sin movimiento, todo está completo desde el principio: el estado
 * atenuado lo pone GSAP, nunca el CSS.
 */

const PASOS: { Icono: LucideIcon; t: string }[] = [
  { Icono: FileText, t: "El Estado lo publica" },
  { Icono: Search, t: "Vigía lo lee" },
  { Icono: Scale, t: "Cita la ley" },
  { Icono: ExternalLink, t: "Tú lo compruebas" },
];

/** La tarjeta oscura de un paso (el paso 3 va en papel: es el hallazgo). */
const TARJETA = "rounded-2xl border border-paper/12 bg-paper/[0.04] p-4 sm:p-5";

export function CasoLeido({
  caso,
  regla,
  otras,
  leidos,
}: {
  caso: CasoPortada;
  regla: string | null;
  /** Las otras señales de proceso del contrato, sólo por su nombre. */
  otras: OtraSenal[];
  /** Los contratos que Vigía ya leyó: el número con que termina la sección de arriba. */
  leidos: number;
}) {
  const raiz = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(SIN_REDUCIR, () => {
        const capas = gsap.utils.toArray<HTMLElement>(".capa");
        const pasos = gsap.utils.toArray<HTMLElement>(".paso-marca");
        // Atenuadas, nunca ocultas: un hueco en blanco se lee como "no cargó".
        gsap.set(capas.slice(1), { opacity: 0.25, filter: "blur(3px)" });
        gsap.set(pasos.slice(1), { opacity: 0.45 });

        const tl = gsap.timeline({
          defaults: { ease: "power2.out" },
          scrollTrigger: { trigger: ".pasos-caso", start: "top 72%", once: true },
        });
        tl.fromTo(".pasos-linea-h", { scaleX: 0 }, { scaleX: 1, duration: 2.1, ease: "none" }, 0).fromTo(
          ".pasos-linea-v",
          { scaleY: 0 },
          { scaleY: 1, duration: 2.1, ease: "none" },
          0,
        );
        // El paso i se enfoca cuando la línea llega a él. Al terminar se limpia el filtro:
        // el panel de "Ver lo que encontró" vive dentro de una de estas capas.
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
  const totalSenales = caso.otrasSenales + 1;
  // Las que no se nombran (de personas o del documento) se cuentan, no se esconden.
  const nombradas = otras.slice(0, 4);
  const sinNombrar = Math.max(0, caso.otrasSenales - nombradas.length);

  return (
    <section
      ref={raiz}
      id="como"
      data-tema="oscuro"
      aria-labelledby="caso-titulo"
      className="sobre-oscuro relative scroll-mt-16 overflow-hidden border-t border-paper/10 bg-ink text-paper"
    >
      <div className="container-page relative py-16 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="min-w-0">
            <h2 id="caso-titulo" className="text-balance font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-5xl">
              ¿Pero cómo lo hizo?
            </h2>
            <p className="mt-3 text-pretty text-lg leading-relaxed text-paper/75">
              Así leyó uno de esos {numero(leidos)} contratos, de principio a fin.
            </p>
          </div>
          <p className="inline-flex items-center gap-2 rounded-full border border-paper/15 bg-paper/[0.05] px-3.5 py-1.5 text-[13.5px] text-paper/80">
            <Info size={15} className="shrink-0 text-maiz" aria-hidden />
            Una señal es para revisar, nunca una acusación.
          </p>
        </div>

        {/* ── Los cuatro pasos ── En columna en el celular (línea a la izquierda), en fila desde lg.
            La línea de lg va del centro del primer círculo al del último. */}
        <div className="pasos-caso relative mt-10">
          <span aria-hidden className="absolute bottom-5 left-5 top-5 w-0.5 -translate-x-1/2 rounded-full bg-paper/15 lg:hidden" />
          <span aria-hidden className="pasos-linea-v absolute bottom-5 left-5 top-5 w-0.5 -translate-x-1/2 origin-top rounded-full bg-maiz lg:hidden" />
          <span aria-hidden className="absolute left-5 right-[calc((100%_-_3.75rem)/4_-_1.25rem)] top-5 hidden h-0.5 rounded-full bg-paper/15 lg:block" />
          <span aria-hidden className="pasos-linea-h absolute left-5 right-[calc((100%_-_3.75rem)/4_-_1.25rem)] top-5 hidden h-0.5 origin-left rounded-full bg-maiz lg:block" />

          <ol className="relative grid gap-6 lg:grid-cols-4 lg:gap-5">
            <Paso n={1}>
              <div className={cn("capa", TARJETA)}>
                <p className="flex items-center gap-1.5 text-[12px] text-paper/60">
                  <FileText size={13} aria-hidden /> Contrato publicado en el SEACE
                </p>
                <p className="mt-2 line-clamp-2 font-display text-[16px] font-bold leading-snug" title={caso.entidad}>
                  {caso.entidad}
                </p>
                <p className="mt-1.5 line-clamp-3 text-[13.5px] leading-relaxed text-paper/70" title={caso.objeto}>
                  {caso.objeto}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-paper/10 pt-3.5">
                  {caso.monto && <Dato t="Monto" v={caso.monto} mono />}
                  {caso.fecha && <Dato t="Adjudicado" v={caso.fecha} />}
                  {caso.region && <Dato t="Provincia" v={caso.region} />}
                </dl>
              </div>
            </Paso>

            <Paso n={2}>
              <div className={cn("capa", TARJETA)}>
                <div className="grid grid-cols-2 gap-3">
                  <Cifra n={TOTAL_AGENTES} t="agentes" />
                  <Cifra n={TOTAL_PASOS} t="revisiones" />
                </div>
                <ul className="mt-4 space-y-2.5 border-t border-paper/10 pt-3.5 text-[13.5px] leading-snug">
                  <Hizo Icono={FileText}>Leyó el expediente completo</Hizo>
                  {caso.proveedor && (
                    <Hizo Icono={Building2}>
                      Investigó a la empresa ganadora,{" "}
                      <span className="font-semibold text-paper" title={caso.proveedor}>
                        {caso.proveedor}
                      </span>
                    </Hizo>
                  )}
                  <Hizo Icono={Search}>
                    Encontró <span className="font-semibold text-maiz">{plural(totalSenales, "señal", "señales")}</span>
                  </Hizo>
                </ul>
              </div>
            </Paso>

            <Paso n={3}>
              {/* El hallazgo, en papel: el foco vuelve a granate. */}
              <article className="capa sobre-claro overflow-hidden rounded-2xl bg-paper text-ink shadow-dialog">
                <div className={cn("p-4 sm:p-5", sev.fondo)}>
                  <Severidad bandera={caso.severidad} className="bg-paper" />
                  <h4 className="mt-2.5 text-balance font-display text-xl font-extrabold leading-tight">{titulo}</h4>
                  <p className="mt-1.5 line-clamp-3 text-[13.5px] leading-relaxed text-inkSoft">{caso.hallazgo}</p>
                </div>
                <div className="space-y-2.5 border-t border-line p-4 sm:px-5">
                  <p className="flex items-start gap-1.5 text-[13px] font-medium text-granate" title={caso.norma}>
                    <Scale size={14} className="mt-0.5 shrink-0" aria-hidden />
                    <span className="sr-only">La norma que cita: </span>
                    <span className="line-clamp-2">{caso.norma}</span>
                  </p>
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
              </article>
            </Paso>

            <Paso n={4}>
              <div className={cn("capa", TARJETA)}>
                {nombradas.length > 0 && (
                  <>
                    <p className="text-[12px] text-paper/60">Otras señales de este contrato</p>
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {nombradas.map((o) => (
                        <li
                          key={o.etiqueta}
                          className="inline-flex items-center gap-1.5 rounded-full border border-paper/15 px-2.5 py-1 text-[12.5px] text-paper/85"
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
                  <p className={cn("text-[12.5px] text-paper/60", nombradas.length > 0 && "mt-2")}>
                    {plural(sinNombrar, "señal más", "señales más")} en el análisis
                  </p>
                )}
                <div className={cn("flex flex-col gap-2", caso.otrasSenales > 0 && "mt-4 border-t border-paper/10 pt-4")}>
                  <Link
                    href={analisis}
                    className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-full bg-maiz px-4 text-[14px] font-semibold text-ink transition-colors duration-rapido hover:bg-maiz-soft"
                  >
                    Leer el análisis completo <ArrowUpRight size={15} aria-hidden />
                  </Link>
                  {caso.fuenteUrl && <FichaOficial href={caso.fuenteUrl} oscuro />}
                </div>
              </div>
            </Paso>
          </ol>
        </div>
      </div>
    </section>
  );
}

/** El punto de severidad de las otras señales, sobre oscuro (los mismos tonos que la pastilla). */
const PUNTO: Record<OtraSenal["severidad"], string> = { alta: "bg-rust", media: "bg-amber", baja: "bg-mute" };

/** Un paso: su marca en la línea (número e ícono), su título y su tarjeta. */
function Paso({ n, children }: { n: 1 | 2 | 3 | 4; children: React.ReactNode }) {
  const { Icono, t } = PASOS[n - 1];
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 lg:flex lg:flex-col">
      <span className="paso-marca relative z-[1] flex h-10 w-10 items-center justify-center rounded-full border border-maiz/60 bg-ink text-maiz">
        <Icono size={17} aria-hidden />
      </span>
      <div className="min-w-0 lg:flex lg:flex-1 lg:flex-col">
        <h3 className="flex min-h-[2.5rem] items-center gap-2 text-[15px] font-semibold lg:mt-3 lg:min-h-0">
          <span className="font-mono text-[12px] font-medium text-maiz">
            <span className="sr-only">Paso </span>
            {n}
          </span>
          {t}
        </h3>
        {/* Desde lg las cuatro tarjetas miden lo mismo: la fila se lee pareja. */}
        <div className="mt-2 lg:mt-3 lg:flex-1 lg:[&>*]:h-full">{children}</div>
      </div>
    </li>
  );
}

function Cifra({ n, t }: { n: number; t: string }) {
  return (
    <p>
      <span className="block font-display text-4xl font-extrabold leading-none tabular-nums text-maiz">{numero(n)}</span>
      <span className="mt-1 block text-[13px] text-paper/75">{t}</span>
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
      <dt className="text-[12px] text-paper/60">{t}</dt>
      <dd className={cn("mt-0.5 text-[14px] font-semibold leading-snug text-paper", mono && "font-mono tabular-nums")}>
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
        "inline-flex min-h-[32px] items-center gap-1.5 font-medium underline-offset-2 hover:underline",
        oscuro ? "justify-center text-[14px] text-paper/85" : "text-ink",
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
