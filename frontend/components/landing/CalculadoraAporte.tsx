"use client";

import { useId, useState } from "react";
import { numero, soles } from "@/lib/formato";
import { EnlaceAccion } from "./EnlaceAccion";

/**
 * Lo que cuesta leer un contrato, y lo que alcanza un aporte.
 *
 * Todo sale de la tarifa pública del API (`/financiamiento/estado`): el precio
 * por contrato y su desglose. Si el desglose no llega, la barra no se dibuja;
 * no se reparte el precio "a ojo".
 *
 * Es una cuenta, no un formulario de pago: mover la barra no compromete a
 * nada, y el botón lleva a la página donde se financia de verdad.
 *
 * Es una placa de papel dentro de la sección oscura de aliados: es el único
 * lugar de la sección donde se actúa, y el desglose de la tarifa es una serie
 * categórica que se lee en la paleta textil (§3.4: añil, achiote, verde…), que
 * sólo pasa 3:1 sobre claro. El foco vuelve a granate por lo mismo.
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
  regionesConCola,
}: {
  precio: number;
  partes: ParteTarifa[];
  enCola: number;
  regionesConCola: number;
}) {
  const [contratos, setContratos] = useState(10);
  const id = useId();
  const sumaPartes = partes.reduce((s, p) => s + p.monto, 0);
  const desgloseValido = partes.length > 0 && Math.abs(sumaPartes - precio) < 0.01;

  return (
    <div className="rounded-2xl bg-paper p-6 text-ink shadow-dialog sm:p-8 [&_:focus-visible]:outline-granate">
      <h3 className="font-display text-2xl font-bold">¿Cuánto cuesta leer un contrato?</h3>
      <p className="mt-2 font-display text-6xl font-extrabold leading-none tabular-nums text-granate">
        {soles(precio)}
        <span className="ml-2 align-middle font-sans text-base font-medium text-mute">por contrato</span>
      </p>

      {desgloseValido && (
        <div className="mt-5">
          <div className="flex h-2.5 overflow-hidden rounded-full" aria-hidden>
            {partes.map((p, i) => (
              <span key={p.concepto} className={TONOS[i % TONOS.length]} style={{ width: `${(p.monto / precio) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-3 grid gap-1.5 text-[14px] text-inkSoft sm:grid-cols-3 sm:gap-4">
            {partes.map((p, i) => (
              <li key={p.concepto} className="flex items-start gap-2">
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONOS[i % TONOS.length]}`} />
                <span>
                  <span className="font-semibold tabular-nums text-ink">{soles(p.monto)}</span> {p.concepto}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 border-t border-line pt-6">
        <label htmlFor={id} className="text-[14px] font-medium text-inkSoft">
          ¿Cuántos contratos quieres que se lean?
        </label>
        <div className="mt-3 flex items-baseline justify-between gap-4">
          <output htmlFor={id} className="font-display text-4xl font-extrabold leading-none tabular-nums">
            {numero(contratos)}
          </output>
          <span className="text-right text-[15px] text-inkSoft">
            por <span className="text-2xl font-bold tabular-nums text-ink">{soles(contratos * precio)}</span>
          </span>
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
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Cantidades rápidas">
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
      </div>

      {enCola > 0 && (
        <p className="mt-6 text-[14px] leading-relaxed text-inkSoft">
          Hoy hay <span className="font-mono font-semibold text-ink">{numero(enCola)}</span> contratos en cola
          {regionesConCola > 0 ? `, en ${numero(regionesConCola)} regiones,` : ""} esperando que alguien financie su
          lectura.
        </p>
      )}

      <EnlaceAccion href="/app/financiar" className="mt-6">
        Financiar una auditoría
      </EnlaceAccion>
    </div>
  );
}
