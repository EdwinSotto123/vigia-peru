import { redirect } from "next/navigation";

/**
 * Ruta legacy. El dossier real vive en /app/convocatoria/[ocid] (datos
 * persistidos vía /api/agent/history). Solo redirige para no romper enlaces
 * viejos; el antiguo visor OCDS en vivo se retiró.
 */
export default function ConvocatoriaLegacyRedirect({ params }: { params: { id: string } }) {
  redirect(`/app/convocatoria/${encodeURIComponent(params.id)}`);
}
