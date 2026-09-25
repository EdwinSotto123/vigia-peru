"use client";

/**
 * El estado actual de la auditoría, arriba del Tablero (DESIGN_SYSTEM.md §14): las cifras en
 * `Indicadores` —número grande, qué es, contexto—, debajo un visual compacto (la barra del
 * ciclo y los análisis por día) y una línea de "ahora mismo". Antes todo esto iba en frases
 * grises ("34 de 100 financiados en todo el Perú con dictamen publicado · 0 leídos hoy…"):
 * la cifra y lo que cuenta se perdían en la misma línea.
 *
 * Es la ÚNICA fuente de conteos del estado global en la pantalla, y habla de todo el Perú aunque
 * el tablero de abajo esté filtrado (el endpoint de resumen no acepta `ubigeo`; se dice en el ⓘ).
 *
 *  · `procesado` se parte en "con dictamen publicado" (procesado − revisión) y "financiados
 *    en revisión": son doce de esos 33, no doce más. Sumarlos era el doble conteo de antes.
 *  · "En espera" es la misma palabra y el mismo número que el rótulo del grupo del tablero
 *    (esperan documentos + en cola + con error + sin análisis aplicable), sin filtros puestos.
 *  · Ritmo real: los análisis que terminaron cada día (hora de Lima) y "último hace N días".
 *    Es lo que impide que la pantalla parezca viva cuando lleva días quieta.
 *
 * "Ahora mismo" (la cola de descarga) va como UNA línea y no como otra fila de Indicadores:
 * es detalle operativo que cambia de minuto a minuto, y sus pedidos pendientes son casi
 * siempre los mismos contratos que "esperan documentos". Con cifras grandes competiría con el
 * estado del ciclo y lo repetiría.
 *
 * Poll cada `pollMs` (5 s) solo con la pestaña visible. Sin región viva: la de la página es la
 * del tablero, que anuncia cambios reales.
 *
 * Datos: GET /financiamiento/procesamientos/resumen
 *        GET /financiamiento/procesamientos?estado=procesado&limit=300 (ritmo)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Cpu, Download, WifiOff } from "lucide-react";
import {
  PUBLIC_API_BASE,
  diaCorto,
  fechaLima,
  haceCuanto,
  procesamientosQueryString,
  ritmoDiario,
  tipoContratoHumano,
  type Procesamiento,
} from "@/lib/auditoria";
import type { ResumenProcesamientoVivo } from "@/lib/contratos";
import { Indicadores, IndicadoresSkeleton, type Indicador } from "@/components/listado";
import { PulseDot } from "@/components/ui/PulseDot";
import { Ayuda } from "@/components/patrones/Ayuda";
import { numero, plural } from "@/lib/formato";
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

/** Las etiquetas de los Indicadores. */
const ETIQUETAS = ["con dictamen publicado", "financiados en revisión", "financiados en espera", "leídos hoy"];

