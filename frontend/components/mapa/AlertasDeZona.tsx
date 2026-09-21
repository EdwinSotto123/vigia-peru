"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ListFilter } from "lucide-react";
import { getAlertas } from "@/lib/api-client";
import { formatSoles } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { belongsToRegion } from "./region-match";

/** Ruta del dossier de una alerta (misma regla que los pines del mapa). */
export function alertaHref(a: any): string {
  const ocid = a.codigoconvocatoria || (typeof a.codigo === "string" ? a.codigo.replace("OECE-", "") : null) || a.id;
  return `/app/convocatoria/${encodeURIComponent(String(ocid))}`;
}

/**
 * Señales de riesgo (alertas) de una región. Si el padre ya trajo las alertas
 * del API (el mapa las usa para los pines) las reutiliza; si no, las pide.
 */
export function AlertasDeZona({
  regionId,
  nombre,
  alertas,
  limit = 20,
}: {
  regionId: string;
  nombre: string;
  /** Alertas ya cargadas por el padre (evita un segundo fetch). */
  alertas?: any[];
  limit?: number;
}) {
  const [fetched, setFetched] = useState<any[] | null>(null);
  const needsFetch = !alertas || alertas.length === 0;

  useEffect(() => {
    if (!needsFetch) return;
    let alive = true;
    getAlertas({ limit: 300 })
      .then((d) => alive && setFetched(d as any[]))
      .catch(() => alive && setFetched([]));
    return () => {
      alive = false;
    };
  }, [needsFetch]);

  const source = needsFetch ? fetched : alertas;
  const rows = useMemo(() => {
    if (!source) return null;
    return source
      .filter((a) => belongsToRegion(a, regionId))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }, [source, regionId, limit]);

  if (rows === null) {
    return (
      <ul className="space-y-2">
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-16 animate-pulse rounded-xl bg-paperDeep" />
        ))}
      </ul>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-paper p-6 text-center">
        <ListFilter size={18} className="mx-auto text-mute" />
        <p className="mt-2 text-sm text-mute">
          Sin señales de riesgo publicadas en {nombre} todavía. Los contratos de la zona se analizan a
          medida que su auditoría se financia.
        </p>
        <Link href="/app/financiar" className="mt-3 inline-block text-[11px] font-medium text-heroViolet hover:underline">
          Financiar la auditoría de {nombre} →
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {rows.map((a) => {
          const score: number = a.score ?? 0;
          const nBanderas = Array.isArray(a.banderas) ? a.banderas.length : 0;
          return (
            <li key={a.id ?? a.codigo}>
              <Link
                href={alertaHref(a)}
                className="group flex items-start gap-2.5 rounded-xl border border-line bg-paper p-2.5 transition-colors hover:border-heroViolet/60 hover:bg-paperDeep"
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg text-paper",
                    score >= 85 ? "bg-rust" : score >= 70 ? "bg-clay" : "bg-amber",
                  )}
                >
                  <span className="text-sm font-bold leading-none">{score}</span>
                  <span className="mt-0.5 text-[7px] uppercase tracking-wider opacity-80">score</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[12px] font-medium leading-snug text-ink">{a.objeto}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-mute">
                    {a.entidad && <span className="line-clamp-1 max-w-[180px]">{a.entidad}</span>}
                    {a.montoSoles > 0 && <span className="font-mono text-heroViolet">{formatSoles(a.montoSoles)}</span>}
                    {nBanderas > 0 && (
                      <span className="text-rust">
                        {nBanderas} señal{nBanderas === 1 ? "" : "es"}
                      </span>
                    )}
                  </span>
                </span>
                <ArrowUpRight size={13} className="mt-1 shrink-0 text-mute opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] leading-relaxed text-mute">
        Señales de riesgo, no acusaciones. Cada una cita la norma y enlaza a la fuente oficial.
      </p>
      <Link href="/app/alertas" className="block text-center text-[11px] text-mute hover:text-heroViolet hover:underline">
        Ver todas las alertas del país →
      </Link>
    </div>
  );
}
