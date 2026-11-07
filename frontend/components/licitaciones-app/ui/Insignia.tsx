import type { ReactNode } from "react";
import { AlertTriangle, CircleAlert, Clock, Info } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { nombreTipo } from "@/lib/licitaciones";
import { vencimiento } from "@/lib/licitaciones-app/formato";
import type { Senal } from "@/lib/licitaciones-app/tipos";
import { cn } from "@/lib/utils";

/**
 * Las insignias de la app. El color se reserva para urgencia y estado (docs/PLAN.md): urgente (rojo) para lo que vence
 * hoy o mañana y las señales altas, aviso (ámbar) para lo que vence en 2 o 3 días y las señales medias, éxito (verde)
 * para lo ganado. Todo lo demás va en neutro. Siempre con texto: el color nunca va solo.
 */
export type Tono = "neutro" | "acento" | "urgente" | "aviso" | "exito";

const TONO: Record<Tono, string> = {
  neutro: "bg-ink/[0.06] text-inkSoft",
  acento: "bg-granate-50 text-granate",
  urgente: "bg-crimson-soft text-crimsonTexto",
  aviso: "bg-amber-soft text-amberTexto",
  exito: "bg-moss/15 text-mossTexto",
};

export function Insignia({ tono = "neutro", Icono, children, title, className }: { tono?: Tono; Icono?: LucideIcon; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-rotulo font-semibold", TONO[tono], className)}>
      {Icono && <Icono size={12} aria-hidden className="shrink-0" />}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** El plazo de consultas: rojo si vence hoy o mañana, ámbar en 2 o 3 días, neutro si falta más o ya pasó. */
export function InsigniaVence({ iso, ahora }: { iso: string | null; ahora?: number }) {
  const v = vencimiento(iso, ahora);
  const tono: Tono = v.estado === "hoy" || (v.estado === "pronto" && (v.dias ?? 9) <= 1) ? "urgente" : v.estado === "pronto" ? "aviso" : "neutro";
  return (
    <Insignia tono={tono} Icono={v.estado === "vencido" || v.estado === "sin_dato" ? undefined : Clock} className={cn(v.estado === "vencido" && "text-mute")}>
      {v.texto}
    </Insignia>
  );
}

export function InsigniaTipo({ tipo }: { tipo: string | null }) {
  return <Insignia>{nombreTipo(tipo)}</Insignia>;
}

const NIVEL: Record<Senal["nivel"], { tono: Tono; Icono: LucideIcon; nombre: string }> = {
  alta: { tono: "urgente", Icono: AlertTriangle, nombre: "Señal alta" },
  media: { tono: "aviso", Icono: CircleAlert, nombre: "Señal media" },
  info: { tono: "neutro", Icono: Info, nombre: "Dato a tener en cuenta" },
};

export function InsigniaSenal({ senal }: { senal: Senal }) {
  const n = NIVEL[senal.nivel];
  return (
    <Insignia tono={n.tono} Icono={n.Icono} title={senal.evidencia}>
      {senal.titulo}
    </Insignia>
  );
}

/** El ícono de una señal solo (en la tabla), con su nombre para el lector de pantalla y al pasar el mouse. */
export function IconoSenal({ senal }: { senal: Senal }) {
  const n = NIVEL[senal.nivel];
  return (
    <span title={`${senal.titulo}: ${senal.evidencia}`} className={cn("grid h-6 w-6 place-items-center rounded-md", TONO[n.tono])}>
      <n.Icono size={13} aria-hidden />
      <span className="sr-only">{`${n.nombre}: ${senal.titulo}.`}</span>
    </span>
  );
}
