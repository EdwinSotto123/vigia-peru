"use client";

/**
 * Estado del pipeline: UNA línea de datos (publicados de financiados, leídos hoy, ritmo de 14
 * días, último análisis), UNA barra con el ciclo completo y UNA fila "ahora mismo". Lo que
 * significa cada estado y cómo se cuenta está a un clic (Ayuda), no en párrafos encima de la
 * cifra (DESIGN_SYSTEM.md §10.7). Poll cada `pollMs` (5 s) solo con la pestaña visible.
 *
 * Esta barra es la ÚNICA fuente de conteos de la pantalla. Antes había dos, y los mismos doce
 * contratos aparecían como "esperan documentos" arriba y "en cola" abajo, y los doce en
 * revisión se leían como sumables a los 33 procesados cuando en realidad SON doce de esos 33.
 * Ahora:
 *
 *  · el total es el universo entero (todo lo financiado), no un subconjunto móvil;
 *  · `procesado` se parte en "con dictamen publicado" (procesado − revisión) y "en
 *    revisión humana", que es lo que evita el doble conteo;
 *  · los estados en 0 no dibujan segmento ni entrada de leyenda;
 *  · cada segmento mide exactamente su proporción (value/total), con un piso de 3 px para
 *    que un 1 de 500 siga siendo visible;
 *  · el alcance se DICE: el endpoint no acepta `ubigeo`, así que la barra siempre habla
 *    de todo el Perú aunque el tablero de abajo esté filtrado por región.
 *
 * Ritmo real: cuántos análisis terminaron cada día (hora de Lima), con los días en cero
 * dibujados, y "Último análisis hace N días". Es lo que impide que la pantalla parezca viva
 * cuando lleva días quieta. Sale de `finalizadoAt` de los procesados; se vuelve a pedir sólo
 * cuando el resumen dice que cambió la cantidad de procesados.
 *
 * Sin región viva: el componente entero lo era, cronómetros por segundo incluidos, y el lector
 * de pantalla repetía la tarjeta completa en cada sondeo. La región viva de la página es la
 * del tablero, que anuncia cambios reales.
 *
 * Datos: GET /financiamiento/procesamientos/resumen
 *        GET /financiamiento/procesamientos?estado=procesado&limit=300 (ritmo)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Cpu, Download, WifiOff } from "lucide-react";
import {
  PUBLIC_API_BASE,
  diaCorto,
  duracion,
  faseHumana,
  fasesEfectivas,
  fechaLima,
  haceCuanto,
  procesamientosQueryString,
  progresoFases,
  ritmoDiario,
  tipoContratoHumano,
  type Procesamiento,
} from "@/lib/auditoria";
import type { ResumenProcesamientoVivo } from "@/lib/contratos";
import { PulseDot } from "@/components/ui/PulseDot";
import { Ayuda } from "@/components/patrones/Ayuda";
import { numero, porcentaje } from "@/lib/formato";
import { cn } from "@/lib/utils";

interface Props {
  initial?: ResumenProcesamientoVivo | null;
  pollMs?: number;
  /** Alcance de las cifras, dicho en voz alta. El endpoint de resumen es global. */
  alcance?: string;
  /** `finalizadoAt` de los procesados (todo el Perú), ya pedidos en el servidor: el ritmo real. */
  finalizados?: string[] | null;
}

interface Tramo {
  clave: string;
  label: string;
  value: number;
  color: string;
  titulo: string;
}

/** Piso en píxeles para que un segmento diminuto (1 de 500) no desaparezca. */
const PISO_PX = 3;
const DIAS_RITMO = 14;

