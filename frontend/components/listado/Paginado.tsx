"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, SearchX } from "lucide-react";
import { MARGEN_LISTA, Paginacion } from "@/components/ui/Paginacion";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { coincide, numero, paraBuscar } from "@/lib/formato";
import { descargarCsv } from "@/lib/csv";
import { cn } from "@/lib/utils";
import { Buscador } from "./BarraFiltros";
import { CuentaGrupo, Tabla, type Columna, type Fila, type GrupoFilas } from "./Tabla";

type PropsTabla = Pick<Parameters<typeof Tabla>[0], "densidad" | "medida" | "className">;

/**
 * Listas que ya llegaron enteras del servidor (las órdenes de una entidad, sus proyectos de inversión) paginadas en el
 * cliente con el mismo control de todos los listados: "1–10 de 136" y anterior/siguiente, arriba y abajo. Antes eran
 * "Ver más / Ver menos" (o cortaban en silencio en 15 o 50).
 *
 * Con `buscar`, un buscador arriba que filtra en el navegador por el `buscable` de cada fila (todas las palabras, sin
 * tildes ni mayúsculas) y vuelve a la página 1. Aparece cuando la lista pasa de `MIN_BUSCAR` filas: en una de tres,
 * estorba.
 */
const MIN_BUSCAR = 10;
function usePaginas(n: number, tam: number) {
  const [pagina, setPagina] = useState(1);
  const paginas = Math.max(1, Math.ceil(n / tam));
  const actual = Math.min(pagina, paginas);
  return { actual, paginas, desde: (actual - 1) * tam, hasta: actual * tam, setPagina };
}

function Control({ actual, paginas, total, tam, nombre, onChange, subir = false }: { actual: number; paginas: number; total: number; tam: number; nombre: string; onChange: (n: number) => void; subir?: boolean }) {
  if (total <= tam) return null;
  return (
    <div className="flex justify-end">
      <Paginacion actual={actual} paginas={paginas} total={total} tam={tam} navegacion="interna" onChange={onChange} cargando={false} nombre={nombre} subir={subir} />
    </div>
  );
}

export interface BuscarEnLista {
  /** "Buscar por objeto, entidad o código…" */
  placeholder: string;
  /** Para el lector de pantalla: "Buscar en las órdenes". */
  etiqueta?: string;
  /** El texto con que llega (un enlace que ya trae qué buscar). */
  inicial?: string;
}

export function TablaPaginada({
  columnas,
  filas,
  etiqueta,
  tam = 10,
  nombre,
  buscar,
  densidad,
  medida,
  className,
}: {
  columnas: Columna[];
  filas: Fila[];
  etiqueta: string;
  tam?: number;
  nombre: string;
  buscar?: BuscarEnLista;
} & PropsTabla) {
  const [consulta, setConsulta] = useState(buscar?.inicial ?? "");
  const indice = useMemo(() => (buscar ? filas.map((f) => paraBuscar(f.buscable)) : []), [filas, buscar]);
  const q = paraBuscar(consulta);
  const vistas = useMemo(() => (buscar && q ? filas.filter((_, i) => coincide(indice[i], q)) : filas), [filas, indice, q, buscar]);
  const p = usePaginas(vistas.length, tam);
  const control = <Control actual={p.actual} paginas={p.paginas} total={vistas.length} tam={tam} nombre={nombre} onChange={p.setPagina} />;
  const controlAbajo = <Control actual={p.actual} paginas={p.paginas} total={vistas.length} tam={tam} nombre={nombre} onChange={p.setPagina} subir />;
  // Con un texto ya puesto, el buscador se ve siempre: si no, no habría cómo quitarlo.
  const barra = buscar && (filas.length > MIN_BUSCAR || consulta !== "") && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Buscador
        placeholder={buscar.placeholder}
        etiqueta={buscar.etiqueta ?? `Buscar en ${nombre}`}
        valor={consulta}
        onBuscar={(v) => {
          setConsulta(v);
          p.setPagina(1);
        }}
      />
      {q && (
        <span className="text-meta tabular-nums text-mute" aria-live="polite">
          {numero(vistas.length)} de {numero(filas.length)}
        </span>
      )}
    </div>
  );
  return (
    <div data-paginado className={`${MARGEN_LISTA} space-y-3`}>
      {barra}
      {vistas.length === 0 && q ? (
        <EstadoVacio icono={<SearchX size={16} />}>Ninguna coincide con “{consulta}”.</EstadoVacio>
      ) : (
        <>
          {control}
          <Tabla columnas={columnas} filas={vistas.slice(p.desde, p.hasta)} etiqueta={etiqueta} densidad={densidad} medida={medida} className={className} />
          {controlAbajo}
        </>
      )}
    </div>
  );
}

