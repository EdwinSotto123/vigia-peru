import { redirect } from "next/navigation";

/**
 * Ruta legacy. El dossier real de una convocatoria vive en
 * /app/convocatoria/[ocid] (carga datos reales desde Cloud SQL vía
 * /api/agent/history). Esta ruta solo redirige para no romper enlaces viejos
 * ni renderizar el antiguo dossier mock.
 */
export default function AlertaLegacyRedirect({ params }: { params: { id: string } }) {
  const ocid = decodeURIComponent(params.id).replace(/^OECE-/i, "");
  redirect(`/app/convocatoria/${ocid}`);
}
