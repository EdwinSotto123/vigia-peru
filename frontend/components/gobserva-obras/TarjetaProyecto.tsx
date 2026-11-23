import Link from "next/link";
import { Building2, CalendarClock, ChevronRight, CirclePause, FileCheck2, HardHat, Hash, MapPin, Megaphone, PackageOpen, Wallet } from "lucide-react";
import { fechaCorta, solesCompacto } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { haceTiempo, lugarProyecto, mesAnio, nombreEmpresa, nombreEntidad, nombreProyecto, nombreSector, procesoConvocado, textoGasto, type Proyecto } from "@/lib/gobserva-obras";
import { cn } from "@/lib/utils";
import { BarraAvance, BarraGastado, CaminoMini, FaseInsignia, iconoSector } from "./Piezas";

/**
 * Un proyecto de inversión como oportunidad, en dos formas: la tarjeta (la portada, en rejilla) y la fila (la lista de
 * /proyectos, una debajo de otra con el costo alineado a la derecha para recorrerla de un vistazo). Las dos dicen lo mismo:
 * su fase (la insignia que manda), su sector, el nombre, quién lo hace y dónde, y lo que importa según la fase: lo que se
 * viene dice desde cuándo es viable, si tiene expediente técnico, su presupuesto del año y si ya se licita; lo que está en
 * marcha, su avance (real contra programado) y quién lo construye (sólo empresas); lo paralizado, desde cuándo y por qué.
 * Abajo (o a la derecha), el costo y cuánto falta ejecutar. Todo el bloque abre la ficha. Si la obra principal de INFOBRAS
 * es sólo una parte chica del proyecto (`obraRepresenta`), su avance y su contratista no se dan por los del proyecto: va el
 * avance que registra el MEF. Server-safe.
 */

const CHIP = "inline-flex items-center gap-1 rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft";

function Chips({ p }: { p: Proyecto }) {
  const Icono = iconoSector(p.sector);
  return (
    <>
      <FaseInsignia fase={p.fase} />
      <span className={CHIP}>
        <Icono size={12} aria-hidden /> {nombreSector(p.sector)}
      </span>
      {p.tipo === "equipamiento" && (
        <span className={CHIP}>
          <PackageOpen size={12} aria-hidden /> Equipos
        </span>
      )}
    </>
  );
}

/**
 * Lo que importa según la fase (nada, si no hay qué decir: sin caja vacía). `enLinea`: los datos de lo que se viene uno al
 * lado de otro (la fila), no en columna.
 */