export function ListaPaginada({
  items,
  tam = 10,
  nombre,
  className,
  buscar,
}: {
  items: { id: string; contenido: ReactNode; buscable?: string }[];
  tam?: number;
  nombre: string;
  className?: string;
  buscar?: BuscarEnLista;
}) {
  const [consulta, setConsulta] = useState("");
  const indice = useMemo(() => (buscar ? items.map((x) => paraBuscar(x.buscable)) : []), [items, buscar]);
  const q = paraBuscar(consulta);
  const vistos = useMemo(() => (buscar && q ? items.filter((_, i) => coincide(indice[i], q)) : items), [items, indice, q, buscar]);
  const p = usePaginas(vistos.length, tam);
  const control = <Control actual={p.actual} paginas={p.paginas} total={vistos.length} tam={tam} nombre={nombre} onChange={p.setPagina} />;
  const controlAbajo = <Control actual={p.actual} paginas={p.paginas} total={vistos.length} tam={tam} nombre={nombre} onChange={p.setPagina} subir />;
  return (
    <div data-paginado className={`${MARGEN_LISTA} space-y-3`}>
      {buscar && items.length > MIN_BUSCAR && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Buscador
            placeholder={buscar.placeholder}
            etiqueta={buscar.etiqueta ?? `Buscar en ${nombre}`}
            valor={consulta}
            onBuscar={(v) => {
              setConsulta(v);
              p.setPagina(1);
            }}
          />
          {q && (
            <span className="text-meta tabular-nums text-mute" aria-live="polite">
              {numero(vistos.length)} de {numero(items.length)}
            </span>
          )}
        </div>
      )}
      {vistos.length === 0 && q ? (
        <EstadoVacio icono={<SearchX size={16} />}>Ninguna coincide con “{consulta}”.</EstadoVacio>
      ) : (
        <>
          {control}
          <ul className={className}>
            {vistos.slice(p.desde, p.hasta).map((x) => (
              <li key={x.id}>{x.contenido}</li>
            ))}
          </ul>
          {controlAbajo}
        </>
      )}
    </div>
  );
}

/** Un filtro de `TablaFiltrable`: un desplegable sobre `Fila.valores[clave]` (una fila puede tener varios valores). */
export interface FiltroLocal {
  clave: string;
  /** Para el lector de pantalla y el chip: "Región de la entidad". */
  etiqueta: string;
  /** Lo que se lee dentro del desplegable sin nada elegido: "Región". */
  corta: string;
  opciones: { valor: string; etiqueta: string }[];
}

/** Un orden de `TablaFiltrable`, sobre `Fila.claves[clave]` (número o texto; sin valor, al final). */
export interface OrdenLocal {
  valor: string;
  etiqueta: string;
  clave: string;
  dir: "asc" | "desc";
}

export type FilaFiltrable = Fila & {
  /** Los valores de la fila para cada filtro (`FiltroLocal.clave`). */
  valores?: Record<string, string | string[] | null | undefined>;
  /** Los valores para ordenar (`OrdenLocal.clave`). */
  claves?: Record<string, number | string | null | undefined>;
  /**
   * La fila en texto para «Descargar CSV» (`descargar` de TablaFiltrable): las columnas con el mismo dato que se ve,
   * nunca más (los nombres ya llegan tapados de la API; nada de documentos).
   */
  csv?: Record<string, string | number | null | undefined>;
};

/** Las filas en CSV (con BOM: Excel lo abre con sus tildes), en el orden y con los filtros de la lista. */
function bajarCsv(filas: FilaFiltrable[], archivo: string): void {
  const conCsv = filas.filter((f) => f.csv);
  if (!conCsv.length) return;
  const cols = [...new Set(conCsv.flatMap((f) => Object.keys(f.csv!)))];
  descargarCsv(cols, conCsv.map((f) => f.csv!), archivo);
}

const CAMPO_LOCAL =
  "h-10 w-full rounded-xl border border-line bg-paper px-3 text-dato text-ink transition-colors duration-rapido hover:border-paperEdge focus:border-granate";

/**
 * «Descargar CSV (n)», del alto de los desplegables: en la barra de filtros o en la cabecera de la sección (`BotonCsv`).
 * En el celular dice «Descargar (n)» (el «CSV» queda para el lector de pantalla): entero no cabía en media fila.
 */
