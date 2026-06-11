"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Filter,
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
import {
  CATEGORIA_META,
  TODAS_CATEGORIAS,
  type CategoriaDenuncia,
} from "@/lib/denuncias-meta";
import { DenunciasMap } from "./DenunciasMap";
import { cn } from "@/lib/utils";

type EstadoFilter = "todos" | "verificados" | "en_validacion" | "convergentes";
type ViewMode = "grid" | "mapa";

interface Props {
  reportes: ReporteCiudadano[];
  convergencias: Convergencia[];
}

export function DenunciasGrid({ reportes, convergencias }: Props) {
  const [categoria, setCategoria] = useState<CategoriaDenuncia | "todas">(
    "todas",
  );
  const [estado, setEstado] = useState<EstadoFilter>("todos");
  const [region, setRegion] = useState<string>("todas");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<ViewMode>("grid");

  const reportesEnConvergencia = useMemo(() => {
    const s = new Set<string>();
    convergencias.forEach((c) => c.reporteIds.forEach((rid) => s.add(rid)));
    return s;
  }, [convergencias]);

  const regiones = useMemo(
    () => Array.from(new Set(reportes.map((r) => r.region))).sort(),
    [reportes],
  );

  const filtered = useMemo(() => {
    return reportes.filter((r) => {
      if (categoria !== "todas" && r.categoria !== categoria) return false;
      if (region !== "todas" && r.region !== region) return false;
      if (estado === "verificados" && !r.confirmado) return false;
      if (estado === "en_validacion" && r.confirmado) return false;
      if (estado === "convergentes" && !reportesEnConvergencia.has(r.id))
        return false;
      if (query.trim()) {
        const q = query.trim().toLowerCase();
        if (
          !r.descripcion.toLowerCase().includes(q) &&
          !r.region.toLowerCase().includes(q) &&
          !r.id.toLowerCase().includes(q)
        )
          return false;
      }
      return true;
    });
  }, [reportes, categoria, region, estado, query, reportesEnConvergencia]);

  return (
    <div className="space-y-5">
      {/* FILTROS — barra superior */}
      <div className="surface space-y-3 p-4">
        {/* Search + view toggle */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-mute"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por descripción, región o ID…"
              className="w-full rounded-full border border-line bg-paperSoft py-2 pl-9 pr-3 text-sm placeholder:text-mute focus:border-clay focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-full border border-line bg-paperSoft p-1">
            <ViewToggle
              active={view === "grid"}
              icon={<LayoutGrid size={13} />}
              label="Lista"
              onClick={() => setView("grid")}
            />
            <ViewToggle
              active={view === "mapa"}
              icon={<MapIcon size={13} />}
              label="Mapa"
              onClick={() => setView("mapa")}
            />
          </div>
        </div>

        {/* Chips categorías */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-mute">
            <Filter size={11} /> Categoría
          </span>
          <CategoryChip
            active={categoria === "todas"}
            label="Todas"
            onClick={() => setCategoria("todas")}
            color="#76695A"
          />
          {TODAS_CATEGORIAS.map((c) => {
            const meta = CATEGORIA_META[c];
            const Icon = meta.icon;
            return (
              <CategoryChip
                key={c}
                active={categoria === c}
                label={meta.label}
                icon={<Icon size={11} />}
                color={meta.color}
                onClick={() =>
                  setCategoria((prev) => (prev === c ? "todas" : c))
                }
              />
            );
          })}
        </div>

        {/* Estado + Región */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-mute">
              Estado
            </span>
            <select
              value={estado}
              onChange={(e) => setEstado(e.target.value as EstadoFilter)}
              className="rounded-full border border-line bg-paperSoft px-2.5 py-1 text-xs text-ink focus:border-clay focus:outline-none"
            >
              <option value="todos">Todos</option>
              <option value="verificados">✓ Verificados</option>
              <option value="en_validacion">En validación</option>
              <option value="convergentes">⚫ Convergentes</option>
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-mute">
              Región
            </span>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="rounded-full border border-line bg-paperSoft px-2.5 py-1 text-xs text-ink focus:border-clay focus:outline-none"
            >
              <option value="todas">Todas</option>
              {regiones.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <span className="ml-auto text-[11px] text-mute">
            {filtered.length} de {reportes.length} reporte
            {reportes.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* RESULTADO */}
      {filtered.length === 0 ? (
        <div className="surface flex flex-col items-center gap-2 p-10 text-center">
          <Search size={20} className="text-mute" />
          <p className="text-sm text-mute">
            No hay denuncias que coincidan con esos filtros.
          </p>
          <button
            onClick={() => {
              setCategoria("todas");
              setEstado("todos");
              setRegion("todas");
              setQuery("");
            }}
            className="text-xs font-medium text-clay hover:underline"
          >
            Limpiar filtros
          </button>
        </div>
      ) : view === "grid" ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <DenunciaCard
              key={r.id}
              reporte={r}
              esConvergente={reportesEnConvergencia.has(r.id)}
            />
          ))}
        </ul>
      ) : (
        <DenunciasMap reportes={filtered} />
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

function CategoryChip({
  active,
  label,
  icon,
  color,
  onClick,
}: {
  active: boolean;
  label: string;
  icon?: React.ReactNode;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-ink bg-ink text-paper"
          : "border-line bg-paperSoft text-ink hover:bg-paperDeep",
      )}
    >
      {icon && (
        <span
          style={{ color: active ? "currentColor" : color }}
          className="flex items-center"
        >
          {icon}
        </span>
      )}
      {label}
    </button>
  );
}

function DenunciaCard({
  reporte,
  esConvergente,
}: {
  reporte: ReporteCiudadano;
  esConvergente: boolean;
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
                alt={reporte.descripcion}
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
              <MapPin size={10} className="text-clay" />
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
