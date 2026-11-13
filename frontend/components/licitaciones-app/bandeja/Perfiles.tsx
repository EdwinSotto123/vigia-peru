"use client";

import { useState } from "react";
import { BookmarkPlus, Check, X } from "lucide-react";
import useSWR from "swr";
import { useSesion } from "@/components/gobserva/cuenta/comun";
import { ErrorCuenta, borrarBusqueda, cargarBusquedas, crearBusqueda } from "@/lib/gobserva-cuenta";
import { filtrosActivos } from "@/lib/licitaciones-app/filtros";
import { useAvisos } from "@/components/gobserva/ui/Avisos";
import { useLista } from "@/lib/licitaciones-app/useListaUrl";
import { cn } from "@/lib/utils";
import { Desplegable } from "@/components/gobserva/ui/Desplegable";

/**
 * Las búsquedas guardadas (los «perfiles de búsqueda»): un clic las aplica, la que está puesta se marca, y cada una se
 * borra con su X (pide confirmar). «Guardar esta búsqueda» pide un nombre y lo valida. Se guardan en tu cuenta
 * (migración 266): te siguen a cualquier equipo.
 */
export function useBusquedas() {
  const { conCuenta } = useSesion();
  return useSWR(conCuenta ? ["gobserva-busquedas", "licitaciones"] : null, () => cargarBusquedas("licitaciones"), { revalidateOnFocus: false });
}

export function Perfiles() {
  const busquedas = useBusquedas();
  const perfiles = busquedas.data?.data ?? [];
  const limite = busquedas.data?.limite ?? 12;
  const avisar = useAvisos();
  const { query, aplicar, filtros } = useLista();
  const [borrando, setBorrando] = useState<number | null>(null);
  const actual = (q: string) => new URLSearchParams(q).toString() === query;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-meta font-semibold text-mute">Mis búsquedas</span>
      {perfiles.length === 0 && <span className="text-meta text-mute">Guarda una búsqueda para volver a ella con un clic.</span>}
      {perfiles.map((p) =>
        borrando === p.id ? (
          <span key={p.id} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-crimson/40 bg-crimson-soft pl-3 pr-1 text-meta text-crimsonTexto">
            ¿Borrar «{p.nombre}»?
            <button
              type="button"
              onClick={() => {
                setBorrando(null);
                const antes = busquedas.data;
                void busquedas.mutate(antes ? { ...antes, data: antes.data.filter((x) => x.id !== p.id) } : antes, { revalidate: false });
                borrarBusqueda(p.id)
                  .then(() => void busquedas.mutate())
                  .catch(() => {
                    void busquedas.mutate(antes, { revalidate: false });
                    avisar({ tono: "error", texto: "No pudimos borrarla. Vuelve a intentarlo." });
                  });
              }}
              className="rounded-full px-2 py-0.5 font-bold hover:bg-crimson/15"
            >
              Sí
            </button>
            <button type="button" onClick={() => setBorrando(null)} className="rounded-full px-2 py-0.5 font-semibold hover:bg-ink/[0.06]">
              No
            </button>
          </span>
        ) : (
          <span
            key={p.id}
            className={cn(
              "inline-flex min-h-8 items-center rounded-full border text-meta font-semibold transition-colors duration-rapido",
              actual(p.query) ? "border-granate bg-granate text-paper" : "border-line bg-caja text-ink hover:border-granate/40",
            )}
          >
            <button type="button" onClick={() => aplicar(p.query)} aria-pressed={actual(p.query)} className="flex min-h-8 items-center gap-1 rounded-l-full pl-3 pr-1">
              {actual(p.query) && <Check size={13} aria-hidden />}
              {p.nombre}
            </button>
            <button
              type="button"
              onClick={() => setBorrando(p.id)}
              aria-label={`Borrar la búsqueda «${p.nombre}»`}
              className={cn("grid h-8 w-7 place-items-center rounded-r-full", actual(p.query) ? "hover:bg-paper/15" : "text-mute hover:text-ink")}
            >
              <X size={13} aria-hidden />
            </button>
          </span>
        ),
      )}
      <Desplegable etiqueta="Guardar esta búsqueda" Icono={BookmarkPlus} ancho="sm:w-80">
        {(cerrar) => (
          <Guardar
            cerrar={cerrar}
            query={query}
            sinFiltros={filtrosActivos(filtros) === 0}
            lleno={perfiles.length >= limite}
            limite={limite}
            listo={(nombre) => {
              void busquedas.mutate();
              avisar({ tono: "ok", texto: `Guardaste «${nombre}»: la tienes en «Mis búsquedas» desde cualquier equipo.` });
            }}
          />
        )}
      </Desplegable>
    </div>
  );
}

function Guardar({ cerrar, query, sinFiltros, lleno, limite, listo }: { cerrar: () => void; query: string; sinFiltros: boolean; lleno: boolean; limite: number; listo: (nombre: string) => void }) {
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const n = nombre.trim();
        if (n.length < 2) return setError("Ponle un nombre de al menos 2 letras.");
        setEnviando(true);
        try {
          await crearBusqueda({ producto: "licitaciones", nombre: n, query });
          cerrar();
          listo(n);
        } catch (err) {
          setError(err instanceof ErrorCuenta ? err.message : "No pudimos guardarla. Vuelve a intentarlo.");
        } finally {
          setEnviando(false);
        }
      }}
    >
      <label htmlFor="perfil-nombre" className="mb-1 block text-meta font-semibold text-ink">
        Nombre de la búsqueda
      </label>
      <input
        id="perfil-nombre"
        value={nombre}
        onChange={(e) => {
          setNombre(e.target.value);
          setError(null);
        }}
        maxLength={60}
        placeholder="Tóner en Lima, obras de más de S/ 1 M"
        aria-invalid={!!error}
        aria-describedby={error ? "perfil-error" : "perfil-nota"}
        className="h-10 w-full rounded-lg border border-line bg-caja px-3 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 aria-[invalid=true]:border-crimson sm:text-dato"
      />
      {error ? (
        <p id="perfil-error" role="alert" className="mt-2 text-meta font-medium text-crimsonTexto">
          {error}
        </p>
      ) : (
        <p id="perfil-nota" className="mt-2 text-meta text-mute">
          {lleno
            ? `Ya tienes ${limite}: borra una para guardar esta.`
            : sinFiltros
              ? "No tiene filtros: guardarás la bandeja entera, con su orden."
              : "Guarda el texto, los filtros y el orden de ahora."}
        </p>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={cerrar} className="min-h-10 rounded-lg px-3 text-dato font-semibold text-inkSoft hover:bg-ink/[0.06]">
          Cancelar
        </button>
        <button type="submit" disabled={enviando} className="min-h-10 rounded-lg bg-granate px-4 text-dato font-semibold text-paper hover:bg-granate-deep disabled:opacity-70">
          Guardar
        </button>
      </div>
    </form>
  );
}
