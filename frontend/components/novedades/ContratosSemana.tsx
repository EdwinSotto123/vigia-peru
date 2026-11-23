"use client";

import { useMemo, useState, type ReactNode } from "react";
import { MapPin, X } from "lucide-react";
import { TablaFiltrable, type Columna, type FilaFiltrable, type FiltroLocal } from "@/components/listado";
import { BotonCsv, ConCsv } from "@/components/listado/Paginado";
import { colorSerie } from "@/components/charts/BarraSegmentada";
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
 * Los contratos graves de la semana en «Lo nuevo» (2026-11-01): dos gráficas de barras, «qué antecedente grave tienen» y
 * «dónde» (la región de la entidad), y la lista. Cada barra es un botón que filtra la lista (y se vuelve a tocar para
 * quitarlo); las cuentas de una gráfica se recalculan con el filtro de la otra, así cada número dice cuántas filas va a
 * mostrar. Antes la página era una lista de 150 filas sin forma, con el mismo contrato una vez por empresa del consorcio,
 * y el filtro de antecedente escondido en un desplegable.
 *
 * Pedido del usuario del 2026-11-05: las dos gráficas eran dos cajas de ~280 px de alto ENCIMA de la lista con dos y tres
 * barras, y de día las barras eran un rosado desvaído (`bg-rust/70`). Ahora van en una columna de 17 rem al costado de la
 * lista, fija al bajar (en el celular, encima y de a dos en la tableta), sin una caja por gráfica, y con rellenos llenos:
 * rojo los antecedentes graves (es su gravedad) y el color de la primera serie las regiones (una cuenta, no una gravedad).
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
    // `minmax(0, 1fr)` y no la columna automática: con ella, «La inversión cuesta 2 veces o más lo aprobado» ensanchaba la
    // columna y la página pasaba el ancho del celular.
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
      {/* Las dos gráficas al costado de la lista, fijas al bajar (con su propio scroll si «Ver las N» las alarga más que la
          pantalla); en la tableta, una al lado de la otra encima de la lista. */}
      <aside
        aria-label="Filtrar los contratos de la semana"
        className="grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-4 rounded-2xl border border-line bg-paper p-4 [.tarjeta_&]:rounded-xl [.tarjeta_&]:border-0 [.tarjeta_&]:bg-paperSoft sm:grid-cols-2 lg:sticky lg:top-[calc(var(--alto-barra-fija,0px)_+_1rem)] lg:block lg:max-h-[calc(100vh_-_var(--alto-barra-fija,0px)_-_2rem)] lg:space-y-5 lg:overflow-y-auto"
      >
        <BarrasFaceta
          id="nuevo-por-tipo"
          titulo="Qué antecedente grave tienen"
          bajada="Un contrato con dos cuenta en los dos. Toca uno para filtrar."
          items={conN(tipos, porTipo, tipo)}
          elegido={tipo}
          alElegir={setTipo}
          icono={(clave) => <IconoBandera tipo={clave} size={15} className="text-rust" />}
          relleno="grave"
        />
        <BarrasFaceta
          id="nuevo-por-region"
          titulo="Dónde"
          bajada="La región de la entidad que contrató."
          items={conN(regiones, porRegion, region)}
          elegido={region}
          alElegir={setRegion}
          icono={() => <MapPin size={15} className="text-mute" aria-hidden />}
          relleno="serie"
          className="lg:border-t lg:border-line lg:pt-4"
        />
      </aside>

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
            tam={10}
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
 * hay, qué significa), de más a menos. Muestra seis y el resto con «Ver las N». La elegida va marcada (aria-pressed) y,
 * con una elegida, las demás barras se atenúan. Sin caja propia: las dos van juntas en la columna de al lado de la lista.
 * `relleno`: «grave» (el rojo de la gravedad, para los antecedentes graves) o «serie» (el color de la primera serie, para
 * una cuenta sin gravedad como la región).
 */
function BarrasFaceta({
  id,
  titulo,
  bajada,
  items,
  elegido,
  alElegir,
  icono,
  relleno,
  className,
}: {
  id: string;
  titulo: string;
  bajada: string;
  items: (Faceta & { n: number })[];
  elegido: string | null;
  alElegir: (clave: string | null) => void;
  icono: (clave: string) => ReactNode;
  relleno: "grave" | "serie";
  className?: string;
}) {
  const [todas, setTodas] = useState(false);
  const mayor = Math.max(1, ...items.map((i) => i.n));
  // recorte: seis a la vista y el resto con «Ver las N» (el botón de abajo); la elegida siempre se ve.
  const visibles = todas ? items : items.filter((i, k) => k < VISIBLES || i.clave === elegido);
  return (
    <section aria-labelledby={`${id}-t`} className={cn("min-w-0", className)}>
      <h3 id={`${id}-t`} className="font-display text-cuerpo font-bold leading-tight text-ink">
        {titulo}
      </h3>
      <p className="mt-0.5 text-rotulo leading-snug text-mute">{bajada}</p>
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
                  title={i.detalle ?? undefined}
                  onClick={() => alElegir(activo ? null : i.clave)}
                  className={cn(
                    "-mx-2 block w-[calc(100%+1rem)] rounded-xl px-2 py-1.5 text-left transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
                    activo ? "bg-granate-50 ring-1 ring-granate/50" : "hover:bg-paperSoft",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {icono(i.clave)}
                    <span className={cn("line-clamp-2 min-w-0 flex-1 text-dato leading-snug", activo ? "font-semibold text-ink" : "font-medium text-ink")}>
                      {i.etiqueta}
                    </span>
                    <span className="shrink-0 font-mono text-dato font-semibold tabular-nums text-ink">{numero(i.n)}</span>
                  </span>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-paperDeep" aria-hidden>
                    <span
                      className={cn("block h-full rounded-full transition-opacity duration-rapido", relleno === "grave" && "bg-rust", elegido && !activo && "opacity-40")}
                      style={{ width: `${Math.max(3, (i.n / mayor) * 100)}%`, background: relleno === "serie" ? colorSerie(0) : undefined }}
                    />
                  </span>
                  {/* Qué es, sólo en el elegido (y en el `title` de todos): con la explicación de cada uno a la vista, la
                      columna medía tres pantallas y en el celular empujaba la lista hacia abajo (auditoría 2026-11-05). */}
                  {activo && i.detalle && <span className="mt-1 block text-rotulo leading-snug text-mute">{i.detalle}</span>}
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
