"use client";

/**
 * Filtros de /app/contratos. Viven en la URL (`?q=&tipo=&etapa=&ubigeo=&riesgo=&orden=…`):
 * cada cambio hace `router.replace` y el server component vuelve a pedir la página 1.
 *
 * Tres niveles, de más a menos frecuente:
 *  1. Búsqueda (siempre visible, su propia fila).
 *  2. Chips rápidos con conteo real (todos · en cola · docs listos · señal alta) — la pregunta
 *     que hace el 90% de las visitas, sin abrir ningún desplegable.
 *  3. "Más filtros" (región, tipo, etapa, señal fina, monto, orden) — plegado salvo que ya
 *     haya algo elegido ahí, para no abrumar con 7 controles de entrada.
 * Cualquier filtro activo aparece además como chip removible individualmente en la fila de abajo.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import {
  ETAPAS, OPERATIVOS, ORDENES, RIESGOS, TIPOS, contratosQueryString, etapaLabel, operativoLabel, riesgoLabel, tipoLabel,
  type ContratosQuery, type ResumenContratos,
} from "@/lib/contratos";
import { ultimosMeses } from "@/components/mapa/FiltroMes";
import { cn } from "@/lib/utils";

interface Props {
  query: ContratosQuery;
  regiones: { ubigeo: string; nombre: string }[];
  /** Nombre de la entidad cuando el filtro `entidad=<ruc>` viene de un enlace. */
  entidadNombre?: string | null;
  resumen?: ResumenContratos | null;
}

