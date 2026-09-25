"use client";

/**
 * Las piezas con las que se lee un nodo del recorrido, en los dos modos: "Recibió", "Hizo" y
 * "Entregó", la fila de un paso (con su dato crudo a un clic) y las listas plegables. El panel
 * del grafo las usa completas; las tarjetas del modo Texto, compactas.
 *
 * Todo texto que viene de la traza pasa por `TextoSeguro` (datos personales en vidrio).
 */

import { useState, type ReactNode } from "react";
import { AlertCircle, ArrowDownRight, Bot, ClipboardCheck, Cog, CornerDownRight, Sparkles, Wrench } from "lucide-react";
import { Severidad } from "@/components/ui/Severidad";
import { Ayuda } from "@/components/patrones/Ayuda";
import { reglaLabel } from "@/lib/auditoria";
import { numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import type { ApiResult } from "../types";
import type { NodoTraza, Paso, Recorrido } from "./modelo";
import { entregaDe, recepcionDe, todosLosPasos, trabajoDe } from "./nodos";
import { accionDe, agruparPasos, lineasDeArgs, lineasDeEntrada, lineasDeResultado, type Linea } from "./pasos";
import { JsonSeguro, TextoSeguro } from "./redaccion";

export const ICONO_TIPO: Record<NodoTraza["tipo"], typeof Bot> = { agente: Bot, codigo: Cog, control: ClipboardCheck };

// ─── Listas y líneas ─────────────────────────────────────────────────────

/** Una lista que muestra las primeras `visibles` y pliega el resto. */
export function ListaPlegable({ items, visibles = 3, className }: { items: string[]; visibles?: number; className?: string }) {
  const [todas, setTodas] = useState(false);
  if (!items.length) return null;
  const mostradas = todas ? items : items.slice(0, visibles);
  return (
    <span className={cn("mt-1 block", className)}>
      <span className="block space-y-0.5">
        {mostradas.map((x, i) => (
          <span key={i} className="block break-words border-l-2 border-line pl-2 text-[12px] leading-snug text-inkSoft">
            <TextoSeguro texto={x} />
          </span>
        ))}
      </span>
      {items.length > visibles && (
        <button
          type="button"
          onClick={() => setTodas((v) => !v)}
          className="mt-0.5 rounded text-[12px] font-medium text-granate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50"
        >
          {todas ? "Mostrar menos" : `y ${numero(items.length - visibles)} más`}
        </button>
      )}
    </span>
  );
}

/** Un texto largo del backend (síntesis, instrucción): tres líneas y el resto a un clic. */
export function CitaLarga({ texto, fuente }: { texto: string; fuente?: string }) {
  const [entera, setEntera] = useState(false);
  const larga = texto.length > 240;
  return (
    <span className="block rounded-r-xl border-l-2 border-granate/40 bg-paperSoft px-3 py-2">
      <span className={cn("block whitespace-pre-line text-[12.5px] leading-relaxed text-ink", !entera && larga && "line-clamp-3")}>
        <TextoSeguro texto={texto} />
      </span>
      {(larga || fuente) && (
        <span className="mt-1 flex flex-wrap items-center gap-x-3 text-[11.5px] text-mute">
          {fuente && <span>{fuente}</span>}
          {larga && (
            <button type="button" onClick={() => setEntera((v) => !v)} className="font-medium text-granate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50">
              {entera ? "Ver menos" : "Leer completo"}
            </button>
          )}
        </span>
      )}
    </span>
  );
}

const TONO: Record<NonNullable<Linea["tono"]>, string> = {
  neutro: "text-ink",
  hallazgo: "font-semibold text-ink",
  error: "text-crimsonTexto",
  tenue: "text-mute",
};

export function Lineas({ lineas, className }: { lineas: Linea[]; className?: string }) {
  if (!lineas.length) return null;
  return (
    <ul className={cn("space-y-1 text-[12.5px] leading-snug", className)}>
      {lineas.map((l, i) => (
        <li key={i} className={cn("min-w-0 break-words", TONO[l.tono ?? "neutro"])}>
          {l.cita ? (
            <CitaLarga texto={l.texto} />
          ) : (
            <span className="flex items-start gap-1">
              {l.tono === "error" && <AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden />}
              <span className="min-w-0">
                <TextoSeguro texto={l.texto} />
              </span>
            </span>
          )}
          {l.lista && <ListaPlegable items={l.lista} />}
        </li>
      ))}
    </ul>
  );
}

// ─── Un paso ─────────────────────────────────────────────────────────────

/** Una llamada: qué hizo, con qué, qué le respondieron y, a un clic, el dato crudo. */
export function FilaPaso({ paso, entrada = false, mostrarQuien = true }: { paso: Paso; entrada?: boolean; mostrarQuien?: boolean }) {
  const [crudo, setCrudo] = useState(false);
  const args = lineasDeArgs(paso);
  const res = entrada ? lineasDeEntrada(paso) : lineasDeResultado(paso);
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={cn("text-[13px] font-medium", paso.error ? "text-crimsonTexto" : "text-ink")}>{accionDe(paso)}</span>
        {mostrarQuien && paso.porCoordinador && <span className="text-[11.5px] text-mute">lo hizo el coordinador</span>}
      </div>
      {args.length > 0 && <Lineas lineas={args.map((l) => ({ ...l, tono: l.tono ?? "tenue" }))} className="mt-0.5" />}
      {res.length > 0 && (
        <div className="mt-1 flex items-start gap-1.5">
          <CornerDownRight size={12} className="mt-0.5 shrink-0 text-mute" aria-hidden />
          <Lineas lineas={res} className="min-w-0 flex-1" />
        </div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <code className="font-mono text-[11px] text-mute">{paso.nombre}</code>
        <button
          type="button"
          onClick={() => setCrudo((v) => !v)}
          aria-expanded={crudo}
          className="rounded text-[11.5px] font-medium text-granate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50"
        >
          {crudo ? "Ocultar los datos" : "Ver los datos"}
        </button>
      </div>
      {crudo && (
        <div className="mt-2 space-y-2">
          <span className="block text-[11.5px] font-semibold text-mute">Lo que se le pidió</span>
          {paso.args ? <JsonSeguro valor={paso.args} /> : <span className="block text-[12px] text-mute">Sin argumentos.</span>}
          <span className="block text-[11.5px] font-semibold text-mute">Lo que respondió</span>
          {paso.hayResultado ? <JsonSeguro valor={paso.resultado} /> : <span className="block text-[12px] text-mute">La traza no guardó la respuesta.</span>}
        </div>
      )}
    </li>
  );
}

export function ListaPasos({ pasos, entrada = false, mostrarQuien = true }: { pasos: Paso[]; entrada?: boolean; mostrarQuien?: boolean }) {
  if (!pasos.length) return null;
  return (
    <ol className="divide-y divide-line/70">
      {pasos.map((p) => (
        <FilaPaso key={p.i} paso={p} entrada={entrada} mostrarQuien={mostrarQuien} />
      ))}
    </ol>
  );
}

/** Pasos en su forma breve: qué hizo y lo que respondió, sin argumentos ni dato crudo (tarjetas compactas). */
export function PasosBreves({ pasos }: { pasos: Paso[] }) {
  if (!pasos.length) return null;
  return (
    <ul className="space-y-1.5">
      {pasos.map((p) => (
        <li key={p.i} className="text-[12.5px] leading-snug">
          <span className={p.error ? "text-crimsonTexto" : "text-ink"}>{accionDe(p)}</span>
          <code className="block font-mono text-[10.5px] text-mute">{p.nombre}</code>
          <Lineas lineas={lineasDeResultado(p).filter((l) => l.tono !== "tenue")} className="mt-0.5" />
        </li>
      ))}
    </ul>
  );
}

/** Los pasos agrupados en una línea cada uno ("Consultó el RNP × 4"): para las tarjetas compactas. */
export function PasosAgrupados({ pasos, max = 5 }: { pasos: Paso[]; max?: number }) {
  const [todos, setTodos] = useState(false);
  const grupos = agruparPasos(pasos);
  if (!grupos.length) return null;
  const mostrados = todos ? grupos : grupos.slice(0, max);
  return (
    <>
      <ul className="space-y-1.5">
        {mostrados.map((g) => (
          <li key={g.accion} className="text-[12.5px] leading-snug">
            <span className="text-ink">{g.accion}</span>
            {g.veces > 1 && <span className="ml-1.5 rounded-full bg-paperDeep px-1.5 text-[11px] font-semibold tabular-nums text-inkSoft">{numero(g.veces)} veces</span>}
            {g.fallidas > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11.5px] text-crimsonTexto">
                <AlertCircle size={11} aria-hidden />
                {g.fallidas === g.veces ? "falló" : `${numero(g.fallidas)} fallaron`}
              </span>
            )}
            <code className="block font-mono text-[10.5px] text-mute">{g.nombre}</code>
          </li>
        ))}
      </ul>
      {grupos.length > max && (
        <button type="button" onClick={() => setTodos((v) => !v)} className="mt-1 rounded text-[12px] font-medium text-granate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50">
          {todos ? "Mostrar menos" : `y ${numero(grupos.length - max)} más`}
        </button>
      )}
    </>
  );
}

