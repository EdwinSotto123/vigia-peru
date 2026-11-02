"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";
import { coincide, decimal, numero, paraBuscar, solesCompacto } from "@/lib/formato";
import { cn } from "@/lib/utils";

/** Un ítem ya listo para mostrar (lo limpia el servidor: el texto del SEACE llega en mayúsculas y con comillas rotas). */
export interface ItemLimpio {
  posicion: number;
  descripcion: string;
  cantidad: number | null;
  /** En minúsculas: «unidad», «galón». */
  unidad: string | null;
  cubso: string | null;
  /** El nombre del CUBSO, o null si repite la descripción. */
  cubsoNombre: string | null;
  valor: number | null;
}

const PRIMEROS = 12;

/**
 * Los ítems de una convocatoria (2026-11-02), en orden: qué es cada uno (con su CUBSO), la cantidad y el valor del ítem
 * cuando la entidad lo publicó. Todos, nunca recortados en silencio: con más de 12 se ven los primeros, un botón muestra
 * los que faltan y un buscador filtra por descripción o código (las compras de medicamentos traen cientos).
 */
export function ListaItems({ items }: { items: ItemLimpio[] }) {
  const [q, setQ] = useState("");
  const [todos, setTodos] = useState(false);
  const indice = useMemo(() => items.map((i) => paraBuscar(`${i.descripcion} ${i.cubso ?? ""} ${i.cubsoNombre ?? ""}`)), [items]);
  const consulta = paraBuscar(q);
  const filtrados = consulta ? items.filter((_, n) => coincide(indice[n], consulta)) : items;
  const faltan = Math.max(0, filtrados.length - PRIMEROS);
  const visibles = todos || consulta ? filtrados : filtrados.slice(0, PRIMEROS);
  const conValor = items.some((i) => i.valor != null);
  const columnas = conValor ? "md:grid-cols-[2.25rem_minmax(0,1fr)_8.5rem_7rem]" : "md:grid-cols-[2.25rem_minmax(0,1fr)_8.5rem]";

  return (
    <div className="mt-3">
      {items.length > PRIMEROS && (
        <label className="relative mb-3 block max-w-md">
          <span className="sr-only">Buscar entre los {numero(items.length)} ítems</span>
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Buscar entre los ${numero(items.length)} ítems`}
            className="h-11 w-full rounded-xl border border-line bg-paper pl-9 pr-3 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato"
          />
        </label>
      )}
      {visibles.length === 0 ? (
        <p role="status" className="rounded-xl border border-line bg-paperSoft px-4 py-3 text-dato text-inkSoft">
          Ningún ítem con «{q.trim()}». Prueba con otra palabra o con el código CUBSO.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-paper">
          <div aria-hidden className={cn("hidden gap-x-4 border-b border-line bg-paperSoft px-4 py-2 text-rotulo font-semibold text-mute md:grid", columnas)}>
            <span>N.º</span>
            <span>Qué se compra</span>
            <span className="text-right">Cantidad</span>
            {conValor && <span className="text-right">Valor del ítem</span>}
          </div>
          <ol className="divide-y divide-line" aria-label="Ítems de la convocatoria">
            {visibles.map((i) => (
              <li key={i.posicion} className={cn("grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4 gap-y-2 px-4 py-3 md:items-start", columnas)}>
                <span className="pt-px font-mono text-meta font-semibold tabular-nums text-mute">{numero(i.posicion)}</span>
                <div className="min-w-0">
                  <p className="text-dato font-medium leading-snug text-ink">{i.descripcion}</p>
                  {i.cubso && (
                    <p className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-meta leading-snug text-inkSoft">
                      <span className="rounded bg-paperDeep px-1.5 py-px font-mono text-rotulo text-inkSoft">CUBSO {i.cubso}</span>
                      {i.cubsoNombre && <span className="min-w-0">{i.cubsoNombre}</span>}
                    </p>
                  )}
                </div>
                <dl className="col-start-2 flex flex-wrap gap-x-5 gap-y-1 text-meta md:contents">
                  <div className="flex items-baseline gap-1.5 md:block md:text-right">
                    <dt className="text-mute md:sr-only">Cantidad</dt>
                    <dd className="tabular-nums text-ink">
                      <span className="font-semibold">{i.cantidad == null ? "Sin dato" : Number.isInteger(i.cantidad) ? numero(i.cantidad) : decimal(i.cantidad, 2)}</span>
                      {i.unidad && <span className="ml-1 text-inkSoft">{i.unidad}</span>}
                    </dd>
                  </div>
                  {conValor && (
                    <div className="flex items-baseline gap-1.5 md:block md:text-right">
                      <dt className="text-mute md:sr-only">Valor del ítem</dt>
                      <dd className={cn("tabular-nums", i.valor != null ? "font-semibold text-ink" : "text-mute")}>{i.valor != null ? solesCompacto(i.valor) : "No publicado"}</dd>
                    </div>
                  )}
                </dl>
              </li>
            ))}
          </ol>
        </div>
      )}
      {!consulta && faltan > 0 && (
        <button type="button" onClick={() => setTodos((v) => !v)} aria-expanded={todos} className={cn(CLASE_ACCION_LISTA, "mt-3 min-h-11")}>
          {todos ? "Ver sólo los primeros 12" : `Ver los ${numero(faltan)} ítems que faltan (${numero(items.length)} en total)`}
        </button>
      )}
    </div>
  );
}
