"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Search, Map as MapIcon, Camera, ArrowRight, ChevronRight } from "lucide-react";
import type { ApiReporte } from "@/lib/api-client";
import { CATEGORIA_META, estaConfirmada, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { type DenunciasQuery, denunciasQueryString } from "@/lib/denuncias-query";
import { REGIONES } from "@/lib/peru-data";
import { Paginacion } from "@/components/ui/Paginacion";
import { maskDnis } from "@/components/Redact";
import { EstadoVacio } from "@/components/patrones";
import { cn } from "@/lib/utils";
import { FiltrosDenuncias } from "./FiltrosDenuncias";
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
 * Lista de denuncias. Región/categoría/estado se resuelven en el servidor (los
 * selectores de FiltrosDenuncias viven en esta misma barra); acá sólo queda un
 * filtro de texto libre puramente local, porque el API no tiene búsqueda
 * full-text: afina la página que ya llegó.
 *
 * Dato primero (DESIGN_SYSTEM.md §10.7): una fila por denuncia —miniatura, qué
 * pasa, dónde, cuándo y si está confirmada— y la ficha completa en su página.
 * Antes era una rejilla de tarjetas con foto de 160 px y tres líneas de relato:
 * en una pantalla cabían seis.
 *
 * El relato va en UNA línea y con los DNI enmascarados (§10.6: nunca un DNI en
 * claro en un listado). Se usa `maskDnis`, texto plano, y no el vidrio revelable:
 * la fila entera es un enlace, y un botón dentro de un enlace no se puede usar.
 * El vidrio que se revela al clic está en la ficha.
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
    <div className="space-y-3">
      {/* Una sola barra: filtros del servidor, búsqueda en la página y el enlace al único mapa. */}
      <div className="flex flex-wrap items-center gap-2 border-y border-line bg-paper/95 py-2.5 backdrop-blur md:sticky md:top-0 md:z-10">
        <FiltrosDenuncias query={query} />
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
            placeholder="Buscar en esta página…"
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
          compacto
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
        <div className="overflow-hidden rounded-2xl border border-line bg-paper">
          <div
            className={cn(COLUMNAS, "hidden border-b border-line bg-paperSoft px-3 py-2 text-[11px] font-semibold text-mute md:grid")}
            aria-hidden
          >
            <span>Foto</span>
            <span>Categoría</span>
            <span>Lo que se reportó</span>
            <span>Región</span>
            <span>Reportada</span>
            <span>Estado</span>
            <span />
          </div>
          <ul>
            {filtrados.map((r) => (
              <FilaDenuncia key={r.id} reporte={r} />
            ))}
          </ul>
        </div>
      )}
      {filtrados.length > 10 && paginacion}
    </div>
  );
}

/** Acción de un estado vacío: enlace o botón con el mismo aspecto. */
const ACCION_VACIO =
  "inline-flex min-h-[36px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[13px] font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";

/** La misma grilla para la cabecera y las filas (escritorio). */
const COLUMNAS = "md:grid-cols-[48px_176px_minmax(0,1fr)_128px_96px_128px_16px] md:items-center md:gap-4";

function FilaDenuncia({ reporte }: { reporte: ApiReporte }) {
  const meta = CATEGORIA_META[reporte.categoria as CategoriaDenuncia];
  const Icon = meta?.icon ?? Camera;
  const confirmada = estaConfirmada(reporte);
  const cuando = haceCuantoSeReporto(reporte.fecha);
  // §10.6: DNI enmascarados también en el `title`, que el navegador muestra tal cual.
  const relato = maskDnis(reporte.descripcion) || "Sin descripción";
  const categoria = (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        meta?.tone ?? "border-line bg-paperSoft text-ink",
      )}
    >
      <Icon size={10} className="shrink-0" aria-hidden />
      <span className="truncate">{meta?.label ?? "Denuncia"}</span>
    </span>
  );

  return (
    <li className="border-b border-line/70 last:border-b-0">
      <Link
        href={`/app/denuncias/${reporte.id}`}
        className={cn(
          "grid grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 transition-colors duration-rapido hover:bg-paperSoft",
          COLUMNAS,
        )}
      >
        <span className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg bg-paperDeep text-mute">
          {reporte.fotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={reporte.fotoUrl}
              alt=""
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
              className="h-full w-full object-cover"
            />
          ) : (
            <Camera size={16} aria-hidden />
          )}
          {!reporte.fotoUrl && <span className="sr-only">Sin foto</span>}
        </span>

        <span className="hidden min-w-0 md:block">{categoria}</span>

        <span className="min-w-0">
          <span className="block truncate text-[14px] font-medium text-ink" title={relato}>
            {relato}
          </span>
          {/* En el celular, lo que en escritorio va en columnas; en escritorio, el código. */}
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-mute">
            <span className="md:hidden">{meta?.label ?? "Denuncia"}</span>
            {reporte.region && <span className="md:hidden">{reporte.region}</span>}
            {cuando && <span className="md:hidden">{cuando}</span>}
            <span className="font-mono text-[11px]" translate="no">
              {reporte.id}
            </span>
          </span>
        </span>

        <span className="hidden truncate text-[13px] text-inkSoft md:block">{reporte.region ?? "Sin región"}</span>
        <span className="hidden text-[13px] tabular-nums text-mute md:block">{cuando ?? "Sin fecha"}</span>

        <span className="justify-self-end md:justify-self-start">
          {confirmada ? (
            <span className="pill border-moss/30 bg-moss/10 font-semibold text-mossTexto">
              <CheckCircle2 size={11} aria-hidden /> Confirmada
            </span>
          ) : (
            <span className="pill border-line bg-paperDeep text-inkSoft">
              <Clock size={11} aria-hidden /> Sin confirmar
            </span>
          )}
        </span>

        <ChevronRight size={16} className="hidden text-mute md:block" aria-hidden />
      </Link>
    </li>
  );
}
