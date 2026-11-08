"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import useSWR from "swr";
import {
  AlertTriangle, ArrowUpRight, Building2, CalendarDays, CheckCircle2, ClipboardList, FileSearch, FileText, Globe, Mail, Sparkles, Target,
} from "lucide-react";
import { Caja } from "@/components/gobserva/app/Caja";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { cn } from "@/lib/utils";

type Medio = "en_linea" | "correo" | "mesa_de_partes" | "plataforma" | "otro";

interface Lectura {
  funciones: string[];
  requisitos_extra: string[];
  cronograma: { etapa: string; fecha: string; postulas?: boolean }[];
  evaluacion: { etapa: string; como: string }[];
  documentos: string[];
  como_postular: { medio: Medio; detalle: string } | null;
  condiciones: string[];
  ojo: string[];
}

interface Bases {
  estado: "encontradas" | "no_encontradas" | "cerrada" | "error";
  pagina: string | null;
  documentos: { titulo: string; url: string; copia: string | null; leido: boolean }[];
  lectura: Lectura | null;
  sin_lectura: "tope" | "largas" | "sin_pdf" | "error" | null;
}

async function cargar(aviso: number): Promise<Bases | null> {
  const r = await fetch(`${PUBLIC_API_BASE}/empleo/plazas/${aviso}/bases`);
  if (!r.ok) return null;
  return (await r.json()) as Bases;
}

const MEDIO: Record<Medio, { texto: string; Icono: typeof Globe }> = {
  en_linea: { texto: "En línea", Icono: Globe },
  correo: { texto: "Por correo", Icono: Mail },
  mesa_de_partes: { texto: "Mesa de partes", Icono: Building2 },
  plataforma: { texto: "En una plataforma", Icono: Globe },
  otro: { texto: "Cómo se postula", Icono: ClipboardList },
};

const SIN_LECTURA: Record<NonNullable<Bases["sin_lectura"]>, string> = {
  tope: "Hoy ya leímos muchas bases: estas las leemos en unas horas. Mientras, ábrelas desde aquí.",
  largas: "Son muy largas para leerlas aquí. Ábrelas desde aquí y busca tu puesto.",
  sin_pdf: "No pudimos bajarlas para leerlas (son muy pesadas o no son PDF). Ábrelas desde aquí.",
  error: "No pudimos leerlas ahora; lo intentamos de nuevo en un rato. Mientras, ábrelas desde aquí.",
};

