import { PersonName } from "@/components/Redact";

/**
 * El nombre de una entidad tal cual, salvo que su RUC empiece con 10: eso es una persona
 * natural y su último apellido va en vidrio (DESIGN_SYSTEM.md §10.6). Las entidades del
 * Estado (RUC 20) nunca se tapan. Server-safe: `PersonName` recibe sólo texto.
 */
export const esRucPersona = (ruc: string | null | undefined) => !!ruc && /^10\d{9}$/.test(ruc.trim());

export function NombreEntidad({ ruc, nombre }: { ruc: string; nombre: string }) {
  return esRucPersona(ruc) ? <PersonName name={nombre} orden="sunat" /> : <>{nombre}</>;
}
