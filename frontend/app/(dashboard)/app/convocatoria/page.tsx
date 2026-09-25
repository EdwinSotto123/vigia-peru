import { Suspense } from "react";
import type { Metadata } from "next";
import { ConvocatoriaSearch } from "@/components/convocatoria/ConvocatoriaSearch";
import { Cargando, Pagina } from "@/components/patrones";

// El público busca análisis publicados; el equipo, además, despacha uno nuevo.
// El título sirve para los dos (el layout raíz agrega "| Vigía Perú").
export const metadata: Metadata = {
  title: "Análisis de contratos",
  description:
    "Busca un contrato del Estado ya analizado por Vigía: señales de riesgo, evidencia, precios de mercado y dictamen.",
};

// Render dinámico: la lista y la sesión de equipo se resuelven en el cliente en cada visita.
export const dynamic = "force-dynamic";

/** Plantilla "Listado" (DESIGN_SYSTEM.md §14): encabezado → filtros con conteo → tabla → paginación. */
export default function ConvocatoriaPage() {
  return (
    <Pagina>
      <Suspense fallback={<Cargando texto="Cargando los análisis publicados…" />}>
        <ConvocatoriaSearch />
      </Suspense>
    </Pagina>
  );
}
