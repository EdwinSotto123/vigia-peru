"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";
import { numero } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";

/**
 * La barra de filtros de las listas de Gobserva Salud (2026-11-22, propuesta A con las palabras de la C: «ordenar mejor;
 * filtros sin forma; aplicar de un color distinto»). Un buscador y una fila de pastillas:
 *
 *  - `uno`: una pregunta con una sola respuesta («Dónde», «Del Estado o privado»): se aplica al tocarla.
 *  - `varios`: varias respuestas a la vez («Categoría»): se marcan y se aplican con «Aplicar», el único botón lleno.
 *  - `si`: un interruptor («Con sanción»): se aplica al tocarlo; el de las sanciones se enciende en rojo.
 *
 * Cada pastilla puesta se ve llena, con lo elegido escrito y su X para quitarla. Todo va a la URL (se comparte igual que
 * antes) con router.push dentro de una transición: mientras llega la lista nueva, `Resultados` la atenúa con una franja
 * que corre arriba, y la lista nueva llega subiendo un poco. En el celular la fila se desliza y cada lista es una hoja que
 * sube desde abajo.
 */

export interface OpcionFiltro {
  valor: string;
  nombre: string;
  /** Una línea de ayuda bajo el nombre («Puesto de salud»). */
  detalle?: string;
  /** Cuántos hay con los demás filtros puestos (las facetas de la API). */
  n?: number | null;
}

export type FiltroBarra =
  | { tipo: "uno"; clave: string; etiqueta: string; opciones: OpcionFiltro[]; valor?: string | null; vacio?: string; buscar?: boolean }
  | { tipo: "varios"; clave: string; etiqueta: string; opciones: OpcionFiltro[]; valor?: string | null }
  | { tipo: "si"; clave: string; etiqueta: string; valorSi: string; activo: boolean; tono?: "alerta" };

interface Filtros {
  pendiente: boolean;
  /** Va a la lista con estos cambios (null quita la clave); siempre vuelve a la página 1. */
  aplicar: (cambios: Record<string, string | null>) => void;
}

const Contexto = createContext<Filtros>({ pendiente: false, aplicar: () => undefined });

const SIN_CONSERVAR: string[] = [];

