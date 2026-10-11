"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useListado } from "@/components/listado";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

/**
 * La barra de filtros de las listas de /app/financiar por partido y por entidad, en UNA línea:
 *
 *   [buscar………………]  [región ▾]  [orden ▾]  [Quitar filtros]
 *
 * El estado vive en la URL (`?q=&region=&orden=`): se comparte y el botón atrás lo deshace. Todo cambio de
 * filtro vuelve a la página 1 (lo hace `Listado.navegar`). Las dos listas de la barra son selectores nativos:
 * teclado, lector de pantalla y móvil funcionan sin código extra.
 *
 * Props de datos planos: la arma un server component.
 */

export interface OpcionSelect {
  valor: string;
  etiqueta: string;
}

const CAMPO =
  "h-10 rounded-xl border border-line bg-paper px-3 text-[14px] text-ink transition-colors duration-rapido hover:border-paperEdge focus:border-granate";

/** Espera tras la última tecla antes de buscar: una búsqueda por letra pedía una página por letra. */
const ESPERA_MS = 400;

export function FiltrosFinanciar({
  placeholder,
  etiquetaBusqueda,
  regiones,
  ordenes,
  ordenPorDefecto,
}: {
  placeholder: string;
  etiquetaBusqueda: string;
  /** Las regiones elegibles (valor = ubigeo de 2 dígitos). Vacío: no hay selector. */
  regiones: OpcionSelect[];
  /** Si no hay, no hay selector de orden. */
  ordenes?: OpcionSelect[];
  ordenPorDefecto?: string;
}) {
  const { parametros, navegar, pendiente } = useListado();
  const qUrl = parametros.q ?? "";
  const region = parametros.region ?? "";
  const orden = parametros.orden ?? ordenPorDefecto ?? "";
  const [texto, setTexto] = useState(qUrl);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Si la URL cambia desde afuera (atrás, "Quitar filtros"), el campo la sigue.
  useEffect(() => setTexto(qUrl), [qUrl]);
  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);

  const buscar = (valor: string) => {
    const t = valor.trim();
    // Desde 2 letras; vaciar el campo sí quita la búsqueda.
    const nuevo = t.length >= 2 ? t : undefined;
    if ((nuevo ?? "") !== qUrl) navegar({ q: nuevo });
  };
  const alEscribir = (valor: string) => {
    setTexto(valor);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => buscar(valor), ESPERA_MS);
  };
  const hayFiltros = !!qUrl || !!region || (!!ordenes && !!parametros.orden && parametros.orden !== ordenPorDefecto);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (temporizador.current) clearTimeout(temporizador.current);
        buscar(texto);
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <label className="relative block min-w-[220px] flex-1">
        <span className="sr-only">{etiquetaBusqueda}</span>
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
        <input
          type="search"
          value={texto}
          onChange={(e) => alEscribir(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          enterKeyHint="search"
          className={cn(CAMPO, "w-full pl-9 pr-9")}
        />
        {texto && (
          <button
            type="button"
            onClick={() => {
              setTexto("");
              if (temporizador.current) clearTimeout(temporizador.current);
              buscar("");
            }}
            aria-label="Borrar la búsqueda"
            className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-mute hover:text-ink"
          >
            <X size={15} aria-hidden />
          </button>
        )}
      </label>

      {regiones.length > 0 && (
        <label className="block">
          <span className="sr-only">Región</span>
          <select
            value={region}
            onChange={(e) => navegar({ region: e.target.value || undefined })}
            className={cn(CAMPO, "w-full sm:w-auto", region && "border-granate/60 font-medium")}
          >
            <option value="">Todo el Perú</option>
            {regiones.map((r) => (
              <option key={r.valor} value={r.valor}>
                {r.etiqueta}
              </option>
            ))}
          </select>
        </label>
      )}

      {ordenes && ordenes.length > 0 && (
        <label className="block">
          <span className="sr-only">Ordenar por</span>
          <select
            value={orden}
            onChange={(e) => navegar({ orden: e.target.value === ordenPorDefecto ? undefined : e.target.value })}
            className={cn(CAMPO, "w-full sm:w-auto")}
          >
            {ordenes.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.etiqueta}
              </option>
            ))}
          </select>
        </label>
      )}

      {hayFiltros && (
        <button
          type="button"
          onClick={() => navegar({ q: undefined, region: undefined, orden: undefined })}
          className="inline-flex min-h-10 items-center gap-1 rounded-full px-3 text-[13.5px] font-semibold text-granate underline-offset-2 hover:underline"
        >
          Quitar filtros
        </button>
      )}
      {pendiente && <span role="status" className="sr-only">Actualizando resultados…</span>}
    </form>
  );
}

/**
 * Lo que va debajo de la barra: la lista, o mientras llega la página nueva un esqueleto con las MISMAS filas
 * (42 px cada una) para que la página no salte. Sin atenuar ni desenfocar nada: lo que se ve es nítido o no está.
 */
export function ResultadosConEspera({ children, filas = 12 }: { children: React.ReactNode; filas?: number }) {
  const { pendiente } = useListado();
  if (!pendiente) return <>{children}</>;
  return (
    <div role="status" aria-busy="true" className="overflow-hidden rounded-2xl border border-line bg-paper">
      <span className="sr-only">Actualizando resultados…</span>
      <div className="h-[34px] border-b border-line bg-paperSoft" aria-hidden />
      {Array.from({ length: Math.min(25, Math.max(3, filas)) }).map((_, i) => (
        <div key={i} className="flex h-[42px] items-center gap-4 border-b border-line/70 px-4 last:border-b-0" aria-hidden>
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="ml-auto h-3.5 w-16" />
          <Skeleton className="hidden h-3.5 w-16 sm:block" />
        </div>
      ))}
    </div>
  );
}
