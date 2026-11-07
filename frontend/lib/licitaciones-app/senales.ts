import type { Comprador, Senal } from "./tipos.ts";
import { diasHasta, instante, pct } from "./formato.ts";

/**
 * Las señales de riesgo de un proceso, desde cifras reales: el historial del comprador en los últimos 12 meses (CONOSCE:
 * postores y adjudicaciones) y lo que publicó el proceso. Son señales para decidir si postular, nunca acusaciones: cada
 * una dice el hecho y la cifra. Sólo se calculan con una base suficiente (5 procesos o más).
 *
 * Umbrales medidos sobre la muestra real (7 nov 2026): un solo postor es común en el Perú (mediana 38 % por comprador),
 * así que la señal empieza en 60 % (uno de cada cinco procesos) y es alta desde 80 %; adjudicar cerca del referencial
 * también (mediana 96 %), así que sólo se marca desde 99,5 %.
 */

const BASE_MINIMA = 5;

export interface DatosSenales {
  valor: number | null;
  publicada: string;
  consultasHasta: string | null;
  comprador: Comprador | null;
}

export function calcularSenales(d: DatosSenales): Senal[] {
  const s: Senal[] = [];
  const c = d.comprador;

  if (c && c.conPostores >= BASE_MINIMA) {
    const r = c.unSoloPostor / c.conPostores;
    if (r >= 0.6) {
      s.push({
        clave: "unico_postor",
        nivel: r >= 0.8 ? "alta" : "media",
        titulo: "Muchos procesos con un solo postor",
        evidencia: `En 12 meses, ${c.unSoloPostor} de los ${c.conPostores} procesos de este comprador con postores registrados tuvieron un solo postor (${pct(r)}).`,
      });
    }
  }

  const top = c?.proveedores[0];
  if (c && top && c.procesos >= BASE_MINIMA && c.monto > 0 && top.monto != null) {
    const r = top.monto / c.monto;
    if (r >= 0.5) {
      s.push({
        clave: "concentracion",
        nivel: r >= 0.75 ? "alta" : "media",
        titulo: "Un proveedor concentra lo adjudicado",
        evidencia: `${top.nombre ?? "Una empresa"} se llevó el ${pct(r)} de lo que adjudicó este comprador en 12 meses (${top.procesos} de sus ${c.procesos} procesos).`,
      });
    }
  }

  if (c && c.procesos >= BASE_MINIMA && c.adjSobreRef != null && c.adjSobreRef >= 0.995) {
    s.push({
      clave: "tope_referencial",
      nivel: "media",
      titulo: "Adjudica casi al valor referencial",
      evidencia: `En 12 meses, lo adjudicado por este comprador sumó el ${pct(c.adjSobreRef)} de los valores referenciales: casi no hay rebaja.`,
    });
  }

  if (d.valor == null) {
    s.push({
      clave: "sin_valor",
      nivel: "info",
      titulo: "Sin valor referencial publicado",
      evidencia: "La entidad no publicó el valor referencial en los datos abiertos: búscalo en las bases.",
    });
  }

  if (d.consultasHasta) {
    const dias = diasHasta(d.consultasHasta, instante(d.publicada, "inicio"));
    if (dias >= 0 && dias <= 2) {
      s.push({
        clave: "consultas_cortas",
        nivel: "info",
        titulo: "Ventana de consultas corta",
        evidencia: `Entre la convocatoria y el fin de consultas hubo ${dias === 0 ? "menos de un día" : dias === 1 ? "un día" : "dos días"}.`,
      });
    }
  }

  const peso = { alta: 0, media: 1, info: 2 } as const;
  return s.sort((a, b) => peso[a.nivel] - peso[b.nivel]);
}

/** ¿Tiene alguna señal de riesgo de verdad (alta o media)? Las informativas no cuentan para el filtro. */
export const conRiesgo = (s: Senal[]) => s.some((x) => x.nivel !== "info");
