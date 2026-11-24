"use client";

/**
 * Lo que pagó el Estado por lo mismo (`precios_internos` del agente, plan 2026-11-04): por ítem, su precio unitario
 * contra los percentiles 25, 50 y 75 de lo adjudicado por el mismo código CUBSO y la misma unidad en todo el Estado.
 * Es la comparación más fuerte porque es el mismo bien; va antes del mercado retail.
 *
 * Pedido del usuario del 2026-11-16: un precio 28 % sobre la mediana salía con un «En rango» a secas, sin decir de qué
 * rango se hablaba. El veredicto es del agente y NO se toca (`veredicto`: en_rango = no pasa del percentil 75). Lo que
 * cambia es cómo se presenta: la diferencia con la mediana va como cifra, en soles y en porcentaje; el rango se dibuja
 * (percentil 25, mediana, percentil 75 y dónde cae este precio) y el rótulo dice qué rango es y qué no afirma.
 */

import { useState } from "react";
import { Landmark, Scale } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { numero, plural, porcentaje } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { montoDossier } from "../dossier";
import { cantidadYUnidad } from "@/lib/unidad";

/** Qué dice cada veredicto del agente, con el rango del que habla. El veredicto no se recalcula aquí. */
const VEREDICTO: Record<string, { texto: string; clase: string; explica: (r: Ref) => string }> = {
  muy_por_encima: {
    texto: "Muy por encima del rango",
    clase: "border-crimson/30 bg-crimson-soft text-crimsonTexto",
    explica: (r) => `Pasa con holgura del percentil 75 (${montoDossier(r.p75)}): tres de cada cuatro compras del Estado costaron eso o menos.`,
  },
  por_encima: {
    texto: "Por encima del rango",
    clase: "border-amber/30 bg-amber-soft text-amberTexto",
    explica: (r) => `Pasa del percentil 75 (${montoDossier(r.p75)}): tres de cada cuatro compras del Estado costaron eso o menos.`,
  },
  en_rango: {
    texto: "Dentro del rango del Estado",
    clase: "border-line bg-paperDeep text-ink",
    explica: (r) =>
      `«En rango» quiere decir que no pasa del percentil 75 (${montoDossier(r.p75)}): tres de cada cuatro compras del Estado costaron eso o menos. No dice que sea el precio típico: ese es la mediana.`,
  },
  por_debajo: {
    texto: "Por debajo del rango",
    clase: "border-line bg-paperDeep text-ink",
    explica: (r) => `Está bajo el percentil 25 (${montoDossier(r.p25)}): tres de cada cuatro compras del Estado costaron más.`,
  },
  sin_dato: { texto: "Sin referencia del Estado", clase: "border-line bg-paperDeep text-mute", explica: () => "" },
};

interface Ref {
  p25: number;
  p75: number;
  mediana: number;
  precios: number;
  entidades: number;
  anio: number | string | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function referenciaDe(x: any): Ref | null {
  const r = x?.referencia;
  const mediana = num(r?.mediana);
  const p25 = num(r?.p25);
  const p75 = num(r?.p75);
  if (!r || mediana === null || p25 === null || p75 === null) return null;
  return { p25, p75, mediana, precios: num(r.precios) ?? 0, entidades: num(r.entidades) ?? 0, anio: r.anio ?? null };
}

/** El color de la banda del rango: la primera serie de la paleta de gráficos (globals.css), a media tinta. */
const BANDA = "rgb(var(--serie-1) / 0.45)";

/** Los ítems que se ven de entrada; el resto, con «Ver los N ítems». */
const VISIBLES = 4;

export function PreciosDelEstado({ datos }: { datos: any }) {
  const items: any[] = datos?.items ?? [];
  const [todos, setTodos] = useState(false);
  if (!items.length) return null;
  const conRef = items.filter((x) => referenciaDe(x));
  const vistos = todos ? items : items.slice(0, VISIBLES);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper">
      <div className="border-b border-line bg-paperSoft px-5 py-3">
        <h2 className="flex items-center gap-2 font-display text-seccion font-bold text-ink">
          <Landmark size={16} className="text-mute" aria-hidden /> Lo que pagó el Estado por lo mismo
          <Ayuda titulo="¿Cómo se compara?">
            Se toma el precio por unidad de cada ítem y se pone al lado de lo que otras entidades adjudicaron por el mismo código de bien (CUBSO) y la
            misma unidad. Con cinco precios o más de tres entidades o más se calculan tres marcas: el percentil 25 (una de cada cuatro compras costó
            eso o menos), la mediana (la mitad costó eso o menos) y el percentil 75 (tres de cada cuatro).
          </Ayuda>
        </h2>
        <p className="mt-0.5 text-rotulo text-mute">
          {numero(conRef.length)} de {plural(items.length, "ítem", "ítems")} con referencia: el mismo código CUBSO y la misma unidad, adjudicados por otras entidades.
        </p>
      </div>
      <ul className="divide-y divide-line">
        {vistos.map((x, i) => (
          <li key={i} className="px-5 py-4">
            <ItemEstado x={x} />
          </li>
        ))}
      </ul>
      {items.length > VISIBLES && (
        <div className="border-t border-line px-5 py-2.5">
          <button type="button" onClick={() => setTodos((v) => !v)} aria-expanded={todos} className="inline-flex min-h-9 items-center text-meta font-semibold text-granate hover:underline">
            {todos ? "Ver menos" : `Ver los ${numero(items.length)} ítems`}
          </button>
        </div>
      )}
    </section>
  );
}

