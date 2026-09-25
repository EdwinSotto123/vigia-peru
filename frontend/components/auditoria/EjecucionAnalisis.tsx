"use client";

/**
 * Las piezas de "cómo se ejecuta" un análisis, que ContratoEnVivo arma de dos formas:
 *  · en su página (§14.2 Ficha): el estado en una tarjeta (`CabeceraEjecucion`), la sección
 *    con carriles y bitácora (`CuerpoEjecucion`) y los datos del proceso en la columna lateral
 *    (`DatosProceso`);
 *  · compacto (aside de /app/contratos/[ocid]): cabecera y cuerpo en una sola tarjeta, con la
 *    ficha técnica completa plegada adentro, porque ahí no hay columna lateral.
 *
 * Dato primero (DESIGN_SYSTEM.md §10.7): los porqués van en un ⓘ junto a lo que explican.
 * Sin estado propio salvo la versión de las reglas, que se pide aparte.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, ShieldCheck } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { FlowGraph } from "@/components/convocatoria/sections/FlowGraph";
import {
  AGENTES_PROGRESO,
  ESTADO_PROC,
  duracion,
  estadoVisible,
  estimadoLabel,
  faseHumana,
  faseLabel,
  fechaLima,
  getReglasPerfil,
  motivoHumano,
  nodoActivoYHechos,
  relojEdad,
  tipoContratoHumano,
  type FasesMap,
  type ProcesamientoDetalle,
} from "@/lib/auditoria";
import { Bitacora } from "./Bitacora";
import { DagCarriles } from "./DagCarriles";
import { ReplayAnalisis } from "./ReplayAnalisis";

type Progreso = { hechas: number; aplicables: number; pct: number };

/**
 * Qué pasa ahora, en palabras, con la barra de pasos. `conCifras`: pasos N/M y tiempo al
 * costado (en la página esas cifras ya están en los Indicadores y no se repiten).
 */
export function CabeceraEjecucion({
  p,
  fases,
  prog,
  ahora,
  duro,
  compacto,
  conCifras,
}: {
  p: ProcesamientoDetalle;
  fases: FasesMap;
  prog: Progreso;
  ahora: number;
  duro: number | null;
  compacto: boolean;
  conCifras: boolean;
}) {
  const estado = estadoVisible(p);
  const terminado = p.estado === "procesado";
  const montado = ahora > 0;
  const transcurrido = montado && p.estado === "procesando" && p.iniciadoAt ? ahora - new Date(p.iniciadoAt).getTime() : null;
  const estimado = p.estimado ?? null;
  const restante = estimado?.medianaSeg && transcurrido != null ? Math.max(0, estimado.medianaSeg * 1000 - transcurrido) : null;
  const sinEventos = p.estado === "procesando" && p.eventos.length === 0;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-[12px] font-semibold text-mute">
            {p.estado === "procesando" ? "Analizando ahora" : p.estado === "encolado" ? "En cola" : p.estado === "error" ? "Falló el análisis" : terminado ? "Cómo se ejecutó" : "Estado"}
            {p.estado === "encolado" && (
              <Ayuda titulo="¿Cuándo le toca?">
                Está asignado a un aporte confirmado. El sistema lo toma por orden de llegada: nadie elige cuál va primero.
              </Ayuda>
            )}
          </div>
          <div className={`mt-0.5 font-semibold text-ink ${compacto ? "text-base" : "text-lg"}`} suppressHydrationWarning>
            {p.estado === "procesando"
              ? faseHumana(p, montado ? ahora : undefined, fases)
              : p.estado === "encolado"
                ? "Espera turno"
                : p.estado === "error"
                  ? p.intentos >= 3 ? "Falló en los 3 intentos" : `Falló el intento ${Math.max(1, p.intentos)} de 3`
                  : terminado
                    // "pasos", no "agentes": dos pasos (SUNAT/OECE y la autoevaluación) no son agentes de IA.
                    ? `${prog.hechas} pasos${duro != null && duro > 0 ? ` en ${duracion(duro)}` : ""}`
                    : ESTADO_PROC[estado].label}
          </div>
        </div>
        {conCifras && (
          <div className="text-right">
            <div className={`font-mono font-semibold tabular-nums text-ink ${compacto ? "text-lg" : "text-2xl"}`}>
              {prog.hechas}<span className="text-mute">/{prog.aplicables}</span>
            </div>
            <div className="font-mono text-[11px] tabular-nums text-mute" suppressHydrationWarning>
              {transcurrido != null && transcurrido > 0 ? (
                <>
                  {duracion(transcurrido)}
                  {restante != null && <span className="ml-2">quedan {restante < 15_000 ? "unos segundos" : `≈ ${duracion(restante)}`}</span>}
                  {restante == null && <span className="ml-2">{estimadoLabel(estimado)} en total</span>}
                </>
              ) : p.estado === "encolado" ? (
                <>{estimadoLabel(estimado)} por contrato</>
              ) : null}
            </div>
          </div>
        )}
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuemin={0} aria-valuemax={prog.aplicables} aria-valuenow={prog.hechas} aria-label="Pasos completados">
        <div className={`h-full rounded-full transition-all duration-700 ease-out ${terminado ? "bg-moss" : "bg-amber"}`} style={{ width: `${Math.max(p.estado === "procesando" ? 3 : 0, prog.pct)}%` }} />
      </div>

      {p.estado === "encolado" && p.intentos > 0 && (
        <p className="mt-3 text-[12px] text-mute">
          Intentos previos: <span className="font-mono">{p.intentos}</span>; se reintenta automáticamente.
        </p>
      )}
      {p.estado === "error" && (
        <p className="mt-3 text-[12px] text-crimsonTexto">
          {p.intentos < 3
            ? "El intento anterior falló; el análisis vuelve a tomar el contrato desde el inicio."
            : "Tras 3 intentos quedó en revisión manual: el equipo lo vuelve a poner en la cola y el aporte no pierde su contrato."}
        </p>
      )}
      {sinEventos && <p className="mt-3 text-[12px] text-mute">Los agentes todavía no reportan nada: el contrato está entrando al análisis.</p>}
    </>
  );
}

