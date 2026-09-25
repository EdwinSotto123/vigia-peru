"use client";

/**
 * Filtros de /app/contratos. Viven en la URL (`?q=&tipo=&etapa=&ubigeo=&riesgo=&orden=…`):
 * cada cambio hace `router.replace` y el server component vuelve a pedir la página 1.
 *
 * Tres niveles, de más a menos frecuente:
 *  1. Búsqueda (siempre visible, su propia fila).
 *  2. Chips rápidos con conteo real (todos · en cola · documentos listos · riesgo alto) — la
 *     pregunta que hace el 90% de las visitas, sin abrir ningún desplegable.
 *  3. "Más filtros" (región, tipo, etapa, peso del riesgo, monto, orden) — plegado salvo que ya
 *     haya algo elegido ahí, para no abrumar con 9 controles de entrada.
 * Cualquier filtro activo aparece además como chip removible individualmente en la fila de abajo.
 *
 * Chip activo = granate (la marca dice "elegido"); la severidad la carga el ícono y la
 * palabra del chip de riesgo, nunca el fondo del chip.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, ChevronDown, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import {
  ETAPAS, OPERATIVOS, ORDENES, RIESGOS, TIPOS, contratosQueryString, etapaLabel, operativoLabel, riesgoLabel, tipoLabel,
  type ContratosQuery, type ResumenContratos,
} from "@/lib/contratos";
import { numero, soles } from "@/lib/formato";
import { ultimosMeses } from "@/components/mapa/FiltroMes";
import { cn } from "@/lib/utils";

interface Props {
  query: ContratosQuery;
  regiones: { ubigeo: string; nombre: string }[];
  /** Nombre de la entidad cuando el filtro `entidad=<ruc>` viene de un enlace. */
  entidadNombre?: string | null;
  resumen?: ResumenContratos | null;
}

/** Conteo de una opción de desplegable: "(1,204)"; sin resumen del API, nada (no un cero inventado). */
const conteo = (n: number | undefined, hay: boolean) => (hay ? ` (${numero(n ?? 0)})` : "");

