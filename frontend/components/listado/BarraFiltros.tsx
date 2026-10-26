"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  /** Las opciones con `grupo` se dibujan juntas bajo su título (<optgroup>), en el orden en que llegan. */
  opciones: { valor: string; etiqueta: string; conteo?: number | null; grupo?: string }[];
  /** Dentro de "Filtros", los filtros con la misma `seccion` van juntos bajo ese subtítulo ("Dónde", "Cuándo", "Cuánto"). */
  seccion?: string;
  /**
   * En `visibles`: el nombre corto que va DENTRO del desplegable cuando no hay nada elegido ("Riesgo"), como un botón de filtro.
   * Así las tres preguntas, la búsqueda, "Filtros" y el orden caben en una fila (antes, con la etiqueta afuera, la
   * barra se partía en dos renglones). Lo elegido se nombra completo en "Filtrando por".
   */
  corta?: string;
}

export interface Orden {
  param: string;
  porDefecto: string;
  opciones: { valor: string; etiqueta: string }[];
}

/** Las opciones de un desplegable, con su conteo; las que traen `grupo`, juntas en su <optgroup>. */
function Opciones({ opciones }: { opciones: FiltroSecundario["opciones"] }) {
  const op = (o: FiltroSecundario["opciones"][number]) => (
    <option key={o.valor} value={o.valor}>
      {o.etiqueta}
      {o.conteo != null ? ` (${numero(o.conteo)})` : ""}
    </option>
  );
  const bloques: { grupo?: string; opciones: FiltroSecundario["opciones"] }[] = [];
  for (const o of opciones) {
    const ultimo = bloques[bloques.length - 1];
    if (ultimo && ultimo.grupo === o.grupo) ultimo.opciones.push(o);
    else bloques.push({ grupo: o.grupo, opciones: [o] });
  }
  return (
    <>
      {bloques.map((b, i) =>
        b.grupo ? <optgroup key={`${b.grupo}-${i}`} label={b.grupo}>{b.opciones.map(op)}</optgroup> : b.opciones.map(op),
      )}
    </>
  );
}

const TONO_ICONO: Record<TonoFaceta, string> = {
  alta: "text-rust",
  media: "text-amberTexto",
  baja: "text-inkSoft",
  positivo: "text-mossTexto",
  neutro: "text-mute",
};

// `placeholder:text-mute`: sin él, el texto de ayuda del buscador heredaba el gris de Tailwind (2,5:1, bajo el piso).
const CAMPO =
  "h-10 w-full rounded-xl border border-line bg-paper px-3 text-dato text-ink placeholder:text-mute transition-colors duration-rapido hover:border-paperEdge focus:border-granate";

