"use client";

import { Severidad } from "@/components/ui/Severidad";
import { redactDnis } from "../../../Redact";
import { Evidencia } from "../Evidencia";
import { RANGO_SEV, sevDe } from "./proveedor";

/**
 * Las señales que dejó el agente sobre la red (o sobre lo que encontró en la web), cada una con su gravedad, qué dice y
 * su evidencia: la más grave primero. Antes eran cajas amarillas de texto («Señales sugeridas para investigar»), todas
 * del mismo color sin importar su gravedad.
 */
export function SenalesRed({ banderas, etiqueta }: { banderas: any[]; etiqueta: string }) {
  const lista = [...banderas].filter((b) => b?.titulo || b?.descripcion).sort((a, b) => RANGO_SEV[sevDe(a?.severidad)] - RANGO_SEV[sevDe(b?.severidad)]);
  if (!lista.length) return null;
  return (
    <ul aria-label={etiqueta} className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
      {lista.map((b, i) => (
        <li key={i} className="space-y-1 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Severidad bandera={sevDe(b?.severidad)} />
            {b?.titulo && <strong className="text-dato leading-snug text-ink">{redactDnis(String(b.titulo).trim().replace(/\.$/, ""))}</strong>}
          </div>
          {b?.descripcion && <p className="text-meta leading-relaxed text-inkSoft text-pretty">{redactDnis(b.descripcion)}</p>}
          {b?.evidencia && <Evidencia value={b.evidencia} className="text-rotulo leading-relaxed text-mute" />}
        </li>
      ))}
    </ul>
  );
}
