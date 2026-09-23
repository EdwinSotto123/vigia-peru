"use client";

/**
 * Selector de zona SIN mapa (el mapa vive en /app/mapa y la página lo enlaza una sola vez).
 * Buscador sobre departamentos → provincias (carga hijas bajo demanda) y lista de las regiones
 * con más contratos sin financiar. Cada fila ES el enlace a /app/financiar/[ubigeo]; el chevrón
 * de la izquierda solo despliega las provincias.
 *
 * Las cifras son las de `pendientes` (contratos que nadie financió todavía) y su costo: las
 * mismas que muestra la ficha de la zona, para que "en cola" no diga 604 aquí y 594 allá.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { ESTADO_FILL, ESTADO_LABEL, conAcentos, formatPEN, type ParteTarifa, type Zona } from "@/lib/financiamiento";

const API = process.env.NEXT_PUBLIC_VIGIA_API_URL ?? "https://vigia-peru-api-36169102688.us-central1.run.app";

function norm(s: string) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const conNombre = (zs: Zona[]) => zs.map((z) => ({ ...z, nombre: conAcentos(z.nombre) }));

export function ZonaPicker({
  zonas,
  precioPen,
  partes,
  alcance,
}: {
  zonas: Zona[];
  precioPen: number;
  /** Desglose real de la tarifa (`estado.tarifa.nota`), ya separado en partes. */
  partes: ParteTarifa[];
  /** Qué entra hoy a la cola financiable, en palabras (`alcanceCorto`). */
  alcance: string;
}) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);           // departamento expandido
  const [hijas, setHijas] = useState<Record<string, Zona[]>>({});          // ubigeo → provincias

  const deptos = useMemo(() => [...zonas].filter((z) => z.totalCola > 0).sort((a, b) => b.pendientes - a.pendientes), [zonas]);

  // Búsqueda: cuando hay texto, buscamos también en todas las provincias (una sola carga).
  const [todasProv, setTodasProv] = useState<Zona[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2 || todasProv) return;
    fetch(`${API}/financiamiento/zonas?nivel=provincia`).then((r) => r.json()).then((j) => setTodasProv(conNombre(j.data ?? []))).catch(() => setTodasProv([]));
  }, [q, todasProv]);

  useEffect(() => {
    if (!abierto || hijas[abierto]) return;
    const nivel = abierto.length === 2 ? "provincia" : "distrito";
    fetch(`${API}/financiamiento/zonas?nivel=${nivel}&padre=${abierto}`).then((r) => r.json())
      .then((j) => setHijas((m) => ({ ...m, [abierto]: conNombre(j.data ?? []).filter((z) => z.totalCola > 0).sort((a, b) => b.pendientes - a.pendientes) })))
      .catch(() => setHijas((m) => ({ ...m, [abierto]: [] })));
  }, [abierto, hijas]);

  const resultados = useMemo(() => {
    const t = norm(q.trim());
    if (t.length < 2) return null;
    const pool = [...zonas, ...(todasProv ?? [])].filter((z) => z.totalCola > 0);
    return pool.filter((z) => norm(z.nombre).includes(t)).sort((a, b) => b.pendientes - a.pendientes).slice(0, 12);
  }, [q, zonas, todasProv]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div>
        <label htmlFor="buscar-zona" className="sr-only">Buscar región, provincia o distrito</label>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
          <input id="buscar-zona" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca tu región, provincia o distrito (ej. Huamanga, Cañete, Cusco)" className="w-full rounded-xl border border-line bg-paper py-3 pl-10 pr-3 text-sm" />
        </div>
        {resultados ? (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
            {!resultados.length && <li className="px-4 py-6 text-center text-sm text-mute">Sin zonas con contratos en cola para “{q}”.</li>}
            {resultados.map((z) => <Fila key={z.ubigeo} z={z} precioPen={precioPen} />)}
          </ul>
        ) : (
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
            {deptos.map((d) => (
              <li key={d.ubigeo}>
                <div className="flex items-stretch">
                  <button
                    type="button"
                    onClick={() => setAbierto(abierto === d.ubigeo ? null : d.ubigeo)}
                    aria-expanded={abierto === d.ubigeo}
                    aria-label={`${abierto === d.ubigeo ? "Ocultar" : "Ver"} provincias de ${d.nombre}`}
                    className="flex shrink-0 items-center px-3 text-mute hover:bg-paperDeep hover:text-ink"
                  >
                    <ChevronRight size={14} className={`transition-transform ${abierto === d.ubigeo ? "rotate-90" : ""}`} aria-hidden />
                  </button>
                  <FilaEnlace z={d} precioPen={precioPen} className="flex-1 pl-0" />
                </div>
                {abierto === d.ubigeo && (
                  <ul className="border-t border-line bg-paperSoft">
                    {!hijas[d.ubigeo] && <li className="px-10 py-2 text-xs text-mute">Cargando provincias…</li>}
                    {hijas[d.ubigeo] && hijas[d.ubigeo].length === 0 && <li className="px-10 py-2 text-xs text-mute">Sin provincias con contratos en cola.</li>}
                    {(hijas[d.ubigeo] ?? []).map((p) => <Fila key={p.ubigeo} z={p} precioPen={precioPen} nested />)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="rounded-2xl border border-line bg-paperDeep p-5">
        <h3 className="text-[11px] uppercase tracking-wide text-inkSoft">Cómo se lee esta lista</h3>
        <dl className="mt-3 space-y-3 text-sm">
          <div>
            <dt className="font-semibold text-ink">En cola</dt>
            <dd className="text-inkSoft">Contratos de la zona que nadie financió todavía. Hoy entran a la cola solo {alcance}.</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Costo</dt>
            <dd className="text-inkSoft">
              {formatPEN(precioPen)} por contrato.
              {partes.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[13px]">
                  {partes.map((p) => (
                    <li key={p.concepto} className="flex items-baseline gap-2">
                      <span className="w-10 shrink-0 font-mono text-ink">{formatPEN(p.monto)}</span>
                      <span>{p.concepto}</span>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          <div><dt className="font-semibold text-ink">Estados</dt><dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-inkSoft">
            {(["pendiente", "parcial", "financiada", "procesada"] as const).map((e) => <span key={e} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: ESTADO_FILL[e] }} aria-hidden />{ESTADO_LABEL[e]}</span>)}
          </dd></div>
        </dl>
      </aside>
    </div>
  );
}

/** Contenido de la fila: estado, nombre, contratos sin financiar y su costo. Toda la fila es el enlace. */
function FilaEnlace({ z, precioPen, className = "", nivel = false }: { z: Zona; precioPen: number; className?: string; nivel?: boolean }) {
  return (
    <Link href={`/app/financiar/${z.ubigeo}`} className={`flex min-w-0 items-center gap-2 py-2.5 pr-3 text-sm hover:bg-paperDeep ${className}`}>
      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: ESTADO_FILL[z.estado] }} aria-hidden />
      <span className="min-w-0 truncate font-medium text-ink">{z.nombre}</span>
      {nivel && <span className="shrink-0 text-[11px] text-mute">{z.nivel}</span>}
      {z.financiados > 0 && <span className="hidden shrink-0 text-[11px] text-moss sm:inline">{z.financiados.toLocaleString("es-PE")} financiados</span>}
      <span className="ml-auto shrink-0 text-right font-mono text-xs text-inkSoft">
        {z.pendientes.toLocaleString("es-PE")} en cola
        <span className="ml-2.5">{formatPEN(z.pendientes * precioPen)}</span>
      </span>
      <ChevronRight size={14} className="shrink-0 text-mute" aria-hidden />
    </Link>
  );
}

function Fila({ z, precioPen, nested = false }: { z: Zona; precioPen: number; nested?: boolean }) {
  return (
    <li>
      <FilaEnlace z={z} precioPen={precioPen} nivel className={nested ? "pl-10" : "px-3"} />
    </li>
  );
}
