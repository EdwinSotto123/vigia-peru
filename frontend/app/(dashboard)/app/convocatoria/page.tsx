import { Suspense } from "react";
import { ConvocatoriaSearch } from "@/components/ConvocatoriaSearch";

// useSearchParams() en ConvocatoriaSearch requiere render dinámico
export const dynamic = "force-dynamic";

export default function ConvocatoriaPage() {
  return (
    <div className="px-6 py-8 lg:px-10">
      <Suspense fallback={<div className="text-sm text-mute">Cargando…</div>}>
        <ConvocatoriaSearch />
      </Suspense>
    </div>
  );
}
