import { TAMANO_OG, imagenOg } from "@/components/gobserva/imagenOg";

export const alt = "Gobserva Licitaciones: oportunidades para venderle al Estado peruano";
export const size = TAMANO_OG;
export const contentType = "image/png";

export default function Image() {
  return imagenOg("licitaciones", "Véndele al Estado: las oportunidades de tu rubro, cada día", "Convocatorias del SEACE, quién gana y a qué precio. Alertas, API y MCP.");
}
