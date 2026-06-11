import { Building2, Cloud } from "lucide-react";
import { EntidadesPanel } from "@/components/EntidadesPanel";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { getEntidades } from "@/lib/api-client";
import { ENTIDADES } from "@/lib/mock-entities";

export default async function EntidadesPage() {
  let entidades: any[] = [];
  let source: "api" | "mock" = "api";
  try {
    entidades = await getEntidades({ limit: 100 });
  } catch (e) {
    console.error("[entidades page] API falló, uso mock:", (e as Error).message);
    entidades = ENTIDADES;
    source = "mock";
  }

  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <PageHeader
        eyebrow="Ranking de entidades"
        icon={<Building2 size={11} className="text-clay" />}
        title="Gobiernos regionales y municipios"
        subtitle="Ordenados por riesgo. Click cualquier entidad para ver perfil completo con ejecución MEF y proveedores."
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
            {source === "api" ? "live · Cloud SQL" : "mock"}
          </span>
        }
      />
      <EntidadesPanel entidades={entidades} />
    </div>
  );
}
