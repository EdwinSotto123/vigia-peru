"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowUpRight, Building2, CalendarClock, CheckCircle2, ClipboardList, Clock, Globe, Mail, ShieldCheck, type LucideIcon,
} from "lucide-react";
import { Caja } from "@/components/gobserva/app/Caja";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { etapaDePostular, fechasDe } from "@/lib/empleo-app/cumplo";
import { fechaDia } from "@/lib/empleo";
import { cn } from "@/lib/utils";
import { diasEntre, hoyEnLima, useBasesPlaza, type MedioPostulacion } from "./datosPlaza";

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

/** «Cierra hoy», «Cierra mañana», «Abre en 5 días», «Ya cerró»: cuánto falta para abrir o cerrar la postulación. */
function cuandoEs(fecha: string, hoy: string, que: "abre" | "cierra"): { texto: string; tono: "urgente" | "aviso" | "neutro" | "pasado" } {
  const d = diasEntre(hoy, fecha);
  const verbo = que === "abre" ? "Abre" : "Cierra";
  if (d < 0) return { texto: que === "abre" ? "Ya abrió" : "Ya cerró", tono: "pasado" };
  if (d === 0) return { texto: `${verbo} hoy`, tono: "urgente" };
  if (d === 1) return { texto: `${verbo} mañana`, tono: que === "abre" ? "aviso" : "urgente" };
  return { texto: `${verbo} en ${d} días`, tono: d <= 3 ? "aviso" : "neutro" };
}

const CHIP = {
  urgente: "bg-crimson-soft text-crimsonTexto",
  aviso: "bg-amber-soft text-amberTexto",
  neutro: "bg-ink/[0.06] text-inkSoft",
  pasado: "bg-ink/[0.04] text-mute",
};

/**
 * «Qué tienes que hacer» (2026-11-08, el usuario: «sin decirte qué tienes que hacer exactamente»): los pasos de esta
 * plaza con sus fechas. Con las bases leídas, la fecha en que se postula (la de las bases manda sobre la de SERVIR), por
 * dónde y cómo, lo que deja fuera a la gente, los documentos como lista para ir marcando y las etapas que siguen; sin
 * ellas, lo de siempre con la fecha de cierre de SERVIR.
 */
export function QueHacer({
  aviso, numero, fechaFin, postular, servir, cerrada, parecidas,
}: {
  aviso: number;
  numero: string | null;
  fechaFin: string | null;
  postular: string | null;
  servir: string;
  cerrada: boolean;
  parecidas: string;
}) {
  const { data, isLoading } = useBasesPlaza(aviso);
  const [hoy, setHoy] = useState<string | null>(null);
  useEffect(() => setHoy(hoyEnLima()), []);

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

  const l = data?.estado === "encontradas" ? data.lectura : null;
  const cron = l?.cronograma ?? [];
  const ip = etapaDePostular(cron);
  const anio = Number((hoy ?? "2026").slice(0, 4));
  const fp = ip >= 0 ? fechasDe(cron[ip].fecha, anio) : null;
  const limite = fp?.hasta ?? fechaFin;
  const difiere = !!(fp && fechaFin && fp.hasta !== fechaFin);
  const siguen = ip >= 0 ? cron.slice(ip + 1) : cron.filter((f) => !/convocatoria|publicaci[oó]n de la convocatoria|difusi[oó]n|registro en el portal/i.test(f.etapa));
  const destino = postular ?? servir;

  return (
    <Caja
      id="que-hacer"
      titulo="Qué tienes que hacer"
      descripcion={
        isLoading
          ? "Con lo que publicó la entidad. Buscamos sus bases para darte las fechas exactas."
          : l
            ? "Con lo que dicen las bases de la entidad. Lo leyó una IA: confírmalo en el documento."
            : "Con lo que publicó la entidad en SERVIR. Sus bases pueden pedir algo más."
      }
    >
      <ol className="space-y-6">
        <Paso n={1} titulo="Junta tus documentos" fecha={limite && hoy ? <Chip texto={`Antes del ${fechaDia(fp?.desde ?? limite)}`} tono="neutro" Icono={CalendarClock} /> : null}>
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
                <Chip {...(fp && diasEntre(hoy, fp.desde) > 0 ? cuandoEs(fp.desde, hoy, "abre") : cuandoEs(limite, hoy, "cierra"))} Icono={Clock} />
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
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <a href={destino} target="_blank" rel="noopener noreferrer" className={claseAccion("primario")}>
              {postular ? "Ir a postular en la entidad" : "Buscarla en SERVIR"} <ArrowUpRight size={15} aria-hidden />
              <span className="sr-only"> (se abre en otra pestaña)</span>
            </a>
            <span className="text-meta text-mute">Es gratis: nadie puede cobrarte por postular a una plaza del Estado.</span>
          </div>
        </Paso>

        <Paso n={3} titulo="Lo que sigue">
          {siguen.length ? (
            <ol className="space-y-2">
              {siguen.map((f, i) => {
                const fechas = hoy ? fechasDe(f.fecha, anio) : null;
                const paso = !!(fechas && hoy && diasEntre(hoy, fechas.hasta) < 0);
                return (
                  <li key={`${f.etapa}-${i}`} className="grid grid-cols-[minmax(0,1fr)] gap-0.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:gap-3">
                    <span className={cn("text-meta font-semibold tabular-nums", paso ? "text-mute line-through" : "text-ink")}>{f.fecha}</span>
                    <span className={cn("text-dato leading-snug", paso ? "text-mute" : "text-inkSoft")}>{f.etapa}</span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-pretty text-dato leading-relaxed text-inkSoft">
              Primero revisan tu CV contra el perfil; quien pasa va a una entrevista. Algunas entidades suman un examen de conocimientos. Los resultados se
              publican en la web de la entidad, en las fechas de su cronograma.
            </p>
          )}
          <p className="mt-3 text-meta leading-relaxed text-mute">Con «Guardar» la llevas en tu tablero y tu calendario, y te avisamos antes de que cierre.</p>
        </Paso>
      </ol>
      <p className="mt-5 flex items-start gap-2 rounded-lg bg-ink/[0.035] px-3 py-2.5 text-meta leading-relaxed text-inkSoft">
        <ShieldCheck size={15} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
        Postular es siempre en la entidad. Gobserva no recibe postulaciones.
      </p>
    </Caja>
  );
}

function Chip({ texto, tono, Icono }: { texto: string; tono: keyof typeof CHIP; Icono?: LucideIcon }) {
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