const N = (n: number | undefined) => (n ?? 0).toLocaleString("es-PE");

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
  const sel = "h-8 rounded-lg border border-line bg-paper px-2 text-xs text-ink outline-none transition-colors duration-rapido hover:border-paperEdge focus:border-heroViolet disabled:cursor-not-allowed disabled:opacity-50";

  // ── Chips removibles: uno por filtro activo (todas las dimensiones, no solo entidad) ──
  const chips: { key: keyof ContratosQuery; label: string }[] = [];
  if (query.q) chips.push({ key: "q", label: `"${query.q}"` });
  if (query.entidad) chips.push({ key: "entidad", label: `Entidad: ${entidadNombre ?? query.entidad}` });
  if (query.ubigeo) chips.push({ key: "ubigeo", label: regionNombre(query.ubigeo) });
  if (query.tipo) chips.push({ key: "tipo", label: tipoLabel(query.tipo) ?? query.tipo });
  if (query.etapa) chips.push({ key: "etapa", label: etapaLabel(query.etapa) ?? query.etapa });
  if (query.riesgo) chips.push({ key: "riesgo", label: riesgoLabel(query.riesgo) ?? query.riesgo });
  if (query.operativo) chips.push({ key: "operativo", label: operativoLabel(query.operativo) ?? query.operativo });
  if (query.desde) chips.push({ key: "desde", label: meses.find((m) => m.desde === query.desde)?.etiqueta ?? query.desde });
  if (query.monto_min != null) chips.push({ key: "monto_min", label: `Desde S/ ${N(Number(query.monto_min))}` });
  if (query.monto_max != null) chips.push({ key: "monto_max", label: `Hasta S/ ${N(Number(query.monto_max))}` });
  if (query.orden && query.orden !== "fecha") chips.push({ key: "orden", label: ORDENES.find((o) => o.value === query.orden)?.label ?? query.orden });

  const limpiarTodo = () => {
    if (timer.current) window.clearTimeout(timer.current);
    setQ("");
    start(() => router.replace(pathname, { scroll: false }));
  };

  return (
    // Pegajosa: /app/contratos no tiene Header público sobre este layout (solo el
    // DashboardSidebar, que no ocupa alto), así que top-0 es la posición correcta — no hay que
    // volver a scrollear arriba para cambiar un filtro mientras se revisan los ~50 contratos de
    // la página actual. Bleed a los bordes con -mx/px (cancela el px-6/lg:px-10 del page.tsx)
    // para que lea como una franja real, no como una tarjeta flotando a mitad de columna.
    <div className="sticky top-0 z-10 -mx-6 space-y-2.5 border-b border-line bg-paper/95 px-6 pb-3 pt-2 backdrop-blur lg:-mx-10 lg:px-10">
      {/* 1. búsqueda */}
      <div className="relative flex items-center">
        <Search size={14} className="pointer-events-none absolute left-3 text-mute" aria-hidden />
        <label className="sr-only" htmlFor="buscar-contratos">Buscar por objeto, código o entidad</label>
        <input
          id="buscar-contratos"
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder="Buscar por objeto, código OCID o nombre de entidad…"
          className="h-10 w-full rounded-xl border border-line bg-paper pl-9 pr-16 text-sm text-ink outline-none placeholder:text-mute hover:border-paperEdge focus:border-heroViolet"
        />
        <span className="absolute right-3 inline-flex items-center gap-1.5">
          {pendiente && <Loader2 size={14} className="animate-spin text-mute" aria-label="Cargando" />}
          {q && (
            <button
              type="button"
              onClick={limpiarQ}
              aria-label="Borrar la búsqueda"
              className="rounded-full p-1 text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink"
            >
              <X size={13} />
            </button>
          )}
        </span>
      </div>

      {/* 2. chips rápidos con conteo real */}
      <div className="flex flex-wrap items-center gap-1.5">
        <ChipRapido active={!query.operativo && !query.riesgo} onClick={() => navegar({ operativo: undefined, riesgo: undefined })}>
          Todos <Cuenta n={resumen?.total} />
        </ChipRapido>
        <ChipRapido active={query.operativo === "en_cola"} tono="amber" onClick={() => navegar({ operativo: query.operativo === "en_cola" ? undefined : "en_cola", riesgo: undefined })}>
          En cola (análisis activo) <Cuenta n={resumen?.porOperativo.en_cola} />
        </ChipRapido>
        <ChipRapido active={query.operativo === "documentos_listos"} tono="inkSoft" onClick={() => navegar({ operativo: query.operativo === "documentos_listos" ? undefined : "documentos_listos", riesgo: undefined })}>
          Documentos listos <Cuenta n={resumen?.porOperativo.documentos_listos} />
        </ChipRapido>
        <ChipRapido active={query.riesgo === "alto"} tono="rust" onClick={() => navegar({ riesgo: query.riesgo === "alto" ? undefined : "alto", operativo: undefined })}>
          Señal alta <Cuenta n={resumen?.porRiesgo.alto} />
        </ChipRapido>
        <button
          type="button"
          onClick={() => setAvanzados((v) => !v)}
          className={cn(
            "ml-auto inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors duration-rapido",
            // Violeta = "este control está activo/abierto" (mismo idioma que el nav
            // destacado del sidebar), no una advertencia: clay/amber quedan para estado real.
            avanzados ? "border-heroViolet bg-heroViolet-soft text-heroViolet" : "border-line bg-paper text-mute hover:border-heroViolet/30 hover:text-ink",
          )}
          aria-expanded={avanzados}
        >
          <SlidersHorizontal size={11} aria-hidden /> Más filtros
          {/* Cuántos hay puestos ahí dentro: plegado, el panel avanzado escondía
              filtros activos y la lista parecía filtrada sin motivo visible. */}
          {nAvanzados > 0 && (
            <span className="rounded-full bg-heroViolet px-1.5 font-mono text-[10px] font-semibold text-paper">{nAvanzados}</span>
          )}
          <ChevronDown size={12} aria-hidden className={cn("transition-transform duration-rapido", avanzados && "rotate-180")} />
        </button>
      </div>

      {/* 3. filtros avanzados — siempre montado (no solo cuando avanzados=true) para poder animar
          su alto con CSS puro: grid-template-rows 0fr→1fr + overflow-hidden en el div interno.
          Antes aparecía/desaparecía de golpe (mount/unmount); ahora abre y cierra con una
          transición real, sin librería de animación. */}
      <div className={cn("grid transition-[grid-template-rows] duration-300 ease-out", avanzados ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
        <div className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paperSoft/60 p-2.5">
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
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label} {resumen ? `(${N(resumen.porTipo[t.value])})` : ""}</option>)}
            </select>
          </Campo>
          <Campo label="Etapa">
            <select value={query.etapa ?? ""} onChange={(e) => navegar({ etapa: (e.target.value || undefined) as ContratosQuery["etapa"] })} className={sel}>
              <option value="">Toda etapa</option>
              {ETAPAS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Campo>
          <Campo label="Señal">
            <select value={query.riesgo ?? ""} onChange={(e) => navegar({ riesgo: (e.target.value || undefined) as ContratosQuery["riesgo"] })} className={sel}>
              <option value="">Toda señal</option>
              {RIESGOS.map((t) => <option key={t.value} value={t.value}>{t.label} {resumen ? `(${N(resumen.porRiesgo[t.value])})` : ""}</option>)}
            </select>
          </Campo>
          <Campo label="Cola y documentos">
            <select value={query.operativo ?? ""} onChange={(e) => navegar({ operativo: (e.target.value || undefined) as ContratosQuery["operativo"] })} className={sel}>
              <option value="">Todos</option>
              {OPERATIVOS.map((t) => <option key={t.value} value={t.value}>{t.label} {resumen ? `(${N(resumen.porOperativo[t.value])})` : ""}</option>)}
            </select>
          </Campo>
          <Campo label="Mes">
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
          <Campo label="Monto mín.">
            <Monto value={query.monto_min} onCommit={(v) => navegar({ monto_min: v })} />
          </Campo>
          <Campo label="Monto máx.">
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

      {/* 4. filtros activos, removibles uno por uno. No es decoración: es el único
          lugar donde se ve POR QUÉ la lista está recortada, y cada uno se quita por
          separado — antes el único camino era "limpiar todo" y volver a empezar. */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
          <span className="text-mute">Filtrando por</span>
          {chips.map((ch) => (
            <span
              key={ch.key}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-heroViolet/35 bg-heroViolet-soft py-0.5 pl-2.5 pr-1 font-medium text-ink"
            >
              <span className="truncate">{ch.label}</span>
              <button
                type="button"
                onClick={() => navegar(ch.key === "desde" ? { desde: undefined, hasta: undefined } : { [ch.key]: undefined } as Partial<ContratosQuery>)}
                aria-label={`Quitar filtro ${ch.label}`}
                className="shrink-0 rounded-full p-0.5 text-heroViolet transition-colors duration-rapido hover:bg-heroViolet hover:text-paper"
              >
                <X size={11} aria-hidden />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={limpiarTodo}
            className="rounded-full px-2 py-0.5 text-mute underline-offset-2 transition-colors duration-rapido hover:bg-paperDeep hover:text-ink hover:underline"
          >
            Limpiar todo
          </button>
        </div>
      )}
    </div>
  );
}

function ChipRapido({ active, tono = "ink", onClick, children }: { active: boolean; tono?: "ink" | "inkSoft" | "moss" | "amber" | "rust"; onClick: () => void; children: React.ReactNode }) {
  // Mismos 5 tonos que el estado operativo real de un contrato (ver COLOR_ESTADO en
  // ContratoPin.tsx, la fuente canónica: sin_analizar/documentos_listos/en_cola/procesado/
  // en_revision) — antes "documentos_listos" era clay acá pero moss en ContratosLista.tsx e
  // inkSoft en ContratoPin.tsx, y "en_cola" era moss acá pero amber en ContratoPin.tsx: la
  // misma zona (p.ej. "en cola") se pintaba de 2-3 colores distintos según qué componente la
  // mostrara. Ahora los tres coinciden.
  const TONOS: Record<string, string> = {
    ink: "border-ink bg-ink text-paper",
    inkSoft: "border-inkSoft bg-inkSoft text-paper",
    moss: "border-moss bg-moss text-paper",
    // amber con texto claro daba 3.5:1 — bajo el piso de 4.5 para texto normal.
    // Con `ink` encima sube a 5.2:1 y el chip sigue leyéndose como ámbar.
    amber: "border-amber bg-amber text-ink",
    rust: "border-rust bg-rust text-paper",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors duration-rapido",
        active ? TONOS[tono] : "border-line bg-paper text-mute hover:border-heroViolet/40 hover:bg-paperSoft hover:text-ink",
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function Cuenta({ n }: { n: number | undefined }) {
  // Sin `opacity`: sobre el chip inactivo (texto mute) bajaba el contraste por
  // debajo del piso, y el conteo es justamente lo que se viene a leer.
  if (n == null) return null;
  return <span className="font-mono tabular-nums">{N(n)}</span>;
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="inline-flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-mute">{label}</span>
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
      className="h-8 w-[100px] rounded-lg border border-line bg-paper px-2 font-mono text-xs text-ink outline-none transition-colors duration-rapido placeholder:font-sans placeholder:text-mute hover:border-paperEdge focus:border-heroViolet"
    />
  );
}
