"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  MapPin,
  Calendar,
  CheckCircle2,
  Clock,
  Search,
  LayoutGrid,
  Map as MapIcon,
  GitMerge,
  Camera,
} from "lucide-react";
import type { ReporteCiudadano, Convergencia } from "@/types";
import { CATEGORIA_META, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { denunciasQueryString, type DenunciasQuery } from "@/lib/denuncias-query";
import { Paginacion } from "@/components/ui/Paginacion";
import { DenunciasMap } from "./DenunciasMap";
import { cn } from "@/lib/utils";

type ViewMode = "grid" | "mapa";

interface Props {
  /** Página actual: ya filtrada (región/categoría/estado) y paginada server-side. */
  reportes: ReporteCiudadano[];
  /** Mismos filtros que `reportes` pero sin paginar (hasta 200) — pines del mapa. */
  reportesMapa: ReporteCiudadano[];
  convergencias: Convergencia[];
  /** Filtros activos (para armar los links de paginación sin perderlos). */
  query: DenunciasQuery;
  /** Total real de denuncias que matchean los filtros (COUNT del backend, no el tamaño de esta página). */
  total: number;
  paginas: number;
  size: number;
}

/**
 * Grilla + mapa de denuncias. Región/categoría/estado ya llegan resueltos
 * desde el servidor (ver FiltrosDenuncias, en la página) — acá solo queda un
 * filtro de texto libre puramente local, porque el API no tiene búsqueda
 * full-text: afina lo que ya llegó (la página actual en vista lista, o el
 * batch grande en vista mapa), cada vista con su propio conteo.
 */
export function DenunciasGrid({ reportes, reportesMapa, convergencias, query, total, paginas, size }: Props) {
  const [texto, setTexto] = useState("");
  const [view, setView] = useState<ViewMode>("grid");

  const reportesEnConvergencia = useMemo(() => {
    const s = new Set<string>();
    convergencias.forEach((c) => c.reporteIds.forEach((rid) => s.add(rid)));
    return s;
  }, [convergencias]);

  const q = texto.trim().toLowerCase();
  const coincideTexto = (r: ReporteCiudadano) =>
    !q ||
    r.descripcion.toLowerCase().includes(q) ||
    r.region.toLowerCase().includes(q) ||
    r.id.toLowerCase().includes(q);

  const filtradosGrid = useMemo(() => (q ? reportes.filter(coincideTexto) : reportes), [reportes, q]);
  const filtradosMapa = useMemo(() => (q ? reportesMapa.filter(coincideTexto) : reportesMapa), [reportesMapa, q]);

  const hrefPagina = (n: number) => {
    const qs = denunciasQueryString({ ...query, page: n });
    return qs ? `/app/denuncias?${qs}` : "/app/denuncias";
  };

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
      {/* Búsqueda de texto + toggle de vista — pegajosa: con hasta 24 tarjetas en la
          grilla (varias pantallas de alto), poder buscar o saltar a Mapa sin volver a
          scrollear hasta arriba es la reducción de scroll más real de esta pantalla.
          top-0 (no top-16): esta ruta vive bajo (dashboard)/layout.tsx, que no monta
          <Header/> — el sidebar es la única franja fija y es una columna aparte. */}
      <div className="surface sticky top-0 z-10 flex flex-wrap items-center gap-2 bg-paper/95 p-4 backdrop-blur">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            type="text"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar por descripción, región o ID…"
            className="w-full rounded-full border border-line bg-paperSoft py-2 pl-9 pr-3 text-sm placeholder:text-mute focus:border-heroViolet focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-1 rounded-full border border-line bg-paperSoft p-1">
          <ViewToggle active={view === "grid"} icon={<LayoutGrid size={13} />} label="Lista" onClick={() => setView("grid")} />
          <ViewToggle active={view === "mapa"} icon={<MapIcon size={13} />} label="Mapa" onClick={() => setView("mapa")} />
        </div>
      </div>

      {/* RESULTADO */}
      {view === "grid" ? (
        <>
          {paginacion}
          {filtradosGrid.length === 0 ? (
            <div className="surface flex flex-col items-center gap-2 p-10 text-center">
              <Search size={20} className="text-mute" />
              <p className="text-sm text-mute">
                {total === 0
                  ? "No hay denuncias que coincidan con esos filtros."
                  : reportes.length === 0
                    ? "Esta página no tiene denuncias — probá una página anterior."
                    : "Ninguna denuncia de esta página coincide con tu búsqueda de texto."}
              </p>
              {total === 0 ? (
                <Link href="/app/denuncias" className="text-xs font-medium text-heroViolet hover:underline">
                  Limpiar filtros
                </Link>
              ) : reportes.length === 0 ? (
                <Link href={hrefPagina(1)} className="text-xs font-medium text-heroViolet hover:underline">
                  Ir a la página 1
                </Link>
              ) : (
                <button onClick={() => setTexto("")} className="text-xs font-medium text-heroViolet hover:underline">
                  Limpiar búsqueda
                </button>
              )}
            </div>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtradosGrid.map((r, i) => (
                <DenunciaCard key={r.id} reporte={r} esConvergente={reportesEnConvergencia.has(r.id)} index={i} />
              ))}
            </ul>
          )}
          {filtradosGrid.length > 10 && paginacion}
        </>
      ) : filtradosMapa.length === 0 ? (
        <div className="surface flex flex-col items-center gap-2 p-10 text-center">
          <Search size={20} className="text-mute" />
          <p className="text-sm text-mute">
            {reportesMapa.length === 0
              ? "No hay denuncias que coincidan con esos filtros."
              : "Ninguna denuncia coincide con tu búsqueda de texto."}
          </p>
          {reportesMapa.length === 0 ? (
            <Link href="/app/denuncias" className="text-xs font-medium text-heroViolet hover:underline">
              Limpiar filtros
            </Link>
          ) : (
            <button onClick={() => setTexto("")} className="text-xs font-medium text-heroViolet hover:underline">
              Limpiar búsqueda
            </button>
          )}
        </div>
      ) : (
        <DenunciasMap reportes={filtradosMapa} />
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function ViewToggle({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active ? "bg-ink text-paper" : "text-mute hover:bg-paperDeep hover:text-ink",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function DenunciaCard({
  reporte,
  esConvergente,
  index,
}: {
  reporte: ReporteCiudadano;
  esConvergente: boolean;
  /** Posición en la grilla — escalona la entrada en cascada, tope en 12 para que una
      página de 24 tarjetas no tarde ~1.7s en terminar de aparecer (24 × 70ms sería
      demasiado lento, no "vivo"). */
  index: number;
}) {
  const meta = CATEGORIA_META[reporte.categoria as CategoriaDenuncia];
  const Icon = meta?.icon ?? Camera;

  const diasDesde = (() => {
    const d = new Date(reporte.fecha);
    const hoy = new Date();
    return Math.floor((hoy.getTime() - d.getTime()) / 86_400_000);
  })();

  return (
    <li>
      <Link
        href={`/app/denuncias/${reporte.id}`}
        className="surface group flex h-full flex-col overflow-hidden p-0 transition-all hover:-translate-y-0.5 hover:shadow-paper"
      >
        {/* Imagen o placeholder */}
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
              <Camera size={28} />
              <span className="ml-2 text-[10px] uppercase tracking-wider">
                Sin foto
              </span>
            </div>
          )}

          {/* Badges sobre la foto */}
          <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold backdrop-blur-md",
                meta?.tone ?? "bg-paperSoft text-ink border-line",
              )}
            >
              <Icon size={10} />
              {meta?.label ?? reporte.categoria}
            </span>
            {esConvergente && (
              <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold text-paper">
                <GitMerge size={10} className="text-amber" />
                convergente
              </span>
            )}
          </div>

          {/* ID en mono abajo derecha */}
          <div className="absolute bottom-2 right-3 font-mono text-[10px] text-paper/85">
            {reporte.id}
          </div>
        </div>

        {/* Cuerpo */}
        <div className="flex flex-1 flex-col gap-2 p-4">
          <p className="line-clamp-3 text-sm leading-relaxed text-ink">
            {reporte.descripcion}
          </p>

          <div className="mt-auto flex flex-wrap items-center gap-2 text-[10px] text-mute">
            <span className="inline-flex items-center gap-1">
              <MapPin size={10} />
              {reporte.region}
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Calendar size={10} />
              hace {diasDesde} día{diasDesde === 1 ? "" : "s"}
            </span>
            <span className="ml-auto">
              {reporte.confirmado ? (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-moss/15 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-moss">
                  <CheckCircle2 size={9} /> verificado
                </span>
              ) : (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-paperDeep px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-mute">
                  <Clock size={9} /> en validación
                </span>
              )}
            </span>
          </div>
        </div>
      </Link>
    </li>
  );
}
