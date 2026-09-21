"use client";

/**
 * Lo que faltaba del hero: al hacer clic en una región del mapa, una tarjeta flotante
 * con sus datos reales (no un mockup fijo) — y una segunda tarjeta con un contrato real
 * ya procesado. Client component porque necesita estado (qué región está seleccionada);
 * CampaignMap.tsx gana un `onRegionClick` opcional y aditivo para esto, sin tocar su
 * comportamiento en /app/financiar (que no lo pasa).
 */

import { AlertTriangle, ArrowUpRight, MapPin, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CampaignMap } from "@/components/financiar/CampaignMap";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import type { Zona } from "@/lib/financiamiento";
import type { Alerta } from "@/types";
import { LlamaHero } from "./LlamaHero";

function formatPEN(n: number) {
  return `S/ ${Math.round(n).toLocaleString("es-PE")}`;
}

export function HeroMapPanel({ zonas, top, featured }: { zonas: Zona[]; top: Zona[]; featured: Alerta | null }) {
  const [clickedCode, setClickedCode] = useState<string | null>(null);
  const clicked = useMemo(() => zonas.find((z) => z.ubigeo === clickedCode) ?? null, [zonas, clickedCode]);
  // "monto monitoreado": lo único real y honesto que se puede afirmar sin un agregado de
  // montoSoles por zona en el API — el costo de leer toda su cola, al precio vigente.
  const costoAuditar = clicked ? clicked.totalCola * clicked.precioPen : 0;

  return (
    <div className="relative">
      {zonas.length > 0 ? (
        <CampaignMap zonas={zonas} compact onRegionClick={setClickedCode} />
      ) : (
        <div className="p-10 text-center text-sm text-mute">Mapa no disponible por ahora.</div>
      )}
      <p className="mt-1 text-center font-mono text-[10px] text-mute/70">SEACE · OECE · OCDS — datos oficiales, en vivo</p>

      {/* Tarjeta flotante: región elegida (datos reales, no fijos) */}
      {clicked && (
        <div className="animate-slideUp absolute left-1 top-1 z-10 w-[235px] rounded-2xl border border-line bg-paper/95 p-3 shadow-lg backdrop-blur">
          <button
            onClick={() => setClickedCode(null)}
            aria-label="Cerrar"
            className="absolute right-2 top-2 rounded-full p-1 text-mute transition-colors hover:bg-paperDeep hover:text-ink"
          >
            <X size={12} />
          </button>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-heroViolet">
            <MapPin size={12} /> {clicked.nombre}
          </span>
          {clicked.totalCola > 0 ? (
            <>
              <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px]">
                <Stat k="Contratos" v={clicked.totalCola.toLocaleString("es-PE")} />
                <Stat k="Pendientes" v={clicked.pendientes.toLocaleString("es-PE")} />
                <Stat k="Señales" v={clicked.senales.toLocaleString("es-PE")} />
                <Stat k="Costo auditarla" v={formatPEN(costoAuditar)} />
              </dl>
              <Link
                href={`/app/mapa?region=${UBIGEO_REGION[clicked.ubigeo] ?? ""}`}
                className="mt-2.5 flex items-center justify-center gap-1 rounded-lg bg-heroGreen/10 py-1.5 text-[11px] font-semibold text-heroGreen transition-colors hover:bg-heroGreen/20"
              >
                Ver contratos <ArrowUpRight size={12} />
              </Link>
            </>
          ) : (
            <p className="mt-1.5 text-[12px] text-mute">Todavía no ingresamos contratos de esta zona.</p>
          )}
        </div>
      )}

      {/* Tarjeta flotante: un contrato ya procesado, real */}
      {featured && (
        <div className="animate-slideUp absolute right-1 top-1 z-10 hidden w-[220px] rounded-2xl border border-line bg-paper/95 p-3 shadow-lg backdrop-blur md:block">
          <span className="inline-flex items-center gap-1 rounded-full bg-rust/10 px-2 py-0.5 text-[10px] font-bold text-rust">
            <AlertTriangle size={10} /> score {featured.score}
          </span>
          <p className="mt-1.5 line-clamp-2 text-[12px] font-semibold leading-snug text-ink">{featured.entidad}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-mute">{featured.objeto}</p>
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
            <span className="font-mono text-[11px] text-ink">{formatPEN(featured.montoSoles)}</span>
            <Link
              href={`/app/convocatoria/${encodeURIComponent(featured.codigoconvocatoria)}`}
              className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-heroGreen hover:underline"
            >
              Ver detalles <ArrowUpRight size={11} />
            </Link>
          </div>
        </div>
      )}

      <LlamaHero width={168} className="pointer-events-none absolute -bottom-4 -right-4 hidden drop-shadow-xl sm:block" />

      {top.length > 0 && (
        <ul className="mt-3 grid grid-cols-5 gap-2 text-center">
          {top.map((z) => (
            <li key={z.ubigeo}>
              <button
                onClick={() => setClickedCode(z.ubigeo)}
                className={`block w-full rounded-xl border px-2 py-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-card ${
                  clickedCode === z.ubigeo ? "border-heroViolet bg-heroViolet/5" : "border-line bg-paper hover:bg-paperDeep"
                }`}
              >
                <div className="truncate text-[11px] font-semibold text-ink">{z.nombre}</div>
                <div className="font-mono text-[11px] text-mute">{z.totalCola.toLocaleString("es-PE")}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[9px] uppercase tracking-wide text-mute">{k}</dt>
      <dd className="font-mono font-semibold text-ink">{v}</dd>
    </div>
  );
}
