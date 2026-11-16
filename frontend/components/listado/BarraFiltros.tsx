"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ArrowDownUp, Check, ChevronDown, Clock, Eye, FileText, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { ICONO_SEVERIDAD } from "@/components/ui/Severidad";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { numero } from "@/lib/formato";
import { useListado, type Parametros } from "./Listado";
import { colorMuestra, type MuestraColor } from "./paletaSeveridad";

/**
 * La barra de filtros de todo listado (§14.1). Una fila de cajas de 40 px y, debajo, lo que está filtrando:
 *
 *   escritorio  [buscar………]  [Severidad ⌄] [Región ⌄] [Año ⌄]           [Filtros 2]  [⇅ Más recientes ⌄]
 *               Región: Lima ×   Regla: Sobreprecio ×                                          Quitar todos
 *
 *   celular     [buscar………………………………………………]
 *               [Filtros 2]             [⇅ Más recientes ⌄]
 *
 * - En escritorio, la faceta y los filtros a la vista van en la fila como desplegables compactos, cada uno del ancho de
 *   lo que dice. Los que no caben pasan a «Filtros» en vez de abrir un segundo renglón: la barra se mide (`medir`).
 * - En el celular, sólo el buscador, «Filtros» y el orden (antes eran casi dos pantallas antes de la primera fila). Todos
 *   los filtros van en una hoja que sube desde abajo, agrupados, con «Ver resultados» y «Quitar filtros».
 * - En la hoja se elige y se aplica todo junto («Ver resultados»): en el celular cada cambio era una página nueva del
 *   servidor. En la fila, cada desplegable aplica al elegir.
 * - Lo activo se ve en un renglón de chips, cada uno con su ×, y «Quitar todos». Sólo si algo filtra.
 * - Todo va a la URL vía `Listado`; mientras llega la página, el ícono del buscador gira y `ZonaResultados` se atenúa.
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
  /**
   * El cuadrito de color de la parte que esta opción es en una barra partida (`BarraSegmentada`): así los chips le hacen
   * de leyenda (auditoría del 2026-11-05: la gravedad iba en rojo y ámbar en la barra y en chips sin color debajo). Una
   * serie por su lugar en la barra, «otros», o una gravedad (`colorMuestra`: el mismo color que `paletaGravedad` le da a
   * su parte). Va en lugar del ícono: el ícono en `text-rust` junto al cuadrito en `crimson` se leían como dos marcas
   * distintas, y el nombre de la opción ya dice la gravedad sin depender del color.
   */
  muestra?: MuestraColor;
}

