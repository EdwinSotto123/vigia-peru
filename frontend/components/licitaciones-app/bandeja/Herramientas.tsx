"use client";

import type { ReactNode } from "react";
import { ORDENES, TAMANOS, type FiltrosBandeja } from "@/lib/licitaciones-app/filtros";
import { useLista } from "@/lib/licitaciones-app/useListaUrl";
import { cn } from "@/lib/utils";

/** El orden y cuántas por página: dos selects nativos (teclado y lector de pantalla los entienden solos). */
export function Herramientas() {
  const { filtros, ir } = useLista();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Selector etiqueta="Ordenar" valor={filtros.orden} onChange={(v) => ir({ orden: v as FiltrosBandeja["orden"] })}>
        {ORDENES.map((o) => (
          <option key={o.clave} value={o.clave}>
            {o.etiqueta}
          </option>
        ))}
      </Selector>
      <Selector etiqueta="Por página" valor={String(filtros.tam)} onChange={(v) => ir({ tam: Number(v) as FiltrosBandeja["tam"] })} className="w-20">
        {TAMANOS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </Selector>
    </div>
  );
}

function Selector({ etiqueta, valor, onChange, children, className }: { etiqueta: string; valor: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  return (
    <label className="flex items-center gap-2 text-meta text-inkSoft">
      <span className="whitespace-nowrap">{etiqueta}</span>
      <select
        value={valor}
        onChange={(e) => onChange(e.target.value)}
        className={cn("h-9 rounded-lg border border-line bg-caja px-2.5 text-dato font-semibold text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30", className)}
      >
        {children}
      </select>
    </label>
  );
}