/** Lo que comparten la barra y los resultados: la transición y cómo se arma la dirección nueva. */
export function ProveedorFiltros({
  ruta,
  params,
  dependientes = {},
  conservar = SIN_CONSERVAR,
  children,
}: {
  /** La lista en este host («/establecimientos» o «/salud/establecimientos» en DEV). */
  ruta: string;
  /** Lo que la URL lleva hoy (sin la página). */
  params: Record<string, string>;
  /** Claves que se borran cuando otra cambia (el departamento borra la provincia y el distrito). */
  dependientes?: Record<string, string[]>;
  /** Claves que se leen de la barra de direcciones al aplicar (la pestaña abierta, que cambia sin pasar por el servidor). */
  conservar?: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const valor = useMemo<Filtros>(
    () => ({
      pendiente,
      aplicar: (cambios) => {
        const u = new URLSearchParams(params);
        u.delete("pagina");
        try {
          const hoy = new URLSearchParams(window.location.search);
          for (const k of conservar) {
            const v = hoy.get(k);
            if (v) u.set(k, v);
            else u.delete(k);
          }
        } catch {
          /* sin la dirección de hoy, se aplica con lo que dio el servidor */
        }
        for (const [k, v] of Object.entries(cambios)) {
          for (const d of dependientes[k] ?? []) u.delete(d);
          if (v == null || v === "") u.delete(k);
          else u.set(k, v);
        }
        const qs = u.toString();
        iniciar(() => router.push(qs ? `${ruta}?${qs}` : ruta, { scroll: false }));
      },
    }),
    [pendiente, params, dependientes, conservar, ruta, router],
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export const useFiltros = () => useContext(Contexto);

/** Lo que muestra la lista: atenuado con la franja que corre mientras llega la nueva; la nueva llega subiendo un poco. */
export function Resultados({ clave, children, className }: { clave: string; children: ReactNode; className?: string }) {
  const { pendiente } = useFiltros();
  return (
    <div aria-busy={pendiente} className={cn("relative", className)}>
      {pendiente && (
        <div role="status" className="gs-velo absolute inset-x-0 -top-2 z-10 h-1 rounded-full bg-granate/15 gs-corre">
          <span className="sr-only">Cargando la lista con los filtros nuevos</span>
        </div>
      )}
      <div key={clave} className={cn("gs-llegan transition-opacity duration-normal", pendiente && "pointer-events-none opacity-50")}>
        {children}
      </div>
    </div>
  );
}

const PASTILLA =
  "gs-hunde inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-meta font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate focus-visible:ring-offset-1 sm:min-h-9 sm:px-3";
const NEUTRA = "border-line bg-paper text-ink hover:border-granate/60 hover:bg-granate-50/60";
const PUESTA = "border-granate bg-granate-50 font-semibold text-ink";

/** El panel de una pastilla: debajo de ella en la computadora; una hoja desde abajo en el celular. */
function Panel({ titulo, cerrar, children, pie, id, derecha = false }: { titulo: string; cerrar: () => void; children: ReactNode; pie?: ReactNode; id: string; derecha?: boolean }) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && cerrar();
    window.addEventListener("keydown", tecla);
    caja.current?.querySelector<HTMLElement>("input, button[aria-pressed='true'], button")?.focus();
    return () => window.removeEventListener("keydown", tecla);
  }, [cerrar]);
  return (
    <>
      <button type="button" aria-label="Cerrar" tabIndex={-1} onClick={cerrar} className="gs-velo fixed inset-0 z-overlay bg-ink/35 sm:hidden" />
      <div
        ref={caja}
        id={id}
        role="dialog"
        aria-label={titulo}
        className={cn(
          "gs-panel fixed inset-x-0 bottom-0 z-overlay flex max-h-[78vh] flex-col rounded-t-3xl border border-line bg-caja pb-[env(safe-area-inset-bottom)] shadow-pop sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-full sm:mt-2 sm:max-h-[min(26rem,70vh)] sm:w-72 sm:rounded-2xl sm:pb-0",
          derecha ? "sm:right-0 sm:[transform-origin:top_right]" : "sm:left-0",
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3 sm:hidden">
          <span aria-hidden className="absolute left-1/2 top-1.5 h-1.5 w-10 -translate-x-1/2 rounded-full bg-ink/15" />
          <p className="pt-1 font-display text-bloque font-bold text-ink">{titulo}</p>
          <button type="button" onClick={cerrar} aria-label="Cerrar" className="grid h-11 w-11 place-items-center rounded-full text-inkSoft hover:bg-ink/[0.05]">
            <X size={19} aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">{children}</div>
        {pie && <div className="flex items-center justify-between gap-2 border-t border-line p-2.5">{pie}</div>}
      </div>
    </>
  );
}

/** Una pastilla que abre su panel (uno o varios), con su X para quitar lo puesto. */
function PastillaLista({ f, abierta, abrir, cerrar, derecha = false }: { f: Extract<FiltroBarra, { tipo: "uno" | "varios" }>; abierta: boolean; abrir: () => void; cerrar: () => void; derecha?: boolean }) {
  const { aplicar, pendiente } = useFiltros();
  const id = useId();
  const elegidos = (f.valor ?? "").split(",").filter(Boolean);
  const puesta = elegidos.length > 0;
  const nombres = elegidos.map((v) => f.opciones.find((o) => o.valor === v)?.nombre ?? v);
  const texto = puesta ? (nombres.length > 2 ? `${nombres[0]} y ${nombres.length - 1} más` : nombres.join(", ")) : (f.tipo === "uno" && f.vacio) || f.etiqueta;
  const [marcados, setMarcados] = useState<string[]>(elegidos);
  const [buscar, setBuscar] = useState("");
  const [tocado, setTocado] = useState<string | null>(null);
  useEffect(() => {
    if (abierta) {
      setMarcados(elegidos);
      setBuscar("");
      setTocado(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abierta]);
  const opciones = buscar
    ? f.opciones.filter((o) => o.nombre.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(buscar.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()))
    : f.opciones;
  const cambio = marcados.slice().sort().join(",") !== elegidos.slice().sort().join(",");

  return (
    <div className="relative shrink-0">
      <span className={cn(PASTILLA, "p-0 sm:p-0", puesta ? PUESTA : NEUTRA)}>
        <button
          type="button"
          onClick={abierta ? cerrar : abrir}
          aria-expanded={abierta}
          aria-controls={abierta ? id : undefined}
          className={cn("inline-flex h-full min-h-11 items-center gap-1.5 rounded-full pl-3.5 focus-visible:outline-none sm:min-h-9 sm:pl-3", puesta ? "pr-1" : "pr-3")}
        >
          {puesta && f.tipo === "uno" && <span className="sr-only">{f.etiqueta}: </span>}
          {texto}
          {!puesta && <ChevronDown size={14} aria-hidden className={cn("text-mute transition-transform duration-rapido", abierta && "rotate-180")} />}
        </button>
        {puesta && (
          <button
            type="button"
            onClick={() => aplicar({ [f.clave]: null })}
            disabled={pendiente}
            aria-label={`Quitar ${texto}`}
            className="mr-1 grid h-7 w-7 place-items-center rounded-full text-granate transition-colors duration-rapido hover:bg-granate hover:text-paper"
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </span>
      {abierta && (
        <Panel
          id={id}
          titulo={f.etiqueta}
          cerrar={cerrar}
          derecha={derecha}
          pie={
            f.tipo === "varios" ? (
              <>
                <button
                  type="button"
                  onClick={() => setMarcados([])}
                  disabled={!marcados.length}
                  className="gs-hunde inline-flex min-h-11 items-center rounded-xl px-3 text-dato font-semibold text-inkSoft hover:bg-ink/[0.05] disabled:opacity-40 sm:min-h-9"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  disabled={!cambio}
                  onClick={() => {
                    aplicar({ [f.clave]: marcados.length ? marcados.join(",") : null });
                    cerrar();
                  }}
                  className="gs-hunde inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-granate px-4 text-dato font-semibold text-paper shadow-[0_1px_2px_rgb(0_0_0/0.12)] hover:bg-granate-deep disabled:cursor-not-allowed disabled:bg-ink/10 disabled:text-mute disabled:shadow-none sm:min-h-9"
                >
                  <Check size={16} aria-hidden />
                  {marcados.length ? `Aplicar ${marcados.length === 1 ? "1 filtro" : `${marcados.length} filtros`}` : "Aplicar"}
                </button>
              </>
            ) : undefined
          }
        >
          {f.tipo === "uno" && f.buscar && (
            <label className="relative mx-1 mb-1.5 mt-1 block">
              <span className="sr-only">Buscar en {f.etiqueta.toLowerCase()}</span>
              <Search size={15} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" />
              <input
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                placeholder="Escribe para buscar"
                className="h-10 w-full rounded-lg border border-line bg-paper pl-9 pr-3 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/25 sm:text-dato"
              />
            </label>
          )}
          <ul className="grid gap-0.5">
            {opciones.map((o) => {
              const si = f.tipo === "uno" ? elegidos.includes(o.valor) || tocado === o.valor : marcados.includes(o.valor);
              return (
                <li key={o.valor}>
                  <button
                    type="button"
                    aria-pressed={si}
                    onClick={() => {
                      if (f.tipo === "uno") {
                        setTocado(o.valor);
                        aplicar({ [f.clave]: elegidos.includes(o.valor) ? null : o.valor });
                        // Se ve la marca un instante antes de cerrar: la respuesta del toque.
                        window.setTimeout(cerrar, 140);
                      } else {
                        setMarcados((m) => (m.includes(o.valor) ? m.filter((x) => x !== o.valor) : [...m, o.valor]));
                      }
                    }}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-rapido sm:min-h-9",
                      si ? "bg-granate-50" : "hover:bg-ink/[0.045]",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid h-[18px] w-[18px] shrink-0 place-items-center border transition-colors duration-rapido",
                        f.tipo === "uno" ? "rounded-full" : "rounded-[5px]",
                        si ? "border-granate bg-granate text-paper" : "border-ink/30 bg-paper",
                      )}
                    >
                      {si && <Check size={12} strokeWidth={3} className="gs-marca" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-dato text-ink", si && "font-semibold")}>{o.nombre}</span>
                      {o.detalle && <span className="block text-rotulo text-mute">{o.detalle}</span>}
                    </span>
                    {o.n != null && <span className="shrink-0 text-rotulo tabular-nums text-mute">{numero(o.n)}</span>}
                  </button>
                </li>
              );
            })}
            {opciones.length === 0 && <li className="px-3 py-4 text-dato text-mute">Nada con «{buscar}».</li>}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function PastillaSi({ f }: { f: Extract<FiltroBarra, { tipo: "si" }> }) {
  const { aplicar, pendiente } = useFiltros();
  const [encendida, setEncendida] = useState(f.activo);
  useEffect(() => setEncendida(f.activo), [f.activo]);
  const alerta = f.tono === "alerta";
  return (
    <button
      type="button"
      aria-pressed={encendida}
      disabled={pendiente && encendida !== f.activo}
      onClick={() => {
        setEncendida(!encendida);
        aplicar({ [f.clave]: encendida ? null : f.valorSi });
      }}
      className={cn(
        PASTILLA,
        encendida
          ? alerta
            ? "border-crimson/50 bg-crimson-soft font-semibold text-crimsonTexto"
            : PUESTA
          : alerta
            ? "border-line bg-paper text-ink hover:border-crimson/50 hover:bg-crimson-soft/50"
            : NEUTRA,
      )}
    >
      {encendida && <Check size={14} strokeWidth={2.75} aria-hidden className="gs-marca" />}
      {f.etiqueta}
    </button>
  );
}

/** La barra: el buscador, las pastillas, «Quitar todos» y el orden a la derecha. */
export function BarraFiltros({
  busqueda,
  filtros,
  orden,
  className,
}: {
  busqueda?: { clave: string; valor?: string | null; ejemplo: string };
  filtros: FiltroBarra[];
  orden?: { clave: string; opciones: OpcionFiltro[]; valor?: string | null; porDefecto: string };
  className?: string;
}) {
  const { aplicar, pendiente } = useFiltros();
  const [abierta, setAbierta] = useState<string | null>(null);
  const [texto, setTexto] = useState(busqueda?.valor ?? "");
  useEffect(() => setTexto(busqueda?.valor ?? ""), [busqueda?.valor]);
  const barra = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!abierta) return;
    const fuera = (e: MouseEvent) => {
      // En la computadora, un clic fuera cierra; en el celular cierra el velo.
      if (barra.current && !barra.current.contains(e.target as Node) && window.matchMedia("(min-width: 640px)").matches) setAbierta(null);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierta]);

  const puestos = filtros.filter((f) => (f.tipo === "si" ? f.activo : !!f.valor)).length + (busqueda?.valor ? 1 : 0);
  function enviar(e: FormEvent) {
    e.preventDefault();
    if (!busqueda) return;
    const t = texto.trim();
    if ((t || null) === (busqueda.valor || null)) return;
    aplicar({ [busqueda.clave]: t.length >= 2 ? t : null });
  }
  const ordenNombre = orden?.opciones.find((o) => o.valor === (orden.valor || orden.porDefecto))?.nombre;

  return (
    <div ref={barra} className={cn("grid gap-2.5", className)}>
      {busqueda && (
        <form role="search" onSubmit={enviar} className="relative">
          <label htmlFor="barra-buscar" className="sr-only">
            {busqueda.ejemplo}
          </label>
          <Search size={17} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
          <input
            id="barra-buscar"
            type="search"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={busqueda.ejemplo}
            maxLength={120}
            enterKeyHint="search"
            className="h-12 w-full rounded-xl border border-line bg-paper pl-10 pr-28 text-destacado text-ink placeholder:text-mute transition-colors duration-rapido focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/25 sm:h-11 sm:text-dato [&::-webkit-search-cancel-button]:hidden"
          />
          <span className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {texto && (
              <button
                type="button"
                onClick={() => {
                  setTexto("");
                  if (busqueda.valor) aplicar({ [busqueda.clave]: null });
                }}
                aria-label="Borrar lo escrito"
                className="grid h-9 w-9 place-items-center rounded-lg text-mute hover:bg-ink/[0.05] hover:text-ink"
              >
                <X size={16} aria-hidden />
              </button>
            )}
            <button
              type="submit"
              className="gs-hunde inline-flex h-9 items-center gap-1.5 rounded-lg bg-granate px-3 text-meta font-semibold text-paper hover:bg-granate-deep"
            >
              {pendiente ? <Loader2 size={15} aria-hidden className="animate-spin" /> : <Search size={15} aria-hidden />}
              Buscar
            </button>
          </span>
        </form>
      )}
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
        {filtros.map((f) =>
          f.tipo === "si" ? (
            <PastillaSi key={f.clave} f={f} />
          ) : (
            <PastillaLista
              key={f.clave}
              f={f}
              abierta={abierta === f.clave}
              abrir={() => setAbierta(f.clave)}
              cerrar={() => setAbierta((a) => (a === f.clave ? null : a))}
            />
          ),
        )}
        {puestos > 1 && (
          <button
            type="button"
            onClick={() => {
              const limpio: Record<string, null> = {};
              for (const f of filtros) limpio[f.clave] = null;
              if (busqueda) limpio[busqueda.clave] = null;
              setTexto("");
              aplicar(limpio);
            }}
            className="gs-hunde inline-flex min-h-11 shrink-0 items-center px-2 text-meta font-semibold text-granate underline-offset-4 hover:underline sm:min-h-9"
          >
            Quitar todos
          </button>
        )}
        {orden && (
          <div className="shrink-0 sm:ml-auto">
            <PastillaLista
              f={{ tipo: "uno", clave: orden.clave, etiqueta: "Ordenar", opciones: orden.opciones, valor: orden.valor, vacio: `Orden: ${ordenNombre ?? ""}` }}
              derecha
              abierta={abierta === "__orden"}
              abrir={() => setAbierta("__orden")}
              cerrar={() => setAbierta((a) => (a === "__orden" ? null : a))}
            />
          </div>
        )}
      </div>
    </div>
  );
}