export interface FiltroSecundario {
  param: string;
  etiqueta: string;
  /** Texto de la opción vacía: "Toda regla", "Todo el Perú". */
  todas: string;
  /** Las opciones con `grupo` se dibujan juntas bajo su título (<optgroup>), en el orden en que llegan. */
  opciones: { valor: string; etiqueta: string; conteo?: number | null; grupo?: string }[];
  /**
   * Los nombres de valores que no están entre las `opciones` (una opción sin coincidencias se oculta, pero puede seguir
   * elegida por un enlace): el chip y el desplegable los nombran así, no con la clave cruda («obra_controversia»).
   */
  etiquetas?: Record<string, string>;
  /** Dentro de "Filtros", los filtros con la misma `seccion` van juntos bajo ese subtítulo ("Dónde", "Cuándo", "Cuánto"). */
  seccion?: string;
  /**
   * En `visibles`: siempre desplegable, aunque tenga una sola opción (un filtro de una opción se dibuja como interruptor;
   * uno que mientras carga trae sólo la elegida saltaba de interruptor a desplegable).
   */
  desplegable?: boolean;
  /**
   * Dentro de "Filtros": un campo donde se escribe y se elige (`<datalist>` nativo) en vez de un desplegable, para las
   * listas largas (unos 100 partidos): recorrer cien opciones a ojo no es filtrar.
   */
  buscable?: boolean;
  /**
   * En `visibles`: el nombre corto del desplegable en la fila ("Riesgo"; con algo elegido, "Riesgo: Alto"). Sin `corta`,
   * va `etiqueta`. El nombre completo va siempre en la hoja de «Filtros» y en el chip de lo activo.
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
// 16 px en el celular (`text-destacado`): con menos, el iPhone agranda la página al tocar el campo.
const CAMPO =
  "h-10 w-full rounded-xl border border-line bg-paper px-3 text-destacado text-ink placeholder:text-mute transition-colors duration-rapido hover:border-paperEdge focus:border-granate md:text-dato";

/**
 * La caja de cada control de la fila: 40 px, borde de 1 px, del ancho de lo que dice (hasta 16rem). El anillo de foco va
 * en la caja: el <select> que la cubre es transparente y su propio anillo no se vería.
 */
const CAJA =
  "relative inline-flex h-10 min-w-0 max-w-[16rem] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-xl border bg-paper pl-3 pr-2.5 text-dato text-ink transition-colors duration-rapido has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-granate";

const BOTON_FILTROS =
  "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border bg-paper px-3 text-dato font-semibold text-ink transition-colors duration-rapido active:translate-y-px";

/** El separador entre controles de la fila (`gap-2`) y el ancho mínimo del buscador (`md:min-w-[16rem]`), para medir. */
const GAP = 8;
const MIN_BUSQUEDA = 256;

/** `useLayoutEffect` en el navegador (mide antes de pintar); en el servidor no hace nada y React avisa si se usa. */
const useEfectoMedida = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** El nombre de un valor que no está entre las opciones: su etiqueta conocida o la clave legible («obra controversia»). */
const nombreDe = (f: FiltroSecundario, v: string) => f.etiquetas?.[v] ?? (v.charAt(0).toUpperCase() + v.slice(1)).replace(/_/g, " ");
const etiquetaDe = (f: FiltroSecundario, v: string) => f.opciones.find((o) => o.valor === v)?.etiqueta ?? nombreDe(f, v);
const esConmutador = (f: FiltroSecundario) => f.opciones.length === 1 && !f.desplegable;

/** Un control que puede ir en la fila (escritorio) y que siempre va en la hoja de «Filtros». */
interface Control {
  clave: string;
  activo: boolean;
  /** En la fila. */
  fila: React.ReactNode;
  /** Su cara, sin el control: la copia invisible con la que se mide cuánto ocupa. */
  cara: React.ReactNode;
  /** En la hoja, con el valor del borrador. */
  hoja: React.ReactNode;
}

export function BarraFiltros({
  busqueda,
  faceta,
  visibles = [],
  filtros = [],
  orden,
  chips = [],
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
   * Filtros a la vista, en la misma fila (no detrás de "Filtros"): para las preguntas que casi todos hacen y que tienen
   * varias respuestas ("¿Lo leyó Vigía?", "Antecedentes del ganador"). Cada opción con su conteo. Los que no caben en la
   * fila pasan solos a «Filtros».
   */
  visibles?: FiltroSecundario[];
  filtros?: FiltroSecundario[];
  orden?: Orden;
  /**
   * Filtros que llegan por enlace y no tienen un control propio (el período de un gobierno con `desde` y `hasta`, varios
   * antecedentes a la vez): se nombran en el renglón de lo activo y su × quita todos sus parámetros. Antes quedaban
   * activos e invisibles: la lista filtraba y la barra decía «Todo el histórico».
   */
  chips?: { clave: string; texto: string; params: string[] }[];
  className?: string;
}) {
  const { parametros, navegar, pendiente } = useListado();
  const valorFaceta = faceta ? parametros[faceta.param] : undefined;
  const textoBusqueda = busqueda ? parametros[busqueda.param] : undefined;

  // ── La hoja de «Filtros»: se elige en un borrador y se aplica todo junto. ──
  const [abierta, setAbierta] = useState(false);
  const [borrador, setBorrador] = useState<Parametros>({});
  const paramsHoja = [...(faceta ? [faceta.param] : []), ...visibles.map((f) => f.param), ...filtros.map((f) => f.param)];
  const paramsEnlace = chips.flatMap((c) => c.params);
  const abrir = () => {
    setBorrador({ ...parametros });
    setAbierta(true);
  };
  const elegir = (param: string) => (v: string) => setBorrador((b) => ({ ...b, [param]: v || undefined }));
  const hayEnBorrador = [...paramsHoja, ...paramsEnlace].some((p) => borrador[p]);
  const quitarBorrador = () =>
    setBorrador((b) => ({ ...b, ...Object.fromEntries([...paramsHoja, ...paramsEnlace].map((p) => [p, undefined])) }));
  const verResultados = () => {
    const cambio: Parametros = {};
    for (const p of [...paramsHoja, ...paramsEnlace]) {
      if ((borrador[p] || undefined) !== (parametros[p] || undefined)) cambio[p] = borrador[p] || undefined;
    }
    setAbierta(false);
    if (Object.keys(cambio).length) navegar(cambio);
  };

  // ── Los controles que pueden ir en la fila, en orden: la faceta y los filtros a la vista. ──
  const controles: Control[] = [];
  if (faceta) {
    const elegida = valorFaceta ? faceta.opciones.find((o) => o.valor === valorFaceta) : undefined;
    const props = {
      etiqueta: faceta.etiqueta,
      nombre: valorFaceta && faceta.nombreEnChip === false ? null : faceta.etiqueta,
      elegido: valorFaceta ? elegida?.etiqueta ?? valorFaceta : null,
      marca: elegida ? <MarcaOpcion opcion={elegida} /> : null,
    };
    controles.push({
      clave: faceta.param,
      activo: !!valorFaceta,
      fila: (
        <SelectCompacto {...props} valor={valorFaceta ?? ""} onCambio={(v) => navegar({ [faceta.param]: v || undefined })}>
          <option value="">
            {faceta.todas}
            {faceta.conteoTodas != null ? ` (${numero(faceta.conteoTodas)})` : ""}
          </option>
          {valorFaceta && !elegida && <option value={valorFaceta}>{valorFaceta}</option>}
          <Opciones opciones={faceta.opciones} />
        </SelectCompacto>
      ),
      cara: <SelectCompacto {...props} soloCara />,
      hoja: <FacetaEnHoja faceta={faceta} valor={borrador[faceta.param]} onCambio={elegir(faceta.param)} />,
    });
  }
  for (const f of visibles) {
    const v = parametros[f.param];
    if (esConmutador(f)) {
      controles.push({
        clave: f.param,
        activo: !!v,
        fila: <Interruptor filtro={f} activo={!!v} onCambio={(x) => navegar({ [f.param]: x || undefined })} />,
        cara: <Interruptor filtro={f} activo={!!v} soloCara />,
        hoja: (
          <fieldset className="min-w-0">
            <legend className="mb-1 text-rotulo font-medium text-inkSoft">{f.etiqueta}</legend>
            <Interruptor filtro={f} activo={!!borrador[f.param]} onCambio={elegir(f.param)} />
          </fieldset>
        ),
      });
      continue;
    }
    const props = {
      etiqueta: f.etiqueta,
      nombre: f.corta ?? f.etiqueta,
      elegido: v ? etiquetaDe(f, v) : null,
      disabled: f.opciones.length === 0 && !v,
    };
    controles.push({
      clave: f.param,
      activo: !!v,
      fila: (
        <SelectCompacto {...props} valor={v ?? ""} onCambio={(x) => navegar({ [f.param]: x || undefined })}>
          <option value="">{f.todas}</option>
          {/* El valor activo puede no estar entre las opciones cruzadas: se agrega para que el select no se vacíe. */}
          {v && !f.opciones.some((o) => o.valor === v) && <option value={v}>{nombreDe(f, v)}</option>}
          <Opciones opciones={f.opciones} />
        </SelectCompacto>
      ),
      cara: <SelectCompacto {...props} soloCara />,
      hoja: <CampoFiltro filtro={f} valor={borrador[f.param]} onCambio={elegir(f.param)} />,
    });
  }

  // ── Cuántos controles caben en la fila (escritorio). `null`: aún sin medir (lo pinta el servidor); entonces la fila
  // corta lo que no cabe (una sola línea con `overflow-hidden`) y nada salta a un segundo renglón. ──
  const hayHoja = controles.length > 0 || filtros.length > 0;
  const filaRef = useRef<HTMLDivElement>(null);
  const medidaRef = useRef<HTMLDivElement>(null);
  const [enFila, setEnFila] = useState<number | null>(null);
  const [botonEnEscritorio, setBotonEnEscritorio] = useState(filtros.length > 0);
  // Una columna angosta en escritorio (768 px con la barra lateral deja ~460): si ni el buscador, «Filtros» y el orden
  // caben juntos, la barra se apila como en el celular en vez de desbordarse.
  const [estrecha, setEstrecha] = useState(false);
  const medir = useRef(() => {});
  medir.current = () => {
    const fila = filaRef.current;
    const medida = medidaRef.current;
    // En el celular la fila no lleva controles: no hay nada que medir.
    if (!fila || !medida || !window.matchMedia("(min-width: 768px)").matches) return;
    const anchos = new Map<string, number>();
    medida.querySelectorAll<HTMLElement>("[data-medida]").forEach((el) => anchos.set(el.dataset.medida!, Math.ceil(el.getBoundingClientRect().width)));
    const items = controles.map((c) => anchos.get(c.clave) ?? 0);
    const fijos = [...(busqueda ? [MIN_BUSQUEDA] : []), ...(orden ? [anchos.get("@orden") ?? 0] : [])];
    const disponible = fila.clientWidth - 1;
    const cabe = (n: number, boton: boolean) => {
      const w = [...fijos, ...items.slice(0, n), ...(boton ? [anchos.get("@filtros") ?? 0] : [])];
      return w.reduce((s, x) => s + x, 0) + GAP * Math.max(0, w.length - 1) <= disponible;
    };
    const angosta = !cabe(0, hayHoja);
    let n = angosta ? 0 : items.length;
    let boton = angosta || filtros.length > 0;
    if (!cabe(n, boton)) {
      boton = true;
      while (n > 0 && !cabe(n, true)) n--;
    }
    setEstrecha(angosta);
    setEnFila(n);
    setBotonEnEscritorio(boton);
  };
  // En cada render (cambia lo que dice un desplegable) y cuando cambia el ancho de la fila o de la copia (las fuentes).
  useEfectoMedida(() => medir.current());
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => medir.current());
    if (filaRef.current) ro.observe(filaRef.current);
    if (medidaRef.current) ro.observe(medidaRef.current);
    return () => ro.disconnect();
  }, []);

  const enLaFila = (i: number) => enFila == null || i < enFila;
  const activosSecundarios = filtros.filter((f) => parametros[f.param]).length;
  // En el celular la hoja tiene todo; en escritorio, lo que no está en la fila.
  const nCelular = controles.filter((c) => c.activo).length + activosSecundarios;
  const nEscritorio = controles.filter((c, i) => c.activo && !enLaFila(i)).length + activosSecundarios;

  // ── Lo activo, para el renglón de chips (la búsqueda no: ya se lee en su campo). ──
  const chipsActivos: { clave: string; nombre?: string; valor: string; quitar: () => void }[] = [];
  if (faceta && valorFaceta) {
    const valor = faceta.opciones.find((x) => x.valor === valorFaceta)?.etiqueta ?? valorFaceta;
    chipsActivos.push({ clave: faceta.param, nombre: faceta.nombreEnChip === false ? undefined : faceta.etiqueta, valor, quitar: () => navegar({ [faceta.param]: undefined }) });
  }
  for (const f of [...visibles, ...filtros]) {
    const v = parametros[f.param];
    if (!v) continue;
    chipsActivos.push({ clave: f.param, nombre: f.etiqueta, valor: etiquetaDe(f, v), quitar: () => navegar({ [f.param]: undefined }) });
  }
  for (const c of chips) {
    if (!c.params.some((p) => parametros[p])) continue;
    chipsActivos.push({ clave: c.clave, valor: c.texto, quitar: () => navegar(Object.fromEntries(c.params.map((p) => [p, undefined]))) });
  }
  const quitarTodo = () => navegar(Object.fromEntries([...paramsHoja, ...paramsEnlace].map((p) => [p, undefined])));

  // Mientras llega la página, gira el ícono del buscador; sin buscador, el del orden o el de «Filtros».
  const giraOrden = pendiente && !busqueda && !!orden;
  const giraFiltros = pendiente && !busqueda && !orden;

  const valorOrden = orden ? parametros[orden.param] ?? orden.porDefecto : "";
  const propsOrden = orden
    ? {
        etiqueta: "Ordenar por",
        nombre: null,
        elegido: orden.opciones.find((o) => o.valor === valorOrden)?.etiqueta ?? valorOrden,
        destacar: false,
        icono: giraOrden ? <Loader2 size={14} className="shrink-0 animate-spin text-mute" aria-hidden /> : <ArrowDownUp size={14} className="shrink-0 text-mute" aria-hidden />,
      }
    : null;

  return (
    // La copia para medir y la hoja van fuera del `space-y-2`: su margen de arriba le ganaba al `mt-auto` de `Panel` y la
    // hoja del celular quedaba pegada arriba en vez de subir desde abajo.
    <div className={cn("relative", className)}>
      <div className="space-y-2">
        <div ref={filaRef} className={cn("flex flex-wrap items-center gap-2", !estrecha && "md:flex-nowrap")}>
          {busqueda && (
            <Buscador
              {...busqueda}
              cargando={pendiente}
              valor={textoBusqueda ?? ""}
              onBuscar={(v) => navegar({ [busqueda.param]: v || undefined })}
              className={cn("w-full sm:w-full sm:min-w-0 sm:flex-none", estrecha ? "lg:max-w-none" : "md:w-auto md:min-w-[16rem] md:flex-1 lg:max-w-xl")}
            />
          )}

          {controles.length > 0 && !estrecha && (
            // `-m-1 p-1`: aire para el anillo de foco, que `overflow-hidden` cortaría. La altura deja una sola línea: lo que
            // no cabe (antes de medir) se corta entero, no abre un segundo renglón.
            <div className="-m-1 hidden h-12 min-w-0 flex-initial flex-wrap items-center gap-2 overflow-hidden p-1 md:flex">
              {controles.map((c, i) => (
                <div key={c.clave} className={cn("flex min-w-0", !enLaFila(i) && "hidden")}>
                  {c.fila}
                </div>
              ))}
            </div>
          )}

          {(hayHoja || orden) && (
            <div className={cn("flex w-full items-center gap-2", !estrecha && "md:ml-auto md:w-auto md:shrink-0")}>
              {hayHoja && (
                <button
                  type="button"
                  onClick={abrir}
                  aria-haspopup="dialog"
                  aria-expanded={abierta}
                  className={cn(
                    BOTON_FILTROS,
                    "flex-1",
                    !estrecha && "md:flex-none",
                    nCelular > 0 ? "max-md:border-granate" : "max-md:border-line max-md:hover:border-paperEdge",
                    nEscritorio > 0 ? "md:border-granate" : "md:border-line md:hover:border-paperEdge",
                    !botonEnEscritorio && "md:hidden",
                  )}
                >
                  {giraFiltros ? <Loader2 size={15} className="shrink-0 animate-spin" aria-hidden /> : <SlidersHorizontal size={15} className="shrink-0" aria-hidden />}
                  Filtros
                  {/* En el celular cuenta todo lo de la hoja; en escritorio, lo que no está a la vista en la fila. */}
                  <Contador n={nCelular} className="md:hidden" />
                  <Contador n={nEscritorio} className="hidden md:inline-flex" />
                </button>
              )}
              {orden && propsOrden && (
                <SelectCompacto
                  {...propsOrden}
                  valor={valorOrden}
                  onCambio={(v) => navegar({ [orden.param]: v === orden.porDefecto ? undefined : v })}
                  className={cn("flex-1 max-w-none", !estrecha && "md:max-w-[16rem] md:flex-none")}
                >
                  {orden.opciones.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.etiqueta}
                    </option>
                  ))}
                </SelectCompacto>
              )}
            </div>
          )}
        </div>

        {chipsActivos.length > 0 && (
          <div className="flex items-center gap-3">
            {/* Una sola línea: si no caben, se desliza de costado. `-m-1 p-1`: aire para el anillo de foco. */}
            <ul aria-label="Filtros activos" className="-m-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto p-1 [scrollbar-width:none]">
              {chipsActivos.map((c) => (
                <li key={c.clave} className="shrink-0">
                  <button
                    type="button"
                    onClick={c.quitar}
                    aria-label={`Quitar el filtro ${c.nombre ? `${c.nombre}: ` : ""}${c.valor}`}
                    className="inline-flex h-8 max-w-[20rem] items-center gap-1 rounded-lg border border-line bg-paper pl-2.5 pr-1.5 text-meta text-ink transition-colors duration-rapido hover:border-granate"
                  >
                    <span className="truncate">
                      {c.nombre && <span className="text-mute">{c.nombre}: </span>}
                      <span className="font-medium">{c.valor}</span>
                    </span>
                    <X size={13} className="shrink-0 text-mute" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            {chipsActivos.length > 1 && (
              <button type="button" onClick={quitarTodo} className="shrink-0 text-meta font-semibold text-granate hover:underline">
                Quitar todos
              </button>
            )}
          </div>
        )}
      </div>

      {/* La copia invisible con que se mide la fila: las caras de los controles a su ancho natural, sin recortes. */}
      <div aria-hidden className="pointer-events-none invisible absolute left-0 top-0 h-0 w-0 overflow-hidden">
        <div ref={medidaRef} className="flex w-max gap-2">
          {controles.map((c) => (
            <div key={c.clave} data-medida={c.clave} className="flex">
              {c.cara}
            </div>
          ))}
          {hayHoja && (
            <div data-medida="@filtros" className="flex">
              <span className={cn(BOTON_FILTROS, "border-line")}>
                <SlidersHorizontal size={15} className="shrink-0" />
                Filtros
                <Contador n={nCelular} />
              </span>
            </div>
          )}
          {propsOrden && (
            <div data-medida="@orden" className="flex">
              <SelectCompacto {...propsOrden} soloCara />
            </div>
          )}
        </div>
      </div>

      {hayHoja && (
        <Panel
          abierto={abierta}
          onCerrar={() => setAbierta(false)}
          titulo="Filtros"
          ancho="sm"
          pie={
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={quitarBorrador} disabled={!hayEnBorrador}>
                Quitar filtros
              </Button>
              <Button type="button" onClick={verResultados} className="flex-1">
                Ver resultados
              </Button>
            </div>
          }
        >
          <div className="space-y-6">
            {/* La faceta, sola (en chips, con su conteo y su color); en escritorio, sólo si no cupo en la fila. */}
            {faceta && <div className={cn(enFila != null && enLaFila(0) && "md:hidden")}>{controles[0].hoja}</div>}
            {/* Lo más usado: los filtros a la vista; en escritorio, sólo los que no cupieron. */}
            {visibles.length > 0 && (
              <Grupo
                titulo="Lo más usado"
                className={cn(enFila != null && enFila >= controles.length && "md:hidden")}
              >
                {controles.slice(faceta ? 1 : 0).map((c, j) => (
                  <div key={c.clave} className={cn(enFila != null && enLaFila(j + (faceta ? 1 : 0)) && "md:hidden")}>
                    {c.hoja}
                  </div>
                ))}
              </Grupo>
            )}
            {secciones(filtros).map((g, i) => (
              <Grupo key={g.titulo ?? `s${i}`} titulo={g.titulo}>
                {g.filtros.map((f) => (
                  <CampoFiltro key={f.param} filtro={f} valor={borrador[f.param]} onCambio={elegir(f.param)} />
                ))}
              </Grupo>
            ))}
          </div>
        </Panel>
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

/** Un grupo de la hoja de «Filtros», con su subtítulo. */
function Grupo({ titulo, className, children }: { titulo?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("space-y-3", className)}>
      {titulo && <p className="text-rotulo font-semibold uppercase tracking-wide text-mute">{titulo}</p>}
      {children}
    </section>
  );
}

function Contador({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-granate px-1 text-micro font-semibold text-paper", className)}>
      {n}
    </span>
  );
}

/** El ícono o el cuadrito de color de una opción de la faceta. */
function MarcaOpcion({ opcion: o, sobreLleno = false }: { opcion: OpcionFaceta; sobreLleno?: boolean }) {
  if (o.muestra != null) {
    // Del tamaño y la forma de `MuestraSerie` (la leyenda de la barra); sobre el chip elegido, con un filete claro para
    // que el color no se pierda en el fondo.
    return (
      <span
        className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-sm", sobreLleno && "ring-1 ring-paper/80")}
        style={{ background: colorMuestra(o.muestra) }}
        aria-hidden
      />
    );
  }
  const Icono = o.icono ? ICONOS_FACETA[o.icono] : null;
  return Icono ? <Icono size={13} className={cn("shrink-0", sobreLleno ? "text-paper" : TONO_ICONO[o.tono ?? "neutro"])} aria-hidden /> : null;
}

/**
 * Un desplegable compacto de la fila: se ve su nombre ("Región") o lo elegido ("Región: Lima"), del ancho de lo que dice;
 * encima va el <select> nativo, transparente, que es el que se toca, se enfoca y lee el lector de pantalla (con su lista
 * nativa en el celular y las opciones con su conteo). Antes cada desplegable medía 13rem aunque dijera "Año".
 */
function SelectCompacto({
  etiqueta,
  nombre,
  elegido,
  marca,
  icono,
  destacar = true,
  valor = "",
  onCambio,
  disabled,
  soloCara = false,
  className,
  children,
}: {
  /** El nombre accesible del <select>. */
  etiqueta: string;
  /** Sin nada elegido, lo que se lee ("Región"); con algo elegido, su prefijo ("Región:"). `null`: sólo lo elegido. */
  nombre: string | null;
  /** El texto de lo elegido; `null` = nada. */
  elegido: string | null;
  marca?: React.ReactNode;
  /** Un ícono fijo a la izquierda (el del orden). */
  icono?: React.ReactNode;
  /** Con algo elegido, borde de marca y el valor en negrita (un filtro). El orden siempre tiene algo: no se destaca. */
  destacar?: boolean;
  valor?: string;
  onCambio?: (v: string) => void;
  disabled?: boolean;
  /** Sólo la cara, sin <select>: la copia con que se mide la fila. */
  soloCara?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  const activo = elegido != null && destacar;
  return (
    <span className={cn(CAJA, activo ? "border-granate" : "border-line hover:border-paperEdge", disabled && "opacity-60", className)}>
      {icono}
      {elegido != null && marca}
      <span aria-hidden className="min-w-0 truncate">
        {elegido == null ? (
          nombre
        ) : nombre ? (
          <>
            <span className="text-mute">{nombre}:</span> <span className={cn(activo && "font-semibold")}>{elegido}</span>
          </>
        ) : (
          <span className={cn(activo && "font-semibold")}>{elegido}</span>
        )}
      </span>
      <ChevronDown size={14} className="ml-auto shrink-0 text-mute" aria-hidden />
      {!soloCara && (
        <select
          aria-label={etiqueta}
          value={valor}
          onChange={(e) => onCambio?.(e.target.value)}
          disabled={disabled}
          className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-xl opacity-0 text-destacado disabled:cursor-not-allowed"
        >
          {children}
        </select>
      )}
    </span>
  );
}

/** Un filtro de una sola opción: un interruptor ("Con posible nepotismo 844"), no un desplegable de una línea. */
function Interruptor({
  filtro: f,
  activo,
  onCambio,
  soloCara = false,
}: {
  filtro: FiltroSecundario;
  activo: boolean;
  onCambio?: (v: string) => void;
  soloCara?: boolean;
}) {
  const o = f.opciones[0];
  const contenido = (
    <>
      {activo && <Check size={14} className="shrink-0" aria-hidden />}
      <span className="truncate">{o.etiqueta}</span>
      {o.conteo != null && <span className="shrink-0 text-meta tabular-nums text-mute">{numero(o.conteo)}</span>}
    </>
  );
  const clase = cn(CAJA, "pr-3", activo ? "border-granate font-semibold" : "border-line hover:border-paperEdge");
  if (soloCara) return <span className={clase}>{contenido}</span>;
  return (
    <button type="button" aria-pressed={activo} onClick={() => onCambio?.(activo ? "" : o.valor)} className={cn(clase, "active:translate-y-px")}>
      {contenido}
    </button>
  );
}

/** La faceta en la hoja: sus opciones como chips, con su conteo y su ícono o cuadrito de color. */
function FacetaEnHoja({
  faceta,
  valor,
  onCambio,
}: {
  faceta: { param: string; etiqueta: string; todas: string; conteoTodas?: number | null; opciones: OpcionFaceta[] };
  valor: string | undefined;
  onCambio: (v: string) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-rotulo font-semibold uppercase tracking-wide text-mute">{faceta.etiqueta}</legend>
      <div className="flex flex-wrap gap-1.5">
        <Chip activo={!valor} onClick={() => onCambio("")}>
          {faceta.todas}
          {faceta.conteoTodas != null && <Conteo n={faceta.conteoTodas} />}
        </Chip>
        {faceta.opciones.map((o) => {
          const activo = valor === o.valor;
          return (
            <Chip key={o.valor} activo={activo} onClick={() => onCambio(activo ? "" : o.valor)}>
              <MarcaOpcion opcion={o} sobreLleno={activo} />
              {o.etiqueta}
              {o.conteo != null && <Conteo n={o.conteo} />}
            </Chip>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Un filtro dentro de la hoja de "Filtros": su nombre arriba y el desplegable a todo el ancho. */
function CampoFiltro({ filtro: f, valor, onCambio }: { filtro: FiltroSecundario; valor: string | undefined; onCambio: (v: string) => void }) {
  if (f.buscable) return <CampoBuscable filtro={f} valor={valor} onCambio={onCambio} />;
  return (
    <label className="block">
      <span className="mb-1 block text-rotulo font-medium text-inkSoft">{f.etiqueta}</span>
      <select value={valor ?? ""} onChange={(e) => onCambio(e.target.value)} className={cn(CAMPO, valor && "border-granate font-medium")} disabled={f.opciones.length === 0 && !valor}>
        <option value="">{f.todas}</option>
        {/* El valor activo puede no estar entre las opciones cruzadas: se agrega para que el select no se vacíe. */}
        {valor && !f.opciones.some((o) => o.valor === valor) && <option value={valor}>{nombreDe(f, valor)}</option>}
        <Opciones opciones={f.opciones} />
      </select>
    </label>
  );
}

/**
 * Un filtro de lista larga: se escribe y el navegador sugiere (`<datalist>`); al elegir una opción se aplica, y vaciar el
 * campo lo quita. Lo que se escribe y no es una opción no filtra nada (no hay controles que finjan funcionar).
 */
function CampoBuscable({ filtro: f, valor, onCambio }: { filtro: FiltroSecundario; valor: string | undefined; onCambio: (v: string) => void }) {
  const id = useId();
  const etiquetaDe = (v: string | undefined) => (v ? f.opciones.find((o) => o.valor === v)?.etiqueta ?? v : "");
  const [texto, setTexto] = useState(etiquetaDe(valor));
  useEffect(() => setTexto(etiquetaDe(valor)), [valor]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="block">
      <span className="mb-1 block text-rotulo font-medium text-inkSoft">{f.etiqueta}</span>
      <span className="relative block">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
        <input
          type="search"
          list={`${id}-opciones`}
          value={texto}
          placeholder={`${f.todas}: escribe para buscar`}
          autoComplete="off"
          onChange={(e) => {
            const t = e.target.value;
            setTexto(t);
            if (!t) return onCambio("");
            const o = f.opciones.find((x) => x.etiqueta === t);
            if (o) onCambio(o.valor);
          }}
          className={cn(CAMPO, "pl-9", valor && "border-granate font-medium")}
        />
      </span>
      <datalist id={`${id}-opciones`}>
        {f.opciones.map((o) => (
          <option key={o.valor} value={o.etiqueta}>
            {o.conteo != null ? numero(o.conteo) : undefined}
          </option>
        ))}
      </datalist>
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
        "inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 text-dato font-medium transition-colors duration-rapido active:translate-y-px",
        activo ? "border-granate bg-granate text-paper" : "border-line bg-paper text-ink hover:border-paperEdge",
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
  cargando = false,
  espera = 350,
  className,
}: {
  param?: string;
  placeholder: string;
  etiqueta: string;
  valor: string;
  min?: number;
  onBuscar: (v: string) => void;
  /** Mientras llega la página: la lupa gira. */
  cargando?: boolean;
  /**
   * Cuánto esperar tras la última tecla antes de buscar (ms). Más largo en un buscador que cuesta cada pedido (el de lo
   * que encontró la Contraloría arma un embedding por búsqueda): así una palabra escrita despacio no son cinco pedidos.
   */
  espera?: number;
  /** El ancho del campo en su fila (se suma al de siempre y lo pisa donde choca). */
  className?: string;
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
    }, espera);
    return () => window.clearTimeout(id);
  }, [texto, onBuscar, min, espera]);
  return (
    <form
      role="search"
      className={cn("relative w-full sm:w-auto sm:min-w-[17rem] sm:flex-1 lg:max-w-sm", className)}
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
      {/* El giro va en el ícono de adentro: `animate-spin` y el centrado (`-translate-y-1/2`) pisarían el mismo transform. */}
      <span className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 text-mute" aria-hidden>
        {cargando ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
      </span>
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
