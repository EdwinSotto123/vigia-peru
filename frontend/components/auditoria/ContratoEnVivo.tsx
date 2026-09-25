"use client";

/**
 * "Mira cómo se ejecuta": un contrato asignado a un aporte, en vivo.
 *   · cabecera (título, entidad, zona, monto, gracias a {financiador}, {código})
 *   · progreso global (fases hechas / aplicables), tiempo transcurrido y estimado
 *   · los tres carriles del DAG con cada agente (DagCarriles)
 *   · bitácora (últimos 12 eventos humanizados)
 *   · al terminar → Resultados (ResultadoAnalisis) en la misma página
 *
 * Cada estado tiene su propia cadencia de consulta: encolado/procesando cada `pollMs` (3 s),
 * esperando documentos o con error cada minuto (nada cambia en segundos), terminado nunca.
 * Antes un contrato esperando documentos consultaba cada 3 s para siempre y mostraba "Sin
 * actividad", doce filas "pendiente" y "Esperando el primer evento…": un callejón sin salida.
 * Ahora ese estado tiene su propio bloque que explica qué espera y desde cuándo.
 *
 * Revisión humana: ni el puntaje, ni las señales, ni cuántas encontró cada agente. Lo dice
 * ResultadoAnalisis, y acá los carriles no reciben las señales.
 *
 * UNA región viva por página: anuncia cambios de estado y el paso en curso, nada más.
 *
 * `compacto` (aside de /app/contratos/[ocid]): sin cabecera ni navegación; carriles y
 * bitácora corta.
 *
 * Datos: GET /financiamiento/procesamientos/:ocid
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, Clock, Landmark, Play, ShieldCheck, WifiOff } from "lucide-react";
import { solesCompacto } from "@/lib/formato";
import { EstadoError } from "@/components/patrones";
import {
  AGENTES_PROGRESO, ESTADO_PROC, PUBLIC_API_BASE, duracion, estadoVisible, estimadoLabel, faseHumana, faseLabel, fasesEfectivas, fechaLima,
  getReglasPerfil, motivoHumano, nodoActivoYHechos, progresoFases, relojEdad, tipoContratoHumano,
  type EstadoProc, type ProcesamientoDetalle,
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

/** Cada cuánto se vuelve a consultar según el estado; null = no se consulta más. */
function cadencia(estado: EstadoProc | null, pollMs: number): number | null {
  if (estado === "procesando" || estado === "encolado" || estado === null) return Math.max(1500, pollMs);
  if (estado === "esperando_documentos" || estado === "error") return 60_000;
  return null;
}

/** Lo que oye un lector de pantalla cuando el contrato cambia de estado. */
const ANUNCIO_ESTADO: Partial<Record<EstadoProc, string>> = {
  encolado: "El contrato entró a la cola.",
  procesando: "Empezó el análisis.",
  procesado: "El análisis terminó.",
  revision: "El análisis terminó y quedó en revisión humana antes de publicarse.",
  error: "El análisis falló.",
  esperando_documentos: "El contrato quedó esperando sus documentos.",
};

