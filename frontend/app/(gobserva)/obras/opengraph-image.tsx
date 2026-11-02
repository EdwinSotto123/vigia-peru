import { TAMANO_OG, imagenOg } from "@/components/gobserva/imagenOg";

export const alt = "Gobserva Obras: las obras públicas que se vienen y las que están en marcha";
export const size = TAMANO_OG;
export const contentType = "image/png";

export default function Image() {
  return imagenOg("obras", "Las obras públicas que se vienen, antes de que se liciten", "Proyectos viables y con expediente, obras en marcha, su avance y quién las construye.");
}
