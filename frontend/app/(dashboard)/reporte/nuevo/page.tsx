import type { Metadata } from "next";
import { Suspense } from "react";
import { ReporteNuevo } from "./ReporteNuevo";

export const metadata: Metadata = {
  title: "Denunciar una obra o entidad",
  description: "Sube una foto, marca el lugar y cuenta qué viste. Tu denuncia se publica para que cualquiera la vea.",
};

export default function ReporteNuevoPage() {
  return (
    <Suspense fallback={<div className="container-page py-10 text-sm text-mute">Cargando el formulario…</div>}>
      <ReporteNuevo />
    </Suspense>
  );
}
