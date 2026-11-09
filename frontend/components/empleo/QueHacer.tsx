"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, Building2, CalendarClock, CheckCircle2, ClipboardList, Clock, Globe, Mail, ShieldCheck, type LucideIcon,
} from "lucide-react";
import { Caja } from "@/components/gobserva/app/Caja";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { fechasDe } from "@/lib/empleo-app/cumplo";
import { fechaDia } from "@/lib/empleo";
import { cn } from "@/lib/utils";
import { diasEntre, type MedioPostulacion } from "./datosPlaza";
import { cuandoEs, useFechaPostular } from "./usePlaza";

const MEDIO: Record<MedioPostulacion, { texto: string; Icono: LucideIcon }> = {
  en_linea: { texto: "En línea", Icono: Globe },
  correo: { texto: "Por correo", Icono: Mail },
  mesa_de_partes: { texto: "En mesa de partes", Icono: Building2 },
  plataforma: { texto: "En una plataforma", Icono: Globe },
  otro: { texto: "Cómo se postula", Icono: ClipboardList },
};

const DOCUMENTOS_DE_SIEMPRE = [
  "Tu CV documentado: copia simple de cada título, certificado y constancia que pruebe lo que piden.",
  "Las constancias de trabajo con fecha de inicio y fin: así cuentan tus años de experiencia.",
  "Tu DNI.",
  "Los anexos y declaraciones juradas, en los formatos de las bases, firmados.",
];

/** Enlaces y correos del texto, como enlaces. */
export function enlazar(texto: string): ReactNode[] {
  return texto.split(/(https?:\/\/[^\s,;)]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g).map((parte, i) => {
    if (i % 2 === 0) return parte;
    const limpio = parte.replace(/[.)]+$/, "");
    const resto = parte.slice(limpio.length);
    const href = limpio.includes("@") && !limpio.startsWith("http") ? `mailto:${limpio}` : limpio;
    return (
      <span key={i}>
        <a href={href} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-granate underline underline-offset-2">
          {limpio}
        </a>
        {resto}
      </span>
    );
  });
}

const CHIP = {
  urgente: "bg-crimson-soft text-crimsonTexto",
  aviso: "bg-amber-soft text-amberTexto",
  neutro: "bg-ink/[0.06] text-inkSoft",
  pasado: "bg-ink/[0.04] text-mute",
};

/**
 * «Cómo postular» (2026-11-08, el usuario: «sin decirte qué tienes que hacer exactamente»): los pasos de esta plaza y,
 * al costado, sus fechas. Con las bases leídas, la fecha en que se postula (la de las bases manda sobre la de SERVIR),
 * por dónde y cómo, lo que deja fuera a la gente, los documentos como lista para ir marcando y el cronograma entero con
 * el día de hoy en su lugar; sin ellas, lo de siempre con las fechas de SERVIR.
 */
