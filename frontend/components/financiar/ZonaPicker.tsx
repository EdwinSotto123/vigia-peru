"use client";

/**
 * Selector de zona SIN mapa (el mapa vive en /app/mapa). Buscador sobre
 * departamentos → provincias → distritos (carga hijas bajo demanda) y lista de
 * las regiones con más contratos en cola. Cada fila lleva a /financiar/[ubigeo].
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Search, ArrowRight } from "lucide-react";
import { ESTADO_FILL, ESTADO_LABEL, type Zona } from "@/lib/financiamiento";

const API = process.env.NEXT_PUBLIC_VIGIA_API_URL ?? "https://vigia-peru-api-36169102688.us-central1.run.app";

function norm(s: string) {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function ZonaPicker({ zonas, precioPen }: { zonas: Zona[]; precioPen: number }) {
  const [q, setQ] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);           // departamento expandido
  const [hijas, setHijas] = useState<Record<string, Zona[]>>({});          // ubigeo → provincias/distritos

  const deptos = useMemo(() => [...zonas].filter((z) => z.totalCola > 0).sort((a, b) => b.totalCola - a.totalCola), [zonas]);

  // Búsqueda: cuando hay texto, buscamos también en todas las provincias (una sola carga).
  const [todasProv, setTodasProv] = useState<Zona[] | null>(null);
  useEffect(() => {
    if (q.trim().length < 2 || todasProv) return;
    fetch(`${API}/financiamiento/zonas?nivel=provincia`).then((r) => r.json()).then((j) => setTodasProv(j.data ?? [])).catch(() => setTodasProv([]));
  }, [q, todasProv]);

  useEffect(() => {
    if (!abierto || hijas[abierto]) return;
    const nivel = abierto.length === 2 ? "provincia" : "distrito";
    fetch(`${API}/financiamiento/zonas?nivel=${nivel}&padre=${abierto}`).then((r) => r.json())
      .then((j) => setHijas((m) => ({ ...m, [abierto]: (j.data ?? []).filter((z: Zona) => z.totalCola > 0).sort((a: Zona, b: Zona) => b.totalCola - a.totalCola) })))
      .catch(() => setHijas((m) => ({ ...m, [abierto]: [] })));
  }, [abierto, hijas]);

  const resultados = useMemo(() => {
    const t = norm(q.trim());
    if (t.length < 2) return null;
    const pool = [...zonas, ...(todasProv ?? [])].filter((z) => z.totalCola > 0);
    return pool.filter((z) => norm(z.nombre).includes(t)).sort((a, b) => b.totalCola - a.totalCola).slice(0, 12);
  }, [q, zonas, todasProv]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <div>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca tu región, provincia o distrito (ej. Huamanga, Cañete, Cusco)" className="w-full rounded-xl border border-line bg-paper py-3 pl-10 pr-3 text-sm" />
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
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button onClick={() => setAbierto(abierto === d.ubigeo ? null : d.ubigeo)} className="flex flex-1 items-center gap-2 text-left text-sm" aria-expanded={abierto === d.ubigeo}>
                    <ChevronRight size={14} className={`text-mute transition-transform ${abierto === d.ubigeo ? "rotate-90" : ""}`} />
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: ESTADO_FILL[d.estado] }} />
                    <span className="font-medium text-ink">{d.nombre}</span>
                    <span className="ml-auto font-mono text-xs text-mute">{d.totalCola.toLocaleString("es-PE")} · S/ {(d.totalCola * precioPen).toLocaleString("es-PE")}</span>
                  </button>
                  <Link href={`/app/financiar/${d.ubigeo}`} className="rounded-lg bg-ink px-2.5 py-1 text-xs font-semibold text-paper">Financiar</Link>
                </div>
                {abierto === d.ubigeo && (
                  <ul className="border-t border-line bg-paperSoft">
                    {!hijas[d.ubigeo] && <li className="px-10 py-2 text-xs text-mute">Cargando provincias…</li>}
                    {(hijas[d.ubigeo] ?? []).map((p) => <Fila key={p.ubigeo} z={p} precioPen={precioPen} nested />)}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <aside className="rounded-2xl border border-line bg-paperDeep p-5">
        <div className="text-[11px] uppercase tracking-wide text-mute">Cómo se lee esta lista</div>
        <dl className="mt-3 space-y-3 text-sm">
          <div><dt className="font-semibold text-ink">Cola</dt><dd className="text-mute">Contratos públicos de la zona que Vigía todavía no leyó (últimos 90 días, todo el Perú, desde la API del OECE).</dd></div>
          <div><dt className="font-semibold text-ink">Costo</dt><dd className="text-mute">S/ {precioPen} por contrato: S/ 1 de procesamiento, S/ 1 de infraestructura y datos, S/ 1 de reserva para expedientes pesados.</dd></div>
          <div><dt className="font-semibold text-ink">Estados</dt><dd className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-mute">
            {(["pendiente", "parcial", "financiada", "procesada"] as const).map((e) => <span key={e} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: ESTADO_FILL[e] }} />{ESTADO_LABEL[e]}</span>)}
          </dd></div>
        </dl>
        <Link href="/app/mapa" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-ink hover:underline">Ver estas zonas en el mapa <ArrowRight size={14} /></Link>
      </aside>
    </div>
  );
}

function Fila({ z, precioPen, nested = false }: { z: Zona; precioPen: number; nested?: boolean }) {
  return (
    <li>
      <Link href={`/app/financiar/${z.ubigeo}`} className={`flex items-center gap-2 py-2.5 pr-3 text-sm hover:bg-paperDeep ${nested ? "pl-10" : "px-3"}`}>
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: ESTADO_FILL[z.estado] }} />
        <span className="text-ink">{z.nombre}</span>
        <span className="text-[11px] text-mute">{z.nivel}</span>
        <span className="ml-auto font-mono text-xs text-mute">{z.totalCola.toLocaleString("es-PE")} · S/ {(z.totalCola * precioPen).toLocaleString("es-PE")}</span>
        <ChevronRight size={14} className="text-mute" />
      </Link>
    </li>
  );
}
