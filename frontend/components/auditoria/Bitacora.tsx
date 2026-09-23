"use client";

/**
 * Bitácora: los últimos `max` eventos del pipeline en lenguaje humano. `warn` en ámbar,
 * `error` en óxido, `final` en musgo. El más reciente arriba.
 *
 * El tiempo de cada fila depende de si la corrida está viva:
 *  · en vivo (`activo`): "hace 12 s", que es lo que importa mientras se mira;
 *  · terminada: "+2:13" desde el primer evento. Un análisis de hace seis días mostraba
 *    "hace 6 d" en las doce filas, que no dice nada; el desfase cuenta cómo corrió.
 *
 * Sin región viva propia: la página tiene UNA sola (en ContratoEnVivo) y anuncia cambios de
 * estado, no cada línea que entra.
 *
 * La clave de cada fila es ts + nombre + tipo (+ ordinal si se repite), contada en orden
 * cronológico: con el índice invertido, cada evento nuevo cambiaba la clave de TODAS las
 * filas y React las volvía a montar.
 */

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { desfase, haceCuanto, horaLima, humanizar, type EventoFase } from "@/lib/auditoria";

interface Props {
  eventos: EventoFase[];
  ahora: number;
  max?: number;
  activo?: boolean;
  compacto?: boolean;
}

export function Bitacora({ eventos, ahora, max = 12, activo = false, compacto = false }: Props) {
  // Claves estables: se cuentan en orden cronológico, así un evento nuevo no mueve las de antes.
  const vistos = new Map<string, number>();
  const conClave = eventos.map((ev) => {
    const base = `${ev.ts}|${ev.name}|${ev.kind}`;
    const n = vistos.get(base) ?? 0;
    vistos.set(base, n + 1);
    return { ev, key: n ? `${base}|${n}` : base };
  });
  const t0 = eventos.reduce((min, ev) => {
    const t = new Date(ev.ts).getTime();
    return Number.isFinite(t) && t < min ? t : min;
  }, Infinity);
  const ultimos = conClave.slice(-max).reverse();

  if (!ultimos.length) {
    return (
      <p className={`text-mute ${compacto ? "text-[11px]" : "text-[12px]"}`}>
        {activo ? "Esperando el primer evento de los agentes…" : "Sin eventos registrados."}
      </p>
    );
  }
  return (
    <ol className={compacto ? "space-y-1" : "space-y-1.5"} aria-label="Bitácora del análisis">
      {ultimos.map(({ ev, key }, i) => {
        const tono = ev.kind === "error" ? "text-rust" : ev.kind === "warn" ? "text-amberTexto" : ev.kind === "final" ? "text-mossTexto" : "text-inkSoft";
        const t = new Date(ev.ts).getTime();
        const tiempo = !Number.isFinite(t)
          ? ""
          : activo
            ? ahora > 0 ? haceCuanto(ahora - t) : ""
            : Number.isFinite(t0) ? desfase(t - t0) : "";
        return (
          <li key={key} className={`flex items-start gap-2 ${compacto ? "text-[11px]" : "text-[12.5px]"} ${i === 0 && activo ? "animate-slideUp" : ""}`}>
            <span className={`mt-[3px] shrink-0 ${tono}`} aria-hidden>
              {ev.kind === "error" ? <XCircle size={12} /> : ev.kind === "warn" ? <AlertTriangle size={12} /> : ev.kind === "final" ? <CheckCircle2 size={12} /> : <span className={`block h-1.5 w-1.5 translate-y-[3px] rounded-full ${i === 0 && activo ? "bg-amber" : "bg-line"}`} />}
            </span>
            <span className={`min-w-0 flex-1 leading-snug ${tono}`}>
              {humanizar(ev)}
              <span className="sr-only">{ev.kind === "error" ? " (error)" : ev.kind === "warn" ? " (advertencia)" : ""}</span>
            </span>
            <time
              dateTime={ev.ts}
              title={`${horaLima(ev.ts)}, hora de Lima`}
              className="shrink-0 font-mono text-[10px] tabular-nums text-mute"
              suppressHydrationWarning
            >
              {tiempo}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
