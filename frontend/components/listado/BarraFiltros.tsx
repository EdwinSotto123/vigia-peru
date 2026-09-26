"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownUp, Clock, Eye, FileText, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { ICONO_SEVERIDAD } from "@/components/ui/Severidad";
import { Popover } from "@/components/ui/Flotante";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";
import { useListado } from "./Listado";

/**
 * La barra de filtros de todo listado (§14.1). Una sola forma, en este orden:
 *
 *   [buscar………]  [faceta principal: chips con conteo]  [Filtros (n)]  [Orden]
 *   Filtrando por: Regla: Sobreprecio ×   Entidad: Gobierno Regional… ×   Quitar todo
 *
 * - La faceta principal (severidad, riesgo, estado) va a la vista, en chips: es la
 *   pregunta que casi todos hacen. Las secundarias (regla, entidad, zona, tipo…) van
 *   detrás de "Filtros": no ocupan la pantalla hasta que se piden.
 * - Lo activo se ve siempre, cada filtro con su ×: el usuario sabe por qué la lista
 *   es la que es y deshace uno sin rehacer los demás.
 * - Todo va a la URL vía `Listado`; mientras llega la página, spinner en la barra y
 *   `ZonaResultados` atenuada.
 *
 * Props de datos planos: esta barra la arma un server component.
 */

/**
 * Íconos que puede llevar una opción de la faceta, por clave (datos planos: la barra la
 * arma un server component). Los de severidad más los de estado del proceso.
 */
const ICONOS_FACETA = { ...ICONO_SEVERIDAD, revision: Eye, espera: Clock, documentos: FileText } as const;
export type IconoFaceta = keyof typeof ICONOS_FACETA;
type TonoFaceta = "alta" | "media" | "baja" | "positivo" | "neutro";

export interface OpcionFaceta {
  valor: string;
  etiqueta: string;
  /** Conteo sobre los OTROS filtros activos. `null` = sin dato: no se muestra un 0. */
  conteo?: number | null;
  icono?: IconoFaceta;
  tono?: TonoFaceta;
}

export interface FiltroSecundario {
  param: string;
  etiqueta: string;
  /** Texto de la opción vacía: "Toda regla", "Todo el Perú". */
  todas: string;
  opciones: { valor: string; etiqueta: string; conteo?: number | null }[];
}

export interface Orden {
  param: string;
  porDefecto: string;
  opciones: { valor: string; etiqueta: string }[];
}

const TONO_ICONO: Record<TonoFaceta, string> = {
  alta: "text-rust",
  media: "text-amberTexto",
  baja: "text-inkSoft",
  positivo: "text-mossTexto",
  neutro: "text-mute",
};

const CAMPO =
  "h-10 w-full rounded-xl border border-line bg-paper px-3 text-[14px] text-ink transition-colors duration-rapido hover:border-paperEdge focus:border-granate";

