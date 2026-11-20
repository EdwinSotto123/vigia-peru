/**
 * Cómo verificar a un médico donde sí se puede (el CMP y SUNEDU), con las mismas palabras que la API, el asistente y el
 * MCP (backend/api/src/lib/gobservaSalud.ts → pasosVerificarMedico). Sin JSX: lo usan páginas y componentes.
 *
 * Copia de `pasosVerificarMedico()` mientras lib/gobserva-salud.ts no las exporte: si cambia la
 * redacción allá, cambia aquí.
 */
import { URL_CMP, URL_SUNEDU } from "@/components/salud/fuentes/urls";
import type { PasoVerificar } from "@/lib/gobserva-salud";

export { URL_CMP, URL_SUNEDU };

/** Los 4 pasos; con un número de colegiatura, el primero lo dice. `url` relativa ("/establecimientos") es de este producto. */
export function pasosVerificarMedico(colegiatura?: string | null): PasoVerificar[] {
  return [
    {
      paso: "Búscalo en «Conoce a tu médico» del CMP",
      detalle: colegiatura
        ? `Entra con una cuenta gratuita y busca por número de colegiatura: ${colegiatura}. Ahí ves si está HÁBIL, su especialidad registrada (RNE) y su recertificación.`
        : "Entra con una cuenta gratuita y busca por número de colegiatura o por apellidos y nombres. Ahí ves si está HÁBIL, su especialidad registrada (RNE) y su recertificación.",
      url: URL_CMP,
    },
    {
      paso: "Revisa que la especialidad coincida con lo que te ofrece",
      detalle:
        "En el CMP mira su especialidad registrada (RNE) y compárala con el procedimiento que te ofrece: para una cirugía plástica o estética, que su RNE sea de cirugía plástica. Si no figura un RNE, no está registrado como especialista.",
      url: URL_CMP,
    },
    {
      paso: "Confirma su título en SUNEDU",
      detalle: "En el Registro Nacional de Grados y Títulos aparece el título de médico cirujano y, si la tiene, la segunda especialidad.",
      url: URL_SUNEDU,
    },
    {
      paso: "Verifica también el establecimiento",
      detalle: "Busca aquí la clínica o el consultorio donde te atenderá: su estado en RENIPRESS, su categoría, si tiene centro quirúrgico y sus sanciones firmes.",
      url: "/establecimientos",
    },
  ];
}
