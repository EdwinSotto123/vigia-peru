import { redirect } from "next/navigation";

/** Ruta pública legacy: el producto vive dentro de la app (barra lateral). */
export default function Redirect({ params }: { params: { ubigeo: string } }) {
  redirect(`/app/financiar/${params.ubigeo}`);
}
