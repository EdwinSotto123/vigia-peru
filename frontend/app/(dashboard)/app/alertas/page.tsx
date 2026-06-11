import { AlertTriangle, Cloud } from "lucide-react";
import { TopAlertasList } from "@/components/TopAlertasList";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { getAlertas } from "@/lib/api-client";
import type { Alerta } from "@/types";

export default async function AlertasPage() {
  let alertas: Alerta[] = [];
  let source: "api" | "mock" = "api";
  try {
    // TopAlertasList muestra el top 6 por score; la API ya ordena por score DESC.
    alertas = (await getAlertas({ limit: 12 })) as any;
  } catch (e) {
    console.error("[alertas page] API falló:", (e as Error).message);
    alertas = [];
    source = "mock";
  }

  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <PageHeader
        eyebrow="Alertas activas"
        icon={<AlertTriangle size={11} className="text-clay" />}
        title="Top alertas del mes"
        subtitle="Ordenadas por score de riesgo. Click cualquier alerta para ver el dossier completo con red de personas y fuentes."
        actions={
          <span
            className={
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-widest " +
              (source === "api"
                ? "border-moss/40 bg-moss/10 text-moss"
                : "border-amber/40 bg-amber-soft text-amber")
            }
          >
            <Cloud size={11} />
            {source === "api" ? "live · Cloud SQL" : "mock (API caída)"}
          </span>
        }
      />
      <TopAlertasList alertas={alertas} />
    </div>
  );
}
