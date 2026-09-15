import { redirect } from "next/navigation";

/** Ruta pública legacy: el producto vive dentro de la app (barra lateral). */
export default function Redirect({ params }: { params: { ocid: string } }) {
  redirect(`/app/auditoria/${encodeURIComponent(params.ocid)}`);
}
