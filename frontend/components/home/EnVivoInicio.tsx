"use client";

import { rutaContrato } from "@/lib/rutas";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { PulseDot } from "@/components/ui/PulseDot";
import { PUBLIC_API_BASE, faseHumana, faseProgreso, type Procesamiento } from "@/lib/auditoria";
import { aFilaLeida, aFilaVivo, type FilaLeida, type FilaVivo, type FotoVivo } from "./vivo";
import { oracion, relativo, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";

/**
 * "Estos contratos se están analizando ahora": lo que los agentes de Vigía tienen entre manos, en vivo.
 * Se refresca cada ~10 s SOLO mientras la pestaña está visible. Un clic en una fila abre un panel lateral con
 * lo que se sabe de ese contrato y los caminos: la auditoría en vivo y la ficha.
 *
 * Honestidad: si nada se está procesando en este momento, se dice, y se muestran los últimos contratos LEÍDOS
 * con su fecha (otro título, otro punto de color). Nunca se hace pasar uno por el otro.
 *
 * El servidor entrega la primera foto (props con sólo datos); el cliente la mantiene al día.
 */

const INTERVALO_MS = 10_000;
const MAX_FILAS = 6;

async function pedir(ruta: string): Promise<unknown | null> {
  try {
    const r = await fetch(`${PUBLIC_API_BASE}${ruta}`, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** "3 min", "1 h 5 min": cuánto lleva. */
function duracion(seg: number): string {
  if (seg < 60) return "menos de 1 min";
  const m = Math.floor(seg / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

const pctDe = (f: FilaVivo) => faseProgreso({ estado: "procesando", faseIndex: f.faseIndex, faseActual: f.faseActual, fases: f.fases });
const faseDe = (f: FilaVivo) =>
  faseHumana({ estado: "procesando", faseActual: f.faseActual, faseIndex: f.faseIndex, fases: f.fases, iniciadoAt: null });

export function EnVivoInicio({ inicial }: { inicial: FotoVivo }) {
  const [foto, setFoto] = useState<FotoVivo>(inicial);
  const [sel, setSel] = useState<{ tipo: "vivo" | "leido"; ocid: string } | null>(null);
  // `desde` = el momento (ms) en que se tomó la foto; el reloj corre aparte para que el tiempo avance entre pedidos.
  const [desde, setDesde] = useState<number | null>(null);
  const [ahora, setAhora] = useState<number | null>(null);
  const [aviso, setAviso] = useState("");
  const enCurso = useRef(false);

  const refrescar = useCallback(async () => {
    if (enCurso.current) return;
    enCurso.current = true;
    try {
      const r = (await pedir("/financiamiento/procesamientos/resumen")) as { activos?: Record<string, any>[]; porEstado?: Record<string, number> } | null;
      if (!r) return;
      const activos = (r.activos ?? []).map(aFilaVivo);
      const total = r.porEstado?.procesando || activos.length;
      let leidos: FilaLeida[] | null = null;
      if (activos.length === 0) {
        const l = (await pedir("/financiamiento/procesamientos?estado=procesado&limit=8")) as { data?: Procesamiento[] } | null;
        leidos = l?.data ? l.data.map(aFilaLeida) : null;
      }
      setFoto((prev) => ({
        enAnalisis: activos.slice(0, MAX_FILAS),
        totalEnAnalisis: total,
        ultimosLeidos: leidos ?? prev.ultimosLeidos,
      }));
      setDesde(Date.now());
      setAviso(activos.length > 0 ? `${total} ${total === 1 ? "contrato" : "contratos"} en análisis ahora.` : "Ahora no se está analizando ninguno.");
    } finally {
      enCurso.current = false;
    }
  }, []);

  const sinNada = inicial.enAnalisis.length === 0 && inicial.ultimosLeidos.length === 0;
  useEffect(() => {
    setDesde(Date.now());
    setAhora(Date.now());
    const reloj = setInterval(() => setAhora(Date.now()), 1000);
    const sondeo = setInterval(() => { if (document.visibilityState === "visible") void refrescar(); }, INTERVALO_MS);
    const alVolver = () => { if (document.visibilityState === "visible") void refrescar(); };
    document.addEventListener("visibilitychange", alVolver);
    if (sinNada) void refrescar();
    return () => { clearInterval(reloj); clearInterval(sondeo); document.removeEventListener("visibilitychange", alVolver); };
  }, [refrescar, sinNada]);

  const extra = desde != null && ahora != null ? Math.max(0, Math.round((ahora - desde) / 1000)) : 0;
  const vivo = foto.enAnalisis.length > 0;
  const selVivo = sel?.tipo === "vivo" ? foto.enAnalisis.find((f) => f.ocid === sel.ocid) ?? null : null;
  const selLeido = sel?.tipo === "leido" ? foto.ultimosLeidos.find((f) => f.ocid === sel.ocid) ?? null : null;
  const tituloSel = selVivo?.titulo ?? selLeido?.titulo ?? null;
  if (!vivo && foto.ultimosLeidos.length === 0) return null;

  const filaCls =
    "block w-full px-4 py-3 text-left transition-colors duration-rapido hover:bg-granate-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-granate sm:px-5";

  return (
    <section aria-labelledby="vivo-titulo" className="rounded-2xl border border-line bg-paper">
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <h2 id="vivo-titulo" className="flex items-center gap-2 font-display text-[20px] font-bold leading-tight text-ink">
          <PulseDot color={vivo ? "moss" : "amber"} size={8} />
          {vivo ? "Se están analizando ahora" : "Lo último que se leyó"}
        </h2>
        <p className="mt-1 text-[13.5px] leading-snug text-mute">
          {vivo
            ? "Cada contrato pasa por los agentes de Vigía. Toca uno para ver."
            : "Ahora no se está analizando ninguno. Estos son los últimos contratos que terminaron de leerse."}
        </p>
        <p className="sr-only" role="status" aria-live="polite">{aviso}</p>
      </div>

      <ul className="divide-y divide-line">
        {vivo
          ? foto.enAnalisis.map((f) => (
              <li key={f.ocid}>
                <button type="button" onClick={() => setSel({ tipo: "vivo", ocid: f.ocid })} aria-haspopup="dialog" className={filaCls}>
                  <span className="block truncate text-[15px] font-semibold text-ink">{f.titulo ? oracion(f.titulo) : "Contrato sin título"}</span>
                  <span className="mt-0.5 flex items-center justify-between gap-3 text-[13px] text-mute">
                    <span className="truncate">{faseDe(f)}</span>
                    <span className="shrink-0 tabular-nums">{duracion(f.desdeSeg + extra)}</span>
                  </span>
                  <span aria-hidden className="mt-2 block h-1.5 overflow-hidden rounded-full bg-paperDeep">
                    <span className="block h-full rounded-full bg-granate transition-[width] duration-700" style={{ width: `${Math.max(4, pctDe(f))}%` }} />
                  </span>
                </button>
              </li>
            ))
          : foto.ultimosLeidos.slice(0, MAX_FILAS).map((f) => (
              <li key={f.ocid}>
                <button type="button" onClick={() => setSel({ tipo: "leido", ocid: f.ocid })} aria-haspopup="dialog" className={filaCls}>
                  <span className="block truncate text-[15px] font-semibold text-ink">{f.titulo ? oracion(f.titulo) : "Contrato sin título"}</span>
                  <span className="mt-0.5 flex items-center justify-between gap-3 text-[13px] text-mute">
                    <span className="truncate">{f.zona ?? "Sin zona"}</span>
                    <span className="shrink-0">{f.finalizadoAt ? relativo(f.finalizadoAt) : "Sin fecha"}</span>
                  </span>
                </button>
              </li>
            ))}
      </ul>

      {vivo && foto.totalEnAnalisis > foto.enAnalisis.length && (
        <p className="border-t border-line px-4 py-2.5 text-[13px] text-mute sm:px-5">y {foto.totalEnAnalisis - foto.enAnalisis.length} más en análisis.</p>
      )}
      <div className="border-t border-line px-4 py-3 sm:px-5">
        <Link href="/app/auditoria" className="inline-flex min-h-10 items-center gap-1.5 text-[14px] font-semibold text-granate underline-offset-4 hover:underline">
          Ver la auditoría en vivo <ArrowRight size={14} aria-hidden />
        </Link>
      </div>

      <Panel
        abierto={sel != null}
        onCerrar={() => setSel(null)}
        titulo={tituloSel ? oracion(tituloSel) : "Contrato"}
        descripcion={selVivo ? "Se está analizando ahora" : "Ya se leyó"}
        ancho="md"
        pie={
          sel ? (
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href={selVivo ? rutaContrato(sel.ocid, "vivo") : `/app/contratos/${encodeURIComponent(sel.ocid)}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-granate px-5 text-[15px] font-semibold text-paper hover:bg-granate-deep"
              >
                {selVivo ? "Ver el análisis en vivo" : "Ver el dictamen"} <ArrowRight size={16} aria-hidden />
              </Link>
              {selVivo && (
                <Link href={`/app/contratos/${encodeURIComponent(sel.ocid)}`} className="inline-flex min-h-11 items-center rounded-full border border-paperEdge px-5 text-[15px] font-semibold text-ink hover:bg-paperSoft">
                  Ver la ficha del contrato
                </Link>
              )}
            </div>
          ) : undefined
        }
      >
        {selVivo && <PanelVivo f={selVivo} extra={extra} />}
        {selLeido && <PanelLeido f={selLeido} />}
      </Panel>
    </section>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-paperSoft p-3.5">
      <dt className="text-[12.5px] text-mute">{etiqueta}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold text-ink">{children}</dd>
    </div>
  );
}

function PanelVivo({ f, extra }: { f: FilaVivo; extra: number }) {
  const pct = pctDe(f);
  return (
    <div className="space-y-5">
      <div>
        <p className="flex items-center gap-2 text-[15px] font-semibold text-ink"><PulseDot size={8} /> {faseDe(f)}</p>
        <div aria-hidden className="mt-3 h-2 overflow-hidden rounded-full bg-paperDeep">
          <div className="h-full rounded-full bg-granate" style={{ width: `${Math.max(4, pct)}%` }} />
        </div>
        <p className="mt-1.5 text-[13px] text-mute">{Math.round(pct)} % del recorrido de los agentes</p>
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <Dato etiqueta="Lleva">{duracion(f.desdeSeg + extra)}</Dato>
        <Dato etiqueta="Zona">{f.zona ?? "Sin dato"}</Dato>
        <Dato etiqueta="Lo financia">{f.financiador || "Anónimo"}</Dato>
      </dl>
      <p className="text-[13px] leading-snug text-mute">Una señal es un motivo para revisar un contrato, nunca una acusación. El resultado aparece cuando terminan los agentes.</p>
    </div>
  );
}

function PanelLeido({ f }: { f: FilaLeida }) {
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3">
        <Dato etiqueta="Terminó">{f.finalizadoAt ? relativo(f.finalizadoAt) : "Sin fecha"}</Dato>
        <Dato etiqueta="Señales">{f.banderas > 0 ? `${f.banderas} ${f.banderas === 1 ? "señal" : "señales"}` : "Ninguna señal"}</Dato>
        <Dato etiqueta="Entidad">{f.entidad ? tituloNatural(f.entidad) : "Sin dato"}</Dato>
        <Dato etiqueta="Zona">{f.zona ?? "Sin dato"}</Dato>
        {f.montoPen ? <Dato etiqueta="Valor referencial">{soles(f.montoPen)}</Dato> : null}
        <Dato etiqueta="Lo financió">{f.financiador || "Anónimo"}</Dato>
      </dl>
      <p className="text-[13px] leading-snug text-mute">Una señal es un motivo para revisar un contrato, nunca una acusación.</p>
    </div>
  );
}
