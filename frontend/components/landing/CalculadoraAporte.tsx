"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Lo que cuesta leer un contrato, y lo que alcanza un aporte.
 *
 * Todo sale de la tarifa pública del API (`/financiamiento/estado`): el precio
 * por contrato y su desglose. Si el desglose no llega, la barra no se dibuja;
 * no se reparte el precio "a ojo".
 *
 * Es una cuenta, no un formulario de pago: mover la barra no compromete a
 * nada, y el botón lleva a la página donde se financia de verdad.
 */

export interface ParteTarifa {
  monto: number;
  concepto: string;
}

const PRESETS = [1, 10, 50, 100];
const TONOS = ["bg-heroGreen", "bg-heroViolet", "bg-paper/60"];

const soles = (v: number) => `S/ ${v.toLocaleString("es-PE", { maximumFractionDigits: 2 })}`;

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
    <div className="rounded-3xl border border-paper/15 bg-paper/[0.05] p-6 sm:p-8">
      <h3 className="font-serif text-2xl font-bold">¿Cuánto cuesta leer un contrato?</h3>
      <p className="mt-2 font-serif text-6xl font-bold leading-none text-heroGreen">{soles(precio)}</p>

      {desgloseValido && (
        <div className="mt-5">
          <div className="flex h-2.5 overflow-hidden rounded-full" aria-hidden>
            {partes.map((p, i) => (
              <span key={p.concepto} className={TONOS[i % TONOS.length]} style={{ width: `${(p.monto / precio) * 100}%` }} />
            ))}
          </div>
          <ul className="mt-3 grid gap-1.5 text-[14px] text-paper/75 sm:grid-cols-3 sm:gap-4">
            {partes.map((p, i) => (
              <li key={p.concepto} className="flex items-start gap-2">
                <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONOS[i % TONOS.length]}`} />
                <span>
                  <span className="font-semibold tabular-nums text-paper">{soles(p.monto)}</span> {p.concepto}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 border-t border-paper/10 pt-6">
        <label htmlFor={id} className="text-[14px] font-medium text-paper/80">
          ¿Cuántos contratos quieres que se lean?
        </label>
        <div className="mt-3 flex items-baseline justify-between gap-4">
          <output htmlFor={id} className="font-mono text-4xl font-bold leading-none">
            {contratos.toLocaleString("es-PE")}
          </output>
          <span className="text-right text-[15px] text-paper/75">
            por <span className="text-2xl font-bold tabular-nums text-paper">{soles(contratos * precio)}</span>
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
          className="mt-4 w-full accent-heroGreen"
        />
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Cantidades rápidas">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setContratos(p)}
              aria-pressed={contratos === p}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-rapido ${
                contratos === p ? "border-heroGreen bg-heroGreen text-ink" : "border-paper/20 text-paper hover:bg-paper/10"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {enCola > 0 && (
        <p className="mt-6 text-[14px] leading-relaxed text-paper/75">
          Hoy hay <span className="font-mono font-semibold text-paper">{enCola.toLocaleString("es-PE")}</span> contratos
          en cola{regionesConCola > 0 ? `, en ${regionesConCola} regiones,` : ""} esperando que alguien financie su
          lectura.
        </p>
      )}

      <Link
        href="/app/financiar"
        className="group mt-6 inline-flex items-center gap-2 rounded-full bg-heroGreen px-6 py-3.5 text-[15px] font-semibold text-ink shadow-card transition-transform duration-rapido hover:-translate-y-0.5 active:translate-y-0"
      >
        Financiar una auditoría
        <ArrowRight size={16} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </div>
  );
}
