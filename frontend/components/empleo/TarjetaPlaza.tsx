import Link from "next/link";
import type { ReactNode } from "react";
import { BadgeCheck, Briefcase, Building2, Eye, GraduationCap, MapPin, Timer, Users } from "lucide-react";
import { SENAL_PLAZA } from "@/lib/planilla";
import { NIVEL, diasParaCierre, entidadNombre, lugar, puesto, textoCierre, textoExperiencia, type PlazaEmpleo } from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";

/** Una etiqueta de la tarjeta: ícono y texto, en su tono. */
export function Chip({ icono, children, tono = "neutro", className }: { icono?: ReactNode; children: ReactNode; tono?: "neutro" | "urgente" | "pronto" | "bien" | "ojo"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-rotulo font-medium",
        tono === "urgente" && "bg-crimson-soft text-crimsonTexto",
        tono === "pronto" && "bg-amber-soft text-amberTexto",
        tono === "bien" && "bg-granate-50 text-granate",
        tono === "ojo" && "border border-amber/40 bg-amber-soft/60 text-amberTexto",
        tono === "neutro" && "bg-paperDeep text-inkSoft",
        className,
      )}
    >
      {icono}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** El tono de la cuenta regresiva: rojo si cierra hoy o mañana, ámbar si en 3 días o menos. */
export function tonoCierre(dias: number | null): "urgente" | "pronto" | "neutro" {
  if (dias == null) return "neutro";
  if (dias <= 1) return "urgente";
  if (dias <= 3) return "pronto";
  return "neutro";
}

/**
 * Una plaza en la lista: el puesto (que abre su ficha), la entidad, lo que paga, cuándo cierra (en rojo si es hoy o
 * mañana), dónde, cuántas vacantes, qué estudios y cuánta experiencia pide, y las señales de Vigía con su nombre corto.
 * La tarjeta entera es el enlace. Server-safe.
 */
export function TarjetaPlaza({ p, base, compacta = false }: { p: PlazaEmpleo; base: string; compacta?: boolean }) {
  const dias = diasParaCierre(p.fechaFin);
  const exp = textoExperiencia(p.expGeneral);
  return (
    <article className="group relative flex min-w-0 flex-col rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/50 hover:bg-paperSoft focus-within:ring-2 focus-within:ring-granate sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={cn("font-semibold leading-snug text-ink", compacta ? "line-clamp-2 text-cuerpo" : "line-clamp-3 text-cuerpo")}>
            <Link href={rutaEn(base, `/plaza/${p.aviso}`)} className="outline-none after:absolute after:inset-0 after:rounded-2xl">
              {puesto(p.titulo)}
            </Link>
          </h3>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-meta text-inkSoft">
            <Building2 size={14} aria-hidden className="shrink-0 text-mute" />
            <span className="truncate" title={entidadNombre(p.entidad)}>
              {entidadNombre(p.entidad)}
            </span>
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className={cn("font-display font-bold leading-none tracking-tight tabular-nums text-ink", compacta ? "text-cuerpo" : "text-bloque")}>{soles(p.remuneracion)}</p>
          <p className="mt-1 text-rotulo text-mute">al mes</p>
        </div>
      </div>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Datos de la plaza">
        <li>
          <Chip icono={<Timer size={13} aria-hidden />} tono={tonoCierre(dias)}>
            {textoCierre(dias)}
          </Chip>
        </li>
        <li>
          <Chip icono={<MapPin size={13} aria-hidden />}>{lugar(p.ubicacion)}</Chip>
        </li>
        {!compacta && p.vacantes != null && (
          <li>
            <Chip icono={<Users size={13} aria-hidden />}>{p.vacantes === 1 ? "1 vacante" : `${numero(p.vacantes)} vacantes`}</Chip>
          </li>
        )}
        {!compacta && (
          <li>
            <Chip icono={<GraduationCap size={13} aria-hidden />}>{NIVEL[p.nivel]?.corto ?? "Según el perfil"}</Chip>
          </li>
        )}
        {!compacta && exp && (
          <li>
            <Chip icono={<Briefcase size={13} aria-hidden />} tono={(p.expGeneral ?? 9) <= 1 ? "bien" : "neutro"}>
              {exp}
            </Chip>
          </li>
        )}
        {!compacta && p.colegiatura && (
          <li>
            <Chip icono={<BadgeCheck size={13} aria-hidden />}>Colegiatura</Chip>
          </li>
        )}
      </ul>
      {!compacta && p.tipos?.length > 0 && (
        <p className="mt-3 flex items-start gap-1.5 text-meta leading-snug text-amberTexto">
          <Eye size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">Ojo: </span>
            {p.tipos.map((t) => SENAL_PLAZA[t]?.corto ?? t).join(", ")}
          </span>
        </p>
      )}
    </article>
  );
}
