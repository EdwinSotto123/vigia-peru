import Link from "next/link";
import type { ReactNode } from "react";
import { BedDouble, Clock3, MapPin, Scissors, Stethoscope } from "lucide-react";
import { InsigniaCategoria } from "@/components/salud/comun";
import { rutaEn } from "@/lib/gobserva";
import { CLASES_DE_HECHO, SECTORES, nombrePropio, numero, rutaFicha, type FilaIpress } from "@/lib/gobserva-salud";
import { atiende24, seguroIpress } from "@/lib/salud-seguros";
import { cn } from "@/lib/utils";
import { lugarIpress } from "./filtros";
import { direccionLegible } from "@/components/salud/ficha/piezas";
import { InsigniaRegistro } from "./Insignias";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";

/** Las clases que tienen su ícono de 12 px (se dibujan a escala 3); el resto, un lugar de 18 x 16 (a escala 2). */
const ICONOS = /ODONTOLOG|PATOLOGIA CLINICA|LABORATORIO|IMAGENES|RADIOLOG|OPTIC|REHABILITA/i;

/** El dibujo de una IPRESS por su clasificación en RENIPRESS (2026-11-22: «otras secciones es solo texto plano»). */
function spriteLugar(x: FilaIpress): NombreSprite {
  const c = (x.clasificacion ?? "").toUpperCase();
  if (/ODONTOLOG/.test(c)) return "iconoDientes";
  if (/PATOLOGIA CLINICA|LABORATORIO/.test(c)) return "iconoAnalisis";
  if (/IMAGENES|RADIOLOG/.test(c)) return "iconoImagenes";
  if (/OPTIC/.test(c)) return "iconoOjos";
  if (/REHABILITA/.test(c)) return "iconoHuesos";
  if (/HOSPITAL|CLINICA|CAMAS|INTERNAMIENTO/.test(c) || x.internamiento) return "lugarHospital";
  if (/PUESTO|POSTA|CENTROS? DE SALUD/.test(c)) return "lugarPosta";
  return "lugarConsultorio";
}

/**
 * Una IPRESS en una lista (la lista, la búsqueda, cerca de mí), como FILA de una placa (la placa la pone la lista:
 * `PLACA_LISTA`).
 *
 * 2026-11-21 (el usuario: «atosigante, sin jerarquías»): antes cada una era una tarjeta con hasta seis insignias del
 * mismo peso (categoría, sector, «Activa en RENIPRESS», sanciones, denuncias, centro quirúrgico, internamiento). Ahora
 * tiene tres niveles: el nombre (lleva a la ficha); debajo, en gris, dónde está y qué tiene (24 horas, médicos, centro
 * quirúrgico, internamiento); y a la derecha, en columnas que se leen hacia abajo, la categoría con su seguro y las
 * señales: las sanciones firmes en rojo y las denuncias en ámbar, como cifras (nunca juntas en una). «Activa» ya no se
 * dice: es lo normal; sólo se marca lo que NO está activo. Server-safe.
 */
export function FilaEstablecimiento({
  x,
  base,
  children,
  className,
  conDireccion = false,
}: {
  x: FilaIpress;
  base: string;
  children?: ReactNode;
  className?: string;
  /** Con su dirección: la lista tiene otro con el mismo nombre (repetidos). */
  conDireccion?: boolean;
}) {
  const nombre = nombrePropio(x.nombre) || `IPRESS ${x.codigo}`;
  const denuncias = x.denuncias ?? 0;
  return (
    <article
      className={cn(
        "group relative grid min-w-0 gap-x-6 gap-y-2.5 px-4 py-4 transition-colors duration-rapido focus-within:bg-granate-50/60 hover:bg-granate-50/50 sm:px-5 md:grid-cols-[minmax(0,1fr)_8.5rem_10rem] md:items-center",
        className,
      )}
    >
      <div className="flex min-w-0 gap-3">
        <span aria-hidden className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-granate-50">
          <Pixel nombre={spriteLugar(x)} escala={x.clasificacion && ICONOS.test(x.clasificacion) ? 3 : 2} animado={false} acento="accion" />
        </span>
        <div className="min-w-0 flex-1">
        <h3 className="text-cuerpo font-semibold leading-snug text-ink">
          <Link
            href={rutaEn(base, rutaFicha(x.codigo))}
            prefetch={false}
            className="line-clamp-2 underline-offset-4 after:absolute after:inset-0 after:content-[''] group-hover:text-granate group-hover:underline focus-visible:outline-none"
          >
            {nombre}
          </Link>
        </h3>
        <p className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-meta text-inkSoft [&_svg]:shrink-0 [&_svg]:text-mute">
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin size={13} aria-hidden />
            {lugarIpress(x)}
          </span>
          {x.activo && atiende24(x.horario) && (
            <span className="inline-flex items-center gap-1">
              <Clock3 size={13} aria-hidden />
              24 horas
            </span>
          )}
          {x.medicos ? (
            <span className="inline-flex items-center gap-1" title="Médicos que declaró a SUSALUD">
              <Stethoscope size={13} aria-hidden />
              {x.medicos === 1 ? "1 médico" : `${numero(x.medicos)} médicos`}
            </span>
          ) : null}
          {x.quirurgico && (
            <span className="inline-flex items-center gap-1" title="RENIPRESS le registra la unidad de centro quirúrgico activa.">
              <Scissors size={13} aria-hidden />
              Centro quirúrgico
            </span>
          )}
          {x.internamiento && (
            <span className="inline-flex items-center gap-1" title="RENIPRESS la registra como establecimiento con internamiento.">
              <BedDouble size={13} aria-hidden />
              Internamiento
            </span>
          )}
        </p>
        {conDireccion && x.direccion && <p className="mt-1 text-meta text-inkSoft">{direccionLegible(x.direccion)}</p>}
        {!x.activo && <InsigniaRegistro activo={x.activo} estado={x.estado} className="mt-2" />}
        {children}
        </div>
      </div>

      {/* La categoría y el sector; en el celular, en la misma línea que las señales. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 md:contents">
        <p className="flex items-center gap-2 md:flex-col md:items-start md:gap-1">
          <InsigniaCategoria categoria={x.categoria} />
          {/* Con qué seguro atiende (la institución) en vez de «Público»: lo que la gente pregunta (2026-11-22). */}
          <span className="text-meta text-inkSoft">{(x.activo ? seguroIpress(x.institucion).corto : null) ?? SECTORES[x.sector] ?? x.sector}</span>
        </p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 md:flex-col md:items-end md:text-right">
          {x.sanciones > 0 ? (
            <p className="text-meta text-crimsonTexto" title={CLASES_DE_HECHO.sancion_firme.explica}>
              <b className="font-display text-bloque font-bold tabular-nums">{numero(x.sanciones)}</b>{" "}
              {x.sanciones === 1 ? "sanción firme" : "sanciones firmes"}
            </p>
          ) : (
            <p className="text-meta text-mute">Sin sanciones firmes</p>
          )}
          {denuncias > 0 && (
            <p className="text-meta text-amberTexto" title={CLASES_DE_HECHO.denuncia.explica}>
              <b className="font-semibold tabular-nums">{numero(denuncias)}</b> {denuncias === 1 ? "denuncia" : "denuncias"}
              {x.denunciasDe ? ` en ${x.denunciasDe}` : ""}
              {x.denunciasDe === new Date().getFullYear() ? " (parcial)" : ""}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

/** La placa de una lista de filas: un borde, filetes entre filas. */
export const PLACA_LISTA = "overflow-hidden rounded-2xl border border-line bg-paper divide-y divide-line";
