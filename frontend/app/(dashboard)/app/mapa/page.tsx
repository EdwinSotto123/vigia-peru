import { MapPin } from "lucide-react";
import { MapaWrapper } from "@/components/MapaWrapper";
import { PageHeader } from "@/components/dashboard/PageHeader";

export default function MapaPage() {
  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <PageHeader
        eyebrow="Mapa interactivo"
        icon={<MapPin size={11} className="text-clay" />}
        title="El Perú departamento por departamento"
        subtitle="Click cualquier región para ver presupuesto MEF, alertas, entidades y provincias."
      />
      <MapaWrapper />
    </div>
  );
}
