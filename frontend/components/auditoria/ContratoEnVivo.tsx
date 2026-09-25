"use client";

/**
 * "Mira cómo se ejecuta": un contrato asignado a un aporte, en vivo, con la plantilla Ficha
 * (DESIGN_SYSTEM.md §14.2):
 *   ← Auditoría en vivo
 *   identidad: h1 (el objeto) · estado (chip) · entidad, zona y códigos en una línea
 *   Indicadores: valor referencial, pasos completados y el tiempo que importa según el estado
 *   estado / veredicto: UNA tarjeta — el resultado (ResultadoAnalisis) o qué pasa ahora
 *   Seccion "cómo se analiza": carriles del DAG, grafo en vivo, tiempos por agente y bitácora
 *   columna lateral (lg): zona, quién pagó y cómo se hizo (DatosProceso)
 *
 * Todo sondea junto (por eso la página entera es este componente): cada estado tiene su propia
 * cadencia de consulta: encolado/procesando cada `pollMs` (3 s), esperando documentos o con
 * error cada minuto (nada cambia en segundos), terminado nunca.
 *
 * Revisión humana: ni el puntaje, ni las señales, ni cuántas encontró cada agente (§10.4).
 * UNA región viva por página: anuncia cambios de estado y el paso en curso, nada más.
 *
 * `compacto` (aside de /app/contratos/[ocid]): sin identidad ni navegación; resultado, una
 * tarjeta de ejecución con la ficha técnica plegada y la bitácora corta.
 *
 * Datos: GET /financiamiento/procesamientos/:ocid
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Landmark, Play, WifiOff } from "lucide-react";
import { numero, soles, solesCompacto } from "@/lib/formato";
import { EstadoError, Seccion, Volver } from "@/components/patrones";
import { Indicadores, type Indicador } from "@/components/listado";
import {
  ESTADO_PROC, PUBLIC_API_BASE, duracion, estadoVisible, estimadoLabel, faseHumana, fasesEfectivas, fechaLima, progresoFases,
  type EstadoProc, type ProcesamientoDetalle,
} from "@/lib/auditoria";
import { PulseDot } from "@/components/ui/PulseDot";
import { Skeleton } from "@/components/ui/Skeleton";
import { CompartirButton } from "./CompartirButton";
import { CabeceraEjecucion, CuerpoEjecucion, DatosProceso, SinEjecucion } from "./EjecucionAnalisis";
import { EstadoPill } from "./EstadoPill";
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

/** "6 días" desde un día; por debajo, la duración exacta. Para una cifra grande, no un reloj. */
const edad = (ms: number) => {
  const d = Math.floor(ms / 86_400_000);
  return d >= 1 ? `${d} ${d === 1 ? "día" : "días"}` : duracion(ms);
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
  // aunque el análisis haya terminado hace días (verlo EN VIVO es rarísimo: unos minutos cada vez).
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
  const duro = p.iniciadoAt && p.finalizadoAt ? new Date(p.finalizadoAt).getTime() - new Date(p.iniciadoAt).getTime() : null;
  const prog = progresoFases(fases, estado);
  const puedeRepetir = terminado && p.eventos.length > 0;

  const regionViva = <p className="sr-only" aria-live="polite" aria-atomic="true">{anuncio}</p>;

  const enVivoBadge = (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
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

  const botonReplay = puedeRepetir ? (
    <button
      type="button"
      onClick={() => setVerReplay((v) => !v)}
      className="inline-flex min-h-[32px] shrink-0 items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-[12px] font-semibold text-ink transition-colors hover:bg-paperDeep"
    >
      <Play size={11} aria-hidden /> {verReplay ? "Ver el resultado final" : "Ver cómo se analizó"}
    </button>
  ) : null;

  const tarjeta = `rounded-2xl border bg-paper ${p.estado === "procesando" ? "border-amber/40 ring-1 ring-amber/15" : "border-line"} ${compacto ? "p-4" : "p-5"}`;

  if (compacto) {
    return (
      <div className="space-y-3">
        {regionViva}
        {terminado && (
          <ResultadoAnalisis resultado={p.resultado ?? null} ocid={p.ocid} score={p.score} banderas={p.banderas} duracionMs={duro} revision={enRevision} compacto sharePath={`/app/contratos/${encodeURIComponent(p.ocid)}`} />
        )}
        {sinEjecucion ? (
          <SinEjecucion p={p} ahora={ahora} compacto />
        ) : (
          <section className={tarjeta} aria-label="Cómo se ejecuta el análisis">
            <CabeceraEjecucion p={p} fases={fases} prog={prog} ahora={ahora} duro={duro} compacto conCifras />
            <div className="mt-3 border-t border-line pt-3">
              {botonReplay && <div className="mb-3 flex justify-end">{botonReplay}</div>}
              <CuerpoEjecucion p={p} fases={fases} ahora={ahora} duro={duro} compacto verReplay={verReplay} />
            </div>
          </section>
        )}
        <div className="flex items-center justify-between text-[11px] text-mute">
          {enVivoBadge}
          <Link href={`/app/auditoria/${encodeURIComponent(p.ocid)}`} className="hover:underline">Ver en auditoría en vivo</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {regionViva}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Volver a /app/auditoria tal como estaba (con sus filtros) si de ahí se vino; si no, al
            tablero sin filtros. `Volver` es un enlace simple: la vuelta atrás se decide al
            capturar el clic, antes que el enlace (que respeta el `preventDefault`). */}
        <span
          onClickCapture={(e) => {
            try {
              const ref = document.referrer ? new URL(document.referrer) : null;
              if (ref && ref.origin === window.location.origin && ref.pathname === "/app/auditoria" && window.history.length > 1) {
                e.preventDefault();
                router.back();
              }
            } catch { /* referrer ilegible: se sigue el enlace */ }
          }}
        >
          <Volver href="/app/auditoria">Auditoría en vivo</Volver>
        </span>
        {enVivoBadge}
      </div>

      {/* Identidad: el objeto entero (es su propia página); estado, entidad, zona y códigos en una línea. */}
      <header className="space-y-2.5">
        <h1 className="max-w-5xl break-words font-display text-[22px] font-bold leading-snug tracking-tight text-ink text-balance sm:text-[26px]">
          {p.titulo ?? "Contrato sin título registrado"}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-mute">
          <EstadoPill estado={estado} size="md" intentos={p.intentos} />
          <span className="inline-flex items-center gap-1 text-inkSoft"><Landmark size={14} aria-hidden /> {p.entidad ?? "Entidad no identificada"}</span>
          <span>{p.zona}</span>
          <span>OCID <span className="font-mono">{p.ocid}</span></span>
          {p.alertaCodigo && <span>Alerta <span className="font-mono">{p.alertaCodigo}</span></span>}
        </div>
      </header>

      <Indicadores items={indicadores(p, prog, duro, ahora)} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          {/* Estado / veredicto: una tarjeta. Terminado, el resultado; si no, qué pasa ahora. */}
          {terminado ? (
            <ResultadoAnalisis resultado={p.resultado ?? null} ocid={p.ocid} score={p.score} banderas={p.banderas} duracionMs={duro} revision={enRevision} />
          ) : sinEjecucion ? (
            <SinEjecucion p={p} ahora={ahora} compacto={false} />
          ) : (
            <section className={tarjeta} aria-label="Estado del análisis">
              <CabeceraEjecucion p={p} fases={fases} prog={prog} ahora={ahora} duro={duro} compacto={false} conCifras={false} />
            </section>
          )}

          {/* En vivo, cómo se ejecuta ES lo que se mira: abierto. Terminado, es el registro de
              cómo se hizo, debajo del resultado: plegado (§14.2, lo largo y secundario). */}
          {!sinEjecucion &&
            (terminado ? (
              <Seccion id="ejecucion" titulo="Cómo se analizó" acciones={botonReplay} plegable>
                <CuerpoEjecucion p={p} fases={fases} ahora={ahora} duro={duro} compacto={false} verReplay={verReplay} />
              </Seccion>
            ) : (
              <Seccion id="ejecucion" titulo="Cómo se está analizando">
                <div className="rounded-2xl border border-line bg-paper p-5">
                  <CuerpoEjecucion p={p} fases={fases} ahora={ahora} duro={duro} compacto={false} verReplay={false} />
                </div>
              </Seccion>
            ))}
        </div>

        <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <DatosProceso p={p} />
          {!terminado && (
            <CompartirButton
              titulo={`${p.titulo ?? p.ocid}: auditoría en vivo`}
              texto="Mira cómo se ejecuta el análisis de este contrato."
              path={`/app/auditoria/${encodeURIComponent(p.ocid)}`}
              className="rounded-full"
            />
          )}
        </aside>
      </div>
    </div>
  );
}

/**
 * Lo que importa del contrato, en cifras (§14.2): cuánto vale, cuánto se avanzó y el tiempo
 * que cuenta según el estado. El conteo de señales no va acá: es el titular de la tarjeta de
 * resultado, justo debajo, y en revisión no se muestra (§10.4).
 */
function indicadores(p: ProcesamientoDetalle, prog: { hechas: number; aplicables: number }, duro: number | null, ahora: number): Indicador[] {
  const montado = ahora > 0;
  const espera = <Skeleton className="h-6 w-16" />;   // antes de montar: sin reloj en el HTML del servidor
  const monto = p.montoPen != null && p.montoPen > 0 ? p.montoPen : null;
  const items: Indicador[] = [
    {
      valor: monto != null ? solesCompacto(monto) : null,
      etiqueta: "valor referencial",
      contexto: monto != null ? `${soles(monto)} según el SEACE` : "el SEACE no publica el valor",
    },
  ];
  if (p.estado === "esperando_documentos") {
    const desde = p.iniciadoAt ? Date.parse(p.iniciadoAt) : NaN;
    if (Number.isFinite(desde)) {
      items.push({
        valor: montado ? <span suppressHydrationWarning>{edad(ahora - desde)}</span> : espera,
        etiqueta: "esperando documentos",
        contexto: `desde el ${fechaLima(desde)}`,
      });
    }
    return items;
  }
  if (p.estado === "pendiente_de_procesamiento") return items;

  items.push({ valor: numero(prog.hechas), etiqueta: "pasos completados", contexto: `de ${numero(prog.aplicables)} que aplican a este contrato` });

  if (p.estado === "procesando") {
    const t = montado && p.iniciadoAt ? ahora - Date.parse(p.iniciadoAt) : null;
    const estimado = p.estimado ?? null;
    const restante = estimado?.medianaSeg && t != null ? Math.max(0, estimado.medianaSeg * 1000 - t) : null;
    items.push({
      valor: t != null && t > 0 ? <span suppressHydrationWarning>{duracion(t)}</span> : espera,
      etiqueta: "en análisis",
      contexto: restante != null ? (restante < 15_000 ? "quedan unos segundos" : `quedan ≈ ${duracion(restante)}`) : `${estimadoLabel(estimado)} en total`,
    });
  } else if (p.estado === "encolado") {
    items.push({ valor: estimadoLabel(p.estimado ?? null), etiqueta: "por contrato", contexto: "lo que suele tardar un análisis" });
  } else if (p.estado === "error") {
    items.push({
      valor: `${Math.min(3, Math.max(1, p.intentos))} de 3`,
      etiqueta: "intentos",
      // Sin tono: un error del sistema no es la severidad de una señal (sólo ésta colorea la cifra).
      contexto: p.intentos >= 3 ? "queda en revisión manual" : "se reintenta solo",
    });
  } else if (p.estado === "procesado" && duro != null && duro > 0) {
    items.push({
      valor: duracion(duro),
      etiqueta: "duró el análisis",
      contexto: p.finalizadoAt ? `terminó el ${fechaLima(p.finalizadoAt, { hora: true })}` : undefined,
    });
  }
  return items;
}
