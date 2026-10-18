import { redirect } from "next/navigation";
import { rutaContrato } from "@/lib/rutas";

/** El dictamen es una vista de la página del contrato (lib/rutas.ts): los enlaces viejos llegan ahí, con su pestaña. */
export default function DictamenAnterior({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const tab = typeof searchParams?.tab === "string" ? searchParams.tab : undefined;
  redirect(rutaContrato(decodeURIComponent(params.id), "dictamen", { tab }));
}
