"use client";

import { useMemo, useState, type ReactNode } from "react";
import { SearchX } from "lucide-react";
import { Paginacion } from "@/components/ui/Paginacion";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { coincide, numero, paraBuscar } from "@/lib/formato";
import { Buscador } from "./BarraFiltros";
import { Tabla, type Columna, type Fila } from "./Tabla";

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

function Control({ actual, paginas, total, tam, nombre, onChange }: { actual: number; paginas: number; total: number; tam: number; nombre: string; onChange: (n: number) => void }) {
  if (total <= tam) return null;
  return (
    <div className="flex justify-end">
      <Paginacion actual={actual} paginas={paginas} total={total} tam={tam} navegacion="interna" onChange={onChange} cargando={false} nombre={nombre} />
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
    <div className="space-y-3">
      {barra}
      {vistas.length === 0 && q ? (
        <EstadoVacio icono={<SearchX size={16} />}>Ninguna coincide con “{consulta}”.</EstadoVacio>
      ) : (
        <>
          {control}
          <Tabla columnas={columnas} filas={vistas.slice(p.desde, p.hasta)} etiqueta={etiqueta} densidad={densidad} medida={medida} className={className} />
          {control}
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
  return (
    <div className="space-y-3">
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
          {control}
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
};

const CAMPO_LOCAL =
  "h-10 w-full rounded-xl border border-line bg-paper px-3 text-dato text-ink transition-colors duration-rapido hover:border-paperEdge focus:border-granate";

/**
 * Una lista que llegó entera, con buscador, filtros (desplegables con su conteo, que cuenta sobre los demás filtros) y
 * orden, todo en el navegador, y su paginación. Pedido del usuario (2026-10-22): «faltan filtros» en las pestañas de la
 * ficha de una empresa (clientes, visitas, empresas vinculadas). Lo que va paginado en el servidor usa `BarraFiltros`.
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
  const control = <Control actual={p.actual} paginas={p.paginas} total={vistas.length} tam={tam} nombre={nombre} onChange={p.setPagina} />;
  const filtrando = !!q || Object.values(elegidos).some(Boolean);
  const conBarra = filas.length > MIN_BUSCAR || filtrando;
  return (
    <div className="space-y-3">
      {conBarra && (
        <div className="flex flex-wrap items-center gap-2">
          {buscar && (
            <div className="min-w-0 flex-[1_1_17rem]">
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
          {filtros.map((fl) => {
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
              <label key={fl.clave} className="min-w-[11rem] flex-[0_1_14rem]">
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
          })}
          {ordenes.length > 1 && (
            <label className="ml-auto min-w-[11rem] flex-[0_1_14rem]">
              <span className="sr-only">Ordenar</span>
              <select className={CAMPO_LOCAL} value={orden} onChange={(e) => { setOrden(e.target.value); p.setPagina(1); }}>
                {ordenes.map((o) => (
                  <option key={o.valor} value={o.valor}>{o.etiqueta}</option>
                ))}
              </select>
            </label>
          )}
        </div>
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
          {control}
          <Tabla columnas={columnas} filas={vistas.slice(p.desde, p.hasta)} etiqueta={etiqueta} densidad={densidad} medida={medida} className={className} />
          {control}
        </>
      )}
    </div>
  );
}
