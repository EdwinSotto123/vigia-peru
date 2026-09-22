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
import type { FasesMap } from "@/lib/auditoria";
import { AuditoriaDeAgentes } from "@/components/agentes/AuditoriaDeAgentes";
import { claveDePaso } from "@/components/agentes/catalogo";
import type { SenalAgente, Severidad } from "@/components/agentes/senales";
import type { Bandera } from "../types";
import { inferAgente } from "../utils";

/** El payload del buscador es JSON suelto: el cotejo puede venir plano o anidado, o no venir. */
type BanderaConCotejo = Bandera & {
  verificada?: boolean | null;
  verificacion?: { ok?: boolean | null } | null;
};

const sev = (v: unknown): Severidad => (v === "alta" || v === "media" ? v : "baja");
const txt = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function desdeBandera(b: Bandera): SenalAgente {
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
    severidad: sev(b.severidad),
    agente: claveDePaso(bruto),
    agenteBruto: bruto,
    verificada: cotejo,
    evidencia: txt(b.evidencia),
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
}: {
  banderas: Bandera[];
  reglas_evaluadas: number;
  /** Perfil del pipeline (bienes · servicios · obras · otros): destraba el catálogo de reglas. */
  perfil?: string | null;
  reglasDisparadas?: string[] | null;
  /** Ventanas reales por agente, si el análisis las trae: habilita el eje de tiempo. */
  fases?: FasesMap | null;
}) {
  const senales = useMemo(() => (banderas ?? []).map(desdeBandera), [banderas]);
  return (
    <AuditoriaDeAgentes
      senales={senales}
      fases={fases}
      perfil={perfil}
      reglasDisparadas={reglasDisparadas}
      reglasEvaluadas={reglas_evaluadas}
      nota="Señales de riesgo, no acusaciones: cada una se publica con su norma y su fuente para que se pueda comprobar."
    />
  );
}
