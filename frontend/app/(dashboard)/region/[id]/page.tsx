import { redirect } from "next/navigation";

/** La ficha de región vive en el hub del mapa (panel de zona con cola, entidades, alertas, denuncias y presupuesto). */
export default function RegionRedirect({ params }: { params: { id: string } }) {
  redirect(`/app/mapa?region=${encodeURIComponent(params.id)}&tab=presupuesto`);
}
