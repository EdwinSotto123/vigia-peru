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
import { cn } from "@/lib/utils";

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
      <div className="surface flex flex-wrap items-center gap-2 bg-paper/95 p-4 backdrop-blur md:sticky md:top-0 md:z-10">
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
            className="w-full rounded-full border border-line bg-paperSoft py-2 pl-9 pr-3 text-sm placeholder:text-mute focus:border-heroViolet focus:outline-none"
          />
        </div>
        <Link
          href={hrefMapa}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paperSoft px-3.5 py-2 text-xs font-medium text-ink transition-colors hover:bg-paperDeep"
        >
          <MapIcon size={13} aria-hidden /> Verlas en el mapa
          <ArrowRight size={12} aria-hidden />
        </Link>
      </div>

      {paginacion}
      {filtrados.length === 0 ? (
        <div className="surface flex flex-col items-center gap-2 p-10 text-center">
          <Search size={20} className="text-mute" aria-hidden />
          <p className="text-sm text-mute">
            {total === 0
              ? "No hay denuncias que coincidan con esos filtros."
              : reportes.length === 0
                ? "Esta página no tiene denuncias. Prueba con una página anterior."
                : "Ninguna denuncia de esta página coincide con tu búsqueda."}
          </p>
          {total === 0 ? (
            <Link href="/app/denuncias" className="text-xs font-medium text-heroViolet hover:underline">
              Quitar los filtros
            </Link>
          ) : reportes.length === 0 ? (
            <Link href={hrefPagina(1)} className="text-xs font-medium text-heroViolet hover:underline">
              Ir a la página 1
            </Link>
          ) : (
            <button type="button" onClick={() => setTexto("")} className="text-xs font-medium text-heroViolet hover:underline">
              Borrar la búsqueda
            </button>
          )}
        </div>
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

function DenunciaCard({ reporte }: { reporte: ApiReporte }) {
  const meta = CATEGORIA_META[reporte.categoria as CategoriaDenuncia];
  const Icon = meta?.icon ?? Camera;
  const confirmada = estaConfirmada(reporte);
  const diasDesde = Math.max(0, Math.floor((Date.now() - new Date(`${String(reporte.fecha).slice(0, 10)}T12:00:00-05:00`).getTime()) / 86_400_000));

  return (
    <li>
      <Link
        href={`/app/denuncias/${reporte.id}`}
        className="surface group flex h-full flex-col overflow-hidden p-0 transition-all hover:-translate-y-0.5 hover:shadow-paper"
      >
        <div className="relative h-40 w-full overflow-hidden bg-paperDeep">
          {reporte.fotoUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={reporte.fotoUrl}
                alt=""
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center text-mute">
              <Camera size={28} aria-hidden />
              <span className="ml-2 text-[11px] uppercase tracking-wider">Sin foto</span>
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

          <div className={cn("absolute bottom-2 right-3 font-mono text-[11px]", reporte.fotoUrl ? "text-paper" : "text-mute")}>
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
            <span className="inline-flex items-center gap-1">
              <Calendar size={10} aria-hidden />
              {diasDesde === 0 ? "hoy" : `hace ${diasDesde} día${diasDesde === 1 ? "" : "s"}`}
            </span>
            <span className="ml-auto">
              {confirmada ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-moss/15 px-1.5 text-[10px] font-bold uppercase tracking-wider text-mossTexto">
                  <CheckCircle2 size={9} aria-hidden /> confirmada
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-paperDeep px-1.5 text-[10px] font-bold uppercase tracking-wider text-mute">
                  <Clock size={9} aria-hidden /> sin confirmar
                </span>
              )}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}
