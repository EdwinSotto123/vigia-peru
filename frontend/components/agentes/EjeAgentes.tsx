"use client";

/**
 * El eje de tiempo compartido de la auditoría: los tres carriles del DAG, cada agente con su
 * VENTANA REAL de ejecución (`fases[clave].desde` / `.hasta`, migración 20) dibujada contra el
 * mismo eje. Que el DAG corra en paralelo deja de ser una afirmación del copy y pasa a verse:
 * las barras de carriles distintos se solapan en el mismo tramo de tiempo.
 *
 * Decisiones que sostiene este archivo:
 *  · Un solo eje para los tres carriles. Tres ejes independientes mentirían sobre el paralelismo.
 *  · Sin marcas de tiempo no se dibuja una barra falsa: se cae al estado en palabras.
 *  · La única animación es el punto del agente en curso. La selección no pulsa, no late, no brilla.
 *  · Clic en un agente = filtro. No navega, no abre nada: el contexto es la prueba.
 */

import { useState } from "react";
import { duracion, estadoDeFase, type EstadoFase, type EstadoProc, type FasesMap, faseLabel } from "@/lib/auditoria";
import { Severidad } from "@/components/ui/Severidad";
import { cn } from "@/lib/utils";
import { PASOS, porCarril, type PasoPipeline } from "./catalogo";
import { ESTADO_PASO, IconoEstado } from "./EstadoPaso";
import { ORDEN_SEVERIDAD, severidadMaxima, type SenalAgente } from "./senales";

export interface VentanaPaso {
  estado: EstadoFase;
  desde: number | null;
  hasta: number | null;
  ms: number | null;
  motivo: string | null;
  msg: string | null;
}

const hora = (v: string | null | undefined): number | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/** Tramo total del análisis, contando TODAS las fases del dispatcher (también las del driver). */
export function rangoDelAnalisis(fases: FasesMap, ahora: number): { t0: number; t1: number; span: number } | null {
  let t0 = Infinity;
  let t1 = -Infinity;
  let corriendo = false;
  for (const f of Object.values(fases)) {
    const a = hora(f?.desde);
    const b = hora(f?.hasta);
    if (a != null) { t0 = Math.min(t0, a); t1 = Math.max(t1, a); }
    if (b != null) t1 = Math.max(t1, b);
    if (f?.estado === "corriendo") corriendo = true;
  }
  if (corriendo && ahora > 0) t1 = Math.max(t1, ahora);
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return null;
  return { t0, t1, span: t1 - t0 };
}

export function ventanaDe(fases: FasesMap, clave: string, estado: EstadoProc, ahora: number): VentanaPaso {
  const st = estadoDeFase(fases, clave, estado);
  const f = fases[clave];
  const desde = hora(f?.desde);
  const hasta = hora(f?.hasta) ?? (st === "corriendo" && ahora > 0 ? ahora : null);
  return {
    estado: st,
    desde,
    hasta,
    ms: desde != null && hasta != null ? Math.max(0, hasta - desde) : null,
    motivo: f?.motivo ?? null,
    msg: f?.msg ?? null,
  };
}

interface Props {
  fases: FasesMap;
  estado: EstadoProc;
  /** Reloj del cliente. 0 en el render del servidor: sin cronómetros, sin desajuste de hidratación. */
  ahora: number;
  /** Catálogo ya recortado al perfil. Por defecto, el DAG completo. */
  pasos?: PasoPipeline[];
  /** Señales por clave de agente. Habilita la columna de señales y el filtro. */
  senalesPorAgente?: Record<string, SenalAgente[]>;
  /** Total de señales del análisis: el denominador de la columna. */
  totalSenales?: number;
  /** Controlado desde afuera (el filtro vive en el componente padre). */
  seleccion?: string | null;
  onSeleccion?: (clave: string | null) => void;
}

