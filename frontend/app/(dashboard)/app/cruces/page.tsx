import { redirect } from "next/navigation";

/**
 * /app/cruces se juntó con la lista de contratos: cada fila trae los cruces de su ganador y el filtro "Ganador en
 * otros registros" (con los tipos de cruce a la vista). Los enlaces viejos llegan a la misma lista ya filtrada.
 */
export default function CrucesPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const uno = (k: string) => (typeof searchParams?.[k] === "string" ? (searchParams[k] as string) : undefined);
  const q = new URLSearchParams({ cruces: uno("severidad") === "alta" ? "alta" : "con" });
  const tipo = uno("tipo");
  if (tipo && /^[a-z_]+(,[a-z_]+)*$/.test(tipo)) q.set("cruce", tipo);
  for (const k of ["q", "entidad"]) if (uno(k)) q.set(k, uno(k)!);
  if (uno("departamento")) q.set("ubigeo", uno("departamento")!);
  redirect(`/app/contratos?${q}`);
}
