import { redirect } from "next/navigation";

/** /donar lleva al aporte al fondo común («Ayúdanos a seguir vigilando»). */
export default function DonarRedirect() {
  redirect("/app/apoyar");
}