/**
 * Carriles del DAG (o la repetición de la bitácora guardada), el grafo en vivo, los tiempos
 * por agente y la bitácora: abierta en vivo, plegada al terminar.
 */
export function CuerpoEjecucion({
  p,
  fases,
  ahora,
  duro,
  compacto,
  verReplay,
}: {
  p: ProcesamientoDetalle;
  fases: FasesMap;
  ahora: number;
  duro: number | null;
  compacto: boolean;
  verReplay: boolean;
}) {
  const estado = estadoVisible(p);
  const enRevision = estado === "revision";
  const terminado = p.estado === "procesado";
  const vivoAhora = p.estado === "procesando" || p.estado === "encolado";
  const montado = ahora > 0;
  const separador = `${compacto ? "mt-3 pt-3" : "mt-4 pt-4"} border-t border-line`;

  if (verReplay && terminado && p.eventos.length > 0) return <ReplayAnalisis eventos={p.eventos} estadoFinal={estado} compacto={compacto} />;
  return (
    <>
      {!compacto && p.estado === "procesando" && (
        <div className="mb-4">
          <FlowGraph override={{ ...nodoActivoYHechos(fases), narracion: faseHumana(p, montado ? ahora : undefined, fases) }} />
        </div>
      )}
      {/* En revisión, los carriles no cuentan señales por agente: serían señales publicadas. */}
      <DagCarriles fases={fases} estado={estado} ahora={ahora} compacto={compacto} senales={enRevision ? null : p.resultado?.banderas ?? null} />
      {terminado && <FichaTecnica p={p} fases={fases} duro={duro} compacto={compacto} conDatos={compacto} />}
      {!terminado ? (
        <div className={separador}>
          <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-mute">
            <span>Bitácora</span>
            <span className="font-mono font-normal tabular-nums">{p.eventos.length} eventos</span>
          </div>
          <Bitacora eventos={p.eventos} ahora={ahora} max={compacto ? 6 : 12} activo={vivoAhora} compacto={compacto} />
        </div>
      ) : (
        <details className={separador}>
          {/* `display` por defecto: conserva el triángulo del <summary>, que es lo que dice "se abre". */}
          <summary className="min-h-[32px] cursor-pointer select-none text-[12px] font-semibold text-mute hover:text-ink">
            <span className="inline-flex items-baseline gap-x-3">
              <span>Bitácora</span>
              <span className="font-mono font-normal tabular-nums">{p.eventos.length} eventos</span>
            </span>
          </summary>
          <div className="mt-2">
            <Bitacora eventos={p.eventos} ahora={ahora} max={compacto ? 6 : 12} activo={false} compacto={compacto} />
          </div>
        </details>
      )}
    </>
  );
}

/**
 * Esperando documentos (o sin análisis aplicable): no hay nada que ejecutar todavía, así que
 * no se dibujan doce pasos "pendiente" ni una bitácora vacía. Se dice qué falta y desde cuándo,
 * en una línea; el porqué, a un clic.
 */
