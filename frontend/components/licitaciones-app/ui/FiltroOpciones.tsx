"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { normalizar } from "@/lib/licitaciones-app/filtros";
import { numero } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Desplegable } from "./Desplegable";

interface OpcionFiltro {
  valor: string;
  etiqueta: string;
  /** Cuántas hay con esta opción (con los demás filtros puestos). */
  n?: number;
}

/**
 * Un filtro de opciones en su desplegable: varias (casillas) o una (radios, con «Todas»), cada una con cuántas hay, y un
 * buscador cuando son muchas (las 25 regiones). Las que tienen resultados van primero. Cada cambio se aplica al toque.
 */
export function FiltroOpciones({
  etiqueta, opciones, elegidas, cambiar, multiple = true, buscador = false, todas = "Todas", ancho = "sm:w-80",
}: {
  etiqueta: string;
  opciones: OpcionFiltro[];
  elegidas: string[];
  cambiar: (valores: string[]) => void;
  multiple?: boolean;
  buscador?: boolean;
  todas?: string;
  ancho?: string;
}) {
  const [q, setQ] = useState("");
  const lista = useMemo(
    () =>
      opciones
        .filter((o) => !q || normalizar(o.etiqueta).includes(normalizar(q)))
        .sort((a, b) => (b.n ?? 0) - (a.n ?? 0) || a.etiqueta.localeCompare(b.etiqueta, "es")),
    [opciones, q],
  );
  return (
    <Desplegable etiqueta={etiqueta} cuenta={multiple ? elegidas.length : 0} activo={!multiple && elegidas.length > 0} ancho={ancho}>
      {(cerrar) => (
        <fieldset>
          <legend className="sr-only">{etiqueta}</legend>
          {buscador && (
            <label className="relative mb-2 block">
              <span className="sr-only">Buscar en {etiqueta.toLowerCase()}</span>
              <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Buscar ${etiqueta.toLowerCase()}`}
                className="h-10 w-full rounded-lg border border-line bg-caja pl-9 pr-3 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato"
              />
            </label>
          )}
          {!multiple && (
            <Linea tipo="radio" nombre={etiqueta} marcada={elegidas.length === 0} onChange={() => { cambiar([]); cerrar(); }}>
              {todas}
            </Linea>
          )}
          {lista.length === 0 && <p className="px-2 py-3 text-meta text-mute">Nada se llama así.</p>}
          {lista.map((o) => {
            const si = elegidas.includes(o.valor);
            return (
              <Linea
                key={o.valor}
                tipo={multiple ? "checkbox" : "radio"}
                nombre={etiqueta}
                marcada={si}
                n={o.n}
                onChange={() => {
                  if (multiple) cambiar(si ? elegidas.filter((x) => x !== o.valor) : [...elegidas, o.valor]);
                  else {
                    cambiar([o.valor]);
                    cerrar();
                  }
                }}
              >
                {o.etiqueta}
              </Linea>
            );
          })}
        </fieldset>
      )}
    </Desplegable>
  );
}

function Linea({ tipo, nombre, marcada, onChange, n, children }: { tipo: "checkbox" | "radio"; nombre: string; marcada: boolean; onChange: () => void; n?: number; children: React.ReactNode }) {
  return (
    <label className={cn("flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 text-dato hover:bg-ink/[0.045]", marcada ? "font-semibold text-ink" : "text-inkSoft")}>
      <input type={tipo} name={nombre} checked={marcada} onChange={onChange} className="h-4 w-4 shrink-0 accent-[rgb(var(--granate))]" />
      <span className="min-w-0 flex-1">{children}</span>
      {n != null && <span className={cn("shrink-0 text-meta tabular-nums", n === 0 ? "text-mute/70" : "text-mute")}>{numero(n)}</span>}
    </label>
  );
}
