import { TAMANO_OG, imagenOg } from "@/components/gobserva/imagenOg";

export const alt = "Gobserva Salud: verifica tu clínica y a tu médico con fuentes oficiales";
export const size = TAMANO_OG;
export const contentType = "image/png";

export default function Image() {
  return imagenOg(
    "salud",
    "Verifica tu clínica y a tu médico antes de atenderte",
    "Registro en RENIPRESS, categoría, servicios y sanciones firmes de SUSALUD, cada dato con su fuente y su fecha. Gratis y sin cuenta.",
  );
}
