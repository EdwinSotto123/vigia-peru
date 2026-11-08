import Link from "next/link";
import type { ReactNode } from "react";
import { Dato } from "@/components/ui/Dato";
import { SENAL_PLAZA } from "@/lib/planilla";
import { NIVEL, diasParaCierre, entidadNombre, lugar, puesto, textoCierre, textoExperiencia, type PlazaEmpleo } from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";
import { BadgeCheck, Briefcase, Building2, Eye, GraduationCap, MapPin, Timer, Users } from "./iconos";

/** Una etiqueta de estado: ícono y texto, en su tono. Sólo para lo que tiene estado (el cierre, una señal, «Nueva»). */
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
 * Una plaza en la lista, ordenada para escanear: arriba el puesto (que abre su ficha) con lo que paga a la derecha y la
 * entidad debajo; luego cuándo cierra (la única etiqueta con color, roja si es hoy o mañana) y dónde, y en otra línea lo
 * que pide (estudios, experiencia, colegiatura) como datos con ícono, sin una caja por dato. Las señales de Vigía van al
 * final, una etiqueta por señal. La tarjeta entera es el enlace. `compacta` (portada): sólo puesto, entidad, sueldo,
 * cierre y lugar. Server-safe; los íconos viajan como referencias (./iconos).
 */
/**
 * `ruta`: dónde está la ficha («/plaza» en la portada, «/app/plaza» en la app). `accion`: un botón propio (guardar la
 * plaza) sobre la tarjeta, por encima del enlace que la cubre entera.
 */
export function TarjetaPlaza({
  p, base, compacta = false, ruta = "/plaza", accion, enApp = false, volver,
}: {
  p: PlazaEmpleo;
  base: string;
  compacta?: boolean;
  ruta?: string;
  accion?: ReactNode;
  enApp?: boolean;
  /** Los filtros de la lista, para que la ficha vuelva a ellos (?volver=). */
  volver?: string;
}) {
  const dias = diasParaCierre(p.fechaFin);
  const desde = diasParaCierre(p.fechaInicio);
  const nueva = desde != null && desde <= 0 && desde >= -2;
  const exp = textoExperiencia(p.expGeneral);
  const pocaExp = p.expGeneral != null && p.expGeneral <= 1;
  const nivel = p.nivel && p.nivel !== "sin_dato" ? NIVEL[p.nivel]?.corto : null;
  const vacantes = p.vacantes ?? 1;
  const entidad = entidadNombre(p.entidad);
  return (
    <article
      className={cn(
        "group relative flex h-full min-w-0 flex-col rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/50 focus-within:ring-2 focus-within:ring-granate sm:p-5",
        enApp ? "shadow-caja" : "hover:bg-paperSoft",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className={cn("font-semibold leading-snug text-ink", compacta ? "line-clamp-2 text-cuerpo" : "line-clamp-3 text-cuerpo sm:text-destacado")}>
            <Link
              href={rutaEn(base, `${ruta}/${p.aviso}${volver ? `?volver=${encodeURIComponent(volver)}` : ""}`)}
              className="outline-none transition-colors duration-rapido after:absolute after:inset-0 after:rounded-2xl group-hover:text-granate"
            >
              {puesto(p.titulo)}
            </Link>
          </h3>
          <p className="mt-1 truncate text-meta text-inkSoft" title={entidad}>
            <Dato icono={Building2} nombre="Entidad">
              {entidad}
            </Dato>
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-1">
        <p className="shrink-0 text-right">
          {p.remuneracion ? (
            <>
              <span className={cn("block font-display font-bold leading-none tracking-tight tabular-nums text-ink", compacta ? "text-cuerpo" : "text-bloque")}>
                {soles(p.remuneracion)}
              </span>
              <span className="mt-1 block text-rotulo text-mute">al mes</span>
            </>
          ) : (
            <span className="block max-w-[8ch] text-rotulo leading-snug text-mute">Sueldo sin dato</span>
          )}
        </p>
        {accion && <div className="relative z-10 -mr-1.5 -mt-1.5">{accion}</div>}
        </div>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-inkSoft">
        <Chip icono={<Timer size={13} aria-hidden />} tono={tonoCierre(dias)}>
          {textoCierre(dias)}
        </Chip>
        {!compacta && nueva && <Chip tono="bien">Nueva</Chip>}
        <Dato icono={MapPin} nombre="Lugar" className="min-w-0">
          {lugar(p.ubicacion)}
        </Dato>
        {!compacta && vacantes > 1 && (
          <Dato icono={Users} nombre="Vacantes">
            {numero(vacantes)} vacantes
          </Dato>
        )}
      </p>

      {!compacta && (nivel || exp || p.colegiatura) && (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-inkSoft">
          <span className="sr-only">Lo que pide: </span>
          {nivel && (
            <Dato icono={GraduationCap} nombre="Estudios">
              {nivel}
            </Dato>
          )}
          {exp && (
            <Dato icono={Briefcase} nombre="Experiencia" className={pocaExp ? "font-medium text-granate" : undefined}>
              {exp}
            </Dato>
          )}
          {p.colegiatura && (
            <Dato icono={BadgeCheck} nombre="Requisito">
              Pide colegiatura
            </Dato>
          )}
        </p>
      )}

      {!compacta && p.tipos?.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5 [&>li]:min-w-0 [&>li]:max-w-full" aria-label="Lo que nadie te dice de esta plaza">
          {p.tipos.map((t) => (
            <li key={t}>
              <Chip tono="ojo" icono={<Eye size={13} aria-hidden />}>
                {SENAL_PLAZA[t]?.corto ?? t}
              </Chip>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
