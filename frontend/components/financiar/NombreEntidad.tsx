import { PersonName } from "@/components/Redact";
import { esRucPersonaNatural } from "@/lib/privacidad";

/**
 * El nombre de una entidad tal cual, salvo que su RUC empiece con 10: eso es una persona
 * natural y su último apellido va tapado (DESIGN_SYSTEM.md §10.6). Las entidades del
 * Estado (RUC 20) nunca se tapan. Server-safe: `PersonName` recibe sólo texto.
 */
export const esRucPersona = (ruc: string | null | undefined) => esRucPersonaNatural(ruc);

export function NombreEntidad({ ruc, nombre }: { ruc: string; nombre: string }) {
  return esRucPersona(ruc) ? <PersonName name={nombre} orden="sunat" /> : <>{nombre}</>;
}
