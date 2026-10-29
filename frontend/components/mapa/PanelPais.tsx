"use client";

import { useId, useState } from "react";
import { MapPin } from "lucide-react";
import { Buscador } from "@/components/listado/BarraFiltros";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { coincide, numero, paraBuscar } from "@/lib/formato";
import { cn } from "@/lib/utils";

/** Un departamento del ranking del país: lo que pinta el mapa y lo que se leyó. */
export interface FilaPais {
  ubigeo: string;
  nombre: string;
  /** Lo que ordena y fija el largo de la barra (la medida del mapa). */
  valor: number;
  /** Ese valor, ya formateado ("S/ 5.9 mil M"). */
  texto: string;
  total: number;
  leidos: number;
  conSenales: number;
}

const FILAS_INICIALES = 12;

/**
 * «Todo el Perú»: sin región abierta, las cifras del país en la cabecera y los departamentos ordenados por lo que
 * pinta el mapa. Es otra puerta al mismo mapa (un toque abre la región) y su alternativa accesible (§13).
 *
 * `variante="panel"`: el panel al costado del lienzo, en escritorio (alto fijo, con scroll propio).
 * `variante="bloque"`: debajo del mapa, en el celular, donde antes no había lista de departamentos (el panel era
 * `hidden lg:block`).
 *
 * Las cifras van aquí y no en una fila encima del mapa: esa fila empujaba el lienzo fuera de la primera pantalla.
 */
export function PanelPais({
  ranking,
  medidaTitulo,
  cifras,
  onElegir,
  variante = "panel",
}: {
  /** Los departamentos ya ordenados por lo que pinta el mapa; `null` = cargando. */
  ranking: FilaPais[] | null;
  /** Qué mide el ranking (lo que pinta el mapa), en palabras. */
  medidaTitulo: string;
  /** Las cifras del país (o de lo filtrado), ya armadas. */
  cifras: Cifra[];
  onElegir: (ubigeo: string) => void;
  variante?: "panel" | "bloque";
}) {
  const id = useId();
  const [todas, setTodas] = useState(false);
  const [consulta, setConsulta] = useState("");
  const max = Math.max(1, ...(ranking ?? []).map((f) => f.valor));
  const q = paraBuscar(consulta);
  // Con búsqueda, todas las que coinciden (el puesto sigue siendo el del ranking entero).
  const conPuesto = (ranking ?? []).map((f, i) => ({ f, puesto: i + 1 }));
  const filas = q ? conPuesto.filter((x) => coincide(paraBuscar(x.f.nombre), q)) : todas ? conPuesto : conPuesto.slice(0, FILAS_INICIALES);

  return (
    <section
      aria-labelledby={`${id}-t`}
      // `tarjeta`: adentro, las cifras van como placas sin borde (nunca una caja con borde dentro de otra).
      className={cn(
        "tarjeta",
        variante === "panel" ? "flex h-full flex-col overflow-y-auto bg-paper px-5 py-4" : "rounded-2xl border border-line bg-paper p-4 sm:p-5",
      )}
    >
      {/* El h2 un escalón sobre el h3 del ranking (los dos iban a 18 px y el panel se leía todo al mismo nivel). */}
      <h2 id={`${id}-t`} className="flex items-center gap-2 font-display text-seccion font-bold leading-tight text-ink">
        <MapPin size={20} className="shrink-0 text-granate" aria-hidden />
        Todo el Perú
      </h2>
      {cifras.length > 0 && (
        <div className="mt-3" aria-live="polite">
          <CifrasEnFila items={cifras} apilado chico />
        </div>
      )}
      {/* El ranking con su título (antes una oración gris hacía de título) y, aparte, cómo se usa. */}
      <h3 id={`${id}-r`} className="mt-5 font-display text-bloque font-bold leading-tight text-ink">
        {medidaTitulo ? `Departamentos por ${medidaTitulo.toLowerCase()}` : "Departamentos"}
      </h3>
      <p className="mt-0.5 text-meta leading-snug text-mute">Toca uno aquí o en el mapa.</p>
      {ranking === null ? (
        <div className="mt-3 space-y-2" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-paperDeep" />
          ))}
        </div>
      ) : (
        <>
          <div className="mt-3">
            <Buscador placeholder="Buscar un departamento…" etiqueta="Buscar un departamento" valor={consulta} onBuscar={setConsulta} />
          </div>
          {q && filas.length === 0 && <p className="mt-2 text-meta text-mute">Ningún departamento coincide con “{consulta}”.</p>}
          <ol aria-labelledby={`${id}-r`} className="mt-3 divide-y divide-line border-y border-line">
            {filas.map(({ f, puesto }) => (
              <li key={f.ubigeo}>
                <button
                  type="button"
                  onClick={() => onElegir(f.ubigeo)}
                  className="group flex min-h-11 w-full items-center gap-2.5 py-2 text-left transition-colors duration-rapido hover:bg-granate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-granate"
                >
                  <span aria-hidden className="w-5 shrink-0 text-right font-mono text-rotulo tabular-nums text-mute">{puesto}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-dato font-semibold text-ink group-hover:text-granate">{f.nombre}</span>
                      <span className="shrink-0 font-mono text-meta font-semibold tabular-nums text-ink">{f.texto}</span>
                    </span>
                    <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-paperDeep">
                      <span className="block h-full rounded-full bg-granate" style={{ width: `${Math.max(2, (f.valor / max) * 100)}%` }} />
                    </span>
                    <span className="mt-0.5 block text-rotulo text-mute">
                      {numero(f.leidos)} leídos de {numero(f.total)}
                      {f.conSenales > 0 ? `, ${numero(f.conSenales)} de riesgo medio o alto` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {!q && ranking.length > FILAS_INICIALES && (
            <button
              type="button"
              onClick={() => setTodas((v) => !v)}
              aria-expanded={todas}
              className="mt-2 inline-flex min-h-10 items-center self-start text-meta font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-granate"
            >
              {todas ? "Ver menos" : `Ver los ${numero(ranking.length)}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
