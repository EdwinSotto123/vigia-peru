"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUpRight, CheckCircle2, Copy, Download, Eye, FileSearch, FileText, Sparkles } from "lucide-react";
import { Caja } from "@/components/gobserva/app/Caja";
import { cn } from "@/lib/utils";
import { urlDocumento, useBasesPlaza, type BasesPlaza, type LecturaBases } from "./datosPlaza";
import { VisorBases, abrirDocumento } from "./VisorBases";

const SIN_LECTURA: Record<NonNullable<BasesPlaza["sin_lectura"]>, string> = {
  tope: "Hoy ya leímos muchas bases: éstas las leemos en unas horas. Mientras, ábrelas aquí.",
  largas: "Son muy largas para leerlas por ti. Ábrelas aquí y busca tu puesto.",
  sin_pdf: "No pudimos bajarlas para leerlas (son muy pesadas o no son PDF). Ábrelas en la web de la entidad.",
  error: "No pudimos leerlas ahora; lo intentamos de nuevo en un rato. Mientras, ábrelas aquí.",
};

const PASOS_ESPERA = ["Buscando la convocatoria en la web de la entidad…", "Bajando las bases…", "Leyéndolas: toma unos segundos más…"];

/**
 * «Las bases» (2026-11-08): las buscamos en la web de la entidad, las guardamos y una IA las lee (GET
 * /empleo/plazas/:aviso/bases, lib/basesPlaza.ts). Cada documento se ve aquí mismo (VisorBases) o se descarga; en
 * pestañas, cómo te evalúan y el puesto. Lo que hay que hacer (el cronograma, por dónde se postula, qué presentar, lo
 * que te deja fuera) va arriba, en «Qué tienes que hacer». Sin bases,
 * el número para buscarlas (con botón para copiarlo) y la web de la entidad.
 */
