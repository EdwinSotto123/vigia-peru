import { redirect } from "next/navigation";

/** /app/financiar/entidad sin RUC: la lista de entidades para financiar. */
export default function FinanciarEntidadSinRuc() {
  redirect("/app/financiar?por=entidad");
}