export function FiltrosContratos({ query, regiones, entidadNombre, resumen }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pendiente, start] = useTransition();
  const [q, setQ] = useState(query.q ?? "");
  const timer = useRef<number | null>(null);

  const meses = useMemo(() => ultimosMeses(12), []);
  // Cuántos filtros están puestos DENTRO del panel plegable (los chips rápidos no
  // cuentan: ésos ya se ven). Se muestra en el botón para que un panel cerrado no
  // esconda el motivo de que la lista esté recortada.
  const nAvanzados = [
    query.ubigeo,
    query.tipo,
    query.etapa,
    query.riesgo && query.riesgo !== "alto" ? query.riesgo : undefined,
    query.monto_min != null ? "min" : undefined,
    query.monto_max != null ? "max" : undefined,
    query.desde,
    query.orden && query.orden !== "fecha" ? query.orden : undefined,
  ].filter(Boolean).length;
  const avanzadosActivos = nAvanzados > 0;
  const [avanzados, setAvanzados] = useState(avanzadosActivos);
  useEffect(() => { if (avanzadosActivos) setAvanzados(true); }, [avanzadosActivos]);

  useEffect(() => { setQ(query.q ?? ""); }, [query.q]);

  const navegar = (patch: Partial<ContratosQuery>) => {
    const qs = contratosQueryString({ ...query, ...patch, page: 1 });
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

  const regionNombre = (u: string) => regiones.find((r) => r.ubigeo === u)?.nombre ?? `Zona ${u}`;
  // Sin `outline-none`: esa utilidad le ganaba al anillo de foco global y el teclado no veía dónde estaba.
  const sel =
    "h-9 rounded-xl border border-line bg-paper px-2.5 text-xs text-ink transition-colors duration-rapido hover:border-paperEdge focus:border-granate disabled:cursor-not-allowed disabled:opacity-50";
  const hayResumen = resumen != null;

  // ── Chips removibles: uno por filtro activo (todas las dimensiones, no solo entidad) ──
  const chips: { key: keyof ContratosQuery; label: string }[] = [];
  if (query.q) chips.push({ key: "q", label: `«${query.q}»` });
  if (query.entidad) chips.push({ key: "entidad", label: `Entidad: ${entidadNombre ?? query.entidad}` });
  if (query.ubigeo) chips.push({ key: "ubigeo", label: regionNombre(query.ubigeo) });
  if (query.tipo) chips.push({ key: "tipo", label: tipoLabel(query.tipo) ?? query.tipo });
  if (query.etapa) chips.push({ key: "etapa", label: etapaLabel(query.etapa) ?? query.etapa });
  if (query.riesgo) chips.push({ key: "riesgo", label: riesgoLabel(query.riesgo) ?? query.riesgo });
  if (query.operativo) chips.push({ key: "operativo", label: operativoLabel(query.operativo) ?? query.operativo });
  if (query.desde) chips.push({ key: "desde", label: meses.find((m) => m.desde === query.desde)?.etiqueta ?? query.desde });
  if (query.monto_min != null) chips.push({ key: "monto_min", label: `Desde ${soles(Number(query.monto_min))}` });
  if (query.monto_max != null) chips.push({ key: "monto_max", label: `Hasta ${soles(Number(query.monto_max))}` });
  if (query.orden && query.orden !== "fecha") chips.push({ key: "orden", label: ORDENES.find((o) => o.value === query.orden)?.label ?? query.orden });

  const limpiarTodo = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setQ("");
    start(() => router.replace(pathname, { scroll: false }));
  };

  return (
    // Pegajosa: no hay que volver a scrollear arriba para cambiar un filtro mientras se
    // revisan los ~50 contratos de la página. Bleed a los bordes con -mx/px (cancela el
    // px-4/sm:px-6/lg:px-10 del page.tsx) para que lea como una franja real.
    <div className="sticky top-0 z-10 -mx-4 space-y-2.5 border-b border-line bg-paper/95 px-4 pb-3 pt-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
      {/* 1. búsqueda */}
      <div className="relative flex items-center">
        <Search size={14} className="pointer-events-none absolute left-3 text-mute" aria-hidden />
        <label className="sr-only" htmlFor="buscar-contratos">Buscar por objeto, código o entidad</label>
        <input
          id="buscar-contratos"
          type="search"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder="Buscar por objeto, código o nombre de entidad…"
          autoComplete="off"
          className="h-10 w-full rounded-xl border border-line bg-paper pl-9 pr-16 text-sm text-ink placeholder:text-mute hover:border-paperEdge focus:border-granate [&::-webkit-search-cancel-button]:hidden"
        />
        <span className="absolute right-2 inline-flex items-center gap-1.5">
          {pendiente && (
            <span role="status" className="inline-flex items-center">
              <Loader2 size={14} className="animate-spin text-mute" aria-hidden />
              <span className="sr-only">Actualizando la lista…</span>
            </span>
          )}
          {q && (
            <button
              type="button"
              onClick={limpiarQ}
              aria-label="Borrar la búsqueda"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink"
            >
              <X size={13} aria-hidden />
            </button>
          )}
        </span>
      </div>

      {/* 2. chips rápidos con conteo real */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtros rápidos">
        <ChipRapido active={!query.operativo && !query.riesgo} onClick={() => navegar({ operativo: undefined, riesgo: undefined })}>
          Todos <Cuenta n={resumen?.total} />
        </ChipRapido>
        <ChipRapido
          active={query.operativo === "en_cola"}
          onClick={() => navegar({ operativo: query.operativo === "en_cola" ? undefined : "en_cola", riesgo: undefined })}
        >
          En cola <Cuenta n={resumen?.porOperativo.en_cola} />
        </ChipRapido>
        <ChipRapido
          active={query.operativo === "documentos_listos"}
          onClick={() => navegar({ operativo: query.operativo === "documentos_listos" ? undefined : "documentos_listos", riesgo: undefined })}
        >
          Documentos listos <Cuenta n={resumen?.porOperativo.documentos_listos} />
        </ChipRapido>
        <ChipRapido
          active={query.riesgo === "alto"}
          onClick={() => navegar({ riesgo: query.riesgo === "alto" ? undefined : "alto", operativo: undefined })}
          icono={<AlertTriangle size={12} aria-hidden className={query.riesgo === "alto" ? "text-paper" : "text-rust"} />}
        >
          Riesgo alto <Cuenta n={resumen?.porRiesgo.alto} />
        </ChipRapido>
        <button
          type="button"
          onClick={() => setAvanzados((v) => !v)}
          className={cn(
            "ml-auto inline-flex min-h-[32px] items-center gap-1 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors duration-rapido",
            avanzados ? "border-granate bg-granate-soft text-granate" : "border-line bg-paper text-inkSoft hover:border-granate/30 hover:text-ink",
          )}
          aria-expanded={avanzados}
          aria-controls="filtros-avanzados"
        >
          <SlidersHorizontal size={12} aria-hidden /> Más filtros
          {/* Cuántos hay puestos ahí dentro: plegado, el panel avanzado escondía
              filtros activos y la lista parecía filtrada sin motivo visible. */}
          {nAvanzados > 0 && (
            <span className="rounded-full bg-granate px-1.5 text-[10px] font-semibold tabular-nums text-paper">
              {nAvanzados}
              <span className="sr-only"> {nAvanzados === 1 ? "filtro activo" : "filtros activos"}</span>
            </span>
          )}
          <ChevronDown size={12} aria-hidden className={cn("transition-transform duration-rapido", avanzados && "rotate-180")} />
        </button>
      </div>

      {/* 3. filtros avanzados — siempre montado para poder animar su alto con CSS puro
          (grid-template-rows 0fr→1fr + overflow-hidden en el div interno). Plegado queda
          `inert`: si no, el Tab recorría nueve controles invisibles antes de llegar a la
          lista. React 18 no tipa `inert`; se pasa como atributo string. */}
      <div
        id="filtros-avanzados"
        className={cn("grid transition-[grid-template-rows] duration-300 ease-out", avanzados ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
        {...({ inert: avanzados ? undefined : "" } as Record<string, string | undefined>)}
        aria-hidden={avanzados ? undefined : true}
      >
        <div className="overflow-hidden">
          <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-paperSoft p-2.5">
            <Campo label="Región">
              <select value={query.ubigeo ?? ""} onChange={(e) => navegar({ ubigeo: e.target.value || undefined })} className={sel}>
                <option value="">Todo el Perú</option>
                {regiones.map((r) => <option key={r.ubigeo} value={r.ubigeo}>{r.nombre}</option>)}
                {query.ubigeo && !regiones.some((r) => r.ubigeo === query.ubigeo) && <option value={query.ubigeo}>Zona {query.ubigeo}</option>}
              </select>
            </Campo>
            <Campo label="Tipo">
              <select value={query.tipo ?? ""} onChange={(e) => navegar({ tipo: (e.target.value || undefined) as ContratosQuery["tipo"] })} className={sel}>
                <option value="">Todo tipo</option>
                {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}{conteo(resumen?.porTipo[t.value], hayResumen)}</option>)}
              </select>
            </Campo>
            <Campo label="Etapa">
              <select value={query.etapa ?? ""} onChange={(e) => navegar({ etapa: (e.target.value || undefined) as ContratosQuery["etapa"] })} className={sel}>
                <option value="">Toda etapa</option>
                {ETAPAS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Campo>
            <Campo label="Peso del riesgo">
              <select value={query.riesgo ?? ""} onChange={(e) => navegar({ riesgo: (e.target.value || undefined) as ContratosQuery["riesgo"] })} className={sel}>
                <option value="">Todos</option>
                {RIESGOS.map((t) => <option key={t.value} value={t.value}>{t.label}{conteo(resumen?.porRiesgo[t.value], hayResumen)}</option>)}
              </select>
            </Campo>
            <Campo label="Cola y documentos">
              <select value={query.operativo ?? ""} onChange={(e) => navegar({ operativo: (e.target.value || undefined) as ContratosQuery["operativo"] })} className={sel}>
                <option value="">Todos</option>
                {OPERATIVOS.map((t) => <option key={t.value} value={t.value}>{t.label}{conteo(resumen?.porOperativo[t.value], hayResumen)}</option>)}
              </select>
            </Campo>
            <Campo label="Mes de convocatoria">
              <select
                value={query.desde ?? ""}
                onChange={(e) => {
                  const r = meses.find((m) => m.desde === e.target.value);
                  navegar({ desde: r?.desde, hasta: r?.hasta });
                }}
                className={sel}
              >
                <option value="">Todo el histórico</option>
                {meses.map((m) => <option key={m.desde} value={m.desde}>{m.etiqueta}</option>)}
              </select>
            </Campo>
            <Campo label="Monto mínimo">
              <Monto value={query.monto_min} onCommit={(v) => navegar({ monto_min: v })} />
            </Campo>
            <Campo label="Monto máximo">
              <Monto value={query.monto_max} onCommit={(v) => navegar({ monto_max: v })} />
            </Campo>
            <Campo label="Orden">
              <select value={query.orden ?? "fecha"} onChange={(e) => navegar({ orden: e.target.value as ContratosQuery["orden"] })} className={sel}>
                {ORDENES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Campo>
          </div>
        </div>
      </div>

      {/* 4. filtros activos, removibles uno por uno. Es el único lugar donde se ve POR
          QUÉ la lista está recortada, y cada uno se quita por separado. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
          <span className="text-mute">Filtrando por</span>
          {chips.map((ch) => (
            <span
              key={ch.key}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-granate/35 bg-granate-soft py-0.5 pl-2.5 pr-0.5 font-medium text-ink"
            >
              <span className="truncate">{ch.label}</span>
              <button
                type="button"
                onClick={() => navegar(ch.key === "desde" ? { desde: undefined, hasta: undefined } : ({ [ch.key]: undefined } as Partial<ContratosQuery>))}
                aria-label={`Quitar filtro ${ch.label}`}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-granate transition-colors duration-rapido hover:bg-granate hover:text-paper"
              >
                <X size={11} aria-hidden />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={limpiarTodo}
            className="min-h-[24px] rounded-full px-2 py-0.5 text-inkSoft underline-offset-2 transition-colors duration-rapido hover:bg-paperDeep hover:text-ink hover:underline"
          >
            Limpiar todo
          </button>
        </div>
      )}
    </div>
  );
}

function ChipRapido({ active, onClick, icono, children }: { active: boolean; onClick: () => void; icono?: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex min-h-[32px] items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors duration-rapido",
        active ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:bg-granate-50 hover:text-ink",
      )}
      aria-pressed={active}
    >
      {icono}
      {children}
    </button>
  );
}

function Cuenta({ n }: { n: number | undefined }) {
  // Sin conteo del API no se escribe nada: un "0" sería un cero inventado.
  if (n == null) return null;
  return <span className="font-semibold tabular-nums">{numero(n)}</span>;
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="inline-flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-mute">{label}</span>
      {children}
    </label>
  );
}

function Monto({ value, onCommit }: { value: number | string | undefined; onCommit: (v: number | undefined) => void }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => { setV(value == null ? "" : String(value)); }, [value]);
  const commit = () => {
    const n = v.trim() === "" ? undefined : Number(v.replace(/[^\d.]/g, ""));
    onCommit(n != null && Number.isFinite(n) ? n : undefined);
  };
  return (
    <input
      inputMode="numeric"
      value={v}
      placeholder="S/"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(); } }}
      className="h-9 w-[112px] rounded-xl border border-line bg-paper px-2.5 font-mono text-xs tabular-nums text-ink transition-colors duration-rapido placeholder:font-sans placeholder:text-mute hover:border-paperEdge focus:border-granate"
    />
  );
}