export function LasBases({ aviso, numero, web, servir }: { aviso: number; numero: string | null; web: string | null; servir: string }) {
  const { data, isLoading } = useBasesPlaza(aviso);
  const [paso, setPaso] = useState(0);
  const [visor, setVisor] = useState<{ abierto: boolean; i: number }>({ abierto: false, i: 0 });
  useEffect(() => {
    if (!isLoading) return;
    const t1 = setTimeout(() => setPaso(1), 4000);
    const t2 = setTimeout(() => setPaso(2), 9000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isLoading]);

  if (!isLoading && data?.estado === "cerrada") return null;

  if (isLoading) {
    return (
      <Caja id="bases" titulo="Las bases" descripcion="Las buscamos en la web de la entidad y las leemos por ti. La primera vez toma hasta medio minuto.">
        <ol className="space-y-2" aria-busy="true" aria-live="polite">
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
      </Caja>
    );
  }

  if (!data || data.estado !== "encontradas" || !data.documentos.length) {
    return <SinBases numero={numero} web={web} servir={servir} aviso={aviso} error={!data || data.estado === "error"} />;
  }

  const l = data.lectura;
  const docs = data.documentos;
  return (
    <Caja
      id="bases"
      titulo="Las bases"
      descripcion={l ? "Las encontramos en la web de la entidad y las leímos por ti." : "Las encontramos en la web de la entidad."}
      pie={
        data.pagina ? (
          <a href={data.pagina} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 text-dato font-semibold text-granate underline-offset-4 hover:underline">
            La convocatoria en la web de la entidad <ArrowUpRight size={14} aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <ul className="grid gap-2" aria-label="Documentos de la convocatoria">
          {docs.map((d, i) => (
            <li key={d.url} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-paper px-3 py-2.5">
              <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-granate-50 text-granate">
                <FileText size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-dato font-semibold text-ink">{d.titulo}</p>
                <p className="flex flex-wrap items-center gap-x-3 text-rotulo text-mute">
                  {d.leido && (
                    <span className="inline-flex items-center gap-1 font-semibold text-granate">
                      <Sparkles size={11} aria-hidden /> Leído
                    </span>
                  )}
                  <a href={d.url} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
                    Original en la web de la entidad
                    <span className="sr-only"> (se abre en otra pestaña)</span>
                  </a>
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => abrirDocumento(d, () => setVisor({ abierto: true, i }))}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-granate px-3 text-meta font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"
                >
                  <Eye size={14} aria-hidden /> Ver
                  <span className="sr-only"> {d.titulo}</span>
                </button>
                {d.copia && (
                  <a
                    href={urlDocumento(d)}
                    download
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-caja px-3 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-ink/20"
                  >
                    <Download size={14} aria-hidden /> <span className="hidden sm:inline">Descargar</span>
                    <span className="sr-only sm:hidden">Descargar {d.titulo}</span>
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
        {!l && data.sin_lectura && <p className="text-pretty text-dato leading-relaxed text-inkSoft">{SIN_LECTURA[data.sin_lectura]}</p>}
        {l && <Pestanas lectura={l} />}
      </div>
      <VisorBases documentos={docs} inicial={visor.i} abierto={visor.abierto} onCerrar={() => setVisor((v) => ({ ...v, abierto: false }))} />
    </Caja>
  );
}

function SinBases({ numero, web, servir, aviso, error }: { numero: string | null; web: string | null; servir: string; aviso: number; error: boolean }) {
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => {
    if (!numero) return;
    try {
      await navigator.clipboard.writeText(numero);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin portapapeles: el número está a la vista */
    }
  };
  return (
    <Caja id="bases" titulo="Las bases">
      <div className="flex items-start gap-3">
        <FileSearch size={20} aria-hidden className="mt-0.5 shrink-0 text-mute" />
        <div className="min-w-0 flex-1">
          <p className="text-pretty text-dato leading-relaxed text-inkSoft">
            {error ? (
              <>
                <b className="font-semibold text-ink">No pudimos buscarlas ahora</b> (la web de la entidad no respondió). Lo intentamos de nuevo en un rato.
              </>
            ) : (
              <>
                <b className="font-semibold text-ink">No las encontramos en la web de la entidad.</b> Algunas entidades las ponen sólo en su sistema de postulación.
                Volvemos a buscarlas en unos días.
              </>
            )}
          </p>
          <p className="mt-3 text-meta font-semibold text-inkSoft">Búscalas tú con este número:</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="min-w-0 max-w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-meta font-semibold text-ink [overflow-wrap:anywhere]">
              {numero ?? `Aviso ${aviso}`}
            </code>
            {numero && (
              <button
                type="button"
                onClick={copiar}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-caja px-3 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-ink/20"
              >
                {copiado ? <CheckCircle2 size={14} aria-hidden className="text-mossTexto" /> : <Copy size={14} aria-hidden />}
                <span aria-live="polite">{copiado ? "Copiado" : "Copiar"}</span>
              </button>
            )}
          </div>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {web && (
              <a href={web} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 text-dato font-semibold text-granate underline-offset-4 hover:underline">
                Web de la entidad <ArrowUpRight size={14} aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
            )}
            <a href={servir} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 text-dato font-semibold text-granate underline-offset-4 hover:underline">
              Buscarla en SERVIR <ArrowUpRight size={14} aria-hidden />
              <span className="sr-only"> (aviso {aviso}, se abre en otra pestaña)</span>
            </a>
          </p>
        </div>
      </div>
    </Caja>
  );
}

function Pestanas({ lectura: l }: { lectura: LecturaBases }) {
  const id = useId();
  const pestanas = [
    { clave: "evaluacion", titulo: "Cómo te evalúan", n: l.evaluacion.length, contenido: <Evaluacion filas={l.evaluacion} /> },
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

function Evaluacion({ filas }: { filas: LecturaBases["evaluacion"] }) {
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

function ElPuesto({ lectura: l }: { lectura: LecturaBases }) {
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
