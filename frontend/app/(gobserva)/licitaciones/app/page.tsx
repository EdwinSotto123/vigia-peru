import { redirect } from "next/navigation";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

/** /app abre la bandeja (cuando exista el panel, el panel). */
export default function App() {
  redirect(rutaEn(baseProducto("licitaciones"), "/app/bandeja"));
}
