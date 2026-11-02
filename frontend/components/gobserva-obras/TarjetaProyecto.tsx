import Link from "next/link";
import { Building2, CalendarClock, ChevronRight, CirclePause, FileCheck2, HardHat, Hash, MapPin, Megaphone, PackageOpen, Wallet } from "lucide-react";
import { fechaCorta, porcentaje, solesCompacto } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { haceTiempo, lugarProyecto, nombreEmpresa, nombreEntidad, nombreProyecto, nombreSector, TIPO_PROCESO, type Proyecto } from "@/lib/gobserva-obras";
import { cn } from "@/lib/utils";
import { BarraAvance, FaseInsignia, iconoSector } from "./Piezas";

/**
 * Un proyecto de inversión como oportunidad: su fase (la insignia que manda), su sector, el nombre, quién lo hace y
 * dónde, y lo que importa según la fase: lo que se viene dice desde cuándo es viable, si tiene expediente técnico, su
 * presupuesto del año y si ya se licita; lo que está en marcha, su avance (real contra programado) y quién lo construye
 * (sólo empresas); lo paralizado, desde cuándo y por qué. Abajo, el costo y lo que falta ejecutar. Toda la tarjeta abre
 * la ficha. Si la obra principal de INFOBRAS es sólo una parte chica del proyecto (`obraRepresenta`), su avance y su
 * contratista no se dan por los del proyecto: va el avance que registra el MEF. Server-safe.
 */
export function TarjetaProyecto({ p, base, compacta = false }: { p: Proyecto; base: string; compacta?: boolean }) {
  const Icono = iconoSector(p.sector);
  const enObra = p.fase === "ejecucion" || p.fase === "paralizada" || p.fase === "terminada";
  const deLaObra = p.obraRepresenta && p.obraFisico != null;
  const anio = new Date().getFullYear();
  const pctGastado = p.costo && p.devengado > 0 ? (p.devengado / p.costo) * 100 : null;
  return (
    <Link
      href={rutaEn(base, `/proyecto/${p.cui}`)}
      className="group flex h-full min-w-0 flex-col rounded-2xl border border-line bg-paper p-4 transition-[border-color,box-shadow,transform] duration-rapido hover:-translate-y-0.5 hover:border-granate/50 hover:shadow-[0_14px_40px_-24px_rgb(var(--granate)/0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate sm:p-5"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <FaseInsignia fase={p.fase} />
        <span className="inline-flex items-center gap-1 rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">
          <Icono size={12} aria-hidden /> {nombreSector(p.sector)}
        </span>
        {p.tipo === "equipamiento" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-medium text-inkSoft">
            <PackageOpen size={12} aria-hidden /> Equipos
          </span>
        )}
      </div>

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

      {/* Lo que importa según la fase. */}
      <div className="mt-4 space-y-2">
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
          <p className="flex items-start gap-1.5 rounded-xl bg-amber-soft px-3 py-2 text-meta text-amberTexto">
            <Megaphone size={15} aria-hidden className="mt-0.5 shrink-0" />
            <span>
              {TIPO_PROCESO[p.convocatoriaTipo ?? ""] ?? "Proceso"} convocado el {fechaCorta(p.convocatoriaFecha)}
              {p.convocatoriaValor ? `, valor referencial ${solesCompacto(p.convocatoriaValor)}` : ""}
            </span>
          </p>
        )}
        {!enObra && (
          <ul className="space-y-1 text-meta text-inkSoft">
            {p.fechaViable && (
              <li className="flex items-center gap-1.5">
                <CalendarClock size={14} aria-hidden className="shrink-0 text-mute" />
                Viable desde el {fechaCorta(p.fechaViable)} ({haceTiempo(p.fechaViable)})
              </li>
            )}
            {p.conExpediente && p.fase !== "licitacion" && (
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
          </ul>
        )}
      </div>

      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
        <div className="min-w-0">
          <p className="text-rotulo text-mute">Costo de la inversión</p>
          <p className="font-display text-bloque font-bold leading-tight tabular-nums text-ink">{p.costo ? solesCompacto(p.costo) : "Sin dato"}</p>
          {p.porEjecutar != null && p.costo ? (
            <p className="text-rotulo text-inkSoft">
              {pctGastado != null && pctGastado >= 1 ? `${porcentaje(Math.min(pctGastado, 100))} gastado, ` : ""}
              por ejecutar {solesCompacto(p.porEjecutar)}
            </p>
          ) : null}
        </div>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-meta font-semibold text-granate">
          Ver ficha <ChevronRight size={15} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-0.5" />
        </span>
      </div>
    </Link>
  );
}
