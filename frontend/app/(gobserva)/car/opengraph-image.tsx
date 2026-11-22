import { TAMANO_OG, imagenOg } from "@/components/gobserva/imagenOg";

export const alt = "Gobserva Car: verifica un auto antes de comprarlo o de subirte";
export const size = TAMANO_OG;
export const contentType = "image/png";

export default function Image() {
  return imagenOg(
    "car",
    "Verifica un auto antes de comprarlo o de subirte",
    "Placa, SOAT, revisión técnica y papeletas en las fuentes oficiales, con la placa lista para copiar. Gratis y sin cuenta.",
  );
}
