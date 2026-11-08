import { redirect } from "next/navigation";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/** /app abre «Para ti»: las plazas que calzan con tu perfil. */
export default function App() {
  redirect(rutaEn(baseProducto("empleo"), "/app/para-ti"));
}
