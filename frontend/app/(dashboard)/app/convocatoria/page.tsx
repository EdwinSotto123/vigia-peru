import { Suspense } from "react";
import type { Metadata } from "next";
import { ConvocatoriaSearch } from "@/components/convocatoria/ConvocatoriaSearch";

// El público busca análisis publicados; el equipo, además, despacha uno nuevo.
// El título sirve para los dos (el layout raíz agrega "| Vigía Perú").
export const metadata: Metadata = {
  title: "Análisis de contratos",
  description:
    "Busca un contrato del Estado ya analizado por Vigía: señales de riesgo, evidencia, precios de mercado y dictamen.",
};

// Render dinámico: la lista y la sesión de equipo se resuelven en el cliente en cada visita.
export const dynamic = "force-dynamic";

export default function ConvocatoriaPage() {
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <Suspense fallback={<div className="text-sm text-mute">Cargando…</div>}>
        <ConvocatoriaSearch />
      </Suspense>
    </div>
  );
}
