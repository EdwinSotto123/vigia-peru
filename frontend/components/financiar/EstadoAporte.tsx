/**
 * Estado del aporte en 4 pasos claros (comprobante /impacto/[codigo] y Mi impacto):
 *   pendiente de validación → validado → en proceso → completo
 * Sin hooks: sirve en server components. `rechazada`/`reembolsada` se muestran aparte.
 *
 * Un aporte INSTITUCIONAL (lote del capital semilla de Vigía Perú, `pasarela: "institucional"`)
 * nunca pasó por un pago: no se le dice "pago confirmado" ni "validamos el pago", se le dice qué es.
 * Y un aporte con contratos asignados que todavía no empezaron a leerse no dice "se están leyendo":
 * dice desde cuándo espera y por qué, con el dato que da el API (`esperando_documentos`).
 *
 * Colores (DESIGN_SYSTEM.md §3): hecho = moss (positivo), en curso = granate (la marca
 * acompañando el trámite), pendiente = neutro. Nunca ámbar: el ámbar es "Señal media".
 */

import { Check, Clock, XCircle } from "lucide-react";
import { relativo } from "@/lib/formato";

export type EstadoContribucion = "pendiente_pago" | "pagada" | "en_proceso" | "procesada" | "rechazada" | "reembolsada" | string;

interface Paso { k: string; label: string; hint: string }

const PASOS: Paso[] = [
  { k: "pendiente", label: "Pendiente de validación", hint: "Registraste el aporte; validamos el pago en menos de 48 h." },
  { k: "validado", label: "Validado", hint: "Pago confirmado. Se asignan contratos por antigüedad." },
  { k: "proceso", label: "En proceso", hint: "Se lee cada contrato, completo, contra la norma." },
  { k: "completo", label: "Completo", hint: "Todos los contratos financiados tienen resultado." },
];

const PASOS_INSTITUCIONAL: Paso[] = [
  { k: "pendiente", label: "Aporte institucional", hint: "Capital semilla de Vigía Perú: no hay pago que validar." },
  { k: "validado", label: "Contratos asignados", hint: "Salen de la cola de la zona por antigüedad." },
  { k: "proceso", label: "En proceso", hint: "Se lee cada contrato, completo, contra la norma." },
  { k: "completo", label: "Completo", hint: "Todos los contratos financiados tienen resultado." },
];

/** Pasado este plazo sin validar, "validamos en menos de 48 h" ya no es verdad y no se dice. */
const PLAZO_VALIDACION_MS = 48 * 3_600_000;

export function indicePaso(estado: EstadoContribucion, procesados = 0, contratos = 0): number {
  if (estado === "pendiente_pago") return 0;
  if (estado === "pagada") return procesados > 0 ? 2 : 1;
  if (estado === "en_proceso") return 2;
  if (estado === "procesada" || (contratos > 0 && procesados >= contratos)) return 3;
  return 0;
}

/**
 * Cuándo pasó algo, listo para ir después de un verbo: "hace 3 h", "ayer", "hace 6 días",
 * "el 14 set.". Relativo sólo para lo reciente (lib/formato `relativo`); después, la fecha.
 */
export function haceDias(iso: string | null | undefined, ahora = Date.now()): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const r = relativo(iso, ahora);
  return r.startsWith("hace") || r === "ayer" ? r : `el ${r}`;
}

