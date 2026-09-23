"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Search, ArrowUpRight, ListFilter } from "lucide-react";
import type { ApiEntidad } from "@/lib/api-client";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { formatSoles } from "@/lib/formato";

const TIPO_LABEL: Record<string, string> = {
  municipal_distrital: "Mun. distrital",
  municipal_provincial: "Mun. provincial",
  gobierno_regional: "Gob. regional",
  ministerio: "Ministerio",
  empresa_publica: "Empresa pública",
  organismo_autonomo: "Org. autónomo",
};

/**
 * Cómo escribe la base cada departamento en `entidades.region`. `/entidades?region=`
 * compara por igualdad exacta, y la base no es pareja: "Áncash" y "Junín" con
 * tilde, "Apurimac", "Huanuco" y "San Martin" sin, "Madre De Dios" con la D
 * mayúscula. Medido el 2026-09-23 contra la API, los 25. Antes se pedía con el
 * nombre de la interfaz y cuatro departamentos volvían vacíos; el respaldo
 * filtraba el top 100 nacional y mostraba "3/3".
 */
const REGION_EN_BASE: Record<string, string> = {
  "01": "Amazonas",
  "02": "Áncash",
  "03": "Apurimac",
  "04": "Arequipa",
  "05": "Ayacucho",
  "06": "Cajamarca",
  "07": "Callao",
  "08": "Cusco",
  "09": "Huancavelica",
  "10": "Huanuco",
  "11": "Ica",
  "12": "Junín",
  "13": "La Libertad",
  "14": "Lambayeque",
  "15": "Lima",
  "16": "Loreto",
  "17": "Madre De Dios",
  "18": "Moquegua",
  "19": "Pasco",
  "20": "Piura",
  "21": "Puno",
  "22": "San Martin",
  "23": "Tacna",
  "24": "Tumbes",
  "25": "Ucayali",
};

/** La API corta en 100 por página. */
const POR_PAGINA = 100;
const VISIBLES = 40;

interface Pagina {
  data: ApiEntidad[];
  total: number;
}

/**
 * Entidades contratantes de un departamento (`/entidades?region=`), ordenadas
 * como las ordena la API (más señales primero). La búsqueda va al servidor, así
 * que encuentra entre TODAS las entidades de la zona, no sólo entre las 100 de
 * la primera página. El contador dice cuántas se ven de cuántas hay.
 */
export function EntidadesDeZona({ ubigeo, nombre }: { ubigeo: string; nombre: string }) {
  const [pagina, setPagina] = useState<Pagina | null>(null);
  const [error, setError] = useState(false);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const region = REGION_EN_BASE[ubigeo] ?? nombre;

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const ctrl = new AbortController();
    setError(false);
    setPagina(null);
    const qs = new URLSearchParams({ region, limit: String(POR_PAGINA) });
    if (qDebounced) qs.set("q", qDebounced);
    fetch(`${PUBLIC_API_BASE}/entidades?${qs}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { data?: ApiEntidad[]; total?: number }) => {
        const data = Array.isArray(j.data) ? j.data : [];
        setPagina({ data, total: typeof j.total === "number" ? j.total : data.length });
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        console.warn("[EntidadesDeZona]", e);
        setPagina({ data: [], total: 0 });
        setError(true);
      });
    return () => ctrl.abort();
  }, [region, qDebounced]);

  const visibles = pagina?.data.slice(0, VISIBLES) ?? [];

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2 focus-within:ring-2 focus-within:ring-heroViolet focus-within:ring-offset-1">
        <Search size={13} className="shrink-0 text-mute" aria-hidden />
        <span className="sr-only">Buscar entidad en {nombre}</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Buscar entidad en ${nombre}…`}
          className="w-full bg-transparent text-sm text-ink placeholder:text-mute focus:outline-none"
        />
      </label>

      {pagina && pagina.total > 0 && (
        <p className="text-[12px] text-mute" aria-live="polite">
          <span className="font-mono tabular-nums text-ink">{visibles.length.toLocaleString("es-PE")}</span> de{" "}
          <span className="font-mono tabular-nums text-ink">{pagina.total.toLocaleString("es-PE")}</span>{" "}
          {qDebounced ? `entidades de ${nombre} que coinciden` : `entidades de ${nombre}`}, primero las que tienen más señales
        </p>
      )}

      {pagina === null && (
        <ul className="space-y-2" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="h-14 animate-pulse rounded-xl bg-paperDeep" />
          ))}
        </ul>
      )}

      {pagina && visibles.length === 0 && (
        <div className="rounded-xl border border-dashed border-line bg-paper p-6 text-center">
          <ListFilter size={18} className="mx-auto text-mute" aria-hidden />
          <p className="mt-2 text-sm text-mute">
            {error
              ? "No se pudo consultar el registro de entidades. Vuelve a intentarlo en un momento."
              : qDebounced
                ? "Ninguna entidad de la zona coincide con la búsqueda."
                : `Todavía no hay entidades de ${nombre} con contratos ingresados.`}
          </p>
        </div>
      )}

      {visibles.length > 0 && (
        <ul className="space-y-1.5">
          {visibles.map((e) => (
            <li key={e.ruc}>
              <Link
                href={`/entidad/${e.ruc}`}
                className="group flex items-start gap-2.5 rounded-xl border border-line bg-paper px-3 py-2.5 transition-colors hover:border-heroViolet/60 hover:bg-paperDeep"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-paperDeep text-heroViolet group-hover:bg-paper">
                  <Building2 size={13} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[12px] font-medium leading-snug text-ink">{e.nombre}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-mute">
                    <span>{TIPO_LABEL[e.tipo] ?? e.tipo ?? "Entidad"}</span>
                    {e.provincia && <span>{e.provincia}</span>}
                    {e.alertas > 0 && (
                      <span className="text-crimsonTexto">
                        {e.alertas} señal{e.alertas === 1 ? "" : "es"}
                      </span>
                    )}
                    {e.monto > 0 && <span className="font-mono text-inkSoft">{formatSoles(e.monto)}</span>}
                  </span>
                </span>
                <ArrowUpRight size={13} className="mt-1 shrink-0 text-mute opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link href="/app/entidades" className="block text-center text-[12px] text-inkSoft hover:text-heroViolet hover:underline">
        Ver el ranking nacional de entidades
      </Link>
    </div>
  );
}