/** Un ítem: qué es, las tres cifras (aquí, la mediana, la diferencia), el rango dibujado y el veredicto con su explicación. */
function ItemEstado({ x }: { x: any }) {
  const r = referenciaDe(x);
  const precio = num(x.precio_unitario);
  const v = VEREDICTO[r ? x.veredicto : "sin_dato"] ?? VEREDICTO.sin_dato;
  // La diferencia es la que calculó el agente; los soles, la resta de las dos cifras que se muestran.
  const dif = num(x.diferencia_vs_mediana_pct);
  const enSoles = r && precio !== null ? precio - r.mediana : null;
  const tonoDif = dif === null ? "text-ink" : dif >= 50 ? "text-crimsonTexto" : dif >= 20 ? "text-amberTexto" : "text-ink";
  const enElTope = !!r && precio !== null && x.veredicto === "en_rango" && precio >= r.p75 * 0.999;
  return (
    <div className="space-y-3">
      <div>
        <p className="text-dato font-semibold leading-snug text-ink">{x.descripcion || `Ítem ${x.item}`}</p>
        <p className="mt-0.5 text-rotulo text-mute">
          Ítem {x.item}
          {x.cantidad ? `, ${cantidadYUnidad(Number(x.cantidad), x.unidad, { minusculas: true })}` : x.unidad ? `, ${String(x.unidad).toLowerCase()}` : ""}
        </p>
      </div>

      <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        <div className="bg-paper px-3.5 py-2.5">
          <dt className="text-rotulo text-mute">Aquí, por unidad</dt>
          <dd className="font-display text-bloque font-bold tabular-nums leading-tight text-ink">{precio !== null ? montoDossier(precio) : "Sin dato"}</dd>
          {x.origen_precio && <dd className="text-rotulo text-mute">precio {String(x.origen_precio).replace(/_/g, " ")}</dd>}
        </div>
        <div className="bg-paper px-3.5 py-2.5">
          <dt className="text-rotulo text-mute">Mediana del Estado</dt>
          <dd className="font-display text-bloque font-bold tabular-nums leading-tight text-ink">{r ? montoDossier(r.mediana) : "Sin referencia"}</dd>
          <dd className="text-rotulo text-mute">
            {r ? `${plural(r.precios, "precio", "precios")} de ${plural(r.entidades, "entidad", "entidades")}${r.anio ? `, ${r.anio}` : ""}` : "menos de 5 precios o de 3 entidades"}
          </dd>
        </div>
        <div className="bg-paper px-3.5 py-2.5">
          <dt className="text-rotulo text-mute">Diferencia con la mediana</dt>
          <dd className={cn("font-display text-bloque font-bold tabular-nums leading-tight", tonoDif)}>
            {dif === null ? "Sin dato" : `${dif > 0 ? "+" : dif < 0 ? "−" : ""}${porcentaje(Math.abs(dif), { decimales: Math.abs(dif) < 10 ? 1 : 0 })}`}
          </dd>
          {enSoles !== null && Math.abs(enSoles) >= 1 && (
            <dd className="text-rotulo text-mute">
              {montoDossier(Math.abs(enSoles))} {enSoles > 0 ? "más" : "menos"} por unidad
            </dd>
          )}
        </div>
      </dl>

      {r && precio !== null && <RangoEstado r={r} precio={precio} />}

      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <span className={cn("pill shrink-0 font-semibold", v.clase)}>
          <Scale size={11} aria-hidden />
          {v.texto}
        </span>
        {r && (
          <p className="min-w-0 flex-1 basis-64 text-meta leading-snug text-inkSoft">
            {v.explica(r)}
            {enElTope && " Aquí el precio cae justo en ese tope."}
            {dif !== null && dif >= 10 && x.veredicto === "en_rango" && (
              <>
                {" "}
                <strong className="font-semibold text-ink">
                  Frente a la mediana, cuesta {porcentaje(dif, { decimales: 0 })} más
                </strong>
                : es un dato para revisar, no una prueba de sobreprecio (otra marca, capacidad o garantía pueden explicarlo).
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * El rango del Estado dibujado: la banda entre el percentil 25 y el 75, la marca de la mediana y dónde cae el precio de
 * este contrato. La escala va del menor al mayor de los cuatro valores, con un margen, para que nada quede en el borde.
 */
function RangoEstado({ r, precio }: { r: Ref; precio: number }) {
  const min = Math.min(r.p25, precio);
  const max = Math.max(r.p75, precio);
  const margen = Math.max((max - min) * 0.12, max * 0.02);
  const lo = Math.max(0, min - margen);
  const hi = max + margen;
  const pos = (v: number) => `${Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100))}%`;
  const fuera = precio > r.p75 * 1.001 || precio < r.p25 * 0.999;
  return (
    <figure
      role="img"
      aria-label={`El rango de lo que pagó el Estado va de ${montoDossier(r.p25)} (percentil 25) a ${montoDossier(r.p75)} (percentil 75), con mediana de ${montoDossier(r.mediana)}. Este contrato: ${montoDossier(precio)}.`}
      className="rounded-xl border border-line px-3.5 pb-2.5 pt-3"
    >
      <div className="relative h-9">
        {/* La pista y la banda del percentil 25 al 75. */}
        <span className="absolute inset-x-0 top-3 h-2.5 rounded-full bg-paperDeep" />
        <span className="absolute top-3 h-2.5 rounded-full" style={{ left: pos(r.p25), width: `calc(${pos(r.p75)} - ${pos(r.p25)})`, background: BANDA }} />
        {/* La mediana. */}
        <span className="absolute top-1.5 h-5 w-0.5 -translate-x-1/2 bg-ink" style={{ left: pos(r.mediana) }} />
        {/* Este contrato. */}
        <span
          className={cn("absolute top-1 size-6 -translate-x-1/2 rounded-full border-2 border-paper", fuera ? "bg-crimson" : "bg-granate")}
          style={{ left: pos(precio) }}
        />
      </div>
      <figcaption className="mt-1 grid gap-x-4 gap-y-1 text-rotulo text-inkSoft sm:grid-cols-4">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 shrink-0 rounded-full" style={{ background: BANDA }} aria-hidden />
          <span>
            Percentil 25: <span className="font-mono tabular-nums text-ink">{montoDossier(r.p25)}</span>
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3.5 w-0.5 shrink-0 bg-ink" aria-hidden />
          <span>
            Mediana: <span className="font-mono tabular-nums text-ink">{montoDossier(r.mediana)}</span>
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 shrink-0 rounded-full" style={{ background: BANDA }} aria-hidden />
          <span>
            Percentil 75: <span className="font-mono tabular-nums text-ink">{montoDossier(r.p75)}</span>
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className={cn("size-3 shrink-0 rounded-full", fuera ? "bg-crimson" : "bg-granate")} aria-hidden />
          <span>
            Este contrato: <span className="font-mono font-semibold tabular-nums text-ink">{montoDossier(precio)}</span>
          </span>
        </span>
      </figcaption>
    </figure>
  );
}
