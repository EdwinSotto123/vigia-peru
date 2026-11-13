"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { REGIONES_UBIGEO, nombreRegion, nombreTipo } from "@/lib/licitaciones";
import { TIPOS_PROCESO, type TipoProceso } from "@/lib/licitaciones-app/filtros";
import { CUANDO, ORDENES_MENORES, activosMenores, type FiltrosMenores } from "@/lib/licitaciones-app/filtrosMenores";
import type { Conteo } from "@/lib/licitaciones-app/tipos";
import { useListaMenores } from "@/lib/licitaciones-app/useListaUrl";
import { cn } from "@/lib/utils";
import { BuscadorTexto } from "@/components/gobserva/ui/BuscadorTexto";
import { FiltroOpciones } from "@/components/gobserva/ui/FiltroOpciones";

/** La barra de los contratos menores: buscar, tipo, región y cuándo cierran, con lo puesto en chips. */
export function BarraMenores({ porTipo, porRegion }: { porTipo: Conteo[]; porRegion: Conteo[] }) {
  const { filtros: f, ir, limpiar, pendiente } = useListaMenores();
  const n = (xs: Conteo[], k: string) => xs.find((x) => x.clave === k)?.n ?? 0;
  const chips: { clave: string; texto: string; quitar: Partial<FiltrosMenores> }[] = [
    ...(f.q ? [{ clave: "q", texto: `«${f.q}»`, quitar: { q: "" } }] : []),
    ...f.tipo.map((t) => ({ clave: `t${t}`, texto: nombreTipo(t), quitar: { tipo: f.tipo.filter((x) => x !== t) } })),
    ...f.region.map((r) => ({ clave: `r${r}`, texto: nombreRegion(r), quitar: { region: f.region.filter((x) => x !== r) } })),
    ...(f.cuando ? [{ clave: "c", texto: CUANDO.find((c) => c.clave === f.cuando)?.etiqueta ?? "", quitar: { cuando: null } }] : []),
  ];
  return (
    <div className="space-y-3 p-4 sm:p-5">
      <BuscadorTexto id="menores-q" q={f.q} buscar={(q) => ir({ q })} pendiente={pendiente} etiqueta="Buscar contratos menores" placeholder="Busca lo que vendes, la entidad o el código" />
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden [&>*]:shrink-0">
        <FiltroOpciones
          etiqueta="Tipo"
          opciones={TIPOS_PROCESO.map((t) => ({ valor: t, etiqueta: nombreTipo(t), n: n(porTipo, t) }))}
          elegidas={f.tipo}
          cambiar={(v) => ir({ tipo: v as TipoProceso[] })}
        />
        <FiltroOpciones
          etiqueta="Región"
          buscador
          opciones={REGIONES_UBIGEO.map((r) => ({ valor: r.ubigeo, etiqueta: r.nombre, n: n(porRegion, r.ubigeo) }))}
          elegidas={f.region}
          cambiar={(v) => ir({ region: v })}
        />
        <FiltroOpciones
          etiqueta="Cuándo"
          multiple={false}
          todas="Todos los abiertos"
          opciones={CUANDO.map((c) => ({ valor: c.clave, etiqueta: c.etiqueta }))}
          elegidas={f.cuando ? [f.cuando] : []}
          cambiar={(v) => ir({ cuando: (v[0] as FiltrosMenores["cuando"]) ?? null })}
        />
        {activosMenores(f) > 0 && (
          <button type="button" onClick={limpiar} className="inline-flex min-h-10 items-center rounded-lg px-2 text-dato font-semibold text-granate underline-offset-4 hover:underline">
            Limpiar filtros
          </button>
        )}
      </div>
      {chips.length > 0 && (
        <div role="group" aria-label="Filtros puestos" className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.clave}
              type="button"
              onClick={() => ir(c.quitar)}
              aria-label={`Quitar el filtro ${c.texto}`}
              className="inline-flex min-h-8 max-w-full items-center gap-1 rounded-full border border-line bg-ink/[0.04] pl-3 pr-1.5 text-meta font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
            >
              <span className="min-w-0 truncate">{c.texto}</span>
              <X size={14} aria-hidden className="shrink-0 text-inkSoft" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** El orden y cuántos por página de los contratos menores. */
export function HerramientasMenores() {
  const { filtros, ir } = useListaMenores();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Selector etiqueta="Ordenar" valor={filtros.orden} onChange={(v) => ir({ orden: v as FiltrosMenores["orden"] })}>
        {ORDENES_MENORES.map((o) => (
          <option key={o.clave} value={o.clave}>
            {o.etiqueta}
          </option>
        ))}
      </Selector>
      <Selector etiqueta="Por página" valor={String(filtros.tam)} onChange={(v) => ir({ tam: Number(v) as FiltrosMenores["tam"] })} className="w-20">
        {[10, 20, 50].map((t) => (
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

/** Los resultados mientras llega la página nueva: atenuados y con aria-busy. */
export function ResultadosMenores({ children }: { children: ReactNode }) {
  const { pendiente } = useListaMenores();
  return (
    <div aria-busy={pendiente} className={cn("min-w-0 transition-opacity duration-normal", pendiente && "pointer-events-none opacity-55")}>
      {children}
    </div>
  );
}
