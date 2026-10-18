import { redirect } from "next/navigation";

/**
 * "Análisis publicados" era una cuarta lista de contratos ya leídos. Ahora es la lista de contratos ordenada por peso del
 * riesgo (los leídos primero), con los mismos filtros: búsqueda, riesgo y tipo.
 */
export default function AnalisisPublicadosAnterior({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const uno = (k: string) => (typeof searchParams?.[k] === "string" ? (searchParams[k] as string) : undefined);
  const q = new URLSearchParams({ orden: "score" });
  for (const k of ["q", "riesgo", "tipo"]) if (uno(k)) q.set(k, uno(k)!);
  redirect(`/app/contratos?${q}`);
}