export function EjeAgentes({
  fases,
  estado,
  ahora,
  pasos = PASOS,
  senalesPorAgente,
  totalSenales,
  seleccion,
  onSeleccion,
}: Props) {
  const [selInterna, setSelInterna] = useState<string | null>(null);
  const controlado = typeof onSeleccion === "function";
  const sel = controlado ? seleccion ?? null : selInterna;
  const elegir = (clave: string) => {
    const siguiente = sel === clave ? null : clave;
    if (controlado) onSeleccion!(siguiente);
    else setSelInterna(siguiente);
  };

  const rango = rangoDelAnalisis(fases, ahora);
  const carriles = porCarril(pasos);
  const claves = new Set(pasos.map((p) => p.clave));
  const otras = Object.keys(fases).filter((k) => !claves.has(k));
  const conSenales = !!senalesPorAgente;

  return (
    <div className="min-w-0">
      {/* Cabecera del eje: qué mide cada columna. Es lo que le da denominador a cada cifra de abajo. */}
      <div className="grid grid-cols-[6rem_minmax(0,1fr)_3rem] items-end gap-x-2 border-b border-line pb-1 text-[10px] uppercase tracking-wide text-mute sm:grid-cols-[11rem_minmax(0,1fr)_4rem_3.5rem]">
        <span>Agente</span>
        <span className="flex min-w-0 items-baseline justify-between gap-2">
          <span className="truncate">{rango ? "Ejecución real" : "Estado"}</span>
          {rango && (
            <span className="shrink-0 font-mono normal-case tracking-normal" suppressHydrationWarning>
              {duracion(rango.span)} en total
            </span>
          )}
        </span>
        <span className="text-right">Duró</span>
        {conSenales && <span className="hidden text-right sm:block">Señales</span>}
      </div>

      {carriles.map((c) => {
        const ventanas = c.pasos.map((p) => ventanaDe(fases, p.clave, estado, ahora));
        const corriendo = ventanas.filter((v) => v.estado === "corriendo").length;
        const listos = ventanas.filter((v) => v.estado === "hecho" || v.estado === "omitido").length;
        return (
          <section key={c.key} className="mt-2 first:mt-1">
            <h4 className="flex items-baseline justify-between gap-2 px-1 text-[11px] font-semibold text-inkSoft">
              <span>
                Carril {c.label}
                <span className="ml-1.5 font-normal text-mute">
                  {listos} de {c.pasos.length} {c.pasos.length === 1 ? "paso listo" : "pasos listos"}
                  {corriendo > 0 && ` · ${corriendo} en curso`}
                </span>
              </span>
            </h4>
            <ul className="mt-0.5">
              {c.pasos.map((p, i) => (
                <FilaAgente
                  key={p.clave}
                  paso={p}
                  v={ventanas[i]}
                  rango={rango}
                  ahora={ahora}
                  senales={senalesPorAgente?.[p.clave]}
                  totalSenales={totalSenales}
                  conSenales={conSenales}
                  seleccionado={sel === p.clave}
                  onElegir={() => elegir(p.clave)}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {otras.length > 0 && (
        <p className="mt-2 border-t border-line pt-2 text-[11px] leading-snug text-mute">
          Además de los {pasos.length} pasos de los carriles corrieron {otras.length} del propio
          orquestador, que no son agentes: {otras.map((k) => faseLabel(k).toLowerCase()).join(" · ")}.
        </p>
      )}
    </div>
  );
}

function FilaAgente({
  paso,
  v,
  rango,
  ahora,
  senales,
  totalSenales,
  conSenales,
  seleccionado,
  onElegir,
}: {
  paso: PasoPipeline;
  v: VentanaPaso;
  rango: { t0: number; t1: number; span: number } | null;
  ahora: number;
  senales?: SenalAgente[];
  totalSenales?: number;
  conSenales: boolean;
  seleccionado: boolean;
  onElegir: () => void;
}) {
  const e = ESTADO_PASO[v.estado];
  const n = senales?.length ?? 0;
  const peor = severidadMaxima(senales);
  const puedeDibujar = rango != null && v.desde != null && v.estado !== "pendiente" && v.estado !== "omitido";
  const izq = puedeDibujar ? ((v.desde! - rango!.t0) / rango!.span) * 100 : 0;
  const ancho = puedeDibujar && v.ms != null ? Math.max(1.5, (v.ms / rango!.span) * 100) : 0;
  const dur = v.ms != null && (v.estado === "hecho" || (v.estado === "corriendo" && ahora > 0) || v.estado === "error")
    ? v.ms < 1000 && v.estado === "hecho" ? "<1 s" : duracion(v.ms)
    : null;

  const etiqueta = [
    paso.titulo,
    e.label,
    dur ? `duró ${dur}` : null,
    v.estado === "omitido" && v.motivo ? `motivo: ${v.motivo}` : null,
    conSenales ? `${n} ${n === 1 ? "señal" : "señales"}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <li>
      <button
        type="button"
        onClick={onElegir}
        aria-pressed={seleccionado}
        aria-label={etiqueta}
        className={cn(
          "grid w-full grid-cols-[6rem_minmax(0,1fr)_3rem] items-center gap-x-2 rounded-lg px-1 py-1 text-left transition-colors duration-rapido sm:grid-cols-[11rem_minmax(0,1fr)_4rem_3.5rem]",
          "hover:bg-paperDeep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-heroViolet/50",
          seleccionado && "bg-heroViolet-soft hover:bg-heroViolet-soft",
        )}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <IconoEstado estado={v.estado} />
          <span className={cn("truncate text-[12px]", v.estado === "omitido" ? "text-mute line-through decoration-mute/50" : "text-ink", seleccionado && "font-semibold")}>
            {paso.nombre}
          </span>
        </span>

        {/* Pista del eje: todas las filas comparten el mismo origen y la misma escala. */}
        <span className="relative block h-4 min-w-0">
          <span aria-hidden className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
          {rango && [25, 50, 75].map((p) => (
            <span key={p} aria-hidden className="absolute top-0 h-4 w-px bg-line/60" style={{ left: `${p}%` }} />
          ))}
          {puedeDibujar ? (
            <span
              aria-hidden
              className={cn("absolute top-1/2 h-2 -translate-y-1/2 rounded-full transition-all duration-normal ease-salida", e.barra)}
              style={{ left: `${izq}%`, width: `${ancho}%` }}
            />
          ) : (
            <span className={cn("absolute inset-y-0 left-0 flex items-center truncate text-[11px]", e.texto)}>
              {v.estado === "omitido" ? `omitido · ${v.motivo ?? "no aplica a este contrato"}` : e.label}
            </span>
          )}
          {v.estado === "corriendo" && puedeDibujar && (
            <span aria-hidden className="absolute top-1/2 -translate-y-1/2" style={{ left: `calc(${izq + ancho}% - 3px)` }}>
              <IconoEstado estado="corriendo" />
            </span>
          )}
        </span>

        <span className={cn("text-right font-mono text-[10px] tabular-nums", v.estado === "corriendo" ? "text-amberTexto" : "text-mute")} suppressHydrationWarning>
          {dur ?? "—"}
        </span>

        {conSenales && (
          <span className="hidden items-center justify-end gap-1 text-[11px] sm:flex">
            {n > 0 && peor ? (
              <>
                <Severidad bandera={peor} formato="punto" />
                <span className="font-mono tabular-nums text-ink">{n}</span>
              </>
            ) : (
              <span className="text-mute">0</span>
            )}
          </span>
        )}
      </button>

      {seleccionado && (
        <div className="mb-1 ml-1 mt-0.5 border-l-2 border-heroViolet/40 pl-3 text-[12px] leading-relaxed text-inkSoft">
          <p>{paso.que}</p>
          {paso.fuentes.length > 0 && (
            <p className="mt-0.5 text-mute">
              Coteja contra: {paso.fuentes.join(", ")}.
              {paso.id && <span className="ml-1.5 font-mono text-[10px]">{paso.id}</span>}
            </p>
          )}
          {v.estado === "omitido" && (
            <p className="mt-0.5 text-mute">No corrió en este contrato: {v.motivo ?? "no aplica al perfil"}.</p>
          )}
          {v.estado === "error" && v.motivo && <p className="mt-0.5 text-rust">Falló: {v.motivo}</p>}
          {v.estado === "corriendo" && v.msg && <p className="mt-0.5 text-amberTexto">Ahora: {v.msg}</p>}
          {conSenales && (
            <p className="mt-0.5 text-mute">
              {n === 0
                ? `Corrió y no encontró señales${totalSenales ? ` (las ${totalSenales} del análisis salieron de otros agentes)` : ""}.`
                : `Emitió ${n} ${n === 1 ? "señal" : "señales"}${totalSenales ? ` de las ${totalSenales} del análisis` : ""}${
                    senales && senales.length
                      ? ` · ${[...senales]
                          .sort((a, b) => ORDEN_SEVERIDAD[a.severidad] - ORDEN_SEVERIDAD[b.severidad])
                          .slice(0, 3)
                          .map((s) => s.severidad)
                          .join(", ")}`
                      : ""
                  }.`}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
