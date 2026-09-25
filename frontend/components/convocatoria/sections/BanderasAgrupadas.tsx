"use client";

/**
 * Las señales del análisis a demanda, mostradas como lo que son: el resultado de una auditoría
 * de agentes. Este archivo ya no dibuja nada por su cuenta — traduce la `Bandera` del payload
 * del buscador a la señal normalizada y delega en <AuditoriaDeAgentes>, que es la misma pieza
 * que usa el dossier. Antes había dos lecturas distintas del mismo hecho en dos páginas que el
 * usuario visita seguidas.
 *
 * Lo que cambió en la lectura, no solo en el dibujo:
 *  · el agente que produjo cada señal deja de ser un chip de color y pasa a ser el filtro;
 *  · las reglas que NO dispararon se muestran (antes solo se contaban: "25 reglas evaluadas");
 *  · el cotejo contra la fuente oficial se ve por señal, o se declara que no vino en el payload.
 */

import { useMemo } from "react";
import { CircleSlash } from "lucide-react";
import { reglaLabel } from "@/lib/auditoria";
import { redactDnis, type NombreConocido } from "../../Redact";
import { evidenciaComoTexto } from "./Evidencia";
import type { FasesMap } from "@/lib/auditoria";
import { AuditoriaDeAgentes } from "@/components/agentes/AuditoriaDeAgentes";
import { claveDePaso } from "@/components/agentes/catalogo";
import type { SenalAgente, Severidad } from "@/components/agentes/senales";
import type { Bandera } from "../types";
import { severidadDe } from "../dossier";
import { inferAgente } from "../utils";

/** El payload del buscador es JSON suelto: el cotejo puede venir plano o anidado, o no venir. */
type BanderaConCotejo = Bandera & {
  verificada?: boolean | null;
  verificacion?: { ok?: boolean | null } | null;
};

const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** La `Bandera` del payload → la señal normalizada (la usa también el resumen de arriba, ResumenHumano). */
export function desdeBandera(b: Bandera): SenalAgente {
  const raw = b as BanderaConCotejo;
  const inferido = inferAgente(b);
  const bruto = txt(b.agente_origen) ?? (inferido && inferido !== "?" ? inferido : null);
  const cotejo =
    typeof raw.verificada === "boolean"
      ? raw.verificada
      : typeof raw.verificacion?.ok === "boolean"
        ? raw.verificacion.ok
        : null;
  return {
    regla: txt(b.regla) ?? "sin_regla",
    // La misma lectura que la cabecera del dossier (../dossier): los conteos cuadran.
    severidad: severidadDe(b) as Severidad,
    agente: claveDePaso(bruto),
    agenteBruto: bruto,
    verificada: cotejo,
    // La evidencia puede venir como texto o como lista de citas: nunca se pierde.
    evidencia: txt(evidenciaComoTexto(b.evidencia)),
    evidenciaTextual: txt(b.evidencia_textual),
    norma: txt(b.norma),
    fuenteUrl: txt(b.fuente_url),
    item: txt(b.item_afectado),
    opinion: b.opinion_oece_relacionada?.num_opinion
      ? {
          num: txt(b.opinion_oece_relacionada.num_opinion),
          url: txt(b.opinion_oece_relacionada.url),
          snippet: txt(b.opinion_oece_relacionada.snippet),
        }
      : null,
    citas: [],
  };
}

export function BanderasAgrupadas({
  banderas,
  reglas_evaluadas,
  perfil,
  reglasDisparadas,
  fases,
  noVerificables = [],
  nombresPrivados,
}: {
  banderas: Bandera[];
  /** Solo si el análisis lo trae: no se supone un número. */
  reglas_evaluadas?: number | null;
  /** Perfil del pipeline (bienes · servicios · obras · otros): destraba el catálogo de reglas. */
  perfil?: string | null;
  reglasDisparadas?: string[] | null;
  /** Ventanas reales por agente, si el análisis las trae: habilita el eje de tiempo. */
  fases?: FasesMap | null;
  /**
   * Señales de sobreprecio de un dossier donde el agente de precios no pudo medir el
   * sobreprecio (`sobreprecio_pct` null): se muestran aparte, marcadas como no
   * verificables, y no cuentan en los totales.
   */
  noVerificables?: Bandera[];
  /** Personas privadas del dossier: su apellido va tapado también en la línea de cada señal. */
  nombresPrivados?: NombreConocido[];
}) {
  const senales = useMemo(() => (banderas ?? []).map(desdeBandera), [banderas]);
  return (
    <div className="space-y-3">
      {/* Sin `nota` al pie: "una señal no es una acusación" lo dice una sola vez el informe, al final. */}
      {senales.length > 0 && (
        <AuditoriaDeAgentes
          senales={senales}
          fases={fases}
          perfil={perfil}
          reglasDisparadas={reglasDisparadas}
          reglasEvaluadas={reglas_evaluadas ?? undefined}
          titulo="Las señales, una por una"
          carrilesPlegados
          nombresPrivados={nombresPrivados}
        />
      )}
      {noVerificables.length > 0 && (
        <details className="rounded-2xl border border-line bg-paperSoft px-4 py-3 text-[13px]">
          <summary className="flex min-h-[24px] cursor-pointer items-center gap-2 text-ink">
            <CircleSlash size={15} className="shrink-0 text-mute" aria-hidden />
            <strong className="font-semibold">
              {noVerificables.length} {noVerificables.length === 1 ? "señal de precio no verificable" : "señales de precio no verificables"}
            </strong>
            <span className="text-[12px] text-mute">fuera de los conteos</span>
          </summary>
          <p className="mt-2 text-[12px] leading-snug text-mute">
            El agente de precios no pudo medir el sobreprecio con fuentes suficientes: estas señales no se cuentan ni se usan
            en el resumen, y se dejan a la vista para revisarlas.
          </p>
          <ul className="mt-3 space-y-2 border-t border-line pt-3">
            {noVerificables.map((b, i) => (
              <li key={`${b.regla}-${i}`} className="text-[12px] leading-relaxed text-inkSoft">
                <span className="font-semibold text-ink">{reglaLabel(String(b.regla || "sobreprecio"))}</span>
                <span className="ml-1.5 rounded-full border border-line bg-paper px-1.5 py-0 text-[11px] text-inkSoft">no verificable</span>
                {evidenciaComoTexto(b.evidencia) && <p className="mt-0.5">{redactDnis(evidenciaComoTexto(b.evidencia))}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
