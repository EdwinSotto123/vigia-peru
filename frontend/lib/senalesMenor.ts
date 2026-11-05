import { fechaConAnio, numero, soles } from "./formato";
import type { SenalMenor, SenalMenorFila } from "./menores";

/**
 * Las señales de un contrato menor (menor_senal, migración 252) en palabras: el chip de la fila (corto, entero), el
 * nombre de la bandera en la ficha y lo que significa, con las cifras de su evidencia. Indicios para revisar, no
 * acusaciones: cada explicación dice qué se midió.
 */
export interface TextoSenal {
  chip: string;
  nombre: string;
  explica: string;
}

const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const horasTxt = (h: number | null) =>
  h == null ? "pocas horas" : h < 1 ? `${Math.max(1, Math.round(h * 60))} minutos` : `${numero(Math.round(h * 10) / 10)} ${h === 1 ? "hora" : "horas"}`;

/** El texto de una señal; con `detalle` (la ficha) la explicación usa toda la evidencia. */
export function textoSenal(s: SenalMenorFila & Partial<Pick<SenalMenor, "detalle">>): TextoSenal {
  const d = (s.detalle ?? {}) as Record<string, unknown>;
  const tope = n(d.tope);
  const contratos = n(s.contratos) ?? n(d.contratos);
  switch (s.tipo) {
    case "menor_partido_mismo_dia":
      return {
        chip: "Compra partida el mismo día",
        nombre: "Compra partida el mismo día",
        explica: `${contratos ? `${contratos} contratos menores` : "Varios contratos menores"} de la misma entidad al mismo proveedor, firmados el mismo día, suman ${soles(s.monto)}${tope ? `: más que el tope de 8 UIT (${soles(tope)})` : ", más que el tope de 8 UIT"}. La ley prohíbe partir una compra para no hacer un procedimiento de selección.`,
      };
    case "menor_partido_en_el_anio": {
      const mismo = n(d.mismo_item);
      return {
        chip: "Compra partida en el año",
        nombre: "Compra partida en el año",
        explica: `${contratos ? `${contratos} contratos menores` : "Varios contratos menores"} del mismo tipo con este proveedor${n(d.anio) ? ` en ${d.anio}` : " en el año"} suman ${soles(s.monto)}${tope ? `, más que el tope de 8 UIT (${soles(tope)})` : ", más que el tope de 8 UIT"}${mismo ? `; ${mismo} repiten el mismo ítem del catálogo` : ""}. Puede ser una compra que debió hacerse por un procedimiento de selección.`,
      };
    }
    case "menor_sobre_tope":
      return {
        chip: "Más de 8 UIT",
        nombre: "Pasa el tope de 8 UIT",
        explica: `El monto pasa el tope de 8 UIT de su año${tope ? ` (${soles(tope)})` : ""} por ${soles(s.monto)}. Un contrato menor no debería: o se registró mal, o debió ir por un procedimiento de selección.`,
      };
    case "menor_borde_tope":
      return {
        chip: "Al borde del tope",
        nombre: "Al borde del tope de 8 UIT",
        explica: `Queda en el ${numero(n(s.pct) ?? n(d.pct))} % del tope de 8 UIT de su año. Un monto pegado al tope es la marca de una compra que se ajustó para no pasar a un procedimiento.`,
      };
    case "menor_ventana_corta": {
      const h = n(s.horas) ?? n(d.horas);
      return {
        chip: `${horasTxt(h)} para cotizar`,
        nombre: "Ventana de cotización corta",
        explica: `La entidad dejó cotizar ${horasTxt(h)}. Con tan poco tiempo, casi sólo puede cotizar quien ya sabía de la compra.`,
      };
    }
    case "menor_invitacion_cerrada":
      return {
        chip: "Invitación cerrada",
        nombre: "Invitación cerrada",
        explica: `La entidad no abrió la cotización a todos: invitó a quienes eligió${typeof d.justificacion === "string" && d.justificacion ? `. Su justificación: «${d.justificacion}»` : ""}.`,
      };
    case "menor_fin_de_semana":
      return {
        chip: "Firmado en fin de semana",
        nombre: "Firmado en fin de semana",
        explica: `Se firmó un ${typeof d.dia === "string" ? d.dia : "sábado o domingo"}${typeof d.fecha === "string" ? ` (${fechaConAnio(d.fecha)})` : ""}. No prueba nada por sí solo.`,
      };
    case "menor_precio_alto": {
      const p = (d.peor ?? {}) as Record<string, unknown>;
      const razon = n(p.razon);
      return {
        chip: "Precio alto",
        nombre: "Precio por encima de lo que pagan otras entidades",
        explica: p.descripcion
          ? `«${p.descripcion}» se pagó a ${soles(n(p.unitario))} por ${String(p.unidad ?? "unidad").toLowerCase()}${razon ? `, ${numero(Math.round(razon * 10) / 10)} veces la mediana (${soles(n(p.mediana))})` : ""} de lo que pagaron ${numero(n(p.entidades))} entidades por el mismo ítem del catálogo.`
          : `Un ítem se pagó 2 veces o más la mediana de lo que pagan las demás entidades por el mismo ítem del catálogo${s.monto ? `: ${soles(s.monto)} por encima de lo habitual` : ""}.`,
      };
    }
    case "tdr_proveedor_nombrado":
      return {
        chip: "El requerimiento nombra al proveedor",
        nombre: "El requerimiento nombra a quién contratar",
        explica: "El requerimiento dice a qué persona o empresa se contratará antes de pedir cotizaciones. Lo encontraron dos lecturas independientes de la IA.",
      };
    case "tdr_marca_sin_equivalente":
      return {
        chip: "Marca sin «o equivalente»",
        nombre: "Exige una marca sin «o equivalente»",
        explica: "El requerimiento exige una marca, un fabricante o un modelo sin admitir uno equivalente: deja fuera a quien venda otra marca. Lo encontraron dos lecturas de la IA.",
      };
    case "tdr_monto_distinto":
      return {
        chip: "Monto distinto al del requerimiento",
        nombre: "El monto no cuadra con el requerimiento",
        explica: `El monto registrado es 5 veces mayor o menor que el que estima el requerimiento${n(d.estimado) ? ` (${soles(n(d.estimado))})` : ""}: otro monto, o uno mal registrado.`,
      };
    case "tdr_experiencia_alta":
      return {
        chip: "Experiencia exigida alta",
        nombre: "Experiencia exigida desproporcionada",
        explica: `El requerimiento pide al proveedor una experiencia de ${soles(s.monto)} o más, 3 veces el monto del contrato o más: deja fuera a casi todos.`,
      };
    case "contrato_monto_distinto":
      return {
        chip: "El contrato dice otro monto",
        nombre: "El contrato dice otro monto",
        explica: `El contrato u orden dice ${soles(n(d.en_documento))} y el SEACE registra ${soles(n(d.registrado))}: ${soles(s.monto)} de diferencia. Lo confirmaron dos lecturas de la IA.`,
      };
    case "contrato_ruc_distinto":
      return {
        chip: "El contrato es con otro RUC",
        nombre: "El contrato es con otro proveedor",
        explica: `El contrato u orden es con otro RUC${typeof d.ruc_en_documento === "string" ? ` (${d.ruc_en_documento})` : ""} que el del proveedor que registra el SEACE. Lo confirmaron dos lecturas de la IA.`,
      };
    default:
      return { chip: s.tipo.replace(/_/g, " "), nombre: s.tipo.replace(/_/g, " "), explica: "Señal de este contrato menor." };
  }
}
