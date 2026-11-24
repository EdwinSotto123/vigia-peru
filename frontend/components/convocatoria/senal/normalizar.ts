/**
 * La `Bandera` del dictamen (JSON suelto de la API) → la señal normalizada (`SenalAgente`) que pintan la tabla de señales,
 * la lista de «Por qué llama la atención» y el panel lateral de cada una. Antes vivía dentro de BanderasAgrupadas y sólo
 * la tabla la usaba: las señales del relato no podían abrir el mismo panel.
 */

import { claveDePaso } from "@/components/agentes/catalogo";
import type { EmpresaDeSenal, SenalAgente, Severidad } from "@/components/agentes/senales";
import { txt } from "@/lib/utils";
import { severidadDe } from "../dossier";
import { evidenciaComoTexto } from "../evidenciaTexto";
import type { Bandera } from "../types";
import { inferAgente } from "../utils";

/** El payload es JSON suelto: el cotejo puede venir plano o anidado, o no venir. */
type BanderaConCotejo = Bandera & {
  verificada?: boolean | null;
  verificacion?: { ok?: boolean | null } | null;
};

const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Las otras empresas que la regla guardó en la señal (`detalle: [{ otras_empresas: [{ ruc, nombre, papel, procesos, monto,
 * misma_entidad }] }]`, en los análisis desde el 2026-11-16). Sólo empresas: un RUC que no empieza en 20 se descarta (un
 * RUC 10 lleva el DNI de una persona). Sin el campo (análisis anteriores), lista vacía.
 */
function otrasEmpresasDe(b: Bandera): EmpresaDeSenal[] {
  const detalle = (b as { detalle?: unknown }).detalle;
  const bloques = Array.isArray(detalle) ? detalle : detalle && typeof detalle === "object" ? [detalle] : [];
  const out: EmpresaDeSenal[] = [];
  for (const bloque of bloques) {
    const lista = (bloque as { otras_empresas?: unknown })?.otras_empresas;
    if (!Array.isArray(lista)) continue;
    for (const e of lista) {
      if (!e || typeof e !== "object") continue;
      const o = e as Record<string, unknown>;
      const ruc = txt(o.ruc);
      if (ruc && !/^20\d{9}$/.test(ruc)) continue;
      if (ruc && out.some((x) => x.ruc === ruc)) continue;
      out.push({
        ruc,
        nombre: txt(o.nombre),
        papel: txt(o.papel),
        procesos: numero(o.procesos),
        monto: numero(o.monto),
        mismaEntidad: typeof o.misma_entidad === "boolean" ? o.misma_entidad : null,
      });
    }
  }
  return out;
}

export function senalDeBandera(b: Bandera): SenalAgente {
  const raw = b as BanderaConCotejo;
  const inferido = inferAgente(b);
  const bruto = txt(b.agente_origen) ?? (inferido && inferido !== "?" ? inferido : null);
  const cotejo =
    typeof raw.verificada === "boolean" ? raw.verificada : typeof raw.verificacion?.ok === "boolean" ? raw.verificacion.ok : null;
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
    // En la señal o, desde el 2026-11-24, dentro de su `verificacion` (la tabla de banderas no tiene la columna).
    ganadorRuc: txt((b as { ganador_ruc?: unknown }).ganador_ruc) ?? txt((b as { verificacion?: { ganador_ruc?: unknown } }).verificacion?.ganador_ruc),
    otrasEmpresas: otrasEmpresasDe(b),
  };
}
