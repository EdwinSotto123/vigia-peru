"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Search, Loader2, X } from "lucide-react";
import { etiquetaTipoEntidad } from "@/lib/entidad-tipo";
import {
  entidadesQueryString,
  type ApiEntidad,
  type EntidadesPagina,
  type EntidadesQuery,
  type EntidadesResumen,
} from "@/lib/api-client";
import { numero, plural, soles, solesCompacto } from "@/lib/formato";
import { Cifra, EstadoVacio } from "@/components/patrones";
import { Paginacion } from "@/components/ui/Paginacion";
import { cn } from "@/lib/utils";

type SortKey = "alertas" | "monto" | "score";

interface Props {
  /** Filtros activos, leídos de la URL por el server component (page.tsx). */
  query: EntidadesQuery;
  /** Página ya traída server-side. */
  initial: EntidadesPagina | null;
  /** KPIs globales (no respetan `query`): universo completo de entidades vigiladas. */
  resumen: EntidadesResumen | null;
}

/**
 * Ranking de entidades. La búsqueda viaja en la URL (`?q=&page=`) y el server
 * component vuelve a pedir la página exacta al API. El orden (`sort`) sólo
 * reordena las filas de la página actual.
 *
 * QUÉ CUENTA: `alertas` (API) = contratos de la entidad con dictamen PUBLICADO,
 * con o sin señales (un dictamen de score 0 también suma), y `monto` = lo
 * adjudicado en esos contratos. Por eso las columnas dicen "con dictamen
 * publicado" y nunca "con señales" (DESIGN_SYSTEM.md §10.1).
 *
 * El número de puesto (#N) es el del ranking por contratos con dictamen, que es
 * como ordena el backend: se calcula sobre toda la lista ((página-1)×tamaño+i+1),
 * no sobre la página (antes cada página volvía a empezar en #1).
 *
 * Volumen = tabla (§5): una fila por entidad, columnas alineadas para comparar.
 * No hay filtro por tipo: el backend tiene el tipo en nulo para casi todas las
 * entidades, y filtrar por "Gobierno regional" escondía a la mayoría de ellos.
 * El tipo se muestra igual, inferido del nombre oficial (lib/entidad-tipo.ts).
 */