export function SinEjecucion({ p, ahora, compacto }: { p: ProcesamientoDetalle; ahora: number; compacto: boolean }) {
  const desde = p.iniciadoAt ? Date.parse(p.iniciadoAt) : NaN;
  const conFecha = Number.isFinite(desde);
  if (p.estado === "pendiente_de_procesamiento") {
    return (
      <section className={`rounded-2xl border border-line bg-paper ${compacto ? "p-4" : "p-5"}`} aria-label="Estado del contrato">
        <div className="text-[12px] font-semibold text-mute">Sin análisis aplicable</div>
        <div className={`mt-0.5 flex items-center gap-1 font-semibold text-ink ${compacto ? "text-base" : "text-lg"}`}>
          Todavía no hay análisis para este tipo de contrato
          <Ayuda titulo="¿Qué pasa con lo que se pagó?">
            Es de un tipo o de una etapa que los agentes todavía no leen. Queda reservado: cuando ese análisis exista, entra
            a la cola sin que nadie tenga que volver a pagarlo.
          </Ayuda>
        </div>
        <p className="mt-1 text-[13px] text-inkSoft">Ya está pagado y queda reservado.</p>
      </section>
    );
  }
  return (
    <section className={`rounded-2xl border border-line bg-paper ${compacto ? "p-4" : "p-5"}`} aria-label="Estado del contrato">
      <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-clayTexto">
        <Clock size={13} aria-hidden /> Esperando documentos
      </div>
      <div className={`mt-0.5 flex items-center gap-1 font-semibold text-ink ${compacto ? "text-base" : "text-lg"}`}>
        Todavía no se puede leer: faltan sus documentos
        <Ayuda titulo="¿Por qué faltan?">
          <span className="block">
            Ya está pagado. El análisis empieza cuando se descargan sus documentos del SEACE, desde una conexión en Perú: el
            SEACE bloquea los servidores en la nube. Después pasa a la cola y aquí se ve a los agentes trabajar.
          </span>
          <span className="mt-2 block text-mute">Esta página vuelve a consultar el estado cada minuto.</span>
        </Ayuda>
      </div>
      {conFecha && (
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-mute">
          <span>
            Espera desde <time dateTime={p.iniciadoAt!} className="text-ink">{fechaLima(desde, { larga: true, hora: true })}</time>
          </span>
          <span>
            lleva <span className="font-mono tabular-nums text-ink" suppressHydrationWarning>{ahora > 0 ? relojEdad(ahora - desde) : "…"}</span>
          </span>
        </p>
      )}
    </section>
  );
}

const ESTADO_FASE_HUMANO: Record<string, string> = { hecho: "completado", corriendo: "en curso", error: "falló", omitido: "omitido" };

/**
 * Tiempo por agente (de `fases`) del análisis terminado, plegado para no estorbar. `conDatos`
 * (compacto): también tipo, modelo, costo y versión de reglas, que en la página van en la
 * columna lateral (`DatosProceso`).
 */
