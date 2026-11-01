"use client";

import { useMemo, useState, type ReactNode } from "react";
import { MapPin, X } from "lucide-react";
import { TablaFiltrable, type Columna, type FilaFiltrable, type FiltroLocal } from "@/components/listado";
import { BotonCsv, ConCsv } from "@/components/listado/Paginado";
import { IconoBandera } from "@/components/ui/IconoBandera";
import { numero, plural } from "@/lib/formato";
import { cn } from "@/lib/utils";

/** Una barra de una faceta: su clave (el valor de la fila), su nombre y, si hace falta, qué significa. */
export interface Faceta {
  clave: string;
  etiqueta: string;
  detalle?: string;
}

/**
 * Los contratos graves de la semana en «Lo nuevo» (2026-11-01): arriba, dos gráficas de barras, «qué antecedente grave
 * tienen» y «dónde» (la región de la entidad), y debajo la lista. Cada barra es un botón que filtra la lista (y se vuelve
 * a tocar para quitarlo); las cuentas de una gráfica se recalculan con el filtro de la otra, así cada número dice cuántas
 * filas va a mostrar. Antes la página era una lista de 150 filas sin forma, con el mismo contrato una vez por empresa del
 * consorcio, y el filtro de antecedente escondido en un desplegable.
 *
 * Las filas llegan armadas del servidor (`valores.grave`: los tipos de antecedente GRAVE de la fila; `valores.region`: el
 * ubigeo de 2 dígitos). Un contrato con dos antecedentes graves cuenta en las dos barras.
 */
