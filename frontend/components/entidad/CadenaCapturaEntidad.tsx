import { getCadenaEntidad } from "@/lib/cadena";
import { CadenaCaptura } from "./CadenaCaptura";

/**
 * Trae la cadena de captura de la entidad (/cadena/entidad/:ruc, Capa C) y la dibuja; oculta si no hay partido ni
 * empresas ligadas. Indicios para revisión humana, no una acusación.
 */
export async function CadenaCapturaEntidad({ ruc }: { ruc: string }) {
  const cadena = await getCadenaEntidad(ruc).catch(() => null);
  if (!cadena) return null;
  return <CadenaCaptura cadena={cadena} />;
}
