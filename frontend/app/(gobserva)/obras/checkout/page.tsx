import { redirect } from "next/navigation";
import { urlCanonica } from "@/lib/gobserva";

/** Obras se contrata con un plan de Gobserva Licitaciones (2026-11-07): el checkout de Obras pasa al de Licitaciones. */
export default function Page({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const plan = typeof searchParams.plan === "string" && ["inicia", "crece", "pro"].includes(searchParams.plan) ? searchParams.plan : null;
  redirect(urlCanonica("licitaciones", plan ? `/checkout?plan=${plan}` : "/planes"));
}