function SegunFase({ p, enLinea = false, className }: { p: Proyecto; enLinea?: boolean; className?: string }) {
  const enObra = p.fase === "ejecucion" || p.fase === "paralizada" || p.fase === "terminada";
  const deLaObra = p.obraRepresenta && p.obraFisico != null;
  const anio = new Date().getFullYear();
  const hayDatos =
    !enObra && (!!p.fechaViable || (p.conExpediente && p.fase !== "licitacion" && p.fase !== "expediente") || p.pimAnio > 0 || (p.fase === "sin_movimiento" && !!p.ultimoGasto));
  const hayAlgo =
    p.fase === "paralizada" ||
    (enObra && (deLaObra || p.avanceMef != null)) ||
    (enObra && !!p.ejecutor && p.obraRepresenta) ||
    (p.fase === "licitacion" && !!p.convocatoriaFecha) ||
    hayDatos;
  if (!hayAlgo) return null;
  const datos = (
    <>
      {p.fechaViable && (
        <li className="flex items-center gap-1.5">
          <CalendarClock size={14} aria-hidden className="shrink-0 text-mute" />
          Viable desde el {fechaCorta(p.fechaViable)} ({haceTiempo(p.fechaViable)})
        </li>
      )}
      {p.conExpediente && p.fase !== "licitacion" && p.fase !== "expediente" && (
        <li className="flex items-center gap-1.5">
          <FileCheck2 size={14} aria-hidden className="shrink-0 text-granate" />
          Con expediente técnico
        </li>
      )}
      {p.pimAnio > 0 && (
        <li className="flex items-center gap-1.5">
          <Wallet size={14} aria-hidden className="shrink-0 text-mute" />
          Presupuesto {anio}: {solesCompacto(p.pimAnio)}
        </li>
      )}
      {p.fase === "sin_movimiento" && p.ultimoGasto && (
        <li className="flex items-center gap-1.5">
          <CalendarClock size={14} aria-hidden className="shrink-0 text-mute" />
          Sin gasto desde {mesAnio(p.ultimoGasto)}
        </li>
      )}
    </>
  );
  return (
    <div className={cn("space-y-2", className)}>
      {p.fase === "paralizada" && (
        <p className="flex items-start gap-1.5 rounded-xl bg-crimson-soft px-3 py-2 text-meta text-crimsonTexto">
          <CirclePause size={15} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            Paralizada{p.paralizadaDesde ? ` desde el ${fechaCorta(p.paralizadaDesde)}` : ""}
            {p.causal ? `: ${p.causal.toLocaleLowerCase("es-PE")}` : ""}
          </span>
        </p>
      )}
      {enObra && (deLaObra || p.avanceMef != null) && (
        <BarraAvance
          className={enLinea ? "max-w-md" : undefined}
          real={deLaObra ? p.obraFisico : p.avanceMef}
          programado={deLaObra ? p.obraProgramado : null}
          etiqueta={deLaObra ? "Avance físico" : "Avance físico (MEF)"}
          pie={deLaObra && p.obraAvanceAl ? `Registrado en INFOBRAS el ${fechaCorta(p.obraAvanceAl)}` : undefined}
        />
      )}
      {enObra && p.ejecutor && p.obraRepresenta && (
        <p className="flex min-w-0 items-center gap-1.5 text-meta text-inkSoft">
          <HardHat size={14} aria-hidden className="shrink-0 text-mute" />
          <span className="truncate">
            Construye <b className="font-semibold text-ink">{nombreEmpresa(p.ejecutor)}</b>
          </span>
        </p>
      )}
      {p.fase === "licitacion" && p.convocatoriaFecha && (
        <p className={cn("flex items-start gap-1.5 rounded-xl bg-amber-soft px-3 py-2 text-meta text-amberTexto", enLinea && "w-fit max-w-full")}>
          <Megaphone size={15} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {procesoConvocado(p.convocatoriaTipo)} el {fechaCorta(p.convocatoriaFecha)}
            {p.convocatoriaValor ? `, valor referencial ${solesCompacto(p.convocatoriaValor)}` : ""}
          </span>
        </p>
      )}
      {hayDatos && <ul className={cn("text-meta text-inkSoft", enLinea ? "flex flex-wrap gap-x-5 gap-y-1" : "space-y-1")}>{datos}</ul>}
    </div>
  );
}