export function PanelProcesamiento({ initial, pollMs = 5000, alcance = "en todo el Perú", finalizados: finalizadosIniciales }: Props) {
  const [data, setData] = useState<ResumenProcesamientoVivo | null>(initial ?? null);
  const [fallo, setFallo] = useState(false);
  const [ahora, setAhora] = useState(0);   // 0 hasta montar: sin desajuste de hidratación en los relativos
  const [finalizados, setFinalizados] = useState<string[] | null>(finalizadosIniciales ?? null);
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
    // Un minuto basta: acá no hay cronómetros, sólo "último análisis hace N h".
    setAhora(Date.now());
    const tick = window.setInterval(() => setAhora(Date.now()), 60_000);
    return () => { vivo = false; ctrl?.abort(); window.clearInterval(id); window.clearInterval(tick); };
    // `finalizadosIniciales` sólo decide la primera carga.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs]);

  // Ritmo real, en días de Lima. `ahora` es 0 en el servidor: el día de hoy se toma del reloj.
  const reloj = ahora || Date.now();
  const ritmo = useMemo(() => (finalizados ? ritmoDiario(finalizados, reloj, DIAS_RITMO) : null), [finalizados, Math.floor(reloj / 60_000)]); // eslint-disable-line react-hooks/exhaustive-deps
  const ultimoFin = useMemo(() => {
    let max = -Infinity;
    for (const f of finalizados ?? []) { const t = Date.parse(f); if (Number.isFinite(t) && t > max) max = t; }
    return Number.isFinite(max) ? max : null;
  }, [finalizados]);

  if (!data) {
    return fallo ? (
      <p className="inline-flex items-center gap-1.5 rounded-xl bg-crimson-soft/60 px-3 py-2 text-[13px] text-crimsonTexto">
        <WifiOff size={13} aria-hidden /> No pudimos leer el estado de la auditoría; se vuelve a intentar solo.
      </p>
    ) : (
      <IndicadoresSkeleton n={4} />
    );
  }

  const e = data.porEstado ?? {};
  const esperando = e.esperando_documentos ?? 0;
  const cola = e.encolado ?? 0;
  const conError = e.error ?? 0;
  const sinAnalisis = e.pendiente_de_procesamiento ?? 0;
  const procesando = e.procesando ?? 0;
  const leidos = e.procesado ?? 0;
  const enRevision = data.enRevision ?? e.revision ?? 0;
  // `revision` NO es un estado aparte en la base: es `procesado` con la alerta bloqueada por
  // la autoevaluación. Restarlo es lo que impide contar los mismos contratos dos veces.
  const publicados = Math.max(0, leidos - enRevision);
  const enEspera = esperando + cola + conError + sinAnalisis;

  // Orden cronológico del ciclo: llega → espera documentos → espera turno → lo leen →
  // lo revisa una persona → se publica. Los dos estados excepcionales van al final.
  const tramos: Tramo[] = [
    // Sin "lote nocturno": es el diseño (backend/dispatcher/README.md), pero los pedidos
    // pendientes pueden pasar días sin que nadie los tome. Se dice sólo lo que siempre es cierto.
    { clave: "esperando", label: "esperan documentos", value: esperando, color: "bg-mute",
      titulo: "Financiados cuyos documentos del SEACE todavía no se descargaron. La descarga se hace desde una conexión en Perú, porque el SEACE bloquea los servidores en la nube; cuando termina, el contrato pasa a la cola." },
    { clave: "cola", label: "en cola", value: cola, color: "bg-inkSoft",
      titulo: "Con documentos listos, esperando turno. El turno es automático, por antigüedad: nadie elige cuál va primero." },
    { clave: "procesando", label: "en análisis", value: procesando, color: "bg-amber",
      titulo: "Los agentes los están leyendo en este momento." },
    // "Financiados en revisión" (§10.1): esta barra sólo conoce lo financiado.
    { clave: "revision", label: "en revisión", value: enRevision, color: "bg-clay",
      titulo: "Financiados cuyo análisis terminó, pero la autoevaluación no alcanzó el mínimo: una persona lo revisa antes de publicarlo. Cuentan como leídos, no como señales." },
    { clave: "publicado", label: "con dictamen publicado", value: publicados, color: "bg-moss",
      titulo: "Dictamen público, con cada señal citando norma y evidencia." },
    // Error de SISTEMA = crimson (DESIGN_SYSTEM.md §3.7); rust es la severidad alta de una señal.
    { clave: "error", label: "con error", value: conError, color: "bg-crimson",
      titulo: "El análisis falló y se reintenta automáticamente, hasta tres veces." },
    { clave: "pendiente", label: "sin análisis aplicable", value: sinAnalisis, color: "bg-paperEdge",
      titulo: "Contratos de un tipo o una etapa que todavía no se analiza." },
  ].filter((t) => t.value > 0);
  const financiados = tramos.reduce((s, t) => s + t.value, 0);

  const hoy = ritmo?.[ritmo.length - 1]?.n ?? data.procesadosHoy ?? 0;
  const totalRitmo = ritmo ? ritmo.reduce((s, d) => s + d.n, 0) : null;

  const items: Indicador[] = [
    {
      valor: numero(publicados),
      etiqueta: ETIQUETAS[0],
      contexto: `de ${numero(financiados)} financiados`,
      ayuda: (
        <Ayuda titulo="¿Cómo se cuenta?">
          <span className="block">
            Todos los contratos financiados {alcance}, aunque filtres el tablero de abajo. Los días se cuentan en hora de Lima.
          </span>
          <span className="mt-2 block text-mute">
            Un contrato en revisión ya se leyó, pero su dictamen no está publicado: cuenta como leído, no como señal.
          </span>
        </Ayuda>
      ),
    },
    {
      valor: numero(enRevision),
      etiqueta: ETIQUETAS[1],
      contexto: `de ${numero(leidos)} leídos`,
      // La lista de esos mismos contratos, con el motivo de cada uno.
      href: "/app/hallazgos?vista=revision",
    },
    { valor: numero(enEspera), etiqueta: ETIQUETAS[2], contexto: composicionEspera(esperando, cola, conError, sinAnalisis) },
    {
      valor: numero(hoy),
      etiqueta: hoy === 1 ? "leído hoy" : ETIQUETAS[3],
      contexto: (
        <>
          {totalRitmo != null && <>{numero(totalRitmo)} en {DIAS_RITMO} días · </>}
          <UltimoTerminado ultimoFin={ultimoFin} ahora={ahora} />
        </>
      ),
    },
  ];

  const pedidos = data.pedidos ?? null;
  const lote = data.lote ?? null;
  const tipos = (data.procesamientoActivo?.tipos_activos ?? []).map((t) => tipoContratoHumano(t)).filter((t): t is string => !!t);

  return (
    <section aria-label="Estado de la auditoría" className="space-y-3">
      {financiados === 0 ? (
        <p className="text-[13px] text-mute">Todavía no hay ningún contrato financiado {alcance}.</p>
      ) : (
        <>
          <Indicadores items={items} />
          {/* El visual no repite cifras: la proporción del ciclo y la forma del ritmo. Cada
              segmento y cada día llevan su número exacto en `title` y en el nombre accesible. */}
          <div className="flex flex-wrap items-center gap-x-8 gap-y-3 px-1">
            <Ciclo tramos={tramos} financiados={financiados} />
            {ritmo && <BarrasRitmo ritmo={ritmo} />}
          </div>
        </>
      )}

      {/* Ahora mismo: una línea. Nada de lo que ya dicen los Indicadores se repite acá. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-paperSoft px-3 py-2 text-[12.5px] text-inkSoft">
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
          {procesando > 0 ? <PulseDot color="amber" size={6} /> : <Cpu size={12} aria-hidden />}
          Ahora mismo
        </span>
        {fallo ? (
          <span className="inline-flex items-center gap-1 text-crimsonTexto"><WifiOff size={11} aria-hidden /> Sin conexión con el servicio; reintentando…</span>
        ) : (
          <span className={procesando > 0 ? "font-medium text-amberTexto" : undefined}>
            {procesando > 0 ? plural(procesando, "contrato en análisis", "contratos en análisis") : "Ningún contrato en análisis"}
          </span>
        )}
        {pedidos && pedidos.pendientes + pedidos.descargando > 0 && (
          // Los números del pedido de descarga, tal cual (ceros incluidos): si nadie los toma, se ve.
          <span>
            Descarga de documentos: <span className="tabular-nums text-ink">{numero(pedidos.descargando)}</span> en curso ·{" "}
            <span className="tabular-nums text-ink">{numero(pedidos.pendientes)}</span> {pedidos.pendientes === 1 ? "pendiente" : "pendientes"} ·{" "}
            <span className="tabular-nums text-ink">{numero(pedidos.listos24h)}</span> {pedidos.listos24h === 1 ? "lista" : "listas"} en 24 h
            {pedidos.fallidos > 0 && (
              <span className="text-crimsonTexto"> · {plural(pedidos.fallidos, "fallida", "fallidas")}</span>
            )}
          </span>
        )}
        {lote && (
          <span className="inline-flex items-center gap-1.5 text-mute" title={`Lote ${lote.id}${lote.tipo ? ` de tipo ${lote.tipo}` : ""}`}>
            <Download size={11} aria-hidden />
            lote de documentos <span className="tabular-nums text-inkSoft">{lote.completados ?? 0}/{lote.total ?? "?"}</span>
            {(lote.fallidos ?? 0) > 0 && <span className="text-crimsonTexto">{plural(lote.fallidos ?? 0, "fallido", "fallidos")}</span>}
          </span>
        )}
        {tipos.length > 0 && (
          <span className="inline-flex items-center gap-1 text-mute">
            Se analizan contratos de {tipos.length === 1 ? tipos[0] : `${tipos.slice(0, -1).join(", ")} y ${tipos[tipos.length - 1]}`}
            {data.procesamientoActivo?.nota && <Ayuda titulo="¿Qué contratos se analizan?">{data.procesamientoActivo.nota}</Ayuda>}
          </span>
        )}
        {data.documentosDescargados7d && data.documentosDescargados7d.n > 0 && (
          // Ingesta, no auditoría: va al final, en voz baja, con su explicación a un clic.
          <span className="inline-flex items-center gap-1 text-mute">
            Catálogo: {numero(data.documentosDescargados7d.n)} documentos en 7 días
            <Ayuda titulo="¿Qué son esos documentos?">
              Documentos del SEACE descargados en los últimos 7 días para{" "}
              {plural(data.documentosDescargados7d.contratos, "contrato", "contratos")} del catálogo general. No son
              contratos financiados: es material para lecturas futuras.
            </Ayuda>
          </span>
        )}
      </div>
    </section>
  );
}

/** De qué está hecho "en espera", en palabras. Un solo motivo: "todos esperan sus documentos". */
function composicionEspera(esperando: number, cola: number, conError: number, sinAnalisis: number): string {
  const partes = [
    { n: esperando, corta: "esperan documentos", todos: "esperan sus documentos" },
    { n: cola, corta: "en cola", todos: "esperan turno en la cola" },
    { n: conError, corta: "con error", todos: "esperan un reintento" },
    { n: sinAnalisis, corta: "sin análisis aplicable", todos: "esperan un análisis aplicable" },
  ].filter((p) => p.n > 0);
  if (partes.length === 0) return "ninguno esperando";
  if (partes.length === 1) return partes[0].n === 1 ? partes[0].todos.replace(/^esperan/, "espera") : `todos ${partes[0].todos}`;
  return partes.map((p) => `${numero(p.n)} ${p.corta}`).join(" · ");
}

/** "último hace 21 h" (la fecha exacta, en `title`). Antes de montar, la fecha: sin relativo en el HTML del servidor. */
function UltimoTerminado({ ultimoFin, ahora }: { ultimoFin: number | null; ahora: number }) {
  if (ultimoFin == null) return <span>ningún análisis terminado</span>;
  const exacta = fechaLima(ultimoFin, { hora: true });
  return (
    <span title={`${exacta}, hora de Lima`} suppressHydrationWarning>
      último {ahora > 0 ? haceCuanto(ahora - ultimoFin) : `el ${exacta}`}
    </span>
  );
}

/** La proporción del ciclo: una barra y su leyenda (sin cifras: están arriba, en los Indicadores). */
function Ciclo({ tramos, financiados }: { tramos: Tramo[]; financiados: number }) {
  const pct = (v: number) => (financiados ? (v / financiados) * 100 : 0);
  return (
    <div className="min-w-[16rem] flex-1 space-y-1.5">
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-paperDeep"
        role="img"
        aria-label={`Ciclo de los ${financiados} financiados: ${tramos.map((t) => `${t.value} ${t.label}`).join(", ")}`}
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-hidden>
          {tramos.map((t) => (
            <li key={t.clave} className="inline-flex items-center gap-1.5 text-[12px] text-inkSoft">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", t.color)} />
              {t.label}
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
    </div>
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
      <figcaption className="mt-0.5 flex justify-between text-[10.5px] text-mute" aria-hidden>
        <span className="font-mono">{diaCorto(ritmo[0].dia)}</span>
        <span>análisis por día</span>
        <span className="font-mono">hoy</span>
      </figcaption>
    </figure>
  );
}
