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
  const [consulta, setConsulta] = useState("");
  const indice = useMemo(() => (buscar ? filas.map((f) => paraBuscar(f.buscable)) : []), [filas, buscar]);
  const q = paraBuscar(consulta);
  const vistas = useMemo(() => (buscar && q ? filas.filter((_, i) => coincide(indice[i], q)) : filas), [filas, indice, q, buscar]);
  const p = usePaginas(vistas.length, tam);
  const control = <Control actual={p.actual} paginas={p.paginas} total={vistas.length} tam={tam} nombre={nombre} onChange={p.setPagina} />;
  const barra = buscar && filas.length > MIN_BUSCAR && (
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
        <span className="text-[13px] tabular-nums text-mute" aria-live="polite">
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
            <span className="text-[13px] tabular-nums text-mute" aria-live="polite">
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
