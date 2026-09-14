import { redirect } from "next/navigation";

/** /donar se reemplazó por "Financia una auditoría" (docs/design/FINANCIA_UNA_AUDITORIA.md). */
export default function DonarRedirect() {
  redirect("/financiar");
}
