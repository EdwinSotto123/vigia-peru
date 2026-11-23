import Link from "next/link";
import type { ReactNode } from "react";
import { SENAL_PLAZA } from "@/lib/planilla";
import { NIVEL, aniosCorto, diasParaCierre, entidadNombre, fechaDia, lugar, puesto, textoCierre, textoExperiencia, type PlazaEmpleo } from "@/lib/empleo";
import { numero, soles } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { cn } from "@/lib/utils";
import { BadgeCheck, Briefcase, Building2, Eye, GraduationCap, MapPin, Users } from "./iconos";

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
 * El cierre como una hoja de calendario (2026-11-22, el usuario: «esto es texto plano»): arriba la franja en su tono
 * (roja si cierra hoy o mañana, con un punto que late; ámbar si en 3 días), al medio lo que falta en grande («Hoy», «1»,
 * «12») y abajo la fecha. Se lee de un vistazo en una lista de veinte. El texto completo («Cierra en 12 días, 4 dic.»)
 * va para lectores de pantalla.
 */
export function CalendarioCierre({ dias, fechaFin, grande = false, className }: { dias: number | null; fechaFin: string | null | undefined; grande?: boolean; className?: string }) {
  const tono = tonoCierre(dias);
  const cifra = dias == null ? "?" : dias < 0 ? "Cerró" : dias === 0 ? "Hoy" : String(dias);
  const unidad = dias == null || dias <= 0 ? null : dias === 1 ? "día" : "días";
  return (
    <span
      className={cn(
        "flex shrink-0 flex-col overflow-hidden rounded-xl border text-center",
        grande ? "w-20" : "w-[3.75rem]",
        tono === "urgente" ? "border-crimsonTexto/30" : tono === "pronto" ? "border-amber/40" : "border-line",
        className,
      )}
    >
      <span className="sr-only">
        {textoCierre(dias)}
        {fechaFin ? `, ${fechaDia(fechaFin)}` : ""}
      </span>
      <span
        aria-hidden
        className={cn(
          "flex items-center justify-center gap-1 py-0.5 text-rotulo font-semibold",
          tono === "urgente" ? "bg-crimson-soft text-crimsonTexto" : tono === "pronto" ? "bg-amber-soft text-amberTexto" : "bg-paperDeep text-inkSoft",
        )}
      >
        {tono === "urgente" && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-crimsonTexto opacity-60 motion-safe:animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-crimsonTexto" />
          </span>
        )}
        cierra
      </span>
      <span aria-hidden className="flex flex-1 flex-col items-center justify-center bg-paper px-1 py-1">
        <span
          className={cn(
            "font-display font-bold leading-none tabular-nums",
            cifra.length > 3 ? (grande ? "text-bloque" : "text-dato") : grande ? "text-cifra" : "text-seccion",
            tono === "urgente" ? "text-crimsonTexto" : "text-ink",
          )}
        >
          {cifra}
        </span>
        {unidad && <span className="mt-0.5 text-rotulo leading-none text-inkSoft">{unidad}</span>}
      </span>
      <span aria-hidden className="border-t border-line bg-paper py-0.5 text-rotulo font-medium tabular-nums text-mute">
        {fechaFin ? fechaDia(fechaFin) : "sin fecha"}
      </span>
    </span>
  );
}

