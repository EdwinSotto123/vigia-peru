import type { Metadata } from "next";
import { Suspense } from "react";
import { ParaTiEmpleo } from "@/components/empleo-app/ParaTi";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Para ti", robots: { index: false, follow: false } };

/** «Para ti» de Empleo: las plazas abiertas que calzan con tu perfil (el del onboarding). */
export default function Page() {
  return (
    <Suspense>
      <ParaTiEmpleo base={baseProducto("empleo")} />
    </Suspense>
  );
}