export function EstadoAporte({
  estado,
  procesados = 0,
  contratos = 0,
  compacto = false,
  institucional = false,
  espera = null,
  registrado = null,
}: {
  estado: EstadoContribucion;
  procesados?: number;
  contratos?: number;
  compacto?: boolean;
  /** Lote del capital semilla (`pasarela: "institucional"`): sin paso de pago. */
  institucional?: boolean;
  /**
   * Contratos asignados que todavía no empezaron: cuántos esperan documentos y desde cuándo.
   * Solo se usa mientras ninguno terminó de leerse; reemplaza el "se está leyendo" genérico.
   */
  espera?: { asignadoHace: string | null; esperandoDocumentos: number; asignados: number } | null;
  /**
   * Cuándo se registró el aporte (ISO). Si lleva más de 48 h sin validar, el paso pendiente
   * deja de prometer el plazo y dice desde cuándo espera.
   */
  registrado?: string | null;
}) {
  if (estado === "rechazada" || estado === "reembolsada") {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-crimson/30 bg-crimson-soft px-3 py-1 text-[12px] font-medium text-crimsonTexto">
        <XCircle size={13} aria-hidden /> {estado === "rechazada" ? "Aporte rechazado" : "Aporte reembolsado"}
      </div>
    );
  }
  const idx = indicePaso(estado, procesados, contratos);
  const pasos = (institucional ? PASOS_INSTITUCIONAL : PASOS).map((p) => ({ ...p }));

  // Pendiente fuera de plazo: se dice tal cual, sin la promesa de las 48 h.
  if (!institucional && idx === 0 && registrado) {
    const t = new Date(registrado).getTime();
    if (!Number.isNaN(t) && Date.now() - t > PLAZO_VALIDACION_MS) {
      pasos[0] = { ...pasos[0], hint: `Registrado ${haceDias(registrado) ?? ""}. El pago todavía no se valida.` };
    }
  }

  // Asignados y sin ninguno leído: el paso activo dice la verdad, no "se está leyendo".
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
    <ol className={`grid gap-1.5 ${compacto ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4"}`} aria-label="Estado del aporte">
      {pasos.map((p, i) => {
        // El último paso, cuando se alcanza, se marca hecho (con check), no "en curso".
        const completo = idx === pasos.length - 1;
        const done = i < idx || (completo && i === idx), active = i === idx && !completo;
        return (
          <li
            key={p.k}
            className={`rounded-xl border px-2.5 py-2 ${active ? "border-granate bg-granate text-paper" : done ? "border-moss/30 bg-moss/10 text-ink" : "border-line bg-paper text-mute"}`}
            aria-current={active ? "step" : undefined}
          >
            <div className="flex items-center gap-1.5 text-[12px] font-semibold">
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${done ? "bg-moss text-paper" : active ? "bg-paper text-granate" : "border border-line"}`} aria-hidden>
                {done ? <Check size={10} strokeWidth={3} /> : active ? <Clock size={10} /> : null}
              </span>
              <span className="leading-tight">{p.label}</span>
              {done && <span className="sr-only">(hecho)</span>}
            </div>
            {!compacto && <div className={`mt-1 text-[11px] leading-snug ${active ? "text-paper/80" : "text-mute"}`}>{p.hint}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * El estado de un aporte como chip de la columna de estado de un listado (§14.1): la
 * lista de aportes de un aliado y la de "Mi impacto" dicen lo mismo con las mismas
 * palabras. Financiado y en proceso = granate (la marca acompañando el trámite); leído =
 * moss (positivo); pendiente = neutro. Nunca ámbar: es "Señal media".
 */
const CHIP_APORTE: Record<string, { label: string; cls: string }> = {
  pendiente_pago: { label: "Pendiente de pago", cls: "bg-paperDeep text-inkSoft border-line" },
  pagada: { label: "Financiado", cls: "bg-granate-soft text-granate border-granate/20" },
  en_proceso: { label: "En proceso", cls: "bg-granate-soft text-granate border-granate/20" },
  procesada: { label: "Leído y publicado", cls: "bg-moss/10 text-mossTexto border-moss/30" },
  rechazada: { label: "Rechazado", cls: "bg-crimson-soft text-crimsonTexto border-crimson/30" },
  reembolsada: { label: "Reembolsado", cls: "bg-paperDeep text-inkSoft border-line" },
};

export function ChipAporte({ estado }: { estado: EstadoContribucion }) {
  const cfg = CHIP_APORTE[estado] ?? { label: estado.replace(/_/g, " "), cls: "bg-paperDeep text-mute border-line" };
  return <span className={`pill whitespace-nowrap ${cfg.cls}`}>{cfg.label}</span>;
}