export function QueHacer({
  aviso, numero, fechaFin, publicada, postular, servir, cerrada, parecidas,
}: {
  aviso: number;
  numero: string | null;
  fechaFin: string | null;
  publicada: string | null;
  postular: string | null;
  servir: string;
  cerrada: boolean;
  parecidas: string;
}) {
  const f = useFechaPostular(aviso, fechaFin);
  const { hoy, lectura: l, cronograma: cron, ip, desde: inicio, hasta: limite, difiere } = f;

  if (cerrada) {
    return (
      <Caja id="que-hacer" titulo="Esta plaza ya cerró">
        <p className="text-dato leading-relaxed text-inkSoft">
          Ya no recibe postulaciones. Puede haber otras iguales abiertas hoy:{" "}
          <Link href={parecidas} className="font-semibold text-granate underline-offset-4 hover:underline">ver plazas parecidas</Link>.
        </p>
      </Caja>
    );
  }

  const destino = postular ?? servir;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Caja
        id="que-hacer"
        titulo="Qué tienes que hacer"
        descripcion={
          f.cargando
            ? "Con lo que publicó la entidad. Buscamos sus bases para darte las fechas exactas."
            : l
              ? "Con lo que dicen las bases de la entidad. Lo leyó una IA: confírmalo en el documento."
              : "Con lo que publicó la entidad en SERVIR. Sus bases pueden pedir algo más."
        }
        pie={
          <p className="flex items-start gap-2 text-meta leading-relaxed text-inkSoft">
            <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
            Postular es siempre en la entidad y es gratis: nadie puede cobrarte por postular a una plaza del Estado.
          </p>
        }
      >
        <ol className="space-y-6">
          <Paso n={1} titulo="Junta tus documentos" fecha={limite && hoy ? <Chip texto={`Antes del ${fechaDia(inicio ?? limite)}`} tono="neutro" Icono={CalendarClock} /> : null}>
            {l?.documentos.length ? (
              <Documentos aviso={aviso} documentos={l.documentos} />
            ) : (
              <ul className="space-y-1.5">
                {DOCUMENTOS_DE_SIEMPRE.map((d) => (
                  <li key={d} className="flex items-start gap-2 text-dato leading-snug text-inkSoft">
                    <span aria-hidden className="mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full bg-mute" />
                    <span className="min-w-0">{d}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 rounded-lg bg-granate-50/60 px-3 py-2.5 text-meta leading-relaxed text-inkSoft">
              <b className="font-semibold text-ink">Puntaje extra por ley.</b> Si tienes una discapacidad acreditada (15%), eres licenciado de las Fuerzas Armadas (10%)
              o deportista calificado, decláralo y adjunta el documento que lo prueba.
            </p>
          </Paso>

          <Paso
            n={2}
            titulo={l?.como_postular ? `Postula ${MEDIO[l.como_postular.medio]?.texto.toLowerCase() ?? ""}`.trim() : "Postula en la entidad"}
            fecha={
              limite && hoy ? (
                <span className="flex flex-wrap items-center gap-1.5">
                  <Chip texto={ip >= 0 ? cron[ip].fecha : `Hasta el ${fechaDia(limite)}`} tono="neutro" Icono={CalendarClock} />
                  <Chip {...(f.abre && inicio ? cuandoEs(inicio, hoy, "abre") : cuandoEs(limite, hoy, "cierra"))} Icono={Clock} />
                </span>
              ) : null
            }
          >
            {l?.como_postular ? (
              <p className="max-w-[75ch] text-pretty text-dato leading-relaxed text-inkSoft [overflow-wrap:anywhere]">{enlazar(l.como_postular.detalle)}</p>
            ) : (
              <p className="text-pretty text-dato leading-relaxed text-inkSoft">
                Entra a la web de la entidad y busca la convocatoria {numero ? <b className="font-semibold text-ink">{numero}</b> : <>del aviso <b className="font-mono font-semibold text-ink">{aviso}</b></>}: ahí
                dice si se postula en línea, por correo o en mesa de partes.
              </p>
            )}
            {difiere && fechaFin && (
              <p className="mt-2 text-meta leading-relaxed text-mute">En SERVIR figura hasta el {fechaDia(fechaFin)}; vale la fecha de las bases.</p>
            )}
            {!!l?.ojo.length && (
              <div className="mt-3 rounded-xl border border-amber/30 bg-amber-soft/40 p-3.5">
                <p className="flex items-center gap-2 text-dato font-semibold text-ink">
                  <AlertTriangle size={15} aria-hidden className="text-amberTexto" /> Para que no te dejen fuera
                </p>
                <ul className="mt-1.5 space-y-1">
                  {l.ojo.map((o) => (
                    <li key={o} className="text-dato leading-relaxed text-inkSoft">{o}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="mt-3">
              <a href={destino} target="_blank" rel="noopener noreferrer" className={claseAccion("primario")}>
                {postular ? "Ir a postular en la entidad" : "Buscarla en SERVIR"} <ArrowUpRight size={15} aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            </div>
          </Paso>

          <Paso n={3} titulo="Espera los resultados">
            <p className="text-pretty text-dato leading-relaxed text-inkSoft">
              Primero revisan tu CV contra el perfil; quien pasa sigue a {l?.evaluacion.length ? "las siguientes etapas" : "una entrevista"}. Los resultados se publican en
              la web de la entidad, en las fechas de su cronograma.
              {l?.evaluacion.length ? (
                <>
                  {" "}
                  Cómo te evalúan, en la pestaña <a href="#evaluacion" className="font-semibold text-granate underline-offset-4 hover:underline">Bases</a>.
                </>
              ) : null}
            </p>
          </Paso>
        </ol>
      </Caja>

      <Fechas f={f} fechaFin={fechaFin} publicada={publicada} />
    </div>
  );
}

/**
 * Las fechas de la plaza: el cronograma de las bases entero (la etapa en que postulas resaltada, lo pasado tachado y el
 * día de hoy en su lugar) o, sin bases, la publicación y el cierre de SERVIR.
 */
function Fechas({ f, fechaFin, publicada }: { f: ReturnType<typeof useFechaPostular>; fechaFin: string | null; publicada: string | null }) {
  const { hoy, cronograma: cron, ip, anio } = f;
  const filas: { etapa: string; fecha: string; postulas: boolean; paso: boolean }[] = cron.length
    ? cron.map((x, i) => {
        const fechas = hoy ? fechasDe(x.fecha, anio) : null;
        return { etapa: x.etapa, fecha: x.fecha, postulas: i === ip, paso: !!(fechas && hoy && diasEntre(hoy, fechas.hasta) < 0) };
      })
    : [
        ...(publicada ? [{ etapa: "Publicación en SERVIR", fecha: fechaDia(publicada), postulas: false, paso: !!(hoy && diasEntre(hoy, publicada) < 0) }] : []),
        ...(fechaFin ? [{ etapa: "Último día para postular", fecha: fechaDia(fechaFin), postulas: true, paso: !!(hoy && diasEntre(hoy, fechaFin) < 0) }] : []),
      ];
  // El día de hoy va antes de la primera etapa que todavía no pasa (si alguna ya pasó).
  const iHoy = hoy && filas.some((x) => x.paso) ? filas.findIndex((x) => !x.paso) : -1;
  return (
    <Caja
      id="fechas"
      titulo="Las fechas"
      descripcion={cron.length ? "El cronograma de las bases." : "Las de SERVIR. El cronograma completo está en las bases."}
      pie={<p className="text-meta leading-relaxed text-inkSoft">Con «Guardar» la llevas en tu tablero y tu calendario, y te avisamos antes de que cierre.</p>}
    >
      {f.cargando ? (
        <div aria-hidden className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="block h-10 animate-pulse rounded-lg bg-ink/[0.05]" />
          ))}
        </div>
      ) : filas.length ? (
        <ol className="space-y-1">
          {filas.map((x, i) => (
            <li key={`${x.etapa}-${i}`}>
              {i === iHoy && hoy && (
                <p className="mb-1 flex items-center gap-2 py-1">
                  <span aria-hidden className="h-px flex-1 bg-granate/60" />
                  <span className="rounded-md bg-granate px-2 py-0.5 text-rotulo font-semibold text-paper">Hoy, {fechaDia(hoy)}</span>
                  <span aria-hidden className="h-px flex-1 bg-granate/60" />
                </p>
              )}
              <div className={cn("grid grid-cols-[0.875rem_minmax(0,1fr)] gap-3 rounded-xl px-2.5 py-2", x.postulas && "bg-granate-50/70")}>
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 block h-3.5 w-3.5 rounded-full border-2",
                    x.postulas ? "border-granate bg-granate" : x.paso ? "border-line bg-caja" : "border-ink/30 bg-caja",
                  )}
                />
                <div className="min-w-0">
                  <p className={cn("text-meta font-semibold tabular-nums", x.paso ? "text-mute line-through" : "text-ink")}>{x.fecha}</p>
                  <p className={cn("text-dato leading-snug", x.paso ? "text-mute" : "text-inkSoft")}>{x.etapa}</p>
                  {x.postulas && <p className="mt-1 text-rotulo font-semibold text-granate">Aquí postulas</p>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-pretty text-dato leading-relaxed text-inkSoft">SERVIR no trae fechas para esta plaza: búscalas en las bases de la entidad.</p>
      )}
    </Caja>
  );
}

export function Chip({ texto, tono, Icono }: { texto: string; tono: keyof typeof CHIP; Icono?: LucideIcon }) {
  return (
    <span className={cn("inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 text-rotulo font-semibold", CHIP[tono])}>
      {Icono && <Icono size={12} aria-hidden className="shrink-0" />}
      <span className="min-w-0">{texto}</span>
    </span>
  );
}

function Paso({ n, titulo, fecha, children }: { n: number; titulo: string; fecha?: ReactNode; children: ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
      <span aria-hidden className="grid h-8 w-8 place-items-center rounded-full bg-granate font-mono text-meta font-bold text-paper">{n}</span>
      <div className="min-w-0 pt-0.5">
        <h3 className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="text-cuerpo font-semibold leading-snug text-ink">{titulo}</span>
          {fecha}
        </h3>
        <div className="mt-2">{children}</div>
      </div>
    </li>
  );
}

/** Lo que piden presentar las bases, como lista para ir marcando (en este navegador). */
function Documentos({ aviso, documentos }: { aviso: number; documentos: string[] }) {
  const clave = `gobserva-empleo:documentos:${aviso}`;
  const [listos, setListos] = useState<string[]>([]);
  useEffect(() => {
    try {
      const v = JSON.parse(window.localStorage.getItem(clave) ?? "[]");
      if (Array.isArray(v)) setListos(v.filter((x) => typeof x === "string"));
    } catch {
      /* sin almacenamiento */
    }
  }, [clave]);
  const alternar = (d: string) =>
    setListos((xs) => {
      const n = xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d];
      try {
        window.localStorage.setItem(clave, JSON.stringify(n));
      } catch {
        /* igual */
      }
      return n;
    });
  const hechos = documentos.filter((d) => listos.includes(d)).length;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-paper">
      <p className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-2 text-meta">
        <span className="font-semibold text-ink" aria-live="polite">
          {hechos} de {documentos.length} listos
        </span>
        <span className="text-rotulo text-mute">Márcalos cuando los tengas</span>
      </p>
      <ul className="divide-y divide-line">
        {documentos.map((d) => {
          const ok = listos.includes(d);
          return (
            <li key={d}>
              <button
                type="button"
                role="checkbox"
                aria-checked={ok}
                onClick={() => alternar(d)}
                className="flex min-h-11 w-full items-start gap-3 px-3.5 py-2.5 text-left transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
              >
                {ok ? (
                  <CheckCircle2 size={18} aria-hidden className="mt-px shrink-0 text-mossTexto" />
                ) : (
                  <span aria-hidden className="mt-0.5 block h-[1.125rem] w-[1.125rem] shrink-0 rounded-md border-2 border-line bg-caja" />
                )}
                <span className={cn("min-w-0 text-dato leading-snug", ok ? "text-mute line-through" : "text-ink")}>{d}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
