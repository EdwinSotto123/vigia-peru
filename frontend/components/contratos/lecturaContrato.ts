/**
 * Lo que la lectura de un contrato encontró, contado UNA vez para toda la página (cabecera, ficha, dictamen y lectura en
 * vivo). Antes cada vista contaba a su manera y el mismo contrato decía «5 señales» en la ficha, «4» en el dictamen y
 * «2 señales, 3 de agentes» en las reglas evaluadas; el puntaje, «100» en el medidor y «105» en otra parte.
 *
 * La fuente es el informe (GET /alertas/:id/full): sus señales llegan con `puntua` y con el mercado que sostiene o no
 * un sobreprecio, y `separarBanderas` aparta los hechos de contexto y lo no verificable. La ficha (GET /contratos/:ocid)
 * no manda `puntua`, así que sus señales se filtran contra las del informe (`senalesQueCuentan`). Sin informe (la API
 * no respondió), se cuenta lo que trae la ficha.
 *
 * Sin nada de cliente: lo llama la página en el servidor.
 */

import type { ContratoDetalle } from "@/lib/contratos";
import type { ProcesamientoDetalle } from "@/lib/auditoria";
import {
  contarSeveridades, estadoCorrida, nivelDelDossier, puntajeVisible, senalesQueCuentan, separarBanderas, severidadDe,
  type ConteoSeveridad, type EstadoCorrida, type NivelDossier, type SeveridadSenal,
} from "@/components/convocatoria/dossier";
import type { ApiResult } from "@/components/convocatoria/types";

export interface SenalContrato {
  regla: string;
  severidad: SeveridadSenal;
  norma: string | null;
}

export interface LecturaContrato {
  /** Las señales que cuentan, en el orden del informe. */
  senales: SenalContrato[];
  conteo: ConteoSeveridad;
  /** Con tope de 100 y sólo con señales (§10.4: el puntaje nunca va sin las señales que lo explican). */
  puntaje: number | null;
  nivel: NivelDossier;
  /** Hechos de contexto que el informe muestra aparte y no suman (para decirlo, no para contarlos). */
  contexto: number;
  analizadoEn: string | null;
}

/** La corrida cuando no hay informe: se da por terminada (la ficha sólo trae alertas publicadas). */
const CORRIDA_SIN_INFORME: EstadoCorrida = {
  agentes: [], nombres: [], total: 0, hayTraza: false, corrioCumplimiento: true, corrioDictamen: true, guardoSenales: true, completa: true, faltan: [],
};

const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** La lectura del contrato, o null si no se leyó o está en revisión humana (ahí no se cuenta nada, §10.4). */
export function lecturaDelContrato(c: ContratoDetalle, informe: ApiResult | null): LecturaContrato | null {
  const a = c.alerta;
  if (!a || a.estado === "revision") return null;
  if (informe) {
    const { visibles, contexto } = separarBanderas(informe);
    const conteo = contarSeveridades(visibles);
    const corrida = estadoCorrida(informe);
    const score = (informe.compliance as { score?: unknown } | undefined)?.score;
    const puntaje = visibles.length > 0 ? puntajeVisible(typeof score === "number" ? score : a.score) : null;
    return {
      senales: visibles.map((b) => ({ regla: String(b.regla || "sin_regla"), severidad: severidadDe(b), norma: texto(b.norma) })),
      conteo,
      puntaje,
      nivel: nivelDelDossier(puntaje, visibles.length, corrida),
      contexto: contexto.length,
      analizadoEn: a.analizadoEn ?? (informe._bridge_meta?.analizado_en as string | undefined) ?? null,
    };
  }
  const senales = a.banderas ?? [];
  const conteo = contarSeveridades(senales);
  const puntaje = senales.length > 0 ? puntajeVisible(a.score) : null;
  return {
    senales: senales.map((s) => ({ regla: s.regla, severidad: severidadDe(s), norma: texto(s.norma) })),
    conteo,
    puntaje,
    nivel: nivelDelDossier(puntaje, senales.length, CORRIDA_SIN_INFORME),
    contexto: 0,
    analizadoEn: a.analizadoEn ?? null,
  };
}

/**
 * La ficha con las señales que cuentan y el puntaje con tope: así la pestaña «Dónde dice cada señal», el estado de la
 * lectura y la lectura en vivo cuentan lo mismo que la cabecera.
 */
export function fichaConSenalesQueCuentan(c: ContratoDetalle, informe: ApiResult | null): ContratoDetalle {
  if (!c.alerta) return c;
  const banderas = informe ? senalesQueCuentan(c.alerta.banderas ?? [], separarBanderas(informe).visibles) : c.alerta.banderas ?? [];
  const score = c.alerta.score == null ? null : puntajeVisible(c.alerta.score);
  return { ...c, alerta: { ...c.alerta, banderas, score } };
}

/** Lo mismo para la lectura en vivo: su resultado trae las señales de la ficha (con los hechos de contexto). */
export function procesamientoConSenalesQueCuentan(p: ProcesamientoDetalle, informe: ApiResult | null): ProcesamientoDetalle {
  const r = p.resultado;
  if (!r || !informe) return { ...p, score: p.score == null ? p.score : puntajeVisible(p.score) };
  const banderas = senalesQueCuentan(r.banderas ?? [], separarBanderas(informe).visibles);
  return {
    ...p,
    score: p.score == null ? p.score : puntajeVisible(p.score),
    banderas: banderas.length,
    resultado: { ...r, banderas, score: r.score == null ? null : puntajeVisible(r.score) },
  };
}
