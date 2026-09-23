import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { FLAGS } from "@/lib/flags";
import { GeneradorNoticia } from "./GeneradorNoticia";

export const metadata: Metadata = {
  title: "Borrador de nota",
  robots: { index: false, follow: false },
};

export default function NoticiaPage() {
  // Herramienta interna: sin el flag editorial, esta ruta no existe para el público.
  if (!FLAGS.editorial) redirect("/app/mapa");
  return (
    <Suspense fallback={<div className="container-page py-10 text-sm text-mute">Cargando…</div>}>
      <GeneradorNoticia />
    </Suspense>
  );
}