function FichaTecnica({ p, fases, duro, compacto, conDatos }: { p: ProcesamientoDetalle; fases: FasesMap; duro: number | null; compacto: boolean; conDatos: boolean }) {
  const r = p.resultado ?? null;
  const filas = AGENTES_PROGRESO
    .map((k) => {
      const f = fases[k];
      if (!f || !f.desde) return null;
      const a = new Date(f.desde).getTime();
      const b = f.hasta ? new Date(f.hasta).getTime() : NaN;
      const ms = Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(0, b - a);
      return { k, estado: f.estado as string, ms, motivo: f.motivo ?? null };
    })
    .filter((x): x is { k: string; estado: string; ms: number | null; motivo: string | null } => !!x);
  if (!filas.length && !(conDatos && (r?.costo || r?.modelo))) return null;
  const costo = r?.costo ?? null;
  return (
    <details className={`${compacto ? "mt-3 pt-3" : "mt-4 pt-4"} border-t border-line text-[12px]`}>
      <summary className="min-h-[32px] cursor-pointer select-none text-[12px] font-semibold text-mute hover:text-ink">
        <span className="inline-flex flex-wrap items-baseline gap-x-3">
          <span>{conDatos ? "Ficha técnica y tiempos por agente" : "Tiempos por agente"}</span>
          {costo?.costoUsd != null && <span className="font-mono normal-case">US$ {costo.costoUsd.toFixed(2)}</span>}
          {duro ? <span className="font-mono normal-case">{duracion(duro)} en total</span> : null}
        </span>
      </summary>
      <div className={`mt-2 grid gap-3 ${conDatos ? "sm:grid-cols-[1fr_auto]" : ""}`}>
        {filas.length > 0 && (
          <table className="w-full text-left text-[11px]">
            <caption className="sr-only">Tiempo por agente</caption>
            <thead className="text-[11px] text-mute"><tr><th className="py-1 pr-2 font-semibold">Agente</th><th className="py-1 pr-2 font-semibold">Estado</th><th className="py-1 text-right font-semibold">Tiempo</th></tr></thead>
            <tbody className="divide-y divide-line">
              {filas.map((f) => (
                <tr key={f.k}>
                  <td className="py-1 pr-2 text-ink">{faseLabel(f.k)}</td>
                  <td className="py-1 pr-2 text-mute">{f.estado === "omitido" ? `omitido: ${motivoHumano(f.motivo)}` : ESTADO_FASE_HUMANO[f.estado] ?? f.estado}</td>
                  <td className="py-1 text-right font-mono tabular-nums text-ink">{f.ms != null && f.estado !== "omitido" ? (f.ms < 1000 ? "<1 s" : duracion(f.ms)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {conDatos && <DatosTecnicos p={p} className="space-y-1 text-[11px] sm:min-w-[180px]" />}
      </div>
    </details>
  );
}

/** Tipo, modelo, costo, fecha y versión de reglas: lo que dice cómo se hizo. */
function DatosTecnicos({ p, className }: { p: ProcesamientoDetalle; className?: string }) {
  const r = p.resultado ?? null;
  const costo = r?.costo ?? null;
  return (
    <dl className={className}>
      <div><dt className="text-mute">Tipo de contrato</dt><dd className="text-ink">{tipoContratoHumano(r?.perfil) ?? "sin declarar"}</dd></div>
      {r?.modelo && <div><dt className="text-mute">Modelo</dt><dd className="font-mono text-ink">{r.modelo}</dd></div>}
      {costo && (
        <div>
          <dt className="text-mute">Costo del análisis</dt>
          <dd className="flex flex-wrap items-baseline gap-x-3 font-mono text-ink">
            <span>{costo.costoUsd != null ? `US$ ${costo.costoUsd.toFixed(3)}` : "sin dato"}</span>
            {costo.llamadas != null && <span className="text-mute">{costo.llamadas} llamadas</span>}
            {costo.tokens != null && <span className="text-mute">{Math.round(costo.tokens / 1000)}k tokens</span>}
          </dd>
        </div>
      )}
      {r?.analizadoEn && <div><dt className="text-mute">Analizado</dt><dd className="text-ink">{fechaLima(r.analizadoEn, { larga: true, hora: true, anio: true })}</dd></div>}
      <div><dt className="text-mute">Versión de reglas</dt><dd className="text-ink"><VersionReglas perfil={r?.perfil} /></dd></div>
    </dl>
  );
}

/**
 * La columna lateral de la ficha (§14.2): zona, quién pagó y con qué aporte (la independencia a
 * un clic) y, si ya se leyó, cómo se hizo. Los códigos van en la línea de identidad.
 */
export function DatosProceso({ p }: { p: ProcesamientoDetalle }) {
  return (
    <section aria-labelledby="datos-proceso" className="rounded-2xl border border-line bg-paper p-4 text-[13px]">
      <h2 id="datos-proceso" className="font-display text-[15px] font-bold text-ink">Datos del proceso</h2>
      <dl className="mt-3 space-y-2.5">
        <div>
          <dt className="text-[12px] text-mute">Zona</dt>
          <dd><Link href={`/app/financiar/${p.ubigeo}`} className="text-ink underline-offset-2 hover:text-granate hover:underline">{p.zona}</Link></dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-[12px] text-mute">
            Lo pagó
            <Ayuda titulo="¿Quién pagó influye en el resultado?">
              Los agentes no saben quién pagó este análisis, y los resultados se publican aunque señalen a quien lo
              financió.{" "}
              <Link href="/app/financiar#independencia" className="font-medium text-granate underline">
                Reglas de independencia
              </Link>
              .
            </Ayuda>
          </dt>
          <dd className="flex flex-wrap items-baseline gap-x-2">
            <span className="inline-flex items-center gap-1 font-semibold text-ink">
              <ShieldCheck size={13} className="text-mossTexto" aria-hidden /> {p.financiador}
            </span>
            <Link href={`/impacto/${p.contribucionCodigo}`} className="font-mono text-[12px] text-mute hover:text-granate hover:underline">
              {p.contribucionCodigo}
            </Link>
          </dd>
        </div>
      </dl>
      {p.estado === "procesado" && (
        <div className="mt-3 border-t border-line pt-3">
          <DatosTecnicos p={p} className="space-y-2.5 text-[13px] [&_dt]:text-[12px]" />
        </div>
      )}
    </section>
  );
}

function VersionReglas({ perfil }: { perfil: string | null | undefined }) {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    // Sin perfil declarado no se adivina uno: pedir las de "bienes" era inventar la versión.
    if (!perfil) { setV(null); return; }
    let vivo = true;
    getReglasPerfil(perfil.toLowerCase()).then((r) => { if (vivo && r) setV(`${r.version}, ${r.reglas.length} reglas`); });
    return () => { vivo = false; };
  }, [perfil]);
  if (!perfil) return <span>sin declarar</span>;
  return <span className="font-mono">{v ?? "…"}</span>;
}