export function ContratoEnVivo({ ocid, initial, pollMs = 3000, compacto = false }: Props) {
  const router = useRouter();
  const [data, setData] = useState<ProcesamientoDetalle | null>(initial ?? null);
  const [cargando, setCargando] = useState(initial == null);
  const [fallo, setFallo] = useState(false);
  // 0 hasta montar: así el HTML del servidor no lleva cronómetros ni "hace N s" (sin desajuste de hidratación).
  const [ahora, setAhora] = useState(0);
  const [anuncio, setAnuncio] = useState("");
  const estadoRef = useRef<EstadoProc | null>(initial?.estado ?? null);
  // Al terminar hacemos UNA lectura más para traer `resultado` (el poll se detiene con el estado final).
  const resultadoPedido = useRef(false);
  // "Ver cómo se analizó": repite la bitácora real ya guardada, para poder mirar la animación
  // aunque el análisis haya terminado hace días (la ventana de verlo EN VIVO es rarísima: solo
  // corre cuando hay algo en cola, unos minutos cada vez).
  const [verReplay, setVerReplay] = useState(false);

  useEffect(() => {
    let vivo = true;
    let ctrl: AbortController | null = null;
    let timer: number | undefined;
    const programar = () => {
      window.clearTimeout(timer);
      const ms = cadencia(estadoRef.current, pollMs);
      if (ms != null) timer = window.setTimeout(tick, ms);
    };
    const cargar = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos/${encodeURIComponent(ocid)}`, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ProcesamientoDetalle;
        if (!vivo) return;
        setData({ ...json, eventos: Array.isArray(json.eventos) ? json.eventos : [] });
        setFallo(false);
        estadoRef.current = json.estado;
        if (json.estado === "procesado" && !json.resultado && !resultadoPedido.current) {
          // el dictamen se publica segundos después del `final`: una relectura corta
          resultadoPedido.current = true;
          window.setTimeout(() => { if (vivo) void cargar(); }, 4000);
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError" || !vivo) return;
        setFallo(true);
      } finally {
        if (vivo) {
          setCargando(false);
          programar();
        }
      }
    };
    function tick() {
      if (document.visibilityState !== "visible") { programar(); return; }
      void cargar();
    }
    void cargar();
    const onVis = () => {
      if (document.visibilityState === "visible" && cadencia(estadoRef.current, pollMs) != null) void cargar();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      vivo = false;
      ctrl?.abort();
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ocid, pollMs]);

  useEffect(() => {
    setAhora(Date.now());
    const id = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const fases = useMemo(() => (data ? fasesEfectivas(data, data.eventos) : {}), [data]);

  // La única región viva: cambios de estado y el paso en curso. Nunca el primer render.
  const anterior = useRef<{ estado: EstadoProc; paso: string } | null>(null);
  useEffect(() => {
    if (!data) return;
    const estado = estadoVisible(data);
    const paso = data.estado === "procesando" ? faseHumana(data, undefined, fases) : "";
    const prev = anterior.current;
    anterior.current = { estado, paso };
    if (!prev) return;
    if (prev.estado !== estado) setAnuncio(ANUNCIO_ESTADO[estado] ?? `Estado: ${ESTADO_PROC[estado].label}.`);
    else if (paso && paso !== prev.paso) setAnuncio(`Ahora: ${paso}.`);
  }, [data, fases]);

  if (!data) {
    return cargando ? (
      <div className="space-y-3 rounded-2xl border border-line bg-paper p-6" aria-busy>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    ) : (
      <EstadoError titulo="No pudimos cargar el estado de este contrato">
        Lo volvemos a intentar solo, en unos segundos. Código: <span className="font-mono">{ocid}</span>
      </EstadoError>
    );
  }

  const p = data;
  const estado = estadoVisible(p);
  const enRevision = estado === "revision";
  const vivoAhora = p.estado === "procesando" || p.estado === "encolado";
  const terminado = p.estado === "procesado";
  const sinEjecucion = p.estado === "esperando_documentos" || p.estado === "pendiente_de_procesamiento";
  const montado = ahora > 0;
  const transcurrido = montado && p.estado === "procesando" && p.iniciadoAt ? ahora - new Date(p.iniciadoAt).getTime() : null;
  const duro = p.iniciadoAt && p.finalizadoAt ? new Date(p.finalizadoAt).getTime() - new Date(p.iniciadoAt).getTime() : null;
  const prog = progresoFases(fases, estado);
  const estimado = p.estimado ?? null;
  const restante = estimado?.medianaSeg && transcurrido != null ? Math.max(0, estimado.medianaSeg * 1000 - transcurrido) : null;
  const sinEventos = p.estado === "procesando" && p.eventos.length === 0;
  const puedeRepetir = terminado && p.eventos.length > 0;

  const regionViva = <p className="sr-only" aria-live="polite" aria-atomic="true">{anuncio}</p>;

  const enVivoBadge = (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      {fallo ? (
        <span className="inline-flex items-center gap-1 text-amberTexto"><WifiOff size={12} aria-hidden /> sin conexión, reintentando</span>
      ) : vivoAhora ? (
        <>
          <PulseDot color="moss" size={6} />
          en vivo
        </>
      ) : p.estado === "esperando_documentos" ? (
        <span className="inline-flex items-center gap-1 text-mute">
          <Clock size={12} aria-hidden />
          {p.iniciadoAt ? `esperando documentos desde el ${fechaLima(p.iniciadoAt)}` : "esperando documentos"}
        </span>
      ) : terminado && p.finalizadoAt ? (
        <span className="text-mute">finalizado el {fechaLima(p.finalizadoAt, { hora: true })}</span>
      ) : null}
    </span>
  );

  // ── Bloque "cómo se ejecuta" (progreso + carriles + bitácora) ──
  const ejecucion = sinEjecucion ? (
    <SinEjecucion p={p} ahora={ahora} compacto={compacto} />
  ) : (
    <section className={`rounded-2xl border bg-paper ${p.estado === "procesando" ? "border-amber/40 ring-1 ring-amber/15" : "border-line"} ${compacto ? "p-4" : "p-5"}`} aria-label="Cómo se ejecuta el análisis">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-mute">
            {p.estado === "procesando" ? "Analizando ahora" : p.estado === "encolado" ? "En cola" : p.estado === "error" ? "Falló el análisis" : terminado ? "Cómo se ejecutó" : "Estado"}
          </div>
          <div className={`mt-0.5 font-semibold text-ink ${compacto ? "text-base" : "text-lg"}`} suppressHydrationWarning>
            {p.estado === "procesando"
              ? faseHumana(p, montado ? ahora : undefined, fases)
              : p.estado === "encolado"
                ? "Espera turno"
                : p.estado === "error"
                  ? p.intentos >= 3 ? "Falló en los 3 intentos" : `Falló el intento ${Math.max(1, p.intentos)} de 3`
                  : terminado
                    // "pasos", no "agentes": prog.hechas cuenta los pasos del DAG, y dos de
                    // ellos (SUNAT/OECE y la autoevaluación) no son agentes de IA: son 10
                    // agentes repartidos en 12 pasos.
                    ? `${prog.hechas} pasos${duro != null && duro > 0 ? ` en ${duracion(duro)}` : ""}`
                    : ESTADO_PROC[estado].label}
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
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuemin={0} aria-valuemax={prog.aplicables} aria-valuenow={prog.hechas} aria-label="Pasos completados">
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
            ? "El intento anterior falló; el análisis vuelve a tomar el contrato desde el inicio."
            : "Tras 3 intentos automáticos quedó en revisión manual. El equipo lo volverá a poner en la cola y el aporte no pierde su contrato."}
        </p>
      )}
      {sinEventos && (
        <p className="mt-3 text-[12px] text-mute">Los agentes todavía no reportan nada: el contrato está entrando al análisis (puede tardar un minuto si hay varios en cola).</p>
      )}

      <div className={`${compacto ? "mt-3" : "mt-4"} border-t border-line ${compacto ? "pt-3" : "pt-4"}`}>
        {puedeRepetir && (
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-[11px] text-mute">
              {verReplay ? "Repitiendo la bitácora real de este análisis." : "Este análisis ya terminó: puedes repetir cómo ocurrió, agente por agente."}
            </span>
            <button
              type="button"
              onClick={() => setVerReplay((v) => !v)}
              className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-[12px] font-semibold text-ink transition-colors hover:bg-paperDeep"
            >
              <Play size={11} aria-hidden /> {verReplay ? "Ver el resultado final" : "Ver cómo se analizó"}
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
            {/* En revisión, los carriles no cuentan señales por agente: serían señales publicadas. */}
            <DagCarriles fases={fases} estado={estado} ahora={ahora} compacto={compacto} senales={enRevision ? null : p.resultado?.banderas ?? null} />
            {terminado && <FichaTecnica p={p} fases={fases} duro={duro} compacto={compacto} />}
            <div className={`${compacto ? "mt-3" : "mt-4"} border-t border-line ${compacto ? "pt-3" : "pt-4"}`}>
              <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-mute">
                <span>Bitácora</span>
                <span className="font-mono font-normal tabular-nums">{p.eventos.length} eventos</span>
              </div>
              <Bitacora eventos={p.eventos} ahora={ahora} max={compacto ? 6 : 12} activo={vivoAhora} compacto={compacto} />
            </div>
          </>
        )}
      </div>
    </section>
  );

  if (compacto) {
    return (
      <div className="space-y-3">
        {regionViva}
        {terminado && (
          <ResultadoAnalisis resultado={p.resultado ?? null} ocid={p.ocid} score={p.score} banderas={p.banderas} duracionMs={duro} revision={enRevision} compacto sharePath={`/app/contratos/${encodeURIComponent(p.ocid)}`} />
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
      {regionViva}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-mute">
        {/* Vuelve a /app/auditoria tal como estaba (con sus filtros) si de ahí se vino; si no,
            al tablero sin filtros. Antes forzaba ?ubigeo= aunque nadie lo hubiera elegido. */}
        <Link
          href="/app/auditoria"
          onClick={(e) => {
            try {
              const ref = document.referrer ? new URL(document.referrer) : null;
              if (ref && ref.origin === window.location.origin && ref.pathname === "/app/auditoria" && window.history.length > 1) {
                e.preventDefault();
                router.back();
              }
            } catch { /* referrer ilegible: se sigue el enlace */ }
          }}
          className="inline-flex items-center gap-1 hover:underline"
        >
          <ChevronLeft size={14} aria-hidden /> Auditoría en vivo
        </Link>
        {enVivoBadge}
      </div>

      {/* cabecera */}
      <header className="mt-3 rounded-2xl border border-line bg-paper p-5 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {/* basis-full en móvil: si no, la píldora de estado le robaba el ancho
              al título y un objeto largo quedaba en una columna de una palabra por renglón. */}
          <div className="min-w-0 flex-1 basis-full sm:basis-0">
            <h1 className="break-words font-display text-[24px] font-bold leading-tight tracking-tight text-ink text-balance sm:text-3xl">{p.titulo ?? "Contrato sin título registrado"}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-mute">
              <span className="inline-flex items-center gap-1"><Landmark size={14} aria-hidden /> {p.entidad ?? "Entidad no identificada"}</span>
              <Link href={`/app/financiar/${p.ubigeo}`} className="hover:underline">{p.zona}</Link>
              {p.montoPen != null && p.montoPen > 0 && <span className="tabular-nums text-ink">valor referencial {solesCompacto(p.montoPen)}</span>}
            </div>
            {/* Los códigos van debajo del título, no encima (sin kicker, DESIGN_SYSTEM.md §4). */}
            <p className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-mute">
              <span>OCID <span className="font-mono">{p.ocid}</span></span>
              {p.alertaCodigo && <span>Alerta <span className="font-mono">{p.alertaCodigo}</span></span>}
            </p>
          </div>
          <div className="order-first sm:order-none">
            <EstadoPill estado={estado} size="md" intentos={p.intentos} />
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-sm text-mute">
          <p className="flex flex-wrap items-center gap-x-1">
            <ShieldCheck size={14} className="text-mossTexto" aria-hidden />
            gracias a <span className="font-semibold text-ink">{p.financiador}</span>
            <Link href={`/impacto/${p.contribucionCodigo}`} className="ml-2 font-mono hover:underline">
              {p.contribucionCodigo}
            </Link>
          </p>
          {!terminado && <CompartirButton titulo={`${p.titulo ?? p.ocid}: auditoría en vivo`} texto="Mira cómo se ejecuta el análisis de este contrato." path={`/app/auditoria/${encodeURIComponent(p.ocid)}`} className="rounded-full" />}
        </div>
      </header>

      <div className={`mt-6 grid gap-6 ${terminado ? "lg:grid-cols-[1.1fr_1fr]" : ""}`}>
        {terminado && (
          <ResultadoAnalisis resultado={p.resultado ?? null} ocid={p.ocid} score={p.score} banderas={p.banderas} duracionMs={duro} revision={enRevision} className="lg:sticky lg:top-24 lg:self-start" />
        )}
        <div className="space-y-4">
          {ejecucion}
          <div className="flex items-start gap-2 rounded-2xl bg-paperSoft p-4 text-[13px] text-inkSoft">
            <ShieldCheck size={14} className="mt-0.5 shrink-0 text-mossTexto" aria-hidden />
            <span>Los agentes no saben quién pagó este análisis. Los resultados se publican aunque señalen a quien lo financió. <Link href="/app/financiar#independencia" className="underline">Reglas de independencia</Link>.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Esperando documentos (o sin análisis aplicable): no hay nada que ejecutar todavía, así que
 * no se dibujan doce pasos "pendiente" ni una bitácora vacía. Se dice qué falta y desde cuándo.
 */
function SinEjecucion({ p, ahora, compacto }: { p: ProcesamientoDetalle; ahora: number; compacto: boolean }) {
  const desde = p.iniciadoAt ? Date.parse(p.iniciadoAt) : NaN;
  const conFecha = Number.isFinite(desde);
  if (p.estado === "pendiente_de_procesamiento") {
    return (
      <section className={`rounded-2xl border border-line bg-paper ${compacto ? "p-4" : "p-5"}`} aria-label="Estado del contrato">
        <div className="text-[12px] font-semibold text-mute">Sin análisis aplicable</div>
        <div className={`mt-0.5 font-semibold text-ink ${compacto ? "text-base" : "text-lg"}`}>Todavía no hay análisis para este tipo de contrato</div>
        <p className="mt-2 text-[13px] leading-relaxed text-inkSoft">
          Este contrato ya está pagado, pero es de un tipo o de una etapa que los agentes todavía no leen. Queda
          reservado: cuando ese análisis exista, entra a la cola sin que nadie tenga que volver a pagarlo.
        </p>
      </section>
    );
  }
  return (
    <section className={`rounded-2xl border border-line bg-paper ${compacto ? "p-4" : "p-5"}`} aria-label="Estado del contrato">
      <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-clayTexto">
        <Clock size={13} aria-hidden /> Esperando documentos
      </div>
      <div className={`mt-0.5 font-semibold text-ink ${compacto ? "text-base" : "text-lg"}`}>Todavía no se puede leer: faltan sus documentos</div>
      <p className="mt-2 text-[13px] leading-relaxed text-inkSoft">
        Este contrato ya está pagado. El análisis empieza cuando se descargan sus documentos publicados en el SEACE.
        Esa descarga se hace desde una conexión en Perú, porque el SEACE bloquea los servidores en la nube. Cuando
        termine, el contrato pasa a la cola y aquí verás a los agentes trabajar.
      </p>
      {conFecha && (
        <dl className="mt-3 grid gap-3 rounded-xl bg-paperSoft p-3 text-[12px] sm:grid-cols-2">
          <div>
            <dt className="text-[12px] font-semibold text-mute">Espera desde</dt>
            <dd className="mt-0.5 text-ink"><time dateTime={p.iniciadoAt!}>{fechaLima(desde, { larga: true, hora: true })}</time></dd>
          </div>
          <div>
            <dt className="text-[12px] font-semibold text-mute">Lleva esperando</dt>
            <dd className="mt-0.5 font-mono tabular-nums text-ink" suppressHydrationWarning>{ahora > 0 ? relojEdad(ahora - desde) : "…"}</dd>
          </div>
        </dl>
      )}
      <p className="mt-3 text-[11px] text-mute">Esta página vuelve a consultar el estado cada minuto.</p>
    </section>
  );
}

const ESTADO_FASE_HUMANO: Record<string, string> = { hecho: "completado", corriendo: "en curso", error: "falló", omitido: "omitido" };

/**
 * Ficha técnica del análisis terminado: tiempo por agente (de `fases`), costo y tokens
 * (llm_metrics), modelo, tipo de contrato y versión de las reglas. Plegable para no estorbar.
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
      <summary className="min-h-[32px] cursor-pointer select-none text-[12px] font-semibold text-mute hover:text-ink">
        <span className="inline-flex flex-wrap items-baseline gap-x-3">
          <span>Ficha técnica y tiempos por agente</span>
          {costo?.costoUsd != null && <span className="font-mono normal-case">US$ {costo.costoUsd.toFixed(2)}</span>}
          {duro ? <span className="font-mono normal-case">{duracion(duro)} en total</span> : null}
        </span>
      </summary>
      <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto]">
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
        <dl className="space-y-1 text-[11px] sm:min-w-[180px]">
          <div><dt className="text-[11px] text-mute">Tipo de contrato</dt><dd className="text-ink">{tipoContratoHumano(r?.perfil) ?? "sin declarar"}</dd></div>
          {r?.modelo && <div><dt className="text-[11px] text-mute">Modelo</dt><dd className="font-mono text-ink">{r.modelo}</dd></div>}
          {costo && (
            <div>
              <dt className="text-[11px] text-mute">Costo del análisis</dt>
              <dd className="flex flex-wrap items-baseline gap-x-3 font-mono text-ink">
                <span>{costo.costoUsd != null ? `US$ ${costo.costoUsd.toFixed(3)}` : "sin dato"}</span>
                {costo.llamadas != null && <span className="text-mute">{costo.llamadas} llamadas</span>}
                {costo.tokens != null && <span className="text-mute">{Math.round(costo.tokens / 1000)}k tokens</span>}
              </dd>
            </div>
          )}
          {r?.analizadoEn && <div><dt className="text-[11px] text-mute">Analizado</dt><dd className="text-ink">{fechaLima(r.analizadoEn, { larga: true, hora: true, anio: true })}</dd></div>}
          <div><dt className="text-[11px] text-mute">Versión de reglas</dt><dd className="text-ink"><VersionReglas perfil={r?.perfil} /></dd></div>
        </dl>
      </div>
    </details>
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