export function ContratosSemana({
  filas,
  columnas,
  tipos,
  regiones,
  filtros,
  archivo,
  acciones,
}: {
  filas: FilaFiltrable[];
  columnas: Columna[];
  /** Los tipos de antecedente grave de la semana (nombre y qué significa). */
  tipos: Faceta[];
  /** Las regiones de la semana (por su ubigeo de 2 dígitos). */
  regiones: Faceta[];
  /** Los desplegables de la lista (tipo de contratación). */
  filtros?: FiltroLocal[];
  archivo: string;
  /** Lo que va a la derecha del CSV, en la cabecera de la lista. */
  acciones?: ReactNode;
}) {
  const [tipo, setTipo] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const grave = (f: FilaFiltrable) => (Array.isArray(f.valores?.grave) ? (f.valores.grave as string[]) : []);
  const regionDe = (f: FilaFiltrable) => String(f.valores?.region ?? "sin_dato");

  const { vistas, porTipo, porRegion } = useMemo(() => {
    const conRegion = region ? filas.filter((f) => regionDe(f) === region) : filas;
    const conTipo = tipo ? filas.filter((f) => grave(f).includes(tipo)) : filas;
    const porTipo = new Map<string, number>();
    for (const f of conRegion) for (const t of grave(f)) porTipo.set(t, (porTipo.get(t) ?? 0) + 1);
    const porRegion = new Map<string, number>();
    for (const f of conTipo) porRegion.set(regionDe(f), (porRegion.get(regionDe(f)) ?? 0) + 1);
    return { vistas: filas.filter((f) => (!tipo || grave(f).includes(tipo)) && (!region || regionDe(f) === region)), porTipo, porRegion };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, tipo, region]);

  const conN = (lista: Faceta[], cuenta: Map<string, number>, elegido: string | null) =>
    lista
      .map((x) => ({ ...x, n: cuenta.get(x.clave) ?? 0 }))
      .filter((x) => x.n > 0 || x.clave === elegido)
      .sort((a, b) => b.n - a.n || a.etiqueta.localeCompare(b.etiqueta, "es"));
  const nombreTipo = tipos.find((t) => t.clave === tipo)?.etiqueta;
  const nombreRegion = regiones.find((r) => r.clave === region)?.etiqueta;

  return (
    <div className="space-y-5">
      {/* `grid-cols-1` (minmax(0, 1fr)) y no la columna automática: con ella, «La inversión cuesta 2 veces o más lo
          aprobado» ensanchaba la tarjeta y la página pasaba el ancho del celular. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <BarrasFaceta
          id="nuevo-por-tipo"
          titulo="Qué antecedente grave tienen"
          bajada="Un contrato con dos antecedentes cuenta en los dos. Toca uno para ver sólo esos contratos."
          items={conN(tipos, porTipo, tipo)}
          elegido={tipo}
          alElegir={setTipo}
          icono={(clave) => <IconoBandera tipo={clave} size={15} className="text-rust" />}
        />
        <BarrasFaceta
          id="nuevo-por-region"
          titulo="Dónde"
          bajada="La región de la entidad que contrató. Toca una para filtrar."
          items={conN(regiones, porRegion, region)}
          elegido={region}
          alElegir={setRegion}
          icono={() => <MapPin size={15} className="text-mute" aria-hidden />}
        />
      </div>

      <ConCsv>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2" aria-live="polite">
              <p className="text-dato text-inkSoft">
                {tipo || region ? (
                  <>
                    <b className="font-semibold text-ink">{numero(vistas.length)}</b> de {plural(filas.length, "contrato", "contratos")}
                  </>
                ) : (
                  <>
                    Los <b className="font-semibold text-ink">{numero(filas.length)}</b> contratos, de más antecedentes graves y mayor monto a menos
                  </>
                )}
              </p>
              {nombreTipo && <Quitar alQuitar={() => setTipo(null)}>{nombreTipo}</Quitar>}
              {nombreRegion && <Quitar alQuitar={() => setRegion(null)}>{nombreRegion}</Quitar>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <BotonCsv archivo={archivo} total={vistas.length} />
              {acciones}
            </div>
          </div>
          <TablaFiltrable
            // Otra selección, otra lista: vuelve a la primera página.
            key={`${tipo ?? ""}|${region ?? ""}`}
            columnas={columnas}
            filas={vistas}
            etiqueta={`${plural(vistas.length, "contrato", "contratos")} (toca uno para ver su evidencia)`}
            tam={15}
            nombre="contratos"
            buscar={{ placeholder: "Buscar una entidad, una empresa, qué se compró…", etiqueta: "Buscar entre los contratos de la semana" }}
            filtros={filtros}
            ordenes={[
              { valor: "graves", etiqueta: "Más antecedentes graves", clave: "graves", dir: "desc" },
              { valor: "monto", etiqueta: "Mayor monto", clave: "monto", dir: "desc" },
              { valor: "reciente", etiqueta: "Lo más reciente", clave: "fecha", dir: "desc" },
            ]}
          />
        </div>
      </ConCsv>
    </div>
  );
}

/** Un filtro puesto, con su ✕ para quitarlo. */
function Quitar({ children, alQuitar }: { children: ReactNode; alQuitar: () => void }) {
  return (
    <button
      type="button"
      onClick={alQuitar}
      className="inline-flex min-h-8 items-center gap-1 rounded-full border border-granate/40 bg-granate-50 px-3 text-meta font-medium text-ink transition-colors duration-rapido hover:border-granate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
    >
      {children}
      <X size={13} aria-hidden />
      <span className="sr-only"> (quitar el filtro)</span>
    </button>
  );
}

/** Cuántas barras se ven antes de «Ver las N». */
const VISIBLES = 6;

/**
 * Una gráfica de barras horizontales que filtra: una fila por valor (ícono, nombre, número, barra contra la mayor y, si
 * hay, qué significa), de más a menos. Muestra seis y el resto con «Ver las N». La elegida va marcada (aria-pressed).
 */
function BarrasFaceta({
  id,
  titulo,
  bajada,
  items,
  elegido,
  alElegir,
  icono,
}: {
  id: string;
  titulo: string;
  bajada: string;
  items: (Faceta & { n: number })[];
  elegido: string | null;
  alElegir: (clave: string | null) => void;
  icono: (clave: string) => ReactNode;
}) {
  const [todas, setTodas] = useState(false);
  const mayor = Math.max(1, ...items.map((i) => i.n));
  // recorte: seis a la vista y el resto con «Ver las N» (el botón de abajo); la elegida siempre se ve.
  const visibles = todas ? items : items.filter((i, k) => k < VISIBLES || i.clave === elegido);
  return (
    <section aria-labelledby={`${id}-t`} className="min-w-0 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <h3 id={`${id}-t`} className="font-display text-bloque font-bold leading-tight text-ink">
        {titulo}
      </h3>
      <p className="mt-0.5 text-meta leading-snug text-mute">{bajada}</p>
      {items.length === 0 ? (
        <p className="mt-3 text-dato text-mute">Ninguno con el filtro de al lado.</p>
      ) : (
        <ul className="mt-3 space-y-1">
          {visibles.map((i) => {
            const activo = i.clave === elegido;
            return (
              <li key={i.clave}>
                <button
                  type="button"
                  aria-pressed={activo}
                  onClick={() => alElegir(activo ? null : i.clave)}
                  className={cn(
                    "-mx-2 block w-[calc(100%+1rem)] rounded-xl px-2 py-1.5 text-left transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                    activo ? "bg-granate-50 ring-1 ring-granate/50" : "hover:bg-paperSoft",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {icono(i.clave)}
                    <span className={cn("min-w-0 flex-1 truncate text-dato", activo ? "font-semibold text-ink" : "font-medium text-ink")} title={i.etiqueta}>
                      {i.etiqueta}
                    </span>
                    <span className="shrink-0 font-mono text-dato font-semibold tabular-nums text-ink">{numero(i.n)}</span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
                    <span className={cn("block h-full rounded-full", activo ? "bg-rust" : "bg-rust/70")} style={{ width: `${Math.max(3, (i.n / mayor) * 100)}%` }} />
                  </span>
                  {i.detalle && <span className="mt-1 line-clamp-2 block text-rotulo leading-snug text-mute">{i.detalle}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > VISIBLES && (
        <button
          type="button"
          onClick={() => setTodas((v) => !v)}
          aria-expanded={todas}
          className="mt-2 inline-flex min-h-9 items-center rounded-full px-1 text-meta font-semibold text-granate underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          {todas ? "Ver menos" : `Ver las ${numero(items.length)}`}
        </button>
      )}
    </section>
  );
}