export function BarraFiltros({
  busqueda,
  faceta,
  visibles = [],
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
  /**
   * Filtros desplegables a la vista, en la misma barra (no detrás de "Filtros"): para las preguntas que casi todos
   * hacen y que tienen varias respuestas ("¿Lo leyó Vigía?", "Antecedentes del ganador"). Cada opción con su conteo.
   */
  visibles?: FiltroSecundario[];
  filtros?: FiltroSecundario[];
  orden?: Orden;
  className?: string;
}) {
  const { parametros, navegar, pendiente } = useListado();
  const activos = filtros.filter((f) => parametros[f.param]);
  const conmutadores = visibles.filter((f) => f.opciones.length === 1);
  const desplegables = visibles.filter((f) => f.opciones.length !== 1);
  const visiblesActivos = desplegables.filter((f) => parametros[f.param]).length;
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
  for (const f of [...visibles.filter((x) => parametros[x.param]), ...activos]) {
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

        {/* Un filtro de una sola opción es un interruptor, no un desplegable de una línea. */}
        {conmutadores.map((f) => {
          const o = f.opciones[0];
          const activo = !!parametros[f.param];
          return (
            <Chip key={f.param} activo={activo} onClick={() => navegar({ [f.param]: activo ? undefined : o.valor })}>
              {o.etiqueta}
              {o.conteo != null && <Conteo n={o.conteo} />}
            </Chip>
          );
        })}

        {/* En el celular, los desplegables a la vista van dentro de "Filtros": eran 4 renglones antes de la primera fila. */}
        {desplegables.map((f) => (
          <span key={f.param} className="hidden sm:inline-flex">
            <DesplegableVisible filtro={f} valor={parametros[f.param]} onCambio={(v) => navegar({ [f.param]: v || undefined })} />
          </span>
        ))}

        <div className="ml-auto flex items-center gap-2">
          {pendiente && (
            <Loader2 size={15} className="animate-spin text-mute" aria-hidden />
          )}
          {(filtros.length > 0 || desplegables.length > 0) && (
            <span className={cn(filtros.length === 0 && "sm:hidden")}>
              <Popover
                titulo="Filtros"
                anchoClase="w-80"
                lado="abajo"
                className={cn(
                  "min-h-[40px] gap-1.5 rounded-full border px-3.5 text-dato font-medium transition-colors duration-rapido",
                  activos.length + visiblesActivos > 0 ? "border-granate bg-granate-50 text-granate" : "border-line bg-paper text-ink hover:bg-paperSoft",
                )}
                trigger={
                  <>
                    <SlidersHorizontal size={15} aria-hidden />
                    Filtros
                    {/* En el celular cuenta también los desplegables que van adentro; en escritorio ésos están a la vista. */}
                    <Contador n={activos.length + visiblesActivos} className="sm:hidden" />
                    <Contador n={activos.length} className="hidden sm:inline-flex" />
                  </>
                }
              >
                <span className="block space-y-4">
                  {desplegables.length > 0 && (
                    <span className="block space-y-3 sm:hidden">
                      <span className="block text-rotulo font-semibold text-inkSoft">Lo más usado</span>
                      {desplegables.map((f) => (
                        <CampoFiltro key={f.param} filtro={f} valor={parametros[f.param]} onCambio={(v) => navegar({ [f.param]: v || undefined })} />
                      ))}
                    </span>
                  )}
                  {secciones(filtros).map((g, i) => (
                    <span
                      key={g.titulo ?? `s${i}`}
                      className={cn(
                        "block space-y-3",
                        i > 0 && "border-t border-line pt-3",
                        // Bajo "Lo más usado" (sólo en el celular) también va su divisor.
                        i === 0 && desplegables.length > 0 && "max-sm:border-t max-sm:border-line max-sm:pt-3",
                      )}
                    >
                      {g.titulo && <span className="block text-rotulo font-semibold text-inkSoft">{g.titulo}</span>}
                      {g.filtros.map((f) => (
                        <CampoFiltro key={f.param} filtro={f} valor={parametros[f.param]} onCambio={(v) => navegar({ [f.param]: v || undefined })} />
                      ))}
                    </span>
                  ))}
                </span>
              </Popover>
            </span>
          )}
          {orden && (
            <label className="relative inline-flex items-center">
              <span className="sr-only">Ordenar por</span>
              <ArrowDownUp size={14} className="pointer-events-none absolute left-3 text-mute" aria-hidden />
              <select
                value={parametros[orden.param] ?? orden.porDefecto}
                onChange={(e) => navegar({ [orden.param]: e.target.value === orden.porDefecto ? undefined : e.target.value })}
                className="h-10 min-w-[11.5rem] max-w-[18rem] truncate rounded-full border border-line bg-paper pl-8 pr-7 text-dato text-ink transition-colors duration-rapido hover:bg-paperSoft focus:border-granate"
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
        <div className="flex flex-wrap items-center gap-1.5 text-meta">
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

/** Los filtros de "Filtros" agrupados por `seccion`, en el orden en que llegan. */
function secciones(filtros: FiltroSecundario[]): { titulo?: string; filtros: FiltroSecundario[] }[] {
  const g: { titulo?: string; filtros: FiltroSecundario[] }[] = [];
  for (const f of filtros) {
    const u = g[g.length - 1];
    if (u && u.titulo === f.seccion) u.filtros.push(f);
    else g.push({ titulo: f.seccion, filtros: [f] });
  }
  return g;
}

function Contador({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-granate px-1 text-micro font-semibold text-paper", className)}>
      {n}
    </span>
  );
}

/** Un filtro dentro del menú "Filtros": su nombre arriba y el desplegable a todo el ancho. */
function CampoFiltro({ filtro: f, valor, onCambio }: { filtro: FiltroSecundario; valor: string | undefined; onCambio: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-rotulo font-medium text-inkSoft">{f.etiqueta}</span>
      <select value={valor ?? ""} onChange={(e) => onCambio(e.target.value)} className={cn(CAMPO, valor && "border-granate/60 font-medium")} disabled={f.opciones.length === 0}>
        <option value="">{f.todas}</option>
        {/* El valor activo puede no estar entre las opciones cruzadas: se agrega para que el select no se vacíe. */}
        {valor && !f.opciones.some((o) => o.valor === valor) && <option value={valor}>{valor}</option>}
        <Opciones opciones={f.opciones} />
      </select>
    </label>
  );
}

/**
 * Un desplegable a la vista en la barra. Con algo elegido dice QUÉ filtra ("Riesgo: Alto"), no sólo el valor: antes,
 * con tres desplegables elegidos, la barra decía "Alto", "Lima", "Sí" y no se sabía cuál era cuál.
 */
function DesplegableVisible({ filtro: f, valor, onCambio }: { filtro: FiltroSecundario; valor: string | undefined; onCambio: (v: string) => void }) {
  const elegido = !!valor;
  const rotulo = elegido && f.corta ? `${f.corta}:` : f.corta ? null : f.etiqueta;
  return (
    <label
      className={cn(
        "inline-flex h-10 min-w-0 items-center rounded-full border bg-paper transition-colors duration-rapido hover:bg-paperSoft focus-within:border-granate",
        f.corta ? "w-[13rem]" : "max-w-[17rem]",
        elegido ? "border-granate" : "border-line",
      )}
    >
      {/* El nombre del filtro: siempre para el lector de pantalla; a la vista cuando hay algo elegido o no hay `corta`. */}
      {rotulo ? <span className="shrink-0 pl-3.5 text-meta text-mute">{rotulo}</span> : <span className="sr-only">{f.etiqueta}</span>}
      <select
        value={valor ?? ""}
        onChange={(e) => onCambio(e.target.value)}
        className={cn(
          "h-full min-w-0 flex-1 truncate rounded-full border-0 bg-transparent pr-8 text-dato text-ink focus:outline-none focus:ring-0",
          rotulo ? "pl-1.5" : "pl-3.5",
          elegido && "font-semibold text-granate",
        )}
      >
        <option value="">{f.corta ?? f.todas}</option>
        {valor && !f.opciones.some((o) => o.valor === valor) && <option value={valor}>{valor}</option>}
        <Opciones opciones={f.opciones} />
      </select>
    </label>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={cn(
        "inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-dato font-medium transition-colors duration-rapido active:translate-y-px",
        activo ? "border-granate bg-granate text-paper" : "border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
      )}
    >
      {children}
    </button>
  );
}

function Conteo({ n }: { n: number }) {
  return <span className="text-rotulo font-semibold tabular-nums opacity-80">{numero(n)}</span>;
}

/**
 * Búsqueda que filtra al dejar de escribir (350 ms) o con Enter; se sincroniza si la URL cambia
 * desde otro lado. Con `min`, un texto más corto no busca: lo dice dentro del campo. También la usa
 * `TablaPaginada` para las listas que llegan enteras (filtra en el navegador). Los ids salen de
 * `useId`: una página puede tener varias listas con su buscador.
 */
export function Buscador({
  placeholder,
  etiqueta,
  valor,
  min = 0,
  onBuscar,
}: {
  param?: string;
  placeholder: string;
  etiqueta: string;
  valor: string;
  min?: number;
  onBuscar: (v: string) => void;
}) {
  const id = useId();
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
      className="relative w-full sm:w-auto sm:min-w-[17rem] sm:flex-1 lg:max-w-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const t = texto.trim();
        if (corto(t)) return;
        ultimo.current = t;
        onBuscar(t);
      }}
    >
      <label className="sr-only" htmlFor={`${id}-campo`}>
        {etiqueta}
      </label>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
      <input
        id={`${id}-campo`}
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        aria-describedby={faltan ? `${id}-minimo` : undefined}
        className={cn(CAMPO, "pl-9")}
      />
      {/* Dentro del campo, a la derecha (el texto corto nunca llega hasta acá): sin mover la barra. */}
      <span
        id={`${id}-minimo`}
        aria-live="polite"
        className="pointer-events-none absolute right-9 top-1/2 -translate-y-1/2 text-rotulo text-mute"
      >
        {faltan ? `Mínimo ${min} caracteres` : ""}
      </span>
    </form>
  );
}
