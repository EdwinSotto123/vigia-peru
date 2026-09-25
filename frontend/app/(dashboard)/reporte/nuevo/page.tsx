import type { Metadata } from "next";
import { Suspense } from "react";
import { Cargando, Pagina } from "@/components/patrones";
import { ReporteNuevo } from "./ReporteNuevo";

export const metadata: Metadata = {
  title: "Denunciar una obra o entidad",
  description:
    "Sube una foto, marca el lugar y cuenta qué viste. Las denuncias de obra se publican para que cualquiera las vea; las de una entidad quedan en reserva.",
};

export default function ReporteNuevoPage() {
  return (
    <Suspense
      fallback={
        <Pagina>
          <Cargando texto="Cargando el formulario…" className="max-w-3xl" />
        </Pagina>
      }
    >
      <ReporteNuevo />
    </Suspense>
  );
}
