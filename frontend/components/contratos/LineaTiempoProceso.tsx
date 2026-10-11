import { dia } from "./EvidenciaContrato";
import { fechaCorta } from "@/lib/formato";
import type { ContratoDetalle } from "@/lib/contratos";

/**
 * Los hitos del proceso con fecha, en orden: convocatoria, buena pro, adjudicaciones del registro y,
 * si Vigía lo leyó, cuándo. Solo lo que el registro trae (nada se calcula ni se estima); con menos de
 * dos hitos no se dibuja. Server-safe.
 */
interface Hito {
  fecha: string;
  texto: string;
  detalle?: string;
}

export function LineaTiempoProceso({ c }: { c: ContratoDetalle }) {
  const hitos: Hito[] = [];
  const agregar = (valor: string | null | undefined, texto: string) => {
    const d = valor ? dia(valor) : null;
    if (d) hitos.push({ fecha: d, texto });
  };
  agregar(c.fecha, "Convocatoria");
  agregar(c.fechaBuenaPro, "Buena pro");
  for (const a of c.adjudicaciones ?? []) agregar(a.fecha, "Adjudicación");
  if (c.alerta && c.alerta.estado !== "revision") agregar(c.alerta.analizadoEn, "Leído por Vigía");
  const vistos = new Set<string>();
  const unicos = hitos
    .filter((h) => {
      const k = `${h.fecha}|${h.texto}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (unicos.length < 2) return null;
  return (
    <section aria-labelledby="linea-tiempo" className="space-y-1.5">
      <h2 id="linea-tiempo" className="text-[13px] font-semibold text-ink">
        Línea de tiempo
      </h2>
      <ol className="space-y-1 border-l-2 border-line pl-3">
        {unicos.map((h, i) => (
          <li key={`${h.texto}-${i}`} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="text-inkSoft">{h.texto}</span>
            <span className="font-mono tabular-nums text-ink">{fechaCorta(h.fecha)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