export function EntidadesPanel({ query, initial, resumen }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, start] = useTransition();
  const [q, setQ] = useState(query.q ?? "");
  const [sort, setSort] = useState<SortKey>("alertas");
  const timer = useRef<number | null>(null);

  useEffect(() => {
    setQ(query.q ?? "");
  }, [query.q]);

  const navegar = (patch: Partial<EntidadesQuery>) => {
    const qs = entidadesQueryString({ ...query, ...patch, page: 1 });
    start(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  };

  const onQ = (v: string) => {
    setQ(v);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => navegar({ q: v.trim() || undefined }), 350);
  };

  /** Borrar la búsqueda cancela el debounce pendiente: si no, vuelve a escribir el texto viejo en la URL. */
  const limpiarQ = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setQ("");
    navegar({ q: undefined });
  };

  const total = initial?.total ?? 0;
  const tam = initial?.size ?? 20;
  const actual = initial?.page ?? query.page ?? 1;
  const paginas = Math.max(1, Math.ceil(total / tam));

  // Puesto en el ranking: por contratos con dictamen (el orden del backend, con
  // el orden del servidor como desempate), contando las páginas anteriores.
  const conPuesto = useMemo(() => {
    const filas = initial?.data ?? [];
    const base = filas.map((e, i) => ({ e, i })).sort((a, b) => b.e.alertas - a.e.alertas || a.i - b.i);
    return base.map(({ e }, k) => ({ e, puesto: (actual - 1) * tam + k + 1 }));
  }, [initial, actual, tam]);

  const sorted = useMemo(() => {
    return [...conPuesto].sort((a, b) => {
      if (sort === "alertas") return a.puesto - b.puesto;
      if (sort === "monto") return b.e.monto - a.e.monto;
      return b.e.scorePromedio - a.e.scorePromedio;
    });
  }, [conPuesto, sort]);

  const hrefPagina = (n: number) => {
    const qs = entidadesQueryString({ ...query, page: n });
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const qRuc = /^\d{11}$/.test((query.q ?? "").trim()) ? (query.q ?? "").trim() : null;

  return (
    <div className="space-y-5">
      {/* Resumen: cada cifra con su denominador o su contexto. Sin resumen, "Sin dato", nunca un cero. */}
      <section aria-label="Resumen de entidades" className="grid gap-5 rounded-2xl border border-line bg-paper p-5 sm:grid-cols-3">
        <Cifra
          valor={resumen ? numero(resumen.totalEntidades) : "Sin dato"}
          etiqueta="Entidades en la base"
          contexto="Compradoras del Estado que Vigía tiene registradas"
        />
        <Cifra
          valor={resumen ? numero(resumen.conAlertas) : "Sin dato"}
          etiqueta="Con dictamen publicado"
          contexto={
            resumen
              ? `de ${numero(resumen.totalEntidades)} tienen al menos un contrato leído y publicado, con o sin señales`
              : "Entidades con al menos un contrato leído y publicado"
          }
        />
        <Cifra
          valor={resumen ? solesCompacto(resumen.monto) : "Sin dato"}
          etiqueta="Adjudicado en esos contratos"
          contexto="Suma de lo adjudicado en los contratos con dictamen publicado"
        />
      </section>

      {/* Búsqueda y orden */}
      <div className="space-y-3">
        <div className="relative">
          <label htmlFor="buscar-entidad" className="sr-only">
            Buscar una entidad por su nombre
          </label>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
          <input
            id="buscar-entidad"
            type="search"
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="Buscar por nombre de la entidad…"
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-line bg-paper pl-9 pr-16 text-sm text-ink placeholder:text-mute hover:border-paperEdge focus:border-granate focus:outline-none"
          />
          <span className="absolute right-3 top-1/2 inline-flex -translate-y-1/2 items-center gap-1.5">
            {pendiente && <Loader2 size={14} className="animate-spin text-mute" aria-label="Buscando…" />}
            {q && (
              <button
                type="button"
                onClick={limpiarQ}
                aria-label="Borrar la búsqueda"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full text-mute transition-colors duration-150 hover:bg-paperDeep hover:text-ink"
              >
                <X size={13} aria-hidden />
              </button>
            )}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Ordenar esta página">
            <span className="text-[12px] text-mute">Ordenar esta página por</span>
            {(
              [
                { id: "alertas", label: "Contratos con dictamen" },
                { id: "monto", label: "Monto adjudicado" },
                { id: "score", label: "Puntaje promedio" },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={sort === s.id}
                onClick={() => setSort(s.id)}
                className={cn(
                  "inline-flex min-h-[28px] items-center rounded-full border px-3 py-1 text-[12px] font-medium transition-colors duration-150",
                  sort === s.id
                    ? "border-granate/40 bg-granate-soft text-granate"
                    : "border-line bg-paper text-inkSoft hover:border-granate/30 hover:text-ink",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          {/* El único anuncio de la lista: cuántas entidades cumplen la búsqueda. */}
          <p className="text-[12px] text-mute sm:ml-auto" aria-live="polite">
            {plural(total, "entidad", "entidades")}
            {query.q ? ` con «${query.q}»` : ""}
          </p>
        </div>

        <p className="max-w-[68ch] text-[12px] leading-relaxed text-mute text-pretty">
          <strong className="font-semibold text-inkSoft">Puntaje promedio:</strong> el promedio, de 0 a 100, del puntaje
          de sus contratos con dictamen publicado; un contrato sin señales puntúa 0. No es una probabilidad de delito: la
          ficha de cada entidad muestra las señales que lo explican.
        </p>
      </div>

      {sorted.length === 0 ? (
        <EstadoVacio
          compacto
          titulo={query.q ? `Ninguna entidad coincide con «${query.q}»` : "No hay entidades para mostrar"}
          accion={
            <span className="flex flex-wrap items-center justify-center gap-2">
              {qRuc && (
                <Link
                  href={`/entidad/${qRuc}`}
                  className="inline-flex min-h-[32px] items-center rounded-full bg-granate px-4 py-1.5 text-xs font-semibold text-paper transition-colors duration-150 hover:bg-granate-deep"
                >
                  Abrir la ficha del RUC {qRuc}
                </Link>
              )}
              {query.q && (
                <button
                  type="button"
                  onClick={limpiarQ}
                  className="inline-flex min-h-[32px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-xs font-semibold text-ink transition-colors duration-150 hover:bg-paperDeep"
                >
                  Borrar la búsqueda
                </button>
              )}
            </span>
          }
        >
          Prueba con otra palabra del nombre oficial, o pega el RUC de 11 dígitos.
        </EstadoVacio>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-paper">
          <table className="w-full table-fixed border-collapse text-left text-[13px]">
            <caption className="sr-only">
              Entidades ordenadas por contratos con dictamen publicado. Página {numero(actual)} de {numero(paginas)}.
            </caption>
            <thead className="border-b border-line bg-paperSoft text-[12px] text-mute">
              <tr>
                <th scope="col" className="w-12 px-3 py-2.5 font-semibold sm:w-14 sm:px-4">
                  Puesto
                </th>
                <th scope="col" className="px-3 py-2.5 font-semibold">
                  Entidad
                </th>
                <th
                  scope="col"
                  aria-sort={sort === "alertas" ? "descending" : undefined}
                  className="w-[5.5rem] px-3 py-2.5 text-right font-semibold sm:w-36"
                >
                  <span className="sm:hidden">Con dictamen</span>
                  <span className="hidden sm:inline">Con dictamen publicado</span>
                </th>
                <th
                  scope="col"
                  aria-sort={sort === "monto" ? "descending" : undefined}
                  className="hidden w-36 px-3 py-2.5 text-right font-semibold md:table-cell"
                >
                  Adjudicado
                </th>
                <th
                  scope="col"
                  aria-sort={sort === "score" ? "descending" : undefined}
                  className="hidden w-28 px-3 py-2.5 text-right font-semibold sm:table-cell sm:pr-4"
                >
                  Puntaje prom.
                </th>
              </tr>
            </thead>
            <tbody className={cn(pendiente && "opacity-60")} aria-busy={pendiente}>
              {sorted.map(({ e, puesto }) => (
                <FilaEntidad key={e.ruc} ent={e} puesto={puesto} orden={sort} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Paginacion
        actual={actual}
        paginas={paginas}
        total={total}
        tam={tam}
        navegacion="url"
        href={hrefPagina}
        onChange={() => {}}
        cargando={pendiente}
        nombre="entidades"
      />
    </div>
  );
}

function FilaEntidad({ ent, puesto, orden }: { ent: ApiEntidad; puesto: number; orden: SortKey }) {
  // Un chip neutro para todos los tipos: el tipo de entidad no es un nivel de
  // riesgo. Se infiere del nombre oficial cuando el backend no lo declara, y si
  // no se puede, dice "Sin clasificar".
  const tipoLabel = etiquetaTipoEntidad(ent.tipo, ent.nombre, "corto");
  // Las entidades sembradas para la demo traen `metadata` inventada, y el backend
  // cae a `metadata.contratos` cuando no hay convocatorias reales: en esas filas
  // (se reconocen porque traen `reportes`/`serie` de la misma metadata) el total
  // de contratos no es confiable y no se muestra.
  const contratosConfiables = ent.reportes == null && ent.serie == null;
  const leida = ent.alertas > 0;
  const resaltar = (k: SortKey) => (orden === k ? "font-semibold text-ink" : "text-inkSoft");

  return (
    <tr className="border-b border-line align-top transition-colors duration-150 last:border-b-0 hover:bg-paperSoft">
      <td className="px-3 py-3 font-mono text-[12px] tabular-nums text-mute sm:px-4">{numero(puesto)}</td>
      <td className="min-w-0 px-3 py-3">
        <Link
          href={`/entidad/${ent.ruc}`}
          className="line-clamp-2 font-semibold leading-snug text-ink underline-offset-2 hover:text-granate hover:underline"
        >
          {ent.nombre}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-mute">
          <span className="rounded-full bg-paperDeep px-2 py-0.5 text-[11px] font-medium text-inkSoft">{tipoLabel}</span>
          {ent.region && <span>{ent.region}</span>}
          <span className="font-mono" translate="no">
            RUC {ent.ruc}
          </span>
        </div>
      </td>
      <td className={cn("px-3 py-3 text-right font-mono tabular-nums", resaltar("alertas"))}>
        {numero(ent.alertas)}
        {contratosConfiables && ent.contratos != null && (
          <span className="mt-0.5 block font-sans text-[11px] font-normal text-mute">
            de {plural(ent.contratos, "registrado", "registrados")}
          </span>
        )}
      </td>
      <td className={cn("hidden px-3 py-3 text-right font-mono tabular-nums md:table-cell", resaltar("monto"))}>
        {leida ? soles(ent.monto) : <span className="font-sans text-[12px] text-mute">Sin dato</span>}
      </td>
      <td className={cn("hidden px-3 py-3 text-right font-mono tabular-nums sm:table-cell sm:pr-4", resaltar("score"))}>
        {leida ? (
          <>
            {numero(ent.scorePromedio)}
            <span className="font-sans text-[11px] font-normal text-mute"> de 100</span>
          </>
        ) : (
          <span className="font-sans text-[12px] text-mute">Sin dato</span>
        )}
      </td>
    </tr>
  );
}
