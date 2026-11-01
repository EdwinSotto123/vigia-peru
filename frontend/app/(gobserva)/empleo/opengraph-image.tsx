import { TAMANO_OG, imagenOg } from "@/components/gobserva/imagenOg";

export const alt = "Gobserva Empleo: todas las plazas CAS del Estado peruano";
export const size = TAMANO_OG;
export const contentType = "image/png";

export default function Image() {
  return imagenOg("empleo", "Todas las plazas CAS del Estado, en un solo lugar", "Sueldo, requisitos, cuándo cierran y lo que nadie te dice. Alertas por correo y WhatsApp.");
}
