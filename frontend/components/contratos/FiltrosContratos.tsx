"use client";

/**
 * Filtros de /app/contratos. Viven en la URL (`?q=&tipo=&etapa=&ubigeo=&riesgo=&orden=…`):
 * cada cambio hace `router.replace` y el server component vuelve a pedir la página 1.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { ETAPAS, OPERATIVOS, ORDENES, RIESGOS, TIPOS, contratosQueryString, type ContratosQuery } from "@/lib/contratos";

interface Props {
  query: ContratosQuery;
  regiones: { ubigeo: string; nombre: string }[];
  /** Nombre de la entidad cuando el filtro `entidad=<ruc>` viene de un enlace. */
  entidadNombre?: string | null;
  total?: number | null;
}

export function FiltrosContratos({ query, regiones, entidadNombre, total }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, start] = useTransition();
  const [q, setQ] = useState(query.q ?? "");
  const timer = useRef<number | null>(null);

  useEffect(() => { setQ(query.q ?? ""); }, [query.q]);

  const navegar = (patch: Partial<ContratosQuery>) => {
    const qs = contratosQueryString({ ...query, ...patch, page: 1 });
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const onQ = (v: string) => {
    setQ(v);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => navegar({ q: v.trim() || undefined }), 350);
  };

  const activos = [query.tipo, query.etapa, query.ubigeo, query.riesgo, query.operativo, query.entidad, query.monto_min, query.monto_max, query.q].filter((v) => v != null && v !== "").length;
  const sel = "h-8 rounded-lg border border-line bg-paper px-2 text-xs text-ink outline-none focus:border-clay";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex min-w-[220px] flex-1 items-center">
          <Search size={13} className="pointer-events-none absolute left-2.5 text-mute" aria-hidden />
          <span className="sr-only">Buscar por objeto, código o entidad</span>
          <input
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Objeto, código o entidad…"
            className="h-8 w-full rounded-lg border border-line bg-paper pl-8 pr-8 text-xs text-ink outline-none placeholder:text-mute focus:border-clay"
          />
          {pendiente && <Loader2 size={13} className="absolute right-2.5 animate-spin text-mute" aria-label="Cargando" />}
        </label>
        <select value={query.ubigeo ?? ""} onChange={(e) => navegar({ ubigeo: e.target.value || undefined })} className={sel} aria-label="Región">
          <option value="">Todo el Perú</option>
          {regiones.map((r) => <option key={r.ubigeo} value={r.ubigeo}>{r.nombre}</option>)}
          {query.ubigeo && !regiones.some((r) => r.ubigeo === query.ubigeo) && <option value={query.ubigeo}>Zona {query.ubigeo}</option>}
        </select>
        <select value={query.tipo ?? ""} onChange={(e) => navegar({ tipo: (e.target.value || undefined) as ContratosQuery["tipo"] })} className={sel} aria-label="Tipo">
          <option value="">Todo tipo</option>
          {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={query.etapa ?? ""} onChange={(e) => navegar({ etapa: (e.target.value || undefined) as ContratosQuery["etapa"] })} className={sel} aria-label="Etapa">
          <option value="">Toda etapa</option>
          {ETAPAS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={query.riesgo ?? ""} onChange={(e) => navegar({ riesgo: (e.target.value || undefined) as ContratosQuery["riesgo"] })} className={sel} aria-label="Señal de riesgo">
          <option value="">Toda señal</option>
          {RIESGOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select value={query.operativo ?? ""} onChange={(e) => navegar({ operativo: (e.target.value || undefined) as ContratosQuery["operativo"] })} className={sel} aria-label="Estado operativo">
          <option value="">Cola y documentos</option>
          {OPERATIVOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <Monto label="Monto mín." value={query.monto_min} onCommit={(v) => navegar({ monto_min: v })} />
        <Monto label="Monto máx." value={query.monto_max} onCommit={(v) => navegar({ monto_max: v })} />
        <select value={query.orden ?? "fecha"} onChange={(e) => navegar({ orden: e.target.value as ContratosQuery["orden"] })} className={sel} aria-label="Orden">
          {ORDENES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      {(query.entidad || activos > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-mute">
          {query.entidad && (
            <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paperSoft px-2 py-0.5 text-ink">
              Entidad: {entidadNombre ?? query.entidad}
              <button type="button" onClick={() => navegar({ entidad: undefined })} aria-label="Quitar filtro de entidad" className="text-mute hover:text-ink"><X size={11} /></button>
            </span>
          )}
          <button
            type="button"
            onClick={() => { setQ(""); start(() => router.replace(pathname, { scroll: false })); }}
            className="underline-offset-2 hover:text-ink hover:underline"
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );
}

function Monto({ label, value, onCommit }: { label: string; value: number | string | undefined; onCommit: (v: number | undefined) => void }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => { setV(value == null ? "" : String(value)); }, [value]);
  const commit = () => {
    const n = v.trim() === "" ? undefined : Number(v.replace(/[^\d.]/g, ""));
    onCommit(n != null && Number.isFinite(n) ? n : undefined);
  };
  return (
    <label className="inline-flex items-center gap-1 text-[11px] text-mute">
      <span className="sr-only">{label}</span>
      <input
        inputMode="numeric"
        value={v}
        placeholder={`${label} S/`}
        onChange={(e) => setV(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
        className="h-8 w-[104px] rounded-lg border border-line bg-paper px-2 font-mono text-xs text-ink outline-none placeholder:font-sans placeholder:text-mute focus:border-clay"
      />
    </label>
  );
}