export function TarjetaProyecto({ p, base, compacta = false }: { p: Proyecto; base: string; compacta?: boolean }) {
  const gasto = textoGasto(p.costo, p.devengado, p.porEjecutar);
  return (
    <Link
      href={rutaEn(base, `/proyecto/${p.cui}`)}
      className="gs-mira group flex h-full min-w-0 flex-col rounded-2xl border border-line bg-paper p-4 transition-[border-color,box-shadow,transform] duration-rapido hover:-translate-y-0.5 hover:border-granate/50 hover:shadow-[0_14px_40px_-24px_rgb(var(--granate)/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Chips p={p} />
      </div>
      <CaminoMini fase={p.fase} className="mt-3" />

      <p className={cn("mt-3 font-display font-semibold leading-snug text-ink group-hover:text-granate", compacta ? "line-clamp-2 text-cuerpo" : "line-clamp-3 text-destacado")}>
        {nombreProyecto(p.nombre, p)}
      </p>

      <ul className="mt-3 space-y-1 text-meta text-inkSoft">
        <li className="flex min-w-0 items-center gap-1.5">
          <Building2 size={14} aria-hidden className="shrink-0 text-mute" />
          <span className="truncate">{nombreEntidad(p.entidad)}</span>
        </li>
        <li className="flex min-w-0 items-center gap-1.5">
          <MapPin size={14} aria-hidden className="shrink-0 text-mute" />
          <span className="truncate">{lugarProyecto(p)}</span>
        </li>
        <li className="flex min-w-0 items-center gap-1.5">
          <Hash size={14} aria-hidden className="shrink-0 text-mute" />
          <span className="font-mono text-rotulo">CUI {p.cui}</span>
        </li>
      </ul>

      <SegunFase p={p} className="mt-4" />

      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <div className="min-w-0">
          <p className="text-rotulo text-mute">Costo</p>
          <p className="font-display text-bloque font-bold leading-tight tabular-nums text-ink">{p.costo ? solesCompacto(p.costo) : "Sin dato"}</p>
          <BarraGastado costo={p.costo} gastado={p.devengado} className="w-32" />
          {gasto && <p className="mt-1 text-rotulo text-inkSoft">{gasto}</p>}
        </div>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-meta font-semibold text-granate">
          Ver ficha <ChevronRight size={15} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}

/**
 * La fila de la lista: a la izquierda qué es, quién y dónde, y lo que importa según la fase; a la derecha (debajo en el
 * celular) el costo y cuánto falta. Los montos quedan en una misma columna: la lista se recorre de arriba abajo.
 */
export function FilaProyecto({ p, base }: { p: Proyecto; base: string }) {
  const gasto = textoGasto(p.costo, p.devengado, p.porEjecutar);
  return (
    <Link
      href={rutaEn(base, `/proyecto/${p.cui}`)}
      className="gs-mira group grid min-w-0 gap-x-6 gap-y-3 rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate sm:p-5 md:grid-cols-[minmax(0,1fr)_12.5rem]"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chips p={p} />
        </div>
        <p className="mt-2 line-clamp-3 font-display text-destacado font-semibold leading-snug text-ink group-hover:text-granate md:line-clamp-2">
          {nombreProyecto(p.nombre, p)}
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft">
          <li className="flex min-w-0 max-w-full items-center gap-1.5">
            <Building2 size={14} aria-hidden className="shrink-0 text-mute" />
            <span className="truncate">{nombreEntidad(p.entidad)}</span>
          </li>
          <li className="flex min-w-0 max-w-full items-center gap-1.5">
            <MapPin size={14} aria-hidden className="shrink-0 text-mute" />
            <span className="truncate">{lugarProyecto(p)}</span>
          </li>
          <li className="flex items-center gap-1.5">
            <Hash size={14} aria-hidden className="shrink-0 text-mute" />
            <span className="font-mono text-rotulo">CUI {p.cui}</span>
          </li>
        </ul>
        <CaminoMini fase={p.fase} className="mt-3 max-w-sm md:hidden" />
        <SegunFase p={p} enLinea className="mt-3" />
      </div>
      <div className="flex items-end justify-between gap-3 border-t border-line pt-2.5 md:flex-col md:items-end md:justify-between md:border-l md:border-t-0 md:pl-6 md:pt-0 md:text-right">
        <div className="min-w-0">
          <p className="sr-only">Costo</p>
          <p className="font-display text-bloque font-bold leading-tight tabular-nums text-ink md:text-seccion">{p.costo ? solesCompacto(p.costo) : "Sin dato"}</p>
          <BarraGastado costo={p.costo} gastado={p.devengado} className="w-36 md:ml-auto" />
          {gasto && <p className="mt-1 text-rotulo leading-snug text-inkSoft">{gasto}</p>}
          {/* En la computadora el camino va en esta columna, bajo el costo: la fila no crece. */}
          <CaminoMini fase={p.fase} className="mt-3 hidden w-44 text-left md:ml-auto md:block" />
        </div>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-meta font-semibold text-granate">
          Ver ficha <ChevronRight size={15} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