export function PanelProcesamiento({ initial, pollMs = 5000, alcance = "en todo el Perú", finalizados: finalizadosIniciales }: Props) {
  const [data, setData] = useState<ResumenProcesamientoVivo | null>(initial ?? null);
  const [fallo, setFallo] = useState(false);
  const [ahora, setAhora] = useState(0);   // 0 hasta montar: sin desajuste de hidratación en los cronómetros
  const [finalizados, setFinalizados] = useState<string[] | null>(finalizadosIniciales ?? null);
  const recibidoAt = useRef<number>(Date.now());
  const procesadosConocidos = useRef<number | null>(initial?.porEstado?.procesado ?? null);

  useEffect(() => {
    let vivo = true;
    let ctrl: AbortController | null = null;
    const pedirRitmo = async () => {
      try {
        const qs = procesamientosQueryString({ estado: "procesado", limit: 300 });
        const res = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos?${qs}`, { cache: "no-store" });
        if (!res.ok) return;
        const j = (await res.json()) as { data?: Procesamiento[] };
        if (vivo && Array.isArray(j.data)) setFinalizados(j.data.map((p) => p.finalizadoAt).filter((f): f is string => !!f));
      } catch { /* el ritmo es accesorio: si falla, queda el último */ }
    };
    const cargar = async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const res = await fetch(`${PUBLIC_API_BASE}/financiamiento/procesamientos/resumen`, { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as ResumenProcesamientoVivo;
        if (!vivo) return;
        setData(json);
        recibidoAt.current = Date.now();
        setFallo(false);
        // El ritmo sólo cambia cuando termina un análisis: se vuelve a pedir sólo entonces.
        const n = json.porEstado?.procesado ?? null;
        if (n != null && n !== procesadosConocidos.current) {
          procesadosConocidos.current = n;
          void pedirRitmo();
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError" || !vivo) return;
        setFallo(true);
      }
    };
    if (finalizadosIniciales == null) void pedirRitmo();
    void cargar();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void cargar(); }, Math.max(2000, pollMs));
    setAhora(Date.now());
    const tick = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => { vivo = false; ctrl?.abort(); window.clearInterval(id); window.clearInterval(tick); };
    // `finalizadosIniciales` sólo decide la primera carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs]);

  const e = data?.porEstado ?? {};
  const esperando = e.esperando_documentos ?? 0;
  const procesando = e.procesando ?? 0;
  const enRevision = data?.enRevision ?? e.revision ?? 0;
  // `revision` NO es un estado aparte en la base: es `procesado` con la alerta bloqueada por
  // la autoevaluación. Restarlo es lo que impide contar los mismos doce contratos dos veces.
  const publicados = Math.max(0, (e.procesado ?? 0) - enRevision);

  // Orden cronológico del ciclo: llega → espera documentos → espera turno → lo leen →
  // lo revisa una persona → se publica. Los dos estados excepcionales van al final.
  const tramos: Tramo[] = [
    // Sin "lote nocturno": es el diseño (backend/dispatcher/README.md), pero los pedidos
    // pendientes pueden pasar días sin que nadie los tome. Se dice sólo lo que siempre es cierto.
    { clave: "esperando", label: "esperan documentos", value: esperando, color: "bg-mute",
      titulo: "Financiados cuyos documentos del SEACE todavía no se descargaron. La descarga se hace desde una conexión en Perú, porque el SEACE bloquea los servidores en la nube; cuando termina, el contrato pasa a la cola." },
    { clave: "cola", label: "en cola", value: e.encolado ?? 0, color: "bg-inkSoft",
      titulo: "Con documentos listos, esperando turno. El turno es automático, por antigüedad: nadie elige cuál va primero." },
    { clave: "procesando", label: "en análisis", value: procesando, color: "bg-amber",
      titulo: "Los agentes los están leyendo en este momento." },
    // "Financiados en revisión" (§10.1): esta barra sólo conoce lo financiado.
    { clave: "revision", label: "en revisión", value: enRevision, color: "bg-clay",
      titulo: "Financiados cuyo análisis terminó, pero la autoevaluación no alcanzó el mínimo: una persona lo revisa antes de publicarlo. Cuentan como leídos, no como señales." },
    { clave: "publicado", label: "con dictamen publicado", value: publicados, color: "bg-moss",
      titulo: "Dictamen público, con cada señal citando norma y evidencia." },
    // Error de SISTEMA = crimson (DESIGN_SYSTEM.md §3.7); rust es la severidad alta de una señal.
    { clave: "error", label: "con error", value: e.error ?? 0, color: "bg-crimson",
      titulo: "El análisis falló y se reintenta automáticamente, hasta tres veces." },
    { clave: "pendiente", label: "sin análisis aplicable", value: e.pendiente_de_procesamiento ?? 0, color: "bg-paperEdge",
      titulo: "Contratos de un tipo o una etapa que todavía no se analiza." },
  ].filter((t) => t.value > 0);

  const financiados = tramos.reduce((s, t) => s + t.value, 0);
  const pct = (v: number) => (financiados ? (v / financiados) * 100 : 0);
  const activos = data?.activos ?? [];
  const lote = data?.lote ?? null;
  const pedidos = data?.pedidos ?? null;
  const drift = ahora > 0 ? Math.max(0, Math.round((ahora - recibidoAt.current) / 1000)) : 0;   // segundos desde el último dato

  // Ritmo real, en días de Lima. `ahora` es 0 en el servidor: el día de hoy se toma del reloj.
  const reloj = ahora || Date.now();
  const ritmo = useMemo(() => (finalizados ? ritmoDiario(finalizados, reloj, DIAS_RITMO) : null), [finalizados, Math.floor(reloj / 60_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const ultimoFin = useMemo(() => {
    let max = -Infinity;
    for (const f of finalizados ?? []) { const t = Date.parse(f); if (Number.isFinite(t) && t > max) max = t; }
    return Number.isFinite(max) ? max : null;
  }, [finalizados]);
  const hoy = ritmo?.[ritmo.length - 1]?.n ?? data?.procesadosHoy ?? 0;
  const totalRitmo = ritmo ? ritmo.reduce((s, d) => s + d.n, 0) : 0;
  const tipos = (data?.procesamientoActivo?.tipos_activos ?? []).map((t) => tipoContratoHumano(t)).filter((t): t is string => !!t);

  return (
    <div className="rounded-2xl border border-line bg-paper">
      <div className="space-y-2 px-3 py-3 sm:px-4">
        {financiados === 0 ? (
          <p className="text-[13px] text-mute">Todavía no hay ningún contrato financiado {alcance}.</p>
        ) : (
          <>
            {/* UNA línea de datos (§10.7): el ciclo, el día y el ritmo, cada cifra con su contexto.
                A la derecha, las barras por día: es lo que impide que la pantalla parezca viva
                cuando lleva días quieta. */}
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] tabular-nums text-inkSoft">
                <span>
                  <strong className="font-semibold text-ink">{numero(publicados)}</strong> de{" "}
                  <strong className="font-semibold text-ink">{numero(financiados)}</strong> financiados {alcance} con dictamen publicado
                </span>
                <span>
                  <strong className="font-semibold text-ink">{numero(hoy)}</strong> {hoy === 1 ? "leído" : "leídos"} hoy
                </span>
                {ritmo && (
                  <span>
                    <strong className="font-semibold text-ink">{numero(totalRitmo)}</strong> en {ritmo.length} días
                  </span>
                )}
                <UltimoTerminado ultimoFin={ultimoFin} ahora={ahora} />
                <Ayuda titulo="¿Cómo se cuenta?">
                  <span className="block">
                    Todos los contratos financiados {alcance}, aunque filtres el tablero de abajo por región. Los días se
                    cuentan en hora de Lima.
                  </span>
                  <span className="mt-2 block text-mute">
                    Un contrato en revisión ya se leyó, pero su dictamen no está publicado: cuenta como leído, no como
                    señal.
                  </span>
                </Ayuda>
              </p>
              {ritmo && <BarrasRitmo ritmo={ritmo} />}
            </div>

            <div
              className="flex h-2 w-full overflow-hidden rounded-full bg-paperDeep"
              role="img"
              aria-label={`${tramos.map((t) => `${t.value} ${t.label}`).join(", ")}; ${financiados} en total`}
            >
              {tramos.map((t) => (
                <div
                  key={t.clave}
                  className={cn(t.color, "h-full")}
                  style={{ width: `${pct(t.value)}%`, minWidth: PISO_PX }}
                  title={`${t.value} ${t.label}`}
                />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {tramos.map((t) => (
                  <li key={t.clave} className="inline-flex items-baseline gap-1.5 text-[12px] text-inkSoft">
                    <span className={cn("relative top-[1px] h-2 w-2 shrink-0 rounded-full", t.color)} aria-hidden />
                    <span className="font-semibold tabular-nums text-ink">{numero(t.value)}</span>
                    {t.label}
                    <span className="text-[11px] tabular-nums text-mute">{porcentaje(pct(t.value))}</span>
                  </li>
                ))}
              </ul>
              <Ayuda titulo="¿Qué es cada estado?" ancho="w-[22rem]">
                {tramos.map((t, i) => (
                  <span key={t.clave} className={cn("block", i > 0 && "mt-1.5")}>
                    <span className="font-semibold text-ink">{t.label.charAt(0).toUpperCase() + t.label.slice(1)}:</span> {t.titulo}
                  </span>
                ))}
              </Ayuda>
            </div>
          </>
        )}
      </div>

      {/* Ahora mismo. Nada de lo que ya cuenta la barra se repite acá. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-paperSoft px-3 py-2 text-[12px] sm:px-4">
        <span className="inline-flex items-center gap-1.5 font-semibold text-inkSoft">
          {procesando > 0 ? <PulseDot color="amber" size={6} /> : <Cpu size={12} aria-hidden />}
          Ahora mismo
        </span>
        {fallo && (
          <span className="inline-flex items-center gap-1 text-crimsonTexto"><WifiOff size={11} aria-hidden /> Sin conexión con el servicio; reintentando…</span>
        )}
        {activos.length === 0 && !fallo && <span className="text-inkSoft">Ningún contrato en análisis</span>}
        {activos.map((a) => {
          const seg = a.desdeSeg + drift;
          // iniciadoAt en el epoch + "ahora" = segundos transcurridos: faseHumana mide la espera sin tocar Date.now() en el render.
          const p = { estado: "procesando" as const, faseActual: a.faseActual, faseIndex: a.faseIndex, fases: a.fases ?? null, iniciadoAt: new Date(0).toISOString() };
          const fases = fasesEfectivas(p);
          const prog = progresoFases(fases, "procesando");
          return (
            <Link
              key={a.ocid}
              href={`/app/auditoria/${encodeURIComponent(a.ocid)}`}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-amber/40 bg-amber-soft px-2 py-0.5 text-[11px] text-ink hover:border-amber"
              title={a.titulo ?? a.ocid}
            >
              <span className="max-w-[14rem] truncate font-medium">{a.titulo ?? a.ocid}</span>
              <span className="font-mono tabular-nums text-mute">{prog.hechas}/{prog.aplicables} pasos</span>
              <span className="truncate text-amberTexto">{faseHumana(p, seg * 1000, fases)}</span>
              <span className="font-mono tabular-nums text-mute">{duracion(seg * 1000)}</span>
            </Link>
          );
        })}
        {pedidos && pedidos.pendientes + pedidos.descargando > 0 && (
          // Los números del pedido de descarga, tal cual (ceros incluidos): si nadie los toma, se ve.
          <span className="text-mute">
            Descargas de documentos:{" "}
            <span className="font-semibold tabular-nums text-inkSoft">{numero(pedidos.pendientes)}</span> {pedidos.pendientes === 1 ? "pendiente" : "pendientes"} ·{" "}
            <span className="font-semibold tabular-nums text-inkSoft">{numero(pedidos.descargando)}</span> en curso ·{" "}
            <span className="font-semibold tabular-nums text-inkSoft">{numero(pedidos.listos24h)}</span> {pedidos.listos24h === 1 ? "lista" : "listas"} en 24 h
            {pedidos.fallidos > 0 && (
              <>
                {" "}· <span className="text-crimsonTexto"><span className="font-semibold tabular-nums">{numero(pedidos.fallidos)}</span> {pedidos.fallidos === 1 ? "fallida" : "fallidas"}</span>
              </>
            )}
          </span>
        )}
        {lote && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2 py-0.5 text-[11px] text-mute" title={`Lote ${lote.id}${lote.tipo ? ` de tipo ${lote.tipo}` : ""}`}>
            <Download size={11} aria-hidden />
            descarga de documentos {lote.completados ?? 0}/{lote.total ?? "?"}
            {lote.total ? (
              <span className="inline-block h-1 w-16 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
                <span className="block h-full bg-moss" style={{ width: `${Math.min(100, Math.round(((lote.completados ?? 0) / lote.total) * 100))}%` }} />
              </span>
            ) : null}
            {(lote.fallidos ?? 0) > 0 && <span className="text-crimsonTexto">{lote.fallidos} fallidos</span>}
          </span>
        )}
        {tipos.length > 0 && (
          <span className="inline-flex items-center gap-1 text-mute">
            Se analizan contratos de {tipos.length === 1 ? tipos[0] : `${tipos.slice(0, -1).join(", ")} y ${tipos[tipos.length - 1]}`}
            {data?.procesamientoActivo?.nota && <Ayuda titulo="¿Qué contratos se analizan?">{data.procesamientoActivo.nota}</Ayuda>}
          </span>
        )}
        {data?.documentosDescargados7d && data.documentosDescargados7d.n > 0 && (
          // Ingesta, no auditoría: va al final, en voz baja, con su explicación a un clic.
          <span className="inline-flex items-center gap-1 text-mute">
            <span>
              Catálogo: <span className="font-semibold tabular-nums text-inkSoft">{numero(data.documentosDescargados7d.n)}</span> documentos de{" "}
              <span className="font-semibold tabular-nums text-inkSoft">{numero(data.documentosDescargados7d.contratos)}</span> contratos en 7 días
            </span>
            <Ayuda titulo="¿Qué son esos documentos?">
              Documentos del SEACE descargados en los últimos 7 días para contratos del catálogo general. No son contratos
              financiados: es material para lecturas futuras.
            </Ayuda>
          </span>
        )}
      </div>
    </div>
  );
}

/** "último análisis hace 21 h" (la fecha exacta, en `title`). Antes de montar, la fecha: sin cronómetro en el HTML del servidor. */
function UltimoTerminado({ ultimoFin, ahora }: { ultimoFin: number | null; ahora: number }) {
  if (ultimoFin == null) return <span>ningún análisis terminado todavía</span>;
  const exacta = fechaLima(ultimoFin, { hora: true });
  return (
    <span title={`${exacta}, hora de Lima`}>
      último análisis{" "}
      <strong className="font-semibold text-ink" suppressHydrationWarning>
        {ahora > 0 ? haceCuanto(ahora - ultimoFin) : `el ${exacta}`}
      </strong>
    </span>
  );
}

/**
 * Barras por día, sin eje inventado: la altura es n / máximo de la ventana. Los días en cero
 * se ven como un trazo en la base: son la parte más importante del dato cuando la cola se
 * detiene. La barra de hoy lleva borde para ubicarse.
 */
function BarrasRitmo({ ritmo }: { ritmo: { dia: string; n: number }[] }) {
  const max = Math.max(1, ...ritmo.map((d) => d.n));
  const total = ritmo.reduce((s, d) => s + d.n, 0);
  const conAnalisis = ritmo.filter((d) => d.n > 0);
  const resumen = conAnalisis.length
    ? `En los últimos ${ritmo.length} días terminaron ${total} análisis: ${conAnalisis.map((d) => `${d.n} el ${diaCorto(d.dia)}`).join(", ")}. Ningún otro día.`
    : `Ningún análisis terminó en los últimos ${ritmo.length} días.`;
  return (
    <figure className="m-0 w-full max-w-[16rem] sm:w-56">
      <div className="flex h-7 items-end gap-[3px]" role="img" aria-label={resumen}>
        {ritmo.map((d, i) => {
          const esHoy = i === ritmo.length - 1;
          return (
            <span
              key={d.dia}
              title={`${diaCorto(d.dia)}${esHoy ? " (hoy)" : ""}: ${d.n} análisis`}
              className={cn(
                "block flex-1 rounded-sm transition-[height] duration-700 ease-out",
                d.n > 0 ? "bg-moss" : "bg-line",
                esHoy && "outline outline-1 outline-offset-1 outline-paperEdge",
              )}
              style={{ height: d.n > 0 ? `${Math.max(12, (d.n / max) * 100)}%` : 2 }}
            />
          );
        })}
      </div>
      <figcaption className="mt-0.5 flex justify-between font-mono text-[10px] text-mute" aria-hidden>
        <span>{diaCorto(ritmo[0].dia)}</span>
        <span>hoy</span>
      </figcaption>
    </figure>
  );
}