export function BarraFiltros({
  busqueda,
  faceta,
  filtros = [],
  orden,
  className,
}: {
  /**
   * `min`: largo mínimo del texto antes de buscar (1–2 caracteres no piden nada al servidor;
   * vaciar el campo sí, para quitar la búsqueda). Sin `min`, busca con cualquier largo.
   */
  busqueda?: { param: string; placeholder: string; etiqueta: string; min?: number };
  faceta?: {
    param: string;
    etiqueta: string;
    todas: string;
    conteoTodas?: number | null;
    opciones: OpcionFaceta[];
    /** El chip activo dice "Severidad: Alta". `false` cuando la opción ya se nombra sola ("Riesgo alto"). */
    nombreEnChip?: boolean;
  };
  filtros?: FiltroSecundario[];
  orden?: Orden;
  className?: string;
}) {
  const { parametros, navegar, pendiente } = useListado();
  const activos = filtros.filter((f) => parametros[f.param]);
  const valorFaceta = faceta ? parametros[faceta.param] : undefined;
  const textoBusqueda = busqueda ? parametros[busqueda.param] : undefined;

  const chipsActivos: { clave: string; texto: string; quitar: () => void }[] = [];
  if (busqueda && textoBusqueda) chipsActivos.push({ clave: busqueda.param, texto: `“${textoBusqueda}”`, quitar: () => navegar({ [busqueda.param]: undefined }) });
  if (faceta && valorFaceta) {
    const o = faceta.opciones.find((x) => x.valor === valorFaceta);
    const opcion = o?.etiqueta ?? valorFaceta;
    const texto = faceta.nombreEnChip === false ? opcion : `${faceta.etiqueta}: ${opcion}`;
    chipsActivos.push({ clave: faceta.param, texto, quitar: () => navegar({ [faceta.param]: undefined }) });
  }
  for (const f of activos) {
    const v = parametros[f.param]!;
    const o = f.opciones.find((x) => x.valor === v);
    chipsActivos.push({ clave: f.param, texto: `${f.etiqueta}: ${o?.etiqueta ?? v}`, quitar: () => navegar({ [f.param]: undefined }) });
  }
  const quitarTodo = () => {
    const cambio: Record<string, undefined> = {};
    for (const c of chipsActivos) cambio[c.clave] = undefined;
    navegar(cambio);
  };

  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {busqueda && <Buscador {...busqueda} valor={textoBusqueda ?? ""} onBuscar={(v) => navegar({ [busqueda.param]: v || undefined })} />}

        {faceta && (
          // En el celular, una sola fila que se desliza (antes 6 chips ocupaban 4 renglones y
          // empujaban la tabla fuera de la pantalla); desde sm, envuelven.
          <div
            role="group"
            aria-label={`Filtrar por ${faceta.etiqueta.toLowerCase()}`}
            className="-mx-4 flex w-[calc(100%+2rem)] items-center gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>button]:shrink-0"
          >
            <Chip activo={!valorFaceta} onClick={() => navegar({ [faceta.param]: undefined })}>
              {faceta.todas}
              {faceta.conteoTodas != null && <Conteo n={faceta.conteoTodas} />}
            </Chip>
            {faceta.opciones.map((o) => {
              const activo = valorFaceta === o.valor;
              const Icono = o.icono ? ICONOS_FACETA[o.icono] : null;
              return (
                <Chip key={o.valor} activo={activo} onClick={() => navegar({ [faceta.param]: activo ? undefined : o.valor })}>
                  {Icono && <Icono size={13} className={activo ? "text-paper" : TONO_ICONO[o.tono ?? "neutro"]} aria-hidden />}
                  {o.etiqueta}
                  {o.conteo != null && <Conteo n={o.conteo} />}
                </Chip>
              );
            })}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {pendiente && (
            <Loader2 size={15} className="animate-spin text-mute" aria-hidden />
          )}
          {filtros.length > 0 && (
            <Popover
              titulo="Filtros"
              anchoClase="w-80"
              lado="abajo"
              className={cn(
                "min-h-[40px] gap-1.5 rounded-full border px-3.5 text-[14px] font-medium transition-colors duration-rapido",
                activos.length ? "border-granate bg-granate-50 text-granate" : "border-line bg-paper text-ink hover:bg-paperSoft",
              )}
              trigger={
                <>
                  <SlidersHorizontal size={15} aria-hidden />
                  Filtros
                  {activos.length > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-granate px-1 text-[11px] font-semibold text-paper">
                      {activos.length}
                    </span>
                  )}
                </>
              }
            >
              <span className="block space-y-3">
                {filtros.map((f) => (
                  <label key={f.param} className="block">
                    <span className="mb-1 block text-[12px] font-medium text-inkSoft">{f.etiqueta}</span>
                    <select
                      value={parametros[f.param] ?? ""}
                      onChange={(e) => navegar({ [f.param]: e.target.value || undefined })}
                      className={cn(CAMPO, parametros[f.param] && "border-granate/60 font-medium")}
                      disabled={f.opciones.length === 0}
                    >
                      <option value="">{f.todas}</option>
                      {/* El valor activo puede no estar entre las opciones cruzadas: se agrega para que el select no se vacíe. */}
                      {parametros[f.param] && !f.opciones.some((o) => o.valor === parametros[f.param]) && (
                        <option value={parametros[f.param]}>{parametros[f.param]}</option>
                      )}
                      {f.opciones.map((o) => (
                        <option key={o.valor} value={o.valor}>
                          {o.etiqueta}
                          {o.conteo != null ? ` (${numero(o.conteo)})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </span>
            </Popover>
          )}
          {orden && (
            <label className="relative inline-flex items-center">
              <span className="sr-only">Ordenar por</span>
              <ArrowDownUp size={14} className="pointer-events-none absolute left-3 text-mute" aria-hidden />
              <select
                value={parametros[orden.param] ?? orden.porDefecto}
                onChange={(e) => navegar({ [orden.param]: e.target.value === orden.porDefecto ? undefined : e.target.value })}
                className="h-10 rounded-full border border-line bg-paper pl-8 pr-8 text-[14px] text-ink transition-colors duration-rapido hover:bg-paperSoft focus:border-granate"
              >
                {orden.opciones.map((o) => (
                  <option key={o.valor} value={o.valor}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>

      {chipsActivos.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-mute">Filtrando por</span>
          {chipsActivos.map((c) => (
            <button
              key={c.clave}
              type="button"
              onClick={c.quitar}
              className="inline-flex min-h-[28px] max-w-[22rem] items-center gap-1 rounded-full bg-paperDeep py-0.5 pl-2.5 pr-1.5 text-ink transition-colors duration-rapido hover:bg-granate-50 hover:text-granate"
            >
              <span className="truncate">{c.texto}</span>
              <X size={13} aria-hidden />
              <span className="sr-only">Quitar este filtro</span>
            </button>
          ))}
          {chipsActivos.length > 1 && (
            <button type="button" onClick={quitarTodo} className="ml-1 font-medium text-granate hover:underline">
              Quitar todo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-medium transition-colors duration-rapido active:translate-y-px",
        activo ? "border-granate bg-granate text-paper" : "border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
      )}
    >
      {children}
    </button>
  );
}

function Conteo({ n }: { n: number }) {
  return <span className="text-[12px] font-semibold tabular-nums opacity-80">{numero(n)}</span>;
}

/**
 * Búsqueda que filtra al dejar de escribir (350 ms) o con Enter; se sincroniza si la URL cambia
 * desde otro lado. Con `min`, un texto más corto no busca: lo dice dentro del campo.
 */
function Buscador({
  placeholder,
  etiqueta,
  valor,
  min = 0,
  onBuscar,
}: {
  param: string;
  placeholder: string;
  etiqueta: string;
  valor: string;
  min?: number;
  onBuscar: (v: string) => void;
}) {
  const [texto, setTexto] = useState(valor);
  const ultimo = useRef(valor);
  // Vacío sí se aplica (quita la búsqueda); 1 a `min - 1` caracteres, no.
  const corto = (t: string) => t.length > 0 && t.length < min;
  const faltan = corto(texto.trim());
  useEffect(() => {
    setTexto(valor);
    ultimo.current = valor;
  }, [valor]);
  useEffect(() => {
    const t = texto.trim();
    if (t === ultimo.current || (t.length > 0 && t.length < min)) return;
    const id = window.setTimeout(() => {
      ultimo.current = t;
      onBuscar(t);
    }, 350);
    return () => window.clearTimeout(id);
  }, [texto, onBuscar, min]);
  return (
    <form
      role="search"
      className="relative w-full sm:w-auto sm:min-w-[18rem] sm:flex-1 lg:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        const t = texto.trim();
        if (corto(t)) return;
        ultimo.current = t;
        onBuscar(t);
      }}
    >
      <label className="sr-only" htmlFor="buscar-listado">
        {etiqueta}
      </label>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
      <input
        id="buscar-listado"
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-describedby={faltan ? "buscar-listado-minimo" : undefined}
        className={cn(CAMPO, "pl-9")}
      />
      {/* Dentro del campo, a la derecha (el texto corto nunca llega hasta acá): sin mover la barra. */}
      <span
        id="buscar-listado-minimo"
        aria-live="polite"
        className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 text-[12px] text-mute"
      >
        {faltan ? `Mínimo ${min} caracteres` : ""}
      </span>
    </form>
  );
}
