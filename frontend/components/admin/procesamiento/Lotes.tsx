"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Partes } from "@/components/ui/Partes";
import { PageSection, claseBoton } from "@/components/admin/ui";
import { type ProcAdmin, type Conteo, conteoVacio, ESTADO_UI, ORDEN_BARRA, TOPE_LISTA } from "./tipos";
// ── Los lotes ─────────────────────────────────────────────────────────────

export interface Lote {
  codigo: string;
  financiador: string | null;
  zonas: string[];
  total: number;
  c: Conteo;
  ultimo: number;
}

export function agruparLotes(rows: ProcAdmin[]): Lote[] {
  const m = new Map<string, Lote>();
  for (const r of rows) {
    const k = r.contribucionCodigo;
    if (!k) continue;
    const l = m.get(k) ?? { codigo: k, financiador: r.financiador, zonas: [], total: 0, c: conteoVacio(), ultimo: 0 };
    l.total += 1;
    l.c[r.estado] += 1;
    if (r.zona && !l.zonas.includes(r.zona)) l.zonas.push(r.zona);
    const t = new Date(r.latidoAt ?? r.finalizadoAt ?? r.encoladoAt ?? 0).getTime();
    if (t > l.ultimo) l.ultimo = t;
    m.set(k, l);
  }
  // Primero los que todavía tienen trabajo; dentro de cada grupo, el de movimiento más reciente
  // (antes se ordenaba por código y `ultimo` se calculaba sin usarse).
  const activo = (l: Lote) => l.c.encolado + l.c.procesando + l.c.esperando_documentos > 0;
  return [...m.values()].sort((a, b) => Number(activo(b)) - Number(activo(a)) || b.ultimo - a.ultimo || b.codigo.localeCompare(a.codigo));
}

export function Lotes({
  lotes,
  activo,
  onElegir,
  incompletos = false,
}: {
  lotes: Lote[];
  activo: string | null;
  onElegir: (codigo: string) => void;
  /** La lista de la que salen vino con tope: un lote puede tener más contratos de los que se cuentan acá. */
  incompletos?: boolean;
}) {
  const [todos, setTodos] = useState(false);
  const mostrados = todos ? lotes : lotes.slice(0, 3);
  return (
    <PageSection
      titulo="Lotes"
      meta={`${lotes.length} ${lotes.length === 1 ? "lote" : "lotes"}${incompletos ? " en la lista" : ""}`}
      acciones={
        lotes.length > 3 && (
          <button onClick={() => setTodos((v) => !v)} aria-expanded={todos} className={claseBoton("fantasma")}>
            {todos ? "Ver menos" : `Ver los ${lotes.length}`}
          </button>
        )
      }
      className="mt-6"
    >
      {incompletos && (
        <p className="mb-2 text-[12px] text-inkSoft">
          Se cuentan sólo los contratos de la lista de abajo, que trae los {TOPE_LISTA} con movimiento más reciente: a un lote grande o antiguo
          le pueden faltar contratos aquí.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {mostrados.map((l) => {
          const sel = activo === l.codigo;
          return (
            <button
              key={l.codigo}
              onClick={() => onElegir(l.codigo)}
              aria-pressed={sel}
              className={cn(
                "rounded-2xl border bg-paper p-4 text-left transition-[border-color,box-shadow] duration-rapido hover:border-ink/25",
                sel ? "border-granate shadow-[0_0_0_3px_rgba(113,28,48,0.12)]" : "border-line",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-ink">{l.codigo}</span>
                <span className="text-[12px] text-mute">
                  <span className="font-mono text-ink">{l.c.procesado}</span> de {l.total} leídos{incompletos ? " en la lista" : ""}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[12px] text-mute"><Partes partes={[l.financiador, l.zonas.slice(0, 2).join(", ")]} /></p>
              <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-paperDeep" aria-hidden>
                {ORDEN_BARRA.map((e) => (l.c[e] > 0 ? <span key={e} className={ESTADO_UI[e].barra} style={{ width: `${(l.c[e] / l.total) * 100}%` }} /> : null))}
              </div>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-inkSoft">
                {ORDEN_BARRA.filter((e) => e !== "procesado" && l.c[e] > 0).map((e) => (
                  <span key={e} className="inline-flex items-center gap-1">
                    <span className={cn("h-1.5 w-1.5 rounded-full", ESTADO_UI[e].punto)} aria-hidden />
                    {l.c[e]} {ESTADO_UI[e].corto}
                  </span>
                ))}
                {l.c.procesado === l.total && <span className="text-mossTexto">{incompletos ? "todo lo de la lista, leído" : "todo leído"}</span>}
              </p>
            </button>
          );
        })}
      </div>
    </PageSection>
  );
}