/** Enlaces y correos del texto, como enlaces. */
function enlazar(texto: string): ReactNode[] {
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

const POSTULACION =
  /postula|presentaci[oó]n (del |de (la )?)?(expediente|cv|hoja|ficha|documentos|propuesta)|expediente virtual|inscripci[oó]n|recepci[oó]n de (expedientes|documentos|cv|hojas?)|registro de (la )?(hoja de vida|ficha|cv|postulantes?)|env[ií]o (del |de (la )?)?(cv|expediente|hoja|ficha|documentos)/i;

const PASOS_ESPERA = ["Buscando la convocatoria en la web de la entidad…", "Bajando las bases…", "Leyéndolas: toma unos segundos más…"];

/**
 * «Las bases, leídas» (2026-11-08, el usuario: «¿por qué nosotros no descargamos? ¿resumimos bases y demás?»): buscamos
 * las bases en la web de la entidad, las guardamos y Haiku las lee (GET /empleo/plazas/:aviso/bases, lib/basesPlaza.ts).
 * Arriba, los documentos y cómo se postula; en pestañas, el cronograma (con el día en que se postula marcado), la
 * evaluación, qué presentar y el puesto; al pie, lo que deja fuera a la gente. La primera vez tarda hasta medio minuto.
 */
export function LasBases({ aviso, numero }: { aviso: number; numero: string | null }) {
  const { data, isLoading } = useSWR(["empleo-bases", aviso], () => cargar(aviso), { revalidateOnFocus: false, shouldRetryOnError: false });
  const [paso, setPaso] = useState(0);
  useEffect(() => {
    if (!isLoading) return;
    const t1 = setTimeout(() => setPaso(1), 4000);
    const t2 = setTimeout(() => setPaso(2), 9000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isLoading]);

  // «error»: no pudimos buscar (la web de la entidad o el relay de Lima no respondieron); se reintenta en 2 horas.
  if (!isLoading && (!data || data.estado === "cerrada" || data.estado === "error")) return null;

  if (isLoading || !data) {
    return (
      <Caja id="bases" titulo="Las bases, leídas" descripcion="Las buscamos en la web de la entidad y las leemos por ti. La primera vez toma hasta medio minuto.">
        <div aria-busy="true" aria-live="polite">
          <ol className="space-y-2">
            {PASOS_ESPERA.map((t, i) => (
              <li key={t} className={cn("flex items-center gap-2 text-meta", i <= paso ? "text-ink" : "text-mute")}>
                {i < paso ? (
                  <CheckCircle2 size={14} aria-hidden className="text-granate" />
                ) : i === paso ? (
                  <Sparkles size={14} aria-hidden className="animate-pulse text-granate" />
                ) : (
                  <span aria-hidden className="block h-3.5 w-3.5 rounded-full border border-line" />
                )}
                {t}
              </li>
            ))}
          </ol>
        </div>
      </Caja>
    );
  }

  if (data.estado !== "encontradas") {
    return (
      <section id="bases" aria-label="Las bases" className="flex items-start gap-3 rounded-2xl border border-dashed border-line bg-paper px-4 py-3.5">
        <FileSearch size={18} aria-hidden className="mt-0.5 shrink-0 text-mute" />
        <p className="text-pretty text-dato leading-relaxed text-inkSoft">
          <b className="font-semibold text-ink">No encontramos las bases publicadas en la web de la entidad.</b> Algunas las ponen sólo en su sistema de
          postulación. {numero ? <>Búscalas con el número <b className="font-semibold text-ink">{numero}</b>.</> : null} Volvemos a buscarlas en unos días.
        </p>
      </section>
    );
  }

  const l = data.lectura;
  return (
    <Caja
      id="bases"
      titulo="Las bases, leídas"
      descripcion={l ? "Las encontramos en la web de la entidad y las leímos por ti. Lo escribe una IA: confírmalo en el documento antes de postular." : "Las encontramos en la web de la entidad."}
      pie={
        data.pagina ? (
          <a href={data.pagina} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 text-dato font-semibold text-granate underline-offset-4 hover:underline">
            Ver la convocatoria en la web de la entidad <ArrowUpRight size={14} aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <Documentos documentos={data.documentos} />
        {!l && data.sin_lectura && <p className="text-pretty text-dato leading-relaxed text-inkSoft">{SIN_LECTURA[data.sin_lectura]}</p>}
        {l?.como_postular && <ComoPostular medio={l.como_postular.medio} detalle={l.como_postular.detalle} />}
        {l && <Pestanas lectura={l} />}
        {l && l.ojo.length > 0 && (
          <div className="rounded-xl border border-amber/30 bg-amber-soft/40 p-4">
            <h3 className="flex items-center gap-2 text-cuerpo font-semibold text-ink">
              <AlertTriangle size={16} aria-hidden className="text-amberTexto" /> Lo que las bases dicen que te deja fuera
            </h3>
            <ul className="mt-2 space-y-1.5">
              {l.ojo.map((o) => (
                <li key={o} className="text-dato leading-relaxed text-inkSoft">{o}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Caja>
  );
}

function Documentos({ documentos }: { documentos: Bases["documentos"] }) {
  if (!documentos.length) return null;
  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label="Documentos de la convocatoria">
      {documentos.map((d) => {
        const abrir = d.copia ? `${PUBLIC_API_BASE}${d.copia}` : d.url;
        return (
          <li key={d.url} className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5">
            <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-granate-50 text-granate">
              <FileText size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <a href={abrir} target="_blank" rel="noopener noreferrer" className="block truncate text-dato font-semibold text-ink underline-offset-2 hover:underline">
                {d.titulo}
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
              <p className="flex flex-wrap items-center gap-x-3 text-rotulo text-mute">
                {d.leido && (
                  <span className="inline-flex items-center gap-1 font-semibold text-granate">
                    <Sparkles size={11} aria-hidden /> Leído
                  </span>
                )}
                {d.copia ? (
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                    Original en la web de la entidad
                  </a>
                ) : (
                  <span>En la web de la entidad</span>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ComoPostular({ medio, detalle }: { medio: Medio; detalle: string }) {
  const { texto, Icono } = MEDIO[medio] ?? MEDIO.otro;
  return (
    <div className="rounded-xl border border-granate/25 bg-granate-50/50 p-4">
      <h3 className="flex flex-wrap items-center gap-2 text-cuerpo font-semibold text-ink">
        <Target size={16} aria-hidden className="text-granate" /> Cómo se postula
        <span className="inline-flex items-center gap-1 rounded-full bg-caja px-2.5 py-0.5 text-rotulo font-semibold text-granate">
          <Icono size={12} aria-hidden /> {texto}
        </span>
      </h3>
      <p className="mt-2 max-w-[75ch] text-pretty text-dato leading-relaxed text-inkSoft [overflow-wrap:anywhere]">{enlazar(detalle)}</p>
    </div>
  );
}

function Pestanas({ lectura: l }: { lectura: Lectura }) {
  const id = useId();
  const pestanas = [
    { clave: "cronograma", titulo: "Cronograma", n: l.cronograma.length, contenido: <Cronograma filas={l.cronograma} /> },
    { clave: "evaluacion", titulo: "Evaluación", n: l.evaluacion.length, contenido: <Evaluacion filas={l.evaluacion} /> },
    { clave: "documentos", titulo: "Qué presentar", n: l.documentos.length, contenido: <QuePresentar filas={l.documentos} /> },
    {
      clave: "puesto",
      titulo: "El puesto",
      n: l.funciones.length + l.requisitos_extra.length + l.condiciones.length,
      contenido: <ElPuesto lectura={l} />,
    },
  ].filter((p) => p.n > 0);
  const [elegida, setElegida] = useState(pestanas[0]?.clave);
  const botones = useRef<(HTMLButtonElement | null)[]>([]);
  if (!pestanas.length) return null;
  const actual = pestanas.find((p) => p.clave === elegida) ?? pestanas[0];
  const mover = (e: KeyboardEvent, i: number) => {
    const destino = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? pestanas.length - 1 : null;
    if (destino == null) return;
    e.preventDefault();
    const j = (destino + pestanas.length) % pestanas.length;
    setElegida(pestanas[j].clave);
    botones.current[j]?.focus();
  };
  return (
    <div>
      <div role="tablist" aria-label="Lo que dicen las bases" className="flex gap-1 overflow-x-auto rounded-lg bg-ink/[0.06] p-1 [scrollbar-width:none]">
        {pestanas.map((p, i) => {
          const activa = p.clave === actual.clave;
          return (
            <button
              key={p.clave}
              ref={(el) => {
                botones.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${id}-t-${p.clave}`}
              aria-selected={activa}
              aria-controls={`${id}-p-${p.clave}`}
              tabIndex={activa ? 0 : -1}
              onClick={() => setElegida(p.clave)}
              onKeyDown={(e) => mover(e, i)}
              className={cn(
                "inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-meta font-semibold transition-colors duration-rapido",
                activa ? "bg-caja text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink",
              )}
            >
              {p.titulo}
              <span className={cn("rounded-full px-1.5 text-rotulo tabular-nums", activa ? "bg-granate-50 text-granate" : "bg-ink/[0.06] text-mute")}>{p.n}</span>
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${id}-p-${actual.clave}`} aria-labelledby={`${id}-t-${actual.clave}`} tabIndex={0} className="mt-4 focus-visible:outline-none">
        {actual.contenido}
      </div>
    </div>
  );
}

function Cronograma({ filas }: { filas: Lectura["cronograma"] }) {
  // La etapa que marcó el modelo; en las lecturas de antes (sin `postulas`), la que lo dice con palabras.
  const marcada = filas.findIndex((f) => f.postulas);
  const iPostula = marcada >= 0 ? marcada : filas.findIndex((f) => POSTULACION.test(f.etapa));
  return (
    <ol className="relative space-y-0">
      {filas.map((f, i) => {
        const postula = i === iPostula;
        return (
          <li key={`${f.etapa}-${i}`} className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 pb-3.5 last:pb-0">
            {i < filas.length - 1 && <span aria-hidden className="absolute left-[0.5625rem] top-5 h-[calc(100%-0.75rem)] w-px bg-line" />}
            <span aria-hidden className={cn("relative mt-1 grid h-5 w-5 place-items-center rounded-full border", postula ? "border-granate bg-granate text-paper" : "border-line bg-caja")}>
              {postula ? <Target size={11} /> : <span className="block h-1.5 w-1.5 rounded-full bg-mute" />}
            </span>
            <div className={cn("min-w-0", postula && "rounded-lg bg-granate-50/60 px-3 py-2")}>
              <p className="flex items-start gap-2 text-meta font-semibold tabular-nums text-ink">
                <CalendarDays size={13} aria-hidden className="mt-[0.2rem] shrink-0 text-mute" />
                <span className="min-w-0">
                  {f.fecha}
                  {postula && <span className="ml-2 inline-block rounded-full bg-granate px-2 py-px align-middle text-rotulo font-semibold text-paper">Aquí postulas</span>}
                </span>
              </p>
              <p className="mt-0.5 text-pretty text-dato leading-snug text-inkSoft">{f.etapa}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Evaluacion({ filas }: { filas: Lectura["evaluacion"] }) {
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {filas.map((f) => (
        <li key={f.etapa} className="grid gap-1 px-3.5 py-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:gap-4">
          <p className="text-dato font-semibold leading-snug text-ink">{f.etapa}</p>
          <p className="text-pretty text-dato leading-relaxed text-inkSoft">{f.como}</p>
        </li>
      ))}
    </ul>
  );
}

function QuePresentar({ filas }: { filas: string[] }) {
  return (
    <ol className="space-y-2">
      {filas.map((f, i) => (
        <li key={f} className="flex items-start gap-3 text-dato leading-snug text-ink">
          <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-paperDeep text-rotulo font-semibold tabular-nums text-inkSoft">{i + 1}</span>
          <span className="min-w-0 pt-0.5">{f}</span>
        </li>
      ))}
    </ol>
  );
}

function ElPuesto({ lectura: l }: { lectura: Lectura }) {
  return (
    <div className="space-y-5">
      {l.funciones.length > 0 && (
        <div>
          <h3 className="text-cuerpo font-semibold text-ink">Lo que harás</h3>
          <ul className="mt-2 space-y-1.5">
            {l.funciones.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-dato leading-snug text-ink">
                <CheckCircle2 size={15} aria-hidden className="mt-0.5 shrink-0 text-granate" />
                <span className="min-w-0">{f}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {l.requisitos_extra.length > 0 && (
        <div>
          <h3 className="text-cuerpo font-semibold text-ink">Además de lo de SERVIR, las bases piden</h3>
          <ul className="mt-2 space-y-1.5">
            {l.requisitos_extra.map((f) => (
              <li key={f} className="text-dato leading-relaxed text-inkSoft">{f}</li>
            ))}
          </ul>
        </div>
      )}
      {l.condiciones.length > 0 && (
        <div>
          <h3 className="text-cuerpo font-semibold text-ink">Condiciones</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {l.condiciones.map((c) => (
              <li key={c} className="rounded-full border border-line bg-paper px-3 py-1 text-meta text-inkSoft">{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
