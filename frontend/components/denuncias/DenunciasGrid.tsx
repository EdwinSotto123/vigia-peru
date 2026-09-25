"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { MapPin, Calendar, CheckCircle2, Clock, Search, Map as MapIcon, Camera, ArrowRight } from "lucide-react";
import type { ApiReporte } from "@/lib/api-client";
import { CATEGORIA_META, estaConfirmada, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { denunciasQueryString, type DenunciasQuery } from "@/lib/denuncias-query";
import { REGIONES } from "@/lib/peru-data";
import { Paginacion } from "@/components/ui/Paginacion";
import { TextoProtegido } from "@/components/alertas/Protegido";
import { EstadoVacio } from "@/components/patrones";
import { cn } from "@/lib/utils";
import { haceCuantoSeReporto } from "./fechaDenuncia";

interface Props {
  /** Página actual: ya filtrada (región/categoría/estado) y paginada server-side. */
  reportes: ApiReporte[];
  /** Filtros activos (para armar los links de paginación sin perderlos). */
  query: DenunciasQuery;
  /** Total real de denuncias que matchean los filtros (COUNT del backend, no el tamaño de esta página). */
  total: number;
  paginas: number;
  size: number;
}

/**
 * Grilla de denuncias. Región/categoría/estado ya llegan resueltos desde el
 * servidor (ver FiltrosDenuncias, en la página); acá sólo queda un filtro de
 * texto libre puramente local, porque el API no tiene búsqueda full-text: afina
 * la página que ya llegó.
 *
 * Antes había un conmutador Lista/Mapa que montaba un SEGUNDO mapa interactivo.
 * El producto tiene un solo mapa, /app/mapa, y ya pinta estas mismas denuncias:
 * el conmutador se cambió por un enlace a ese mapa, con la región filtrada si
 * hay una.
 */
export function DenunciasGrid({ reportes, query, total, paginas, size }: Props) {
  const [texto, setTexto] = useState("");

  const q = texto.trim().toLowerCase();
  const filtrados = useMemo(
    () =>
      q
        ? reportes.filter(
            (r) =>
              (r.descripcion ?? "").toLowerCase().includes(q) ||
              (r.region ?? "").toLowerCase().includes(q) ||
              r.id.toLowerCase().includes(q),
          )
        : reportes,
    [reportes, q],
  );

  const hrefPagina = (n: number) => {
    const qs = denunciasQueryString({ ...query, page: n });
    return qs ? `/app/denuncias?${qs}` : "/app/denuncias";
  };

  const regionId = query.region ? REGIONES.find((r) => r.nombre === query.region)?.id : undefined;
  const hrefMapa = `/app/mapa?${regionId ? `region=${regionId}&` : ""}tab=denuncias`;

  const paginacion = (
    <Paginacion
      actual={query.page}
      paginas={paginas}
      total={total}
      tam={size}
      navegacion="url"
      href={hrefPagina}
      onChange={() => {}}
      cargando={false}
      nombre="denuncias"
    />
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-paper/95 p-3 backdrop-blur md:sticky md:top-0 md:z-10">
        <div className="relative min-w-[200px] flex-1">
          <label htmlFor="buscar-denuncias" className="sr-only">
            Buscar en esta página por descripción, región o código
          </label>
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
          <input
            id="buscar-denuncias"
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por descripción, región o código…"
            className="min-h-[40px] w-full rounded-xl border border-line bg-paperDeep py-2 pl-9 pr-3 text-sm text-ink placeholder:text-mute focus:border-granate"
          />
        </div>
        <Link
          href={hrefMapa}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 text-[13px] font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
        >
          <MapIcon size={13} aria-hidden /> Verlas en el mapa
          <ArrowRight size={12} aria-hidden />
        </Link>
      </div>

      {paginacion}
      {filtrados.length === 0 ? (
        // Un solo vacío por pantalla, con la llamita: dice qué pasó y ofrece la salida.
        <EstadoVacio
          titulo={
            total === 0
              ? "Ninguna denuncia coincide con esos filtros"
              : reportes.length === 0
                ? "Esta página no tiene denuncias"
                : "Ninguna denuncia de esta página coincide con tu búsqueda"
          }
          accion={
            total === 0 ? (
              <Link href="/app/denuncias" className={ACCION_VACIO}>
                Quitar los filtros
              </Link>
            ) : reportes.length === 0 ? (
              <Link href={hrefPagina(1)} className={ACCION_VACIO}>
                Ir a la página 1
              </Link>
            ) : (
              <button type="button" onClick={() => setTexto("")} className={ACCION_VACIO}>
                Borrar la búsqueda
              </button>
            )
          }
        >
          {total === 0
            ? "Prueba con otra región, otra categoría o ambos estados a la vez."
            : reportes.length === 0
              ? "La lista llega hasta una página anterior."
              : "La búsqueda sólo mira las denuncias de esta página: por descripción, región o código."}
        </EstadoVacio>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtrados.map((r) => (
            <DenunciaCard key={r.id} reporte={r} />
          ))}
        </ul>
      )}
      {filtrados.length > 10 && paginacion}
    </div>
  );
}

/** Acción de un estado vacío: enlace o botón con el mismo aspecto. */
const ACCION_VACIO =
  "inline-flex min-h-[36px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[13px] font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";

function DenunciaCard({ reporte }: { reporte: ApiReporte }) {
  const meta = CATEGORIA_META[reporte.categoria as CategoriaDenuncia];
  const Icon = meta?.icon ?? Camera;
  const confirmada = estaConfirmada(reporte);
  const cuando = haceCuantoSeReporto(reporte.fecha);

  return (
    <li>
      <Link
        href={`/app/denuncias/${reporte.id}`}
        className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-paper transition-[border-color,box-shadow] duration-rapido hover:border-granate/30 hover:shadow-card"
      >
        <div className="relative h-40 w-full overflow-hidden bg-paperDeep">
          {reporte.fotoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={reporte.fotoUrl}
                alt=""
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                className="h-full w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/60 via-ink/10 to-transparent" aria-hidden />
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-mute">
              <Camera size={24} aria-hidden />
              <span className="ml-2 text-xs font-medium">Sin foto</span>
            </div>
          )}

          <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold backdrop-blur-md",
                meta?.tone ?? "border-line bg-paperSoft text-ink",
              )}
            >
              <Icon size={10} aria-hidden />
              {meta?.label ?? "Denuncia"}
            </span>
          </div>

          <div className={cn("absolute bottom-2 right-3 font-mono text-[11px]", reporte.fotoUrl ? "text-paper" : "text-mute")} translate="no">
            {reporte.id}
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-4">
          <p className="line-clamp-3 text-sm leading-relaxed text-ink">
            <TextoProtegido texto={reporte.descripcion ?? ""} nombres={[]} />
          </p>

          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-mute">
            {reporte.region && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={10} aria-hidden />
                {reporte.region}
              </span>
            )}
            {cuando && (
              <span className="inline-flex items-center gap-1">
                <Calendar size={10} aria-hidden />
                {cuando}
              </span>
            )}
            <span className="ml-auto">
              {confirmada ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-moss/30 bg-moss/10 px-2 py-0.5 text-[11px] font-semibold text-mossTexto">
                  <CheckCircle2 size={11} aria-hidden /> Confirmada
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paperDeep px-2 py-0.5 text-[11px] font-medium text-inkSoft">
                  <Clock size={11} aria-hidden /> Sin confirmar
                </span>
              )}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}
