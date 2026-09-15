import { redirect } from "next/navigation";

/** Ruta pública legacy: el producto vive dentro de la app (barra lateral). */
export default function Redirect() {
  redirect("/app/auditoria");
}
