/**
 * Estado del aporte en 4 pasos claros (comprobante /impacto/[codigo] y Mi impacto):
 *   pendiente de validación → validado → en proceso → completo
 * Sin hooks: sirve en server components. `rechazada`/`reembolsada` se muestran aparte.
 *
 * Un aporte INSTITUCIONAL (lote del capital semilla de Vigía Perú, `pasarela: "institucional"`)
 * nunca pasó por un pago: no se le dice "pago confirmado" ni "validamos el pago", se le dice qué es.
 * Y un aporte con contratos asignados que todavía no empezaron a leerse no dice "los agentes leen":
 * dice desde cuándo espera y por qué, con el dato que da el API (`esperando_documentos`).
 */

import { Check, Clock, XCircle } from "lucide-react";

export type EstadoContribucion = "pendiente_pago" | "pagada" | "en_proceso" | "procesada" | "rechazada" | "reembolsada" | string;

interface Paso { k: string; label: string; hint: string }

const PASOS: Paso[] = [
  { k: "pendiente", label: "Pendiente de validación", hint: "Registraste el aporte; validamos el pago en ≤ 48 h." },
  { k: "validado", label: "Validado", hint: "Pago confirmado. Se asignan contratos por antigüedad." },
  { k: "proceso", label: "En proceso", hint: "Los agentes leen y analizan cada contrato." },
  { k: "completo", label: "Completo", hint: "Todos los contratos financiados tienen resultado." },
];

const PASOS_INSTITUCIONAL: Paso[] = [
  { k: "pendiente", label: "Aporte institucional", hint: "Capital semilla de Vigía Perú: no hay pago que validar." },
  { k: "validado", label: "Contratos asignados", hint: "Salen de la cola de la zona por antigüedad." },
  { k: "proceso", label: "En proceso", hint: "Los agentes leen y analizan cada contrato." },
  { k: "completo", label: "Completo", hint: "Todos los contratos financiados tienen resultado." },
];

export function indicePaso(estado: EstadoContribucion, procesados = 0, contratos = 0): number {
  if (estado === "pendiente_pago") return 0;
  if (estado === "pagada") return procesados > 0 ? 2 : 1;
  if (estado === "en_proceso") return 2;
  if (estado === "procesada" || (contratos > 0 && procesados >= contratos)) return 3;
  return 0;
}

/** "hoy", "hace 1 día", "hace 6 días". */
export function haceDias(iso: string | null | undefined, ahora = Date.now()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const d = Math.floor((ahora - t) / 86_400_000);
  return d <= 0 ? "hoy" : d === 1 ? "hace 1 día" : `hace ${d} días`;
}

export function EstadoAporte({
  estado,
  procesados = 0,
  contratos = 0,
  compacto = false,
  institucional = false,
  espera = null,
}: {
  estado: EstadoContribucion;
  procesados?: number;
  contratos?: number;
  compacto?: boolean;
  /** Lote del capital semilla (`pasarela: "institucional"`): sin paso de pago. */
  institucional?: boolean;
  /**
   * Contratos asignados que todavía no empezaron: cuántos esperan documentos y desde cuándo.
   * Solo se usa mientras ninguno terminó de leerse; reemplaza el "los agentes leen" genérico.
   */
  espera?: { asignadoHace: string | null; esperandoDocumentos: number; asignados: number } | null;
}) {
  if (estado === "rechazada" || estado === "reembolsada") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-rust/30 bg-crimson-soft px-3 py-1 text-[12px] font-medium text-rust">
        <XCircle size={13} aria-hidden /> {estado === "rechazada" ? "Aporte rechazado" : "Aporte reembolsado"}
      </div>
    );
  }
  const idx = indicePaso(estado, procesados, contratos);
  const pasos = (institucional ? PASOS_INSTITUCIONAL : PASOS).map((p) => ({ ...p }));
  // Asignados y sin ninguno leído: el paso activo dice la verdad, no "los agentes leen".
  if (espera && procesados === 0 && (idx === 1 || idx === 2)) {
    const cuando = espera.asignadoHace ? `Asignados ${espera.asignadoHace}. ` : "";
    pasos[idx] = {
      ...pasos[idx],
      label: espera.esperandoDocumentos > 0 ? "Esperando documentos" : pasos[idx].label,
      hint:
        espera.esperandoDocumentos > 0
          ? `${cuando}${espera.esperandoDocumentos} de ${espera.asignados} esperan que se descarguen sus documentos.`
          : `${cuando}Ninguno terminó de leerse todavía.`,
    };
  }
  return (
    <ol className={`grid gap-1 ${compacto ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`} aria-label="Estado del aporte">
      {pasos.map((p, i) => {
        // El último paso, cuando se alcanza, se marca hecho (con check), no "en curso".
        const completo = idx === pasos.length - 1;
        const done = i < idx || (completo && i === idx), active = i === idx && !completo;
        return (
          <li key={p.k} className={`rounded-xl border px-2.5 py-2 ${active ? "border-ink bg-ink text-paper" : done ? "border-moss/30 bg-moss/5 text-ink" : "border-line text-mute"}`} aria-current={active ? "step" : undefined}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${done ? "bg-moss text-paper" : active ? "bg-paper text-ink" : "border border-line"}`} aria-hidden>
                {done ? <Check size={10} strokeWidth={3} /> : active ? <Clock size={10} /> : null}
              </span>
              <span className="leading-tight">{p.label}</span>
            </div>
            {!compacto && <div className={`mt-1 text-[10px] leading-snug ${active ? "text-paper/80" : "text-mute"}`}>{p.hint}</div>}
          </li>
        );
      })}
    </ol>
  );
}
