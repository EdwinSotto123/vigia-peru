"use client";

/**
 * El recorrido en texto: una línea de tiempo por fases (arranque, las tres ramas, la síntesis,
 * el control de calidad) y, en cada fase, una tarjeta por paso con tres columnas —Recibió,
 * Hizo, Entregó— y todos sus pasos, con el dato crudo, a un clic. Lo que corrió a la vez va
 * agrupado. Los nombres técnicos de las herramientas quedan en segundo plano (mono, chicos).
 *
 * El orden es el del DAG, no la hora de cada paso: la traza no guarda marcas de tiempo.
 */

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { irAPestana } from "@/components/patrones/Pestanas";
import { numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";
import type { ApiResult } from "../types";
import { BloqueEntrego, BloqueHizo, BloqueRecibio, ICONO_TIPO, ListaPasos } from "./BloquesNodo";
import { usd } from "./cifras";
import { ControlesEnResumen } from "./ControlesCalidad";
import { EVALS } from "./evaluadores";
import { GRUPOS_PARALELOS, SINTESIS, type GrupoParalelo, type Recorrido } from "./modelo";
import { ESTADO_NODO, TIPO_NODO, todosLosPasos } from "./nodos";

export function TextoRecorrido({ recorrido, result }: { recorrido: Recorrido; result: ApiResult }) {
  const tarjeta = (clave: string) => <TarjetaPaso key={clave} clave={clave} recorrido={recorrido} result={result} />;
  const grupo = (g: GrupoParalelo) => (
    <div className="space-y-3 rounded-2xl border border-dashed border-paperEdge bg-paperSoft/60 p-2 sm:p-3">
      <p className="px-1 text-[12px] font-medium text-mute">{recorrido.paralelo[g] ? "Estos corrieron a la vez" : "Estos corrieron después, uno tras otro"}</p>
      {GRUPOS_PARALELOS[g].map(tarjeta)}
    </div>
  );

  return (
    <ol className="relative space-y-8 border-l-2 border-line pl-5 sm:pl-7">
      <Fase numero={1} titulo="Arranque" bajada="El coordinador trae el registro del proceso.">
        {tarjeta("ocds")}
      </Fase>

      <Fase
        numero={2}
        titulo={recorrido.paralelo.ramas ? "Tres ramas a la vez" : "Tres ramas"}
        bajada={
          recorrido.paralelo.ramas
            ? "Reglas, expediente y proveedor parten del mismo registro y avanzan en paralelo."
            : "Reglas, expediente y proveedor parten del mismo registro; en este análisis corrieron uno tras otro."
        }
      >
        <Rama titulo="Reglas de contratación">{tarjeta("compliance")}</Rama>
        <Rama titulo="Expediente">
          {tarjeta("document_parser")}
          {grupo("expediente")}
        </Rama>
        <Rama titulo="Proveedor">
          {tarjeta("proveedor")}
          {grupo("proveedor")}
        </Rama>
      </Fase>

      <Fase numero={3} titulo="Síntesis" bajada="Con las tres ramas terminadas, uno tras otro.">
        {SINTESIS.filter((k) => k !== "self_eval").map(tarjeta)}
      </Fase>

      <Fase numero={4} titulo="Control de calidad" bajada={`${EVALS.length} revisores miran el análisis antes de publicarlo.`}>
        {tarjeta("self_eval")}
      </Fase>
    </ol>
  );
}

function Fase({ numero: n, titulo, bajada, children }: { numero: number; titulo: string; bajada: string; children: ReactNode }) {
  return (
    <li className="relative">
      <span
        aria-hidden
        className="absolute -left-[2.05rem] top-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-paper bg-ink text-[11px] font-bold text-paper sm:-left-[2.55rem]"
      >
        {n}
      </span>
      <h3 className="font-display text-[17px] font-bold leading-6 text-ink">{titulo}</h3>
      <p className="text-[13px] text-inkSoft">{bajada}</p>
      <div className="mt-3 space-y-4">{children}</div>
    </li>
  );
}

function Rama({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h4 className="flex items-center gap-2 text-[13px] font-semibold text-inkSoft">
        <span className="h-px w-3 bg-mute/60" aria-hidden />
        Rama: {titulo}
      </h4>
      {children}
    </section>
  );
}

function TarjetaPaso({ clave, recorrido, result }: { clave: string; recorrido: Recorrido; result: ApiResult }) {
  const n = recorrido.porClave[clave];
  if (!n) return null;
  const Icono = ICONO_TIPO[n.tipo];
  const pasos = todosLosPasos(n);
  const tenue = n.estado === "sin_rastro" || n.estado === "omitido";
  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border [container-type:inline-size]",
        tenue ? "border-dashed border-paperEdge bg-paperSoft" : n.estado === "fallo" ? "border-crimson/40 bg-paper" : "border-line bg-paper",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <Icono size={15} className={cn("shrink-0", tenue ? "text-mute" : "text-inkSoft")} aria-hidden />
          <h5 className={cn("font-display text-[15px] font-bold leading-tight", tenue ? "text-mute" : "text-ink")}>{n.titulo}</h5>
          <span className="text-[12px] text-mute">{TIPO_NODO[n.tipo]}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
          {n.estado !== "corrio" && (
            <span className={cn("pill", n.estado === "fallo" ? "border-crimson/40 bg-crimson-soft text-crimsonTexto" : "border-dashed border-line bg-paper text-mute")}>
              {ESTADO_NODO[n.estado]}
            </span>
          )}
          {n.consumo && n.consumo.llamadas > 0 && (
            <span className="pill border-line bg-paperSoft tabular-nums text-inkSoft">{plural(n.consumo.llamadas, "llamada al modelo", "llamadas al modelo")}</span>
          )}
          {pasos.length > 0 && <span className="pill border-line bg-paperSoft tabular-nums text-inkSoft">{plural(pasos.length, "consulta", "consultas")}</span>}
          {n.consumo && n.consumo.costo > 0 && <span className="pill border-line bg-paperSoft tabular-nums text-inkSoft">{usd(n.consumo.costo)}</span>}
        </div>
      </header>

      {tenue ? (
        <p className="px-4 py-3 text-[12.5px] text-mute">
          {n.estado === "omitido" ? n.avisos.find((a) => a.tipo === "omitido")?.texto ?? "No aplicó a este contrato." : "La traza no registra este paso en este análisis."}
        </p>
      ) : (
        <>
          <div className="grid gap-4 px-4 py-3 [@container(min-width:38rem)]:grid-cols-3 [@container(min-width:38rem)]:gap-5">
            <Columna titulo="Recibió">
              <BloqueRecibio nodo={n} recorrido={recorrido} result={result} compacto />
            </Columna>
            <Columna titulo="Hizo">
              {n.clave === "self_eval" ? (
                <ControlesEnResumen recorrido={recorrido} onVerControles={() => irAPestana("controles", "traza")} />
              ) : (
                <BloqueHizo nodo={n} compacto />
              )}
            </Columna>
            <Columna titulo="Entregó">
              <BloqueEntrego nodo={n} recorrido={recorrido} result={result} compacto />
            </Columna>
          </div>
          {pasos.length > 0 && (
            <details className="group border-t border-line">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2 text-[12.5px] font-medium text-granate hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate/50 [&::-webkit-details-marker]:hidden">
                <ChevronRight size={14} className="transition-transform duration-rapido group-open:rotate-90" aria-hidden />
                Ver {pasos.length === 1 ? "el paso" : `los ${numero(pasos.length)} pasos`} con sus datos
              </summary>
              <div className="px-4 pb-3 pt-1">
                <ListaPasos pasos={pasos} />
              </div>
            </details>
          )}
        </>
      )}
    </article>
  );
}

function Columna({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <h6 className="mb-1.5 text-[12px] font-semibold text-mute">{titulo}</h6>
      {children}
    </section>
  );
}
