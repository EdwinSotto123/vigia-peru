"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Search, ArrowUpRight, ListFilter } from "lucide-react";
import { getEntidades, type ApiEntidad } from "@/lib/api-client";
import { formatSoles } from "@/lib/mock-data";
import { belongsToRegion } from "./region-match";

const TIPO_LABEL: Record<string, string> = {
  municipal_distrital: "Mun. distrital",
  municipal_provincial: "Mun. provincial",
  gobierno_regional: "Gob. regional",
  ministerio: "Ministerio",
  empresa_publica: "Empresa pública",
  organismo_autonomo: "Org. autónomo",
};

/**
 * Entidades contratantes de una región (API real, `/entidades?region=`).
 * El filtro del API es por igualdad exacta del nombre; si no devuelve nada,
 * cae a la lista completa filtrada localmente (los nombres de región en la
 * base no siempre están normalizados).
 */
export function EntidadesDeZona({ regionId, nombre }: { regionId: string; nombre: string }) {
  const [items, setItems] = useState<ApiEntidad[] | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    setItems(null);
    setError(false);
    (async () => {
      try {
        let data = await getEntidades({ region: nombre, limit: 100 });
        if (data.length === 0) {
          const all = await getEntidades({ limit: 100 });
          data = all.filter((e) => belongsToRegion(e, regionId));
        }
        if (alive) setItems(data);
      } catch {
        if (alive) {
          setItems([]);
          setError(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [regionId, nombre]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    const base = needle
      ? items.filter((e) => e.nombre.toLowerCase().includes(needle) || e.ruc.includes(needle))
      : items;
    return [...base].sort((a, b) => (b.alertas ?? 0) - (a.alertas ?? 0) || (b.monto ?? 0) - (a.monto ?? 0));
  }, [items, q]);

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2">
        <Search size={13} className="shrink-0 text-mute" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Buscar entidad en ${nombre}…`}
          className="w-full bg-transparent text-sm text-ink placeholder:text-mute focus:outline-none"
        />
        {items && (
          <span className="shrink-0 font-mono text-[10px] text-mute">
            {filtered.length}/{items.length}
          </span>
        )}
      </label>

      {items === null && (
        <ul className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="h-14 animate-pulse rounded-xl bg-paperDeep" />
          ))}
        </ul>
      )}

      {items && filtered.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-paper p-6 text-center">
          <ListFilter size={18} className="mx-auto text-mute" />
          <p className="mt-2 text-sm text-mute">
            {error
              ? "No se pudo consultar el registro de entidades."
              : q
                ? "Ninguna entidad coincide con la búsqueda."
                : `Todavía no hay entidades de ${nombre} con contratos ingresados.`}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <ul className="space-y-1.5">
          {filtered.slice(0, 40).map((e) => (
            <li key={e.ruc}>
              <Link
                href={`/entidad/${e.ruc}`}
                className="group flex items-start gap-2.5 rounded-xl border border-line bg-paper px-3 py-2.5 transition-colors hover:border-heroViolet/60 hover:bg-paperDeep"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-paperDeep text-heroViolet group-hover:bg-paper">
                  <Building2 size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[12px] font-medium leading-snug text-ink">{e.nombre}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[10px] text-mute">
                    <span>{TIPO_LABEL[e.tipo] ?? e.tipo ?? "Entidad"}</span>
                    {e.provincia && <span>{e.provincia}</span>}
                    {e.alertas > 0 && (
                      <span className="text-rust">
                        {e.alertas} señal{e.alertas === 1 ? "" : "es"}
                      </span>
                    )}
                    {e.monto > 0 && <span className="font-mono text-heroViolet">{formatSoles(e.monto)}</span>}
                  </span>
                </span>
                <ArrowUpRight size={13} className="mt-1 shrink-0 text-mute opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link href="/app/entidades" className="block text-center text-[11px] text-mute hover:text-heroViolet hover:underline">
        Ver el ranking nacional de entidades →
      </Link>
    </div>
  );
}