/** Lo que pide la plaza, en una pastilla con su ícono (en vez de una línea de texto). */
function Pide({ icono, children, destacado = false }: { icono: ReactNode; children: ReactNode; destacado?: boolean }) {
  return (
    <span className={cn("inline-flex min-h-7 max-w-full items-center gap-1 rounded-lg border px-2 py-0.5 text-rotulo font-medium", destacado ? "border-granate/30 bg-granate-50 text-granate" : "border-line bg-paperSoft text-inkSoft")}>
      {icono}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/**
 * Una plaza en la lista (rehecha el 2026-11-22, el usuario: «mejora la ux/ui de todo… esto es texto plano»): a la
 * izquierda el cierre como hoja de calendario; a la derecha el puesto (que abre su ficha), la entidad, el sueldo grande
 * con una barra que lo compara con el mejor pagado de la página (`tope`, crece a pasos) y lo que pide en pastillas con
 * ícono (estudios, experiencia, colegiatura, lugar, vacantes). Las señales de Vigía y «por qué te calza», en su color, al
 * final. La tarjeta entera es el enlace; al pasar o enfocar, la mira (`.gs-mira`) cierra sus esquinas. `compacta`: sin
 * lo que pide ni las señales. Server-safe; los íconos viajan como referencias (./iconos).
 *
 * `ruta`: dónde está la ficha («/plaza» en la portada, «/app/plaza» en la app). `accion`: un botón propio (guardar la
 * plaza) sobre la tarjeta, por encima del enlace que la cubre entera. `motivo`: por qué te calza (en «Para ti»).
 */
export function TarjetaPlaza({
  p, base, compacta = false, ruta = "/plaza", accion, enApp = false, volver, motivo, tope,
}: {
  p: PlazaEmpleo;
  base: string;
  compacta?: boolean;
  ruta?: string;
  accion?: ReactNode;
  enApp?: boolean;
  /** Los filtros de la lista, para que la ficha vuelva a ellos (?volver=). */
  volver?: string;
  /** Por qué te calza: «Pide Arquitectura», «Tu puesto: …». */
  motivo?: string[];
  /** El sueldo más alto de la lista (sólo sueldos creíbles): la barra del sueldo se mide contra él. */
  tope?: number;
}) {
  const dias = diasParaCierre(p.fechaFin);
  const desde = diasParaCierre(p.fechaInicio);
  const nueva = desde != null && desde <= 0 && desde >= -2;
  const exp = textoExperiencia(p.expGeneral);
  // En la pastilla, corto («8 años»): el ícono dice que es experiencia y el lector de pantalla oye la frase entera.
  const expCorta = aniosCorto(p.expGeneral);
  const pocaExp = p.expGeneral != null && p.expGeneral <= 1;
  const nivel = p.nivel && p.nivel !== "sin_dato" ? NIVEL[p.nivel]?.corto : null;
  const vacantes = p.vacantes ?? 1;
  const entidad = entidadNombre(p.entidad);
  const pct = tope && p.remuneracion && p.remuneracion <= tope ? Math.max(4, Math.round((p.remuneracion / tope) * 100)) : null;
  return (
    <article
      className={cn(
        "gs-mira group relative grid h-full min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3.5 rounded-2xl border border-line bg-paper p-3.5 transition-colors duration-rapido hover:border-granate/50 focus-within:ring-2 focus-within:ring-granate sm:gap-x-4 sm:p-4",
        enApp ? "shadow-caja" : "hover:bg-paperSoft",
      )}
    >
      <CalendarioCierre dias={dias} fechaFin={p.fechaFin} className="self-start" />
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-2 min-w-0 flex-1 text-cuerpo font-semibold leading-snug text-ink">
            <Link
              href={rutaEn(base, `${ruta}/${p.aviso}${volver ? `?volver=${encodeURIComponent(volver)}` : ""}`)}
              className="group outline-none transition-colors duration-rapido after:absolute after:inset-0 after:rounded-2xl group-hover:text-granate"
            >
              {puesto(p.titulo)}
            </Link>
          </h3>
          {accion && <div className="relative z-10 -mr-1.5 -mt-1.5 shrink-0">{accion}</div>}
        </div>
        <p className="mt-1 flex min-w-0 items-center gap-1 text-meta text-inkSoft" title={entidad}>
          <Building2 size={13} aria-hidden className="shrink-0 text-mute" />
          <span className="truncate">{entidad}</span>
        </p>

        <div className="mt-2.5 flex items-center gap-3">
          {p.remuneracion ? (
            <p className="shrink-0 leading-none">
              <span className="font-display text-bloque font-bold tabular-nums tracking-tight text-ink sm:text-seccion">{soles(p.remuneracion)}</span>
              <span className="ml-1 text-rotulo text-mute">al mes</span>
            </p>
          ) : (
            <p className="text-meta text-mute">Sueldo sin dato</p>
          )}
          {pct != null && (
            <span aria-hidden className="block h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
              <span className="gs-barra-crece block h-full rounded-full bg-granate" style={{ width: `${pct}%` }} />
            </span>
          )}
        </div>

        <p className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="sr-only">Dónde y qué pide: </span>
          {nueva && <Chip tono="bien">Nueva</Chip>}
          <Pide icono={<MapPin size={12} aria-hidden className="shrink-0" />}>{lugar(p.ubicacion)}</Pide>
          {vacantes > 1 && <Pide icono={<Users size={12} aria-hidden className="shrink-0" />}>{numero(vacantes)} vacantes</Pide>}
          {!compacta && nivel && <Pide icono={<GraduationCap size={12} aria-hidden className="shrink-0" />}>{nivel}</Pide>}
          {!compacta && exp && (
            <Pide icono={<Briefcase size={12} aria-hidden className="shrink-0" />} destacado={pocaExp}>
              {expCorta && expCorta !== "No pide" ? (
                <>
                  {expCorta}
                  <span className="sr-only"> de experiencia</span>
                </>
              ) : (
                exp
              )}
            </Pide>
          )}
          {!compacta && p.colegiatura && (
            <Pide icono={<BadgeCheck size={12} aria-hidden className="shrink-0" />}>
              <span className="sr-only">Pide </span>Colegiatura
            </Pide>
          )}
        </p>

        {!compacta && motivo && motivo.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5 [&>li]:min-w-0 [&>li]:max-w-full" aria-label="Por qué te calza">
            {motivo.map((m) => (
              <li key={m}>
                <Chip tono="bien" icono={<BadgeCheck size={13} aria-hidden />}>
                  {m}
                </Chip>
              </li>
            ))}
          </ul>
        )}

        {!compacta && p.tipos?.length > 0 && (
          <ul className="mt-2.5 flex flex-wrap gap-1.5 [&>li]:min-w-0 [&>li]:max-w-full" aria-label="Lo que nadie te dice de esta plaza">
            {p.tipos.map((t) => (
              <li key={t}>
                <Chip tono="ojo" icono={<Eye size={13} aria-hidden />}>
                  {SENAL_PLAZA[t]?.corto ?? t}
                </Chip>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

/** El sueldo más alto creíble de una lista (para la barra): fuera los de relleno de la fuente (S/ 99,999, S/ 9,999,999). */
export function topeSueldo(plazas: PlazaEmpleo[]): number | undefined {
  const creibles = plazas.map((p) => p.remuneracion ?? 0).filter((n) => n >= 500 && n <= 50_000);
  return creibles.length ? Math.max(...creibles) : undefined;
}