function BotonDescargar({ n, onClick, className }: { n: number; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-paper px-3.5 text-meta font-semibold text-inkSoft transition-colors duration-rapido hover:border-granate/40 hover:text-ink",
        className,
      )}
    >
      <Download size={14} aria-hidden />
      <span>
        Descargar<span className="sr-only sm:not-sr-only"> CSV</span> ({numero(n)})
      </span>
    </button>
  );
}

/**
 * «Descargar CSV» en la cabecera de la sección (`Seccion acciones`) y no suelto sobre la tabla: `ConCsv` envuelve la
 * sección, `BotonCsv` va en sus acciones y la `TablaFiltrable` de adentro (una por `ConCsv`) le pasa lo que se ve, con
 * los filtros y el orden de ahora. La página, de servidor, sólo compone: ninguna función cruza al cliente.
 */
const CsvDeLista = createContext<{ vistas: FilaFiltrable[] | null; poner: (v: FilaFiltrable[]) => void } | null>(null);

export function ConCsv({ children }: { children: ReactNode }) {
  const [vistas, poner] = useState<FilaFiltrable[] | null>(null);
  const valor = useMemo(() => ({ vistas, poner }), [vistas]);
  return <CsvDeLista.Provider value={valor}>{children}</CsvDeLista.Provider>;
}

/**
 * El botón de `ConCsv`. `total` son las filas de la lista: con él se dibuja igual en el servidor, antes de que la tabla
 * diga cuántas se ven (así no aparece de golpe al hidratar y empuja la sección).
 */
export function BotonCsv({ archivo, total }: { archivo: string; total: number }) {
  const vistas = useContext(CsvDeLista)?.vistas ?? null;
  if (vistas ? !vistas.some((f) => f.csv) : total === 0) return null;
  return <BotonDescargar n={vistas ? vistas.length : total} onClick={() => vistas && bajarCsv(vistas, archivo)} />;
}

/** Un valor como parte de un id: «Compras del Estado» → «compras-del-estado». */
const enAncla = (t: string) => paraBuscar(t).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/**
 * Las filas de la página en grupos según `valores[clave]`. Ya vienen ordenadas, así que cada grupo es una racha (si un
 * valor volviera más abajo, se suma a su grupo: nunca dos rótulos iguales). El rótulo lleva el ancla de la fila de saltos.
 */
function agruparFilas(filas: FilaFiltrable[], clave: string, nombre: string): { grupos: GrupoFilas[]; saltos: { valor: string; ancla: string }[] } {
  const porValor = new Map<string, FilaFiltrable[]>();
  for (const f of filas) {
    const v = f.valores?.[clave];
    const valor = (Array.isArray(v) ? v[0] : v) || "Otros";
    const grupo = porValor.get(valor);
    if (grupo) grupo.push(f);
    else porValor.set(valor, [f]);
  }
  const usadas = new Set<string>();
  const saltos = [...porValor.keys()].map((valor) => {
    const base = `${enAncla(nombre) || "lista"}-${enAncla(valor) || "otros"}`;
    let ancla = base;
    for (let i = 2; usadas.has(ancla); i++) ancla = `${base}-${i}`;
    usadas.add(ancla);
    return { valor, ancla };
  });
  const grupos = saltos.map(({ valor, ancla }) => {
    const delGrupo = porValor.get(valor) ?? [];
    return {
      clave: valor,
      // El salto deja el rótulo arriba de todo (bajo la barra del sitio en el celular): con más aire asomaba, fijo, el
      // rótulo del grupo anterior y parecía que se había ido a otra letra.
      titulo: (
        <span id={ancla} className="inline-flex scroll-mt-14 items-center gap-2 md:scroll-mt-2">
          {valor}
          <CuentaGrupo>{numero(delGrupo.length)}</CuentaGrupo>
        </span>
      ),
      filas: delGrupo,
    };
  });
  return { grupos, saltos };
}

