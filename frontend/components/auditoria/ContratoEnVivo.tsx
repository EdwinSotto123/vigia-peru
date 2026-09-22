"use client";

/**
 * "Mira cómo se ejecuta": un contrato asignado a un aporte, en vivo.
 *   · cabecera (título, entidad, zona, monto, gracias a {financiador} · {código})
 *   · progreso global (fases hechas / aplicables), tiempo transcurrido y estimado
 *   · los tres carriles del DAG con cada agente como chip (DagCarriles)
 *   · bitácora en vivo (últimos 12 eventos humanizados)
 *   · al terminar → Resultados (ResultadoAnalisis) en la misma página
 * Poll cada `pollMs` (3 s) mientras el estado sea encolado/procesando.
 *
 * `compacto` (aside de /app/contratos/[ocid]): sin cabecera ni navegación; carriles y
 * bitácora corta.
 *
 * Datos: GET /financiamiento/procesamientos/:ocid
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Landmark, Play, ShieldCheck, WifiOff } from "lucide-react";
import { formatPEN } from "@/lib/financiamiento";
import {
  AGENTES_PROGRESO, PUBLIC_API_BASE, duracion, esActivo, estadoVisible, estimadoLabel, faseHumana, faseLabel, fasesEfectivas, getReglasPerfil, haceCuanto, nodoActivoYHechos, progresoFases,
  type ProcesamientoDetalle,
} from "@/lib/auditoria";
import { FlowGraph } from "@/components/convocatoria/sections/FlowGraph";
import { PulseDot } from "@/components/ui/PulseDot";
import { Skeleton } from "@/components/ui/Skeleton";
import { Bitacora } from "./Bitacora";
import { CompartirButton } from "./CompartirButton";
import { DagCarriles } from "./DagCarriles";
import { EstadoPill } from "./EstadoPill";
import { ReplayAnalisis } from "./ReplayAnalisis";
import { ResultadoAnalisis } from "./ResultadoAnalisis";

interface Props {
  ocid: string;
  initial?: ProcesamientoDetalle | null;
  pollMs?: number;
  compacto?: boolean;
}

export function ContratoEnVivo({ ocid, initial, pollMs = 3000, compacto = false }: Props) {
  const [data, setData] = useState<ProcesamientoDetalle | null>(initial ?? null);
  const [cargando, setCargando] = useState(initial == null);
  const [fallo, setFallo] = useState(false);
  const [actualizadoAt, setActualizadoAt] = useState<number | null>(initial ? Date.now() : null);
  // 0 hasta montar: así el HTML del servidor no lleva cronómetros ni "hace N s" (sin desajuste de hidratación).
  const [ahora, setAhora] = useState(0);
  const activoRef = useRef<boolean>(initial ? esActivo(initial.estado) : true);
  // Al terminar hacemos UNA lectura más para traer `resultado` (el poll se detiene con el estado final).
  const resultadoPedido = useRef(false);
  // "Ver cómo se analizó": repite la bitácora real ya guardada, para poder mirar la animación
  // aunque el análisis haya terminado hace días (la ventana de verlo EN VIVO es rarísima: solo
  // corre cuando hay algo en cola, unos minutos cada vez).
  const [verReplay, setVerReplay] = useState(false);

  useEffect(() => {
    let vivo = true;
    let ctrl: AbortController | null = null;
    const cargar = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos/${encodeURIComponent(ocid)}`, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ProcesamientoDetalle;
        if (!vivo) return;
        setData({ ...json, eventos: Array.isArray(json.eventos) ? json.eventos : [] });
        setActualizadoAt(Date.now());
        setFallo(false);
        activoRef.current = esActivo(json.estado);
        if (!activoRef.current && json.estado === "procesado" && !json.resultado && !resultadoPedido.current) {
          // el dictamen se publica segundos después del `final`: una relectura corta
          resultadoPedido.current = true;
          window.setTimeout(() => { if (vivo) void cargar(); }, 4000);
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError" || !vivo) return;
        setFallo(true);
      } finally {
        if (vivo) setCargando(false);
      }
    };
    void cargar();
    const id = window.setInterval(() => {
      if (!activoRef.current) return;
      if (document.visibilityState !== "visible") return;
      void cargar();
    }, Math.max(1500, pollMs));
    const onVis = () => { if (document.visibilityState === "visible" && activoRef.current) void cargar(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      vivo = false;
      ctrl?.abort();
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ocid, pollMs]);

  useEffect(() => {
    setAhora(Date.now());
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const fases = useMemo(() => (data ? fasesEfectivas(data, data.eventos) : {}), [data]);

  if (!data) {
    return cargando ? (
      <div className="space-y-3 rounded-2xl border border-line bg-paper p-6" aria-busy>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    ) : (
      <div className="flex items-start gap-3 rounded-2xl border border-dashed border-line p-6 text-sm text-mute">
        <WifiOff size={18} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
        <div>
          <div className="font-medium text-ink">No pudimos cargar el estado de este contrato.</div>
          <div className="mt-0.5">Reintentamos automáticamente. Código: <span className="font-mono">{ocid}</span></div>
        </div>
      </div>
    );
  }

  const p = data;
  const estado = estadoVisible(p);
  const activo = esActivo(p.estado);
  const terminado = p.estado === "procesado";
  const montado = ahora > 0;
  const transcurrido = montado && p.estado === "procesando" && p.iniciadoAt ? ahora - new Date(p.iniciadoAt).getTime() : null;
  const duro = p.iniciadoAt && p.finalizadoAt ? new Date(p.finalizadoAt).getTime() - new Date(p.iniciadoAt).getTime() : null;
  const prog = progresoFases(fases, estado);
  const estimado = p.estimado ?? null;
  const restante = estimado?.medianaSeg && transcurrido != null ? Math.max(0, estimado.medianaSeg * 1000 - transcurrido) : null;
  const sinEventos = p.estado === "procesando" && p.eventos.length === 0;
  const puedeRepetir = (p.estado === "procesado" || p.estado === "revision") && p.eventos.length > 0;

  const enVivoBadge = (
    <span className="inline-flex items-center gap-1.5 text-[11px]" aria-live="polite" aria-atomic="true" suppressHydrationWarning>
      {fallo ? (
        <span className="inline-flex items-center gap-1 text-amberTexto"><WifiOff size={12} aria-hidden /> sin conexión, reintentando</span>
      ) : activo ? (
        <>
          <PulseDot color="moss" size={6} />
          en vivo{montado && actualizadoAt ? `, actualizado ${haceCuanto(ahora - actualizadoAt)}` : ""}
        </>
      ) : (
        <span suppressHydrationWarning>{!montado ? "" : p.finalizadoAt ? `finalizado el ${new Date(p.finalizadoAt).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" })}` : "sin actividad"}</span>
      )}
    </span>
  );

  // ── Bloque "cómo se ejecuta" (progreso + carriles + bitácora) ──
  const ejecucion = (
    <section className={`rounded-2xl border bg-paper ${p.estado === "procesando" ? "border-amber/40 ring-1 ring-amber/15" : "border-line"} ${compacto ? "p-4" : "p-5"}`} aria-label="Cómo se ejecuta el análisis">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-mute">
            {p.estado === "procesando" ? "Analizando ahora" : p.estado === "encolado" ? "En cola" : p.estado === "error" ? "Reintento automático" : terminado ? "Cómo se ejecutó" : "Estado"}
          </div>
          <div className={`mt-0.5 font-semibold text-ink ${compacto ? "text-base" : "text-lg"}`} aria-live="polite" suppressHydrationWarning>
            {p.estado === "procesando"
              ? faseHumana(p, montado ? ahora : undefined, fases)
              : p.estado === "encolado"
                ? "Espera turno"
                : p.estado === "error"
                  ? `Intento ${Math.min(3, Math.max(1, p.intentos))} de 3`
                  : terminado
                    // "pasos", no "agentes": prog.hechas cuenta los pasos del
                    // DAG, y dos de ellos (SUNAT/OECE y la autoevaluación) no
                    // son agentes de IA. Decir "12 agentes" acá reabría la
                    // contradicción de recuentos que el catálogo vino a cerrar:
                    // son 10 agentes repartidos en 12 pasos.
                    ? `${prog.hechas} pasos en ${duro != null && duro > 0 ? duracion(duro) : "—"}`
                    : "Sin actividad"}
          </div>
        </div>
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
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuemin={0} aria-valuemax={prog.aplicables} aria-valuenow={prog.hechas} aria-label="Agentes completados">
        <div className={`h-full rounded-full transition-all duration-700 ease-out ${terminado ? "bg-moss" : "bg-amber"}`} style={{ width: `${Math.max(p.estado === "procesando" ? 3 : 0, prog.pct)}%` }} />
      </div>

      {p.estado === "encolado" && (
        <p className="mt-3 text-[12px] text-mute">
          Asignado a un aporte confirmado; el sistema lo toma en orden de llegada.
          {p.intentos > 0 && <> Intentos previos: <span className="font-mono">{p.intentos}</span>; se reintenta automáticamente.</>}
        </p>
      )}
      {p.estado === "error" && (
        <p className="mt-3 text-[12px] text-crimsonTexto">
          {p.intentos < 3
            ? "El intento anterior falló; el pipeline vuelve a tomar el contrato desde el inicio."
            : "Tras 3 intentos automáticos quedó en revisión manual. El equipo lo re-encolará y el aporte no pierde su contrato."}
        </p>
      )}
      {sinEventos && (
        <p className="mt-3 text-[12px] text-mute">Los agentes todavía no emiten eventos: el orquestador está tomando el contrato (puede tardar un minuto si hay varios en cola).</p>
      )}

      <div className={`${compacto ? "mt-3" : "mt-4"} border-t border-line ${compacto ? "pt-3" : "pt-4"}`}>
        {puedeRepetir && (
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-[11px] text-mute">
              {verReplay ? "Repitiendo la bitácora real de este análisis." : "Este análisis ya terminó — podés repetir cómo ocurrió, agente por agente."}
            </span>
            <button
              type="button"
              onClick={() => setVerReplay((v) => !v)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-[11px] font-semibold text-paper transition-transform hover:scale-[1.02]"
            >
              <Play size={11} /> {verReplay ? "Ver el resultado final" : "Ver cómo se analizó"}
            </button>
          </div>
        )}
        {verReplay && puedeRepetir ? (
          <ReplayAnalisis eventos={p.eventos} estadoFinal={estado} compacto={compacto} />
        ) : (
          <>
            {!compacto && p.estado === "procesando" && (
              <div className="mb-4">
                <FlowGraph override={{ ...nodoActivoYHechos(fases), narracion: faseHumana(p, montado ? ahora : undefined, fases) }} />
              </div>
            )}
            <DagCarriles fases={fases} estado={estado} ahora={ahora} compacto={compacto} senales={p.resultado?.banderas ?? null} />
            {terminado && <FichaTecnica p={p} fases={fases} duro={duro} compacto={compacto} />}
            <div className={`${compacto ? "mt-3" : "mt-4"} border-t border-line ${compacto ? "pt-3" : "pt-4"}`}>
              <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-mute">
                <span>Bitácora</span>
                <span className="font-mono normal-case tracking-normal">{p.eventos.length} eventos</span>
              </div>
              <Bitacora eventos={p.eventos} ahora={ahora} max={compacto ? 6 : 12} activo={activo} compacto={compacto} />
            </div>
          </>
        )}
      </div>
    </section>
  );

  if (compacto) {
    return (
      <div className="space-y-3">
        {terminado && (
          <ResultadoAnalisis resultado={p.resultado ?? null} ocid={p.ocid} score={p.score} banderas={p.banderas} duracionMs={duro} compacto sharePath={`/app/contratos/${encodeURIComponent(p.ocid)}`} />
        )}
        {ejecucion}
        <div className="flex items-center justify-between text-[11px] text-mute">
          {enVivoBadge}
          <Link href={`/app/auditoria/${encodeURIComponent(p.ocid)}`} className="hover:underline">Ver en auditoría en vivo</Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-mute">
        <Link href={`/app/auditoria?ubigeo=${p.ubigeo.slice(0, 2)}`} className="inline-flex items-center gap-1 hover:underline">
          <ChevronLeft size={14} /> Auditoría en vivo
        </Link>
        {enVivoBadge}
      </div>

      {/* cabecera */}
      <header className="mt-3 rounded-3xl border border-line bg-paper p-6 shadow-sm sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] uppercase tracking-wide text-mute">
              <span className="font-mono normal-case tracking-normal">{p.ocid}</span>
              {p.alertaCodigo && <span className="font-mono normal-case tracking-normal">{p.alertaCodigo}</span>}
            </div>
            <h1 className="mt-1 font-serif text-2xl font-bold leading-tight text-ink sm:text-3xl">{p.titulo ?? "Contrato sin título registrado"}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-mute">
              <span className="inline-flex items-center gap-1"><Landmark size={13} aria-hidden /> {p.entidad ?? "Entidad no identificada"}</span>
              <Link href={`/app/financiar/${p.ubigeo}`} className="hover:underline">{p.zona}</Link>
              {p.montoPen != null && p.montoPen > 0 && <span className="font-mono text-ink">{formatPEN(p.montoPen)}</span>}
            </div>
          </div>
          <EstadoPill estado={estado} size="md" />
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-sm text-mute">
          <p className="flex flex-wrap items-center gap-x-1">
            <ShieldCheck size={14} className="text-moss" aria-hidden />
            gracias a <span className="font-semibold text-ink">{p.financiador}</span>
            <Link href={`/impacto/${p.contribucionCodigo}`} className="ml-2 font-mono hover:underline">
              {p.contribucionCodigo}
            </Link>
          </p>
          {!terminado && <CompartirButton titulo={`${p.titulo ?? p.ocid} — auditoría en vivo`} texto="Mira cómo se ejecuta el análisis de este contrato." path={`/app/auditoria/${encodeURIComponent(p.ocid)}`} className="rounded-full" />}
        </div>
      </header>

      <div className={`mt-6 grid gap-6 ${terminado ? "lg:grid-cols-[1.1fr_1fr]" : ""}`}>
        {terminado && (
          <ResultadoAnalisis resultado={p.resultado ?? null} ocid={p.ocid} score={p.score} banderas={p.banderas} duracionMs={duro} className="animate-slideUp lg:sticky lg:top-24 lg:self-start" />
        )}
        <div className="space-y-4">
          {ejecucion}
          <div className="flex items-start gap-2 rounded-xl bg-paperDeep p-4 text-[12px] text-mute">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-moss" aria-hidden />
            <span>El pipeline no sabe quién financió este análisis. Los resultados se publican aunque señalen al financiador. <Link href="/app/financiar#independencia" className="underline">Reglas de independencia</Link>.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Ficha técnica del análisis terminado: tiempo por agente (de `fases`), costo y tokens
 * (llm_metrics), modelo, perfil y versión de las reglas. Plegable para no estorbar.
 */
