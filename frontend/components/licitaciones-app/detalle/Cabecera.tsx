import Link from "next/link";
import { ArrowLeft, ArrowUpRight, Building2, MapPin } from "lucide-react";
import { limpiar, nombreRegion } from "@/lib/licitaciones";
import { tituloNatural } from "@/lib/landing";
import { fechaCortaLima, haceDias, vencimiento } from "@/lib/licitaciones-app/formato";
import type { DetalleOportunidad } from "@/lib/licitaciones-app/tipos";
import { numero, solesCompacto } from "@/lib/formato";
import { SeguirConEtapa } from "../seguimiento/BotonSeguir";
import { CopiarEnlace } from "./CopiarEnlace";
import { Insignia, InsigniaTipo, InsigniaVence } from "@/components/gobserva/ui/Insignia";

/**
 * La cabecera del detalle: volver a la bandeja (con los mismos filtros), qué es, quién compra, las acciones (seguir con su
 * etapa, abrir en el SEACE, copiar el enlace) y las cuatro cifras que deciden si mirar más: valor, publicación, fin de
 * consultas e ítems.
 */
export function Cabecera({ o, volver, ahora }: { o: DetalleOportunidad; volver: string; ahora: number }) {
  return (
    <header className="mb-6">
      <Link href={volver} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg text-dato font-semibold text-inkSoft underline-offset-4 hover:text-ink hover:underline">
        <ArrowLeft size={16} aria-hidden /> Bandeja
      </Link>
      {/* Las insignias y las acciones se envuelven: lado a lado sólo desde xl, y aun ahí los botones pasan de línea antes que desbordar. */}
      <div className="mt-3 flex flex-col-reverse gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 xl:pt-2.5">
          <span className="font-mono text-meta font-semibold text-inkSoft">{o.codigo ?? o.id}</span>
          <InsigniaTipo tipo={o.tipo} />
          {o.procedimiento && <Insignia>{o.procedimiento}</Insignia>}
          {o.etapa && <Insignia tono="acento">{o.etapa === "convocada" ? "Convocada" : limpiar(o.etapa)}</Insignia>}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
          <SeguirConEtapa id={o.id} codigo={o.codigo} titulo={limpiar(o.objeto)} />
          <a
            href={o.enlaces.seace}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-line bg-caja px-3.5 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-ink/20"
          >
            Ver en el OECE <ArrowUpRight size={15} aria-hidden />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
          <CopiarEnlace />
        </div>
      </div>
      <div className="mt-3 min-w-0">
        {/* recorte: el objeto llega a tener 400 letras; aquí van tres renglones y entero en «Qué se compra» (Resumen). */}
        <h1 title={limpiar(o.objeto)} className="line-clamp-3 max-w-[80ch] text-pretty font-display text-bloque font-bold leading-snug tracking-tight text-ink sm:text-seccion">
          {limpiar(o.objeto) || "Sin descripción registrada"}
        </h1>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-dato text-inkSoft">
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={15} aria-hidden className="text-mute" />
              {o.entidad.nombre ? tituloNatural(o.entidad.nombre) : "Entidad sin nombre"}
              {o.entidad.ruc && <span className="font-mono text-meta text-mute">RUC {o.entidad.ruc}</span>}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin size={15} aria-hidden className="text-mute" />
              {[o.provincia, nombreRegion(o.region)].filter(Boolean).join(", ")}
            </span>
        </p>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-caja lg:grid-cols-4">
        <Cifra etiqueta="Valor referencial" valor={o.valor != null ? solesCompacto(o.valor) : "Sin publicar"} detalle={o.valor != null ? "Publicado por la entidad" : "Búscalo en las bases"} />
        <Cifra etiqueta="Publicado" valor={fechaCortaLima(o.publicada)} detalle={haceDias(o.publicada, ahora)} />
        <div className="min-w-0 bg-caja p-4 sm:p-5">
          <dt className="text-meta font-semibold text-inkSoft">Fin de consultas</dt>
          <dd className="mt-2 font-display text-bloque font-bold leading-tight text-ink sm:text-seccion">{o.consultasHasta ? fechaCortaLima(o.consultasHasta) : "Sin dato"}</dd>
          <dd className="mt-1.5">
            {vencimiento(o.consultasHasta, ahora).estado === "vencido" ? <span className="text-meta text-mute">Ya cerraron</span> : <InsigniaVence iso={o.consultasHasta} ahora={ahora} />}
          </dd>
        </div>
        <Cifra etiqueta="Ítems y documentos" valor={`${numero(o.itemsDetalle.length || o.items)} ${o.itemsDetalle.length === 1 || o.items === 1 ? "ítem" : "ítems"}`} detalle={`${numero(o.documentos.length)} ${o.documentos.length === 1 ? "documento" : "documentos"}`} />
      </dl>
    </header>
  );
}

function Cifra({ etiqueta, valor, detalle }: { etiqueta: string; valor: string; detalle: string }) {
  return (
    <div className="min-w-0 bg-caja p-4 sm:p-5">
      <dt className="text-meta font-semibold text-inkSoft">{etiqueta}</dt>
      <dd className="mt-2 truncate font-display text-bloque font-bold leading-tight tabular-nums text-ink sm:text-seccion">{valor}</dd>
      <dd className="mt-1.5 text-meta text-mute">{detalle}</dd>
    </div>
  );
}
