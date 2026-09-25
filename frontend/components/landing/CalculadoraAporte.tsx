"use client";

import { useId, useState } from "react";
import { numero, soles } from "@/lib/formato";
import { EnlaceAccion } from "./EnlaceAccion";

/**
 * Lo que cuesta leer un contrato, y lo que alcanza un aporte, en una sola placa a lo
 * ancho: a la izquierda el precio y en qué se va; a la derecha cuántos, cuánto y el botón.
 * Antes eran diez bloques apilados (precio, barra, leyenda, raya, pregunta, cifra,
 * deslizador, atajos, una oración sobre la cola, botón); ahora se lee de izquierda a
 * derecha y la cola es una pastilla con su número.
 *
 * Todo sale de la tarifa pública del API (`/financiamiento/estado`): el precio por
 * contrato y su desglose. Si el desglose no llega, la barra no se dibuja; no se reparte
 * el precio "a ojo".
 *
 * Es una cuenta, no un formulario de pago: mover la barra no compromete a nada, y el
 * botón lleva a la página donde se financia de verdad.
 *
 * Placa de papel dentro de la sección oscura: es el único lugar de la sección donde se
 * actúa, y el desglose es una serie categórica en la paleta textil (§3.4), que sólo pasa
 * 3:1 sobre claro. El foco vuelve a granate por lo mismo.
 */

export interface ParteTarifa {
  monto: number;
  concepto: string;
}

const PRESETS = [1, 10, 50, 100];
/** Series categóricas, en el orden de DESIGN_SYSTEM.md §3.4. */
const TONOS = ["bg-textil-anil", "bg-textil-achiote", "bg-textil-verde", "bg-textil-ocre", "bg-granate", "bg-textil-tierra"];

export function CalculadoraAporte({
  precio,
  partes,
  enCola,
}: {
  precio: number;
  partes: ParteTarifa[];
  enCola: number;
}) {
  const [contratos, setContratos] = useState(10);
  const id = useId();
  const sumaPartes = partes.reduce((s, p) => s + p.monto, 0);
  const desgloseValido = partes.length > 0 && Math.abs(sumaPartes - precio) < 0.01;

  return (
    <div className="grid overflow-hidden rounded-2xl bg-paper text-ink shadow-dialog lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] [&_:focus-visible]:outline-granate">
      {/* El precio y en qué se va. */}
      <div className="border-b border-line bg-paperSoft p-6 sm:p-8 lg:border-b-0 lg:border-r">
        <h3 className="text-[15px] font-semibold text-inkSoft">Leer un contrato cuesta</h3>
        <p className="mt-1 font-display text-6xl font-extrabold leading-none tabular-nums text-granate sm:text-7xl">{soles(precio)}</p>
        {desgloseValido && (
          <>
            <div className="mt-5 flex h-2.5 gap-[2px] overflow-hidden rounded-full" aria-hidden>
              {partes.map((p, i) => (
                <span key={p.concepto} className={TONOS[i % TONOS.length]} style={{ width: `${(p.monto / precio) * 100}%` }} />
              ))}
            </div>
            <ul className="mt-3 space-y-1.5 text-[14px] text-inkSoft">
              {partes.map((p, i) => (
                <li key={p.concepto} className="flex items-center gap-2">
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${TONOS[i % TONOS.length]}`} />
                  <span className="font-semibold tabular-nums text-ink">{soles(p.monto)}</span>
                  <span className="min-w-0">{p.concepto}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* Cuántos, cuánto, y a financiar. */}
      <div className="p-6 sm:p-8">
        <label htmlFor={id} className="text-[15px] font-semibold text-inkSoft">
          ¿Cuántos quieres que se lean?
        </label>
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <output htmlFor={id} className="font-display text-5xl font-extrabold leading-none tabular-nums">
            {numero(contratos)}
            <span className="ml-2 font-sans text-base font-medium text-mute">{contratos === 1 ? "contrato" : "contratos"}</span>
          </output>
          <span className="font-display text-3xl font-bold tabular-nums text-granate">{soles(contratos * precio)}</span>
        </div>
        <input
          id={id}
          type="range"
          min={1}
          max={200}
          step={1}
          value={contratos}
          onChange={(e) => setContratos(Number(e.target.value))}
          aria-valuetext={`${contratos} contratos por ${soles(contratos * precio)}`}
          className="mt-4 h-6 w-full accent-granate"
        />
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Cantidades rápidas">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setContratos(p)}
              aria-pressed={contratos === p}
              className={`min-h-[36px] min-w-[44px] rounded-full border px-3.5 py-1.5 text-[13px] font-semibold tabular-nums transition-colors duration-rapido ${
                contratos === p
                  ? "border-granate bg-granate text-paper"
                  : "border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-3">
          <EnlaceAccion href="/app/financiar">Financiar una auditoría</EnlaceAccion>
          {enCola > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full bg-paperDeep px-3 py-1.5 text-[13px] text-inkSoft">
              <span aria-hidden className="h-2 w-2 rounded-full bg-amber" />
              <span>
                <span className="font-semibold tabular-nums text-ink">{numero(enCola)}</span> contratos esperan en cola
              </span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