function FichaTecnica({ p, fases, duro, compacto }: { p: ProcesamientoDetalle; fases: ReturnType<typeof fasesEfectivas>; duro: number | null; compacto: boolean }) {
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
  if (!filas.length && !r?.costo && !r?.modelo) return null;
  const costo = r?.costo ?? null;
  return (
    <details className={`${compacto ? "mt-3" : "mt-4"} border-t border-line ${compacto ? "pt-3" : "pt-4"} text-[12px]`}>
      <summary className="cursor-pointer select-none text-[10px] font-semibold uppercase tracking-wide text-mute hover:text-ink">
        <span className="inline-flex flex-wrap items-baseline gap-x-3">
          <span>Ficha técnica y tiempos por agente</span>
          {costo?.costoUsd != null && <span className="font-mono normal-case">US$ {costo.costoUsd.toFixed(2)}</span>}
          {duro ? <span className="font-mono normal-case">{duracion(duro)} en total</span> : null}
        </span>
      </summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
        <table className="w-full text-left text-[11px]">
          <caption className="sr-only">Tiempo por agente</caption>
          <thead className="text-[9px] uppercase tracking-wide text-mute"><tr><th className="py-1 pr-2 font-semibold">Agente</th><th className="py-1 pr-2 font-semibold">Estado</th><th className="py-1 text-right font-semibold">Tiempo</th></tr></thead>
          <tbody className="divide-y divide-line">
            {filas.map((f) => (
              <tr key={f.k}>
                <td className="py-1 pr-2 text-ink">{faseLabel(f.k)}</td>
                <td className="py-1 pr-2 text-mute">{f.estado === "hecho" ? "completado" : f.estado === "omitido" ? `omitido${f.motivo ? `: ${f.motivo}` : ""}` : f.estado}</td>
                <td className="py-1 text-right font-mono tabular-nums text-ink">{f.ms != null && f.estado !== "omitido" ? (f.ms < 1000 ? "<1 s" : duracion(f.ms)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="space-y-1 text-[11px] sm:min-w-[180px]">
          <div><dt className="text-[9px] uppercase tracking-wide text-mute">Perfil del pipeline</dt><dd className="font-mono text-ink">{r?.perfil ?? "bienes"}</dd></div>
          {r?.modelo && <div><dt className="text-[9px] uppercase tracking-wide text-mute">Modelo</dt><dd className="font-mono text-ink">{r.modelo}</dd></div>}
          {costo && (
            <div>
              <dt className="text-[9px] uppercase tracking-wide text-mute">Costo del análisis</dt>
              <dd className="flex flex-wrap items-baseline gap-x-3 font-mono text-ink">
                <span>{costo.costoUsd != null ? `US$ ${costo.costoUsd.toFixed(3)}` : "—"}</span>
                {costo.llamadas != null && <span className="text-mute">{costo.llamadas} llamadas</span>}
                {costo.tokens != null && <span className="text-mute">{Math.round(costo.tokens / 1000)}k tokens</span>}
              </dd>
            </div>
          )}
          {r?.analizadoEn && <div><dt className="text-[9px] uppercase tracking-wide text-mute">Analizado</dt><dd className="text-ink" suppressHydrationWarning>{new Date(r.analizadoEn).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" })}</dd></div>}
          <div><dt className="text-[9px] uppercase tracking-wide text-mute">Versión de reglas</dt><dd className="text-ink"><VersionReglas perfil={r?.perfil} /></dd></div>
        </dl>
      </div>
    </details>
  );
}

function VersionReglas({ perfil }: { perfil: string | null | undefined }) {
  const [v, setV] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    getReglasPerfil((perfil ?? "bienes").toLowerCase()).then((r) => { if (vivo && r) setV(`${r.version}, ${r.reglas.length} reglas`); });
    return () => { vivo = false; };
  }, [perfil]);
  return <span className="font-mono">{v ?? "—"}</span>;
}
