import { redirect } from "next/navigation";
import { rutaContrato } from "@/lib/rutas";

/** La lectura en vivo es una vista de la página del contrato (lib/rutas.ts). */
export default function EnVivoAnterior({ params }: { params: { ocid: string } }) {
  redirect(rutaContrato(decodeURIComponent(params.ocid), "vivo"));
}