/** La fila para saltar a cada grupo de la página (sólo los que hay): en el celular se desliza de costado. */
function SaltosGrupo({ saltos, nombre }: { saltos: { valor: string; ancla: string }[]; nombre: string }) {
  return (
    <nav aria-label={`Saltar a un grupo de ${nombre}`}>
      <ul className="-m-1 flex gap-1.5 overflow-x-auto p-1 sm:flex-wrap sm:overflow-visible">
        {saltos.map((s) => (
          <li key={s.ancla} className="shrink-0">
            <a
              href={`#${s.ancla}`}
              className="inline-flex h-11 min-w-11 items-center justify-center rounded-xl border border-line bg-paper px-3 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:text-granate sm:h-9 sm:min-w-9 sm:px-2.5"
            >
              {s.valor}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * Una lista que llegó entera, con buscador, filtros (desplegables con su conteo, que cuenta sobre los demás filtros) y
 * orden, todo en el navegador, y su paginación. Pedido del usuario (2026-10-22): «faltan filtros» en las pestañas de la
 * ficha de una empresa (clientes, visitas, empresas vinculadas). Lo que va paginado en el servidor usa `BarraFiltros`.
 *
 * Con `agrupar`, la página se parte en grupos con su rótulo fijo y su conteo (la letra con «De la A a la Z» y el tema
 * con «Por tema», en el glosario) y, desde tres grupos, arriba va una fila para saltar a cada uno.
 */
export function TablaFiltrable({
  columnas,
  filas,
  etiqueta,
  tam = 20,
  nombre,
  buscar,
  filtros = [],
  ordenes = [],
  agrupar,
  descargar,
  densidad,
  medida,
  className,
}: {
  columnas: Columna[];
  filas: FilaFiltrable[];
  etiqueta: string;
  tam?: number;
  nombre: string;
  buscar?: BuscarEnLista;
  filtros?: FiltroLocal[];
  ordenes?: OrdenLocal[];
  /**
   * Por cada orden (`OrdenLocal.valor`), la clave de `FilaFiltrable.valores` que nombra el grupo de cada fila:
   * `{ alfabetico: "letra", tema: "tema" }`. Un dato y no una función: lo arma una página de servidor.
   */
  agrupar?: Record<string, string>;
  /**
   * «Descargar CSV» con lo que se ve (los filtros y el orden de ahora), si las filas traen `csv`: en la barra de filtros.
   * Dentro de `ConCsv` no hace falta: el botón es `BotonCsv`, en la cabecera de la sección.
   */
  descargar?: { archivo: string };
} & PropsTabla) {
  const [consulta, setConsulta] = useState(buscar?.inicial ?? "");
  const [elegidos, setElegidos] = useState<Record<string, string>>({});
  const [orden, setOrden] = useState(ordenes[0]?.valor ?? "");
  const indice = useMemo(() => filas.map((f) => paraBuscar(f.buscable)), [filas]);
  const q = paraBuscar(consulta);
  const tiene = (f: FilaFiltrable, clave: string, valor: string) => {
    const v = f.valores?.[clave];
    return Array.isArray(v) ? v.includes(valor) : v === valor;
  };
  // Las filas que pasan todo menos el filtro `sin` (para contar cada opción de ese filtro).
  const pasan = (sin?: string) =>
    filas.filter((f, i) => (!q || coincide(indice[i], q)) && Object.entries(elegidos).every(([k, v]) => k === sin || !v || tiene(f, k, v)));
  const vistas = useMemo(() => {
    const out = pasan();
    const o = ordenes.find((x) => x.valor === orden);
    if (!o) return out;
    const val = (f: FilaFiltrable) => f.claves?.[o.clave];
    return [...out].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "es");
      return o.dir === "asc" ? c : -c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filas, indice, q, elegidos, orden]);
  const p = usePaginas(vistas.length, tam);
  // Dentro de `ConCsv`, el botón va en la cabecera de la sección: se le pasa lo que se ve.
  const csvFuera = useContext(CsvDeLista);
  const ponerCsv = csvFuera?.poner;
  useEffect(() => {
    ponerCsv?.(vistas);
  }, [ponerCsv, vistas]);
  const control = <Control actual={p.actual} paginas={p.paginas} total={vistas.length} tam={tam} nombre={nombre} onChange={p.setPagina} />;
  const controlAbajo = <Control actual={p.actual} paginas={p.paginas} total={vistas.length} tam={tam} nombre={nombre} onChange={p.setPagina} subir />;
  const filtrando = !!q || Object.values(elegidos).some(Boolean);
  const conBarra = filas.length > MIN_BUSCAR || filtrando;
  const desplegables = filtros.map((fl) => {
    // Una pasada por las filas (no una por opción): con 300 entidades y 5 mil filas se notaba al escribir.
    const cuenta = new Map<string, number>();
    for (const f of pasan(fl.clave)) {
      const v = f.valores?.[fl.clave];
      for (const x of Array.isArray(v) ? v : v ? [v] : []) cuenta.set(x, (cuenta.get(x) ?? 0) + 1);
    }
    const opciones = fl.opciones
      .map((o) => ({ ...o, n: cuenta.get(o.valor) ?? 0 }))
      .filter((o) => o.n > 0 || elegidos[fl.clave] === o.valor);
    if (opciones.length < 2 && !elegidos[fl.clave]) return null;
    return (
      <label key={fl.clave} className="min-w-0 sm:min-w-[11rem] sm:flex-[0_1_14rem]">
        <span className="sr-only">{fl.etiqueta}</span>
        <select
          className={CAMPO_LOCAL}
          value={elegidos[fl.clave] ?? ""}
          onChange={(e) => {
            setElegidos((x) => ({ ...x, [fl.clave]: e.target.value }));
            p.setPagina(1);
          }}
        >
          <option value="">{fl.corta}</option>
          {opciones.map((o) => (
            <option key={o.valor} value={o.valor}>{`${o.etiqueta} (${numero(o.n)})`}</option>
          ))}
        </select>
      </label>
    );
  });
  const hayDesplegables = desplegables.some(Boolean);
  const conOrden = ordenes.length > 1;
  // Sin el desplegable del orden, el CSV es lo que va a la derecha.
  const botonCsv =
    descargar && !csvFuera && vistas.some((f) => f.csv) ? (
      <BotonDescargar n={vistas.length} onClick={() => bajarCsv(vistas, descargar.archivo)} className={conOrden ? undefined : "sm:ml-auto"} />
    ) : null;
  const hayBarra = conBarra && (!!buscar || hayDesplegables || conOrden || !!botonCsv);
  const enPagina = vistas.slice(p.desde, p.hasta);
  const claveGrupo = agrupar?.[orden];
  const agrupada = claveGrupo ? agruparFilas(enPagina, claveGrupo, nombre) : null;
  return (
    <div data-paginado className={`${MARGEN_LISTA} space-y-3`}>
      {hayBarra ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          {buscar && (
            <div className="min-w-0 sm:flex-[1_1_17rem]">
              <Buscador
                placeholder={buscar.placeholder}
                etiqueta={buscar.etiqueta ?? `Buscar en ${nombre}`}
                valor={consulta}
                onBuscar={(v) => {
                  setConsulta(v);
                  p.setPagina(1);
                }}
              />
            </div>
          )}
          {(hayDesplegables || conOrden || botonCsv) && (
            // En el celular, los desplegables y el CSV de a dos por fila y del mismo ancho (si son impares, el último a lo
            // ancho): antes cada uno medía distinto y el orden quedaba solo a la derecha. Desde sm, `contents`: van en la
            // fila del buscador, con el orden y el CSV a la derecha.
            <div className="grid grid-cols-2 gap-2 max-sm:[&>*:last-child:nth-child(odd)]:col-span-2 sm:contents">
              {desplegables}
              {conOrden && (
                <label className="min-w-0 sm:ml-auto sm:min-w-[11rem] sm:flex-[0_1_14rem]">
                  <span className="sr-only">Ordenar</span>
                  <select className={CAMPO_LOCAL} value={orden} onChange={(e) => { setOrden(e.target.value); p.setPagina(1); }}>
                    {ordenes.map((o) => (
                      <option key={o.valor} value={o.valor}>{o.etiqueta}</option>
                    ))}
                  </select>
                </label>
              )}
              {botonCsv}
            </div>
          )}
        </div>
      ) : (
        botonCsv && <div className="flex justify-end">{botonCsv}</div>
      )}
      {filtrando && (
        <p className="flex flex-wrap items-center gap-2 text-meta tabular-nums text-mute" aria-live="polite">
          {`${numero(vistas.length)} de ${numero(filas.length)}`}
          <button
            type="button"
            className="rounded-full border border-line px-2.5 py-0.5 text-meta text-inkSoft hover:border-granate/40 hover:text-ink"
            onClick={() => {
              setElegidos({});
              setConsulta("");
              p.setPagina(1);
            }}
          >
            Quitar filtros
          </button>
        </p>
      )}
      {vistas.length === 0 ? (
        <EstadoVacio icono={<SearchX size={16} />}>Nada coincide con estos filtros.</EstadoVacio>
      ) : (
        <>
          {agrupada && agrupada.saltos.length >= 3 && <SaltosGrupo saltos={agrupada.saltos} nombre={nombre} />}
          {control}
          <Tabla
            columnas={columnas}
            filas={agrupada ? undefined : enPagina}
            grupos={agrupada?.grupos}
            etiqueta={etiqueta}
            densidad={densidad}
            medida={medida}
            className={className}
          />
          {controlAbajo}
        </>
      )}
    </div>
  );
}