// ─── Los tres bloques ────────────────────────────────────────────────────

function Subtitulo({ children }: { children: ReactNode }) {
  return <span className="mb-1 block text-[12px] font-semibold text-mute">{children}</span>;
}

/** Qué recibió: quién lo llamó, de qué pasos depende, qué le preparó el coordinador, qué leyó. */
export function BloqueRecibio({
  nodo,
  recorrido,
  result,
  compacto = false,
  onIr,
}: {
  nodo: NodoTraza;
  recorrido: Recorrido;
  result: ApiResult;
  compacto?: boolean;
  /** Abre otro nodo (desde el panel del grafo). */
  onIr?: (clave: string) => void;
}) {
  const r = recepcionDe(nodo, recorrido, result);
  const codigo = nodo.clave === "ocds" ? nodo.pasos.find((p) => p.nombre === "fetch_ocds_record")?.args?.ocid : null;
  const vacio = !r.delegacion && !r.instruccion && !r.previos.length && !r.lecturas.length && !r.preparado.length && !codigo;
  if (vacio) return <p className="text-[12.5px] text-mute">Sin detalle en la traza.</p>;
  return (
    <div className="space-y-3">
      {codigo != null && (
        <p className="text-[12.5px] text-ink">
          El código del proceso, <span className="font-mono">{String(codigo)}</span>.
        </p>
      )}
      {r.delegacion && (
        <p className="flex items-start gap-1.5 text-[12.5px] leading-snug text-ink">
          <ArrowDownRight size={13} className="mt-0.5 shrink-0 text-mute" aria-hidden />
          <span>{r.delegacion}.</span>
        </p>
      )}
      {r.instruccion && <CitaLarga texto={r.instruccion} fuente="La instrucción que le escribió el coordinador" />}
      {r.sinInstruccion && <p className="text-[12px] text-mute">El texto de la instrucción no queda en la traza.</p>}
      {r.previos.length > 0 && (
        <div>
          <Subtitulo>{r.previos.length === 1 ? "Parte de lo que dejó" : "Parte de lo que dejaron"}</Subtitulo>
          <ul className="space-y-1">
            {r.previos.map((p) => (
              <li key={p.clave} className="text-[12.5px] leading-snug">
                {onIr ? (
                  <button type="button" onClick={() => onIr(p.clave)} className="rounded font-medium text-granate hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate/50">
                    {p.nombre}
                  </button>
                ) : (
                  <span className="font-medium text-ink">{p.nombre}</span>
                )}
                <span className="text-inkSoft">
                  : <TextoSeguro texto={p.resumen} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.preparado.length > 0 && (
        <div>
          <Subtitulo>Antes de llamarlo, el coordinador</Subtitulo>
          {compacto ? <PasosAgrupados pasos={r.preparado} max={4} /> : <ListaPasos pasos={r.preparado} mostrarQuien={false} />}
        </div>
      )}
      {r.lecturas.length > 0 && (
        <div>
          <Subtitulo>Lo que pidió leer</Subtitulo>
          {compacto ? (
            <ul className="space-y-1.5">
              {r.lecturas.map((p) => (
                <li key={p.i}>
                  <span className="text-[12.5px] text-ink">{accionDe(p)}</span>
                  <Lineas lineas={lineasDeEntrada(p)} className="mt-0.5" />
                </li>
              ))}
            </ul>
          ) : (
            <ListaPasos pasos={r.lecturas} entrada />
          )}
        </div>
      )}
    </div>
  );
}

/** Qué hizo: sus herramientas (sin las lecturas) y los avisos del camino. */
export function BloqueHizo({ nodo, compacto = false }: { nodo: NodoTraza; compacto?: boolean }) {
  const pasos = trabajoDe(nodo);
  const infos = nodo.avisos.filter((a) => a.tipo === "info" || a.tipo === "razonamiento");
  return (
    <div className="space-y-2">
      {pasos.length > 0 ? (
        compacto ? <PasosAgrupados pasos={pasos} /> : <ListaPasos pasos={pasos} mostrarQuien={nodo.tipo === "agente"} />
      ) : nodo.consumo?.llamadas ? (
        <p className="text-[12.5px] text-inkSoft">Trabajó sólo con el modelo: la traza no registra herramientas.</p>
      ) : nodo.estado === "sin_rastro" ? (
        <p className="text-[12.5px] text-mute">Sin registro en la traza.</p>
      ) : !infos.length ? (
        <p className="text-[12.5px] text-mute">La traza no registra pasos propios.</p>
      ) : null}
      {infos.map((a, i) => (
        <p key={i} className="text-[12px] leading-snug text-inkSoft">
          <TextoSeguro texto={a.texto} />
        </p>
      ))}
    </div>
  );
}

/** Qué entregó: sus conclusiones, las señales anotadas a su nombre y lo que falló. */
export function BloqueEntrego({ nodo, recorrido, result, compacto = false }: { nodo: NodoTraza; recorrido: Recorrido; result: ApiResult; compacto?: boolean }) {
  const e = entregaDe(nodo, recorrido, result);
  const alertas = nodo.avisos.filter((a) => a.tipo === "error" || a.tipo === "aviso" || a.tipo === "omitido");
  const nada = !e.lineas.length && !e.senales?.length && !alertas.length && !nodo.despues.length;
  return (
    <div className="space-y-3">
      {nada && <p className="text-[12.5px] text-mute">{nodo.estado === "sin_rastro" ? "Sin registro en la traza." : "Sin detalle en la traza."}</p>}
      <Lineas lineas={e.lineas} />
      {e.senales && e.senales.length > 0 && (
        <div>
          <span className="mb-1 flex items-center text-[12px] font-semibold text-mute">
            Señales que el dictamen recibió a su nombre
            <Ayuda titulo="¿De dónde sale esta lista?">
              Es el agente que figura como origen de cada señal en lo que recibió el dictamen. Puede no coincidir con lo que el
              agente guardó en su turno: hay señales que se suman después, al cruzar datos de otras ramas.
            </Ayuda>
          </span>
          <ul className="space-y-1">
            {e.senales.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] text-ink">
                <Severidad bandera={s.severidad === "alta" || s.severidad === "media" ? s.severidad : "baja"} />
                <span className="min-w-0">{reglaLabel(s.regla)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {alertas.length > 0 && (
        <ul className="space-y-1">
          {alertas.map((a, i) => (
            <li key={i} className={cn("flex items-start gap-1 text-[12.5px] leading-snug", a.tipo === "omitido" ? "text-mute" : "text-crimsonTexto")}>
              <AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden />
              <span className="min-w-0">
                <TextoSeguro texto={a.texto} />
                {a.detalle && a.detalle !== a.texto && (
                  <span className="mt-0.5 block break-words font-mono text-[11px] text-mute">
                    <TextoSeguro texto={a.detalle} />
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {nodo.despues.length > 0 && (
        <div>
          <Subtitulo>Con eso, el coordinador</Subtitulo>
          {compacto ? <PasosBreves pasos={nodo.despues} /> : <ListaPasos pasos={nodo.despues} mostrarQuien={false} />}
        </div>
      )}
    </div>
  );
}

// ─── Cifras del nodo ─────────────────────────────────────────────────────

/** Llamadas al modelo, consultas y consultas fallidas: íconos con número (la leyenda del grafo los explica). */
export function CifrasNodo({ nodo, className }: { nodo: NodoTraza; className?: string }) {
  const pasos = todosLosPasos(nodo);
  const fallidas = pasos.filter((p) => p.error).length;
  const llamadas = nodo.consumo?.llamadas ?? 0;
  if (!llamadas && !pasos.length) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11.5px] tabular-nums text-mute", className)}>
      {llamadas > 0 && (
        <span className="inline-flex items-center gap-0.5" title={plural(llamadas, "llamada al modelo", "llamadas al modelo")}>
          <Sparkles size={11} aria-hidden />
          {numero(llamadas)}
          <span className="sr-only">{llamadas === 1 ? " llamada al modelo" : " llamadas al modelo"}</span>
        </span>
      )}
      {pasos.length > 0 && (
        <span className="inline-flex items-center gap-0.5" title={plural(pasos.length, "consulta", "consultas")}>
          <Wrench size={11} aria-hidden />
          {numero(pasos.length)}
          <span className="sr-only">{pasos.length === 1 ? " consulta" : " consultas"}</span>
        </span>
      )}
      {fallidas > 0 && (
        <span className="inline-flex items-center gap-0.5 text-crimsonTexto" title={plural(fallidas, "consulta falló", "consultas fallaron")}>
          <AlertCircle size={11} aria-hidden />
          {numero(fallidas)}
          <span className="sr-only">{fallidas === 1 ? " consulta falló" : " consultas fallaron"}</span>
        </span>
      )}
    </span>
  );
}
