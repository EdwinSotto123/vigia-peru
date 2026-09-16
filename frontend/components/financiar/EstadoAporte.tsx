/**
 * Estado del aporte en 4 pasos claros (comprobante /impacto/[codigo] y Mi impacto):
 *   pendiente de validación → validado → en proceso → completo
 * Sin hooks: sirve en server components. `rechazada`/`reembolsada` se muestran aparte.
 */

import { Check, Clock, XCircle } from "lucide-react";

export type EstadoContribucion = "pendiente_pago" | "pagada" | "en_proceso" | "procesada" | "rechazada" | "reembolsada" | string;

const PASOS = [
  { k: "pendiente", label: "Pendiente de validación", hint: "Registraste el aporte; validamos el pago en ≤ 48 h." },
  { k: "validado", label: "Validado", hint: "Pago confirmado. Se asignan contratos por antigüedad." },
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

export function EstadoAporte({ estado, procesados = 0, contratos = 0, compacto = false }: { estado: EstadoContribucion; procesados?: number; contratos?: number; compacto?: boolean }) {
  if (estado === "rechazada" || estado === "reembolsada") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-rust/30 bg-crimson-soft px-3 py-1 text-[12px] font-medium text-rust">
        <XCircle size={13} aria-hidden /> {estado === "rechazada" ? "Aporte rechazado" : "Aporte reembolsado"}
      </div>
    );
  }
  const idx = indicePaso(estado, procesados, contratos);
  return (
    <ol className={`grid gap-1 ${compacto ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`} aria-label="Estado del aporte">
      {PASOS.map((p, i) => {
        const done = i < idx, active = i === idx;
        return (
          <li key={p.k} className={`rounded-xl border px-2.5 py-2 ${active ? "border-ink bg-ink text-paper" : done ? "border-moss/30 bg-moss/5 text-ink" : "border-line text-mute"}`} aria-current={active ? "step" : undefined}>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${done ? "bg-moss text-paper" : active ? "bg-paper text-ink" : "border border-line"}`} aria-hidden>
                {done ? <Check size={10} strokeWidth={3} /> : active ? <Clock size={10} /> : null}
              </span>
              <span className="leading-tight">{p.label}</span>
            </div>
            {!compacto && <div className={`mt-1 text-[10px] leading-snug ${active ? "text-paper/70" : "text-mute"}`}>{p.hint}</div>}
          </li>
        );
      })}
    </ol>
  );
}
